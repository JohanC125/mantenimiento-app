-- AVISO is required for new orders, while pre-existing orders remain nullable.
-- Apply after 20260921_status_flow_correction.sql; no historical backfill.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

alter table public.maintenance_orders add column if not exists aviso text;

-- Partial contains-search (for example, "ascensor") cannot use a B-tree.
create extension if not exists pg_trgm with schema public;
do $$
declare operator_class text;
begin
  select pg_catalog.format('%I.%I',n.nspname,c.opcname) into operator_class
  from pg_catalog.pg_opclass c
  join pg_catalog.pg_namespace n on n.oid=c.opcnamespace
  where c.opcname='gin_trgm_ops' limit 1;
  if operator_class is null then raise exception 'pg_trgm no está disponible'; end if;
  execute pg_catalog.format(
    'create index if not exists maintenance_orders_aviso_trgm_idx on public.maintenance_orders using gin (aviso %s)',
    operator_class
  );
end $$;

create function public.normalize_order_aviso(p_aviso text)
returns text language plpgsql immutable set search_path = ''
as $$
declare normalized text;
begin
  normalized := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_aviso,''), '[[:space:]]+', ' ', 'g'));
  if normalized !~* '^AVISO .*[[:alnum:]].*$' then
    raise exception 'El aviso debe comenzar por AVISO y contener un asunto después';
  end if;
  return 'AVISO ' || pg_catalog.substr(normalized, 7);
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.maintenance_orders'::regclass
      and conname = 'maintenance_orders_aviso_format_check'
      and contype = 'c'
  ) then
    alter table public.maintenance_orders
      add constraint maintenance_orders_aviso_format_check
      check (case when aviso is null then true
                  else aviso = public.normalize_order_aviso(aviso) end);
  end if;
end $$;

create function public.enforce_order_aviso()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare parent_aviso text;
begin
  if tg_op = 'UPDATE' then
    if new.aviso is distinct from old.aviso then
      raise exception 'El aviso de una orden no se puede modificar';
    end if;
    return new;
  end if;

  new.aviso := public.normalize_order_aviso(new.aviso);
  if new.parent_order_id is not null then
    select aviso into parent_aviso
    from public.maintenance_orders where id = new.parent_order_id;
    if not found or parent_aviso is distinct from new.aviso then
      raise exception 'La reprogramación debe heredar el aviso de la OT padre';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_orders_aviso_guard on public.maintenance_orders;
create trigger maintenance_orders_aviso_guard
before insert or update of aviso on public.maintenance_orders
for each row execute function public.enforce_order_aviso();

-- Remove the old callable signature atomically: no client may omit AVISO.
drop function public.create_maintenance_order_v2(bigint,text,text,date,time without time zone);

create function public.create_maintenance_order_v2(
  p_site_id bigint,
  p_maintenance_type text,
  p_description text,
  p_scheduled_date date,
  p_scheduled_time time without time zone,
  p_aviso text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare oid bigint; num bigint; site_requires_coproperty boolean;
  normalized_aviso text;
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador','planeador') then
    raise exception 'Solo administrador o planeador pueden crear órdenes';
  end if;
  normalized_aviso := public.normalize_order_aviso(p_aviso);
  select requires_coproperty into site_requires_coproperty
    from public.sites where id = p_site_id and active = true;
  if not found then raise exception 'Sede no disponible'; end if;
  if p_maintenance_type is null or p_maintenance_type not in ('preventivo','correctivo')
     or nullif(trim(p_description),'') is null
     or p_scheduled_date is null or p_scheduled_time is null then
    raise exception 'Datos de orden inválidos: fecha y hora son obligatorias';
  end if;
  insert into public.maintenance_orders(
    parent_order_id,root_order_id,reprogramming_number,site_id,
    maintenance_type,description,scheduled_date,scheduled_time,
    status,approval_status,created_by,requires_coproperty,provider_id,aviso
  ) values(
    null,null,0,p_site_id,p_maintenance_type,trim(p_description),
    p_scheduled_date,p_scheduled_time,'pendiente','pendiente',auth.uid(),
    site_requires_coproperty,null,normalized_aviso
  ) returning id,order_number into oid,num;
  update public.maintenance_orders set root_order_id=oid where id=oid;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
    values(oid,auth.uid(),'create',jsonb_build_object('created_by',auth.uid())::text);
  return num;
end;
$$;

create or replace function public.reprogram_maintenance_order_v2(
  p_parent_order_id bigint,
  p_new_scheduled_date date,
  p_new_scheduled_time time without time zone,
  p_reason text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare o public.maintenance_orders%rowtype; child_id bigint; child_number bigint;
  site_requires_coproperty boolean;
  reprogrammed_at_value timestamptz := now(); reason_value text := nullif(trim(p_reason),'');
begin
  if coalesce(public.maintenance_current_role(),'') not in ('administrador','planeador') then
    raise exception 'Solo administrador o planeador pueden reprogramar órdenes';
  end if;
  if p_new_scheduled_date is null or p_new_scheduled_time is null or reason_value is null then
    raise exception 'Nueva fecha, nueva hora y motivo son obligatorios';
  end if;
  select * into o from public.maintenance_orders where id=p_parent_order_id for update;
  if not found or o.deleted_at is not null
     or o.status not in ('pendiente','programada','en_ejecucion') then
    raise exception 'Orden no reprogramable';
  end if;
  if o.aviso is null then
    raise exception 'La OT histórica no tiene AVISO y no puede reprogramarse sin inventar uno';
  end if;
  select requires_coproperty into site_requires_coproperty from public.sites where id=o.site_id;
  if not found then raise exception 'Sede no disponible'; end if;
  update public.maintenance_orders
    set status='reprogramada',reprogramming_reason=reason_value,
        reprogrammed_by=auth.uid(),reprogrammed_at=reprogrammed_at_value
    where id=o.id;
  insert into public.maintenance_orders(
    parent_order_id,root_order_id,reprogramming_number,site_id,provider_id,
    maintenance_type,description,scheduled_date,scheduled_time,
    status,approval_status,created_by,reprogramming_reason,reprogrammed_by,
    reprogrammed_at,requires_coproperty,aviso
  ) values(
    o.id,coalesce(o.root_order_id,o.id),o.reprogramming_number+1,o.site_id,null,
    o.maintenance_type,o.description,p_new_scheduled_date,p_new_scheduled_time,
    'pendiente','pendiente',auth.uid(),reason_value,auth.uid(),
    reprogrammed_at_value,site_requires_coproperty,o.aviso
  ) returning id,order_number into child_id,child_number;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
  values
    (o.id,auth.uid(),'reprogram',jsonb_build_object('child_order_id',child_id,'child_order_number',child_number,'new_date',p_new_scheduled_date,'new_time',p_new_scheduled_time,'reason',reason_value)::text),
    (child_id,auth.uid(),'create',jsonb_build_object('parent_order_id',o.id,'root_order_id',coalesce(o.root_order_id,o.id),'reprogramming_number',o.reprogramming_number+1,'reason',reason_value)::text);
  return child_number;
end;
$$;

-- Search is server-side. A match on AVISO expands through the existing root ID;
-- direct OT-radicado searches return the matching OT only. Buckets still filter.
create function public.search_maintenance_orders_v2(p_query text, p_bucket text)
returns table(order_id bigint, aviso_match boolean)
language plpgsql stable security invoker set search_path = ''
as $$
declare term text := pg_catalog.btrim(p_query); direct_ot boolean; pattern text;
begin
  if coalesce(public.maintenance_current_role(),'') not in ('administrador','planeador','auxiliar') then
    raise exception 'No tienes permiso para consultar órdenes';
  end if;
  if p_bucket not in ('todas','pendientes','programadas','en-ejecucion',
                      'completadas','reprogramadas','canceladas','eliminadas') then
    raise exception 'Bandeja inválida';
  end if;
  if p_bucket='eliminadas' and public.maintenance_current_role()<>'administrador' then
    raise exception 'Solo el administrador puede consultar órdenes eliminadas';
  end if;
  if term is null or term = '' then return; end if;
  direct_ot := term ~* '^OT-[0-9]+$';
  pattern := '%' || pg_catalog.replace(pg_catalog.replace(
    pg_catalog.replace(term, pg_catalog.chr(92), pg_catalog.chr(92) || pg_catalog.chr(92)),
    '%', pg_catalog.chr(92) || '%'), '_', pg_catalog.chr(92) || '_') || '%';
  return query
  with matching_roots as (
    select distinct coalesce(m.root_order_id,m.id) as root_id
    from public.maintenance_orders m
    where not direct_ot and m.aviso ilike pattern escape pg_catalog.chr(92)
  )
  select o.id,
    (not direct_ot and exists(
      select 1 from matching_roots r where r.root_id=coalesce(o.root_order_id,o.id)
    )) as aviso_match
  from public.maintenance_orders o
  left join public.sites s on s.id=o.site_id
  where (
    (p_bucket='eliminadas' and o.deleted_at is not null)
    or (p_bucket='todas' and o.deleted_at is null)
    or (p_bucket='pendientes' and o.deleted_at is null and o.status='pendiente')
    or (p_bucket='programadas' and o.deleted_at is null and o.status='programada')
    or (p_bucket='en-ejecucion' and o.deleted_at is null and o.status='en_ejecucion')
    or (p_bucket='completadas' and o.deleted_at is null and o.status='completada')
    or (p_bucket='reprogramadas' and o.deleted_at is null and o.status='reprogramada')
    or (p_bucket='canceladas' and o.deleted_at is null and o.status='cancelada')
  ) and (
    (direct_ot and o.order_number::text = pg_catalog.ltrim(pg_catalog.substr(term, 4),'0'))
    or (not direct_ot and (
      exists(select 1 from matching_roots r where r.root_id=coalesce(o.root_order_id,o.id))
      or o.order_number::text ilike pattern escape pg_catalog.chr(92)
      or o.description ilike pattern escape pg_catalog.chr(92)
      or s.name ilike pattern escape pg_catalog.chr(92)
    ))
  )
  order by o.id desc;
end;
$$;

revoke all on function public.normalize_order_aviso(text),
  public.create_maintenance_order_v2(bigint,text,text,date,time without time zone,text),
  public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text),
  public.search_maintenance_orders_v2(text,text)
  from public,anon,authenticated;
grant execute on function public.create_maintenance_order_v2(bigint,text,text,date,time without time zone,text),
  public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text),
  public.search_maintenance_orders_v2(text,text) to authenticated;

-- Earlier migrations deliberately retained provider-based overloads, but
-- revoked them. Reaffirm that no legacy creation entrypoint is client-callable.
do $$
declare older record;
begin
  for older in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_maintenance_order_v2'
      and p.oid <> 'public.create_maintenance_order_v2(bigint,text,text,date,time without time zone,text)'::regprocedure
  loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated',older.signature);
  end loop;
end $$;

do $$
begin
  if not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='maintenance_orders'
         and column_name='aviso' and data_type='text'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid='public.maintenance_orders'::regclass
         and tgname='maintenance_orders_aviso_guard' and not tgisinternal
     )
     or pg_catalog.to_regclass('public.maintenance_orders_aviso_trgm_idx') is null
     or pg_catalog.to_regprocedure('public.create_maintenance_order_v2(bigint,text,text,date,time without time zone)') is not null
     or exists (
       select 1 from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='create_maintenance_order_v2'
         and p.oid <> 'public.create_maintenance_order_v2(bigint,text,text,date,time without time zone,text)'::regprocedure
         and (pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
              or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
              or exists (
                select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
                where acl.grantee=0 and acl.privilege_type='EXECUTE'
              ))
     )
     or not pg_catalog.has_function_privilege('authenticated',
       'public.create_maintenance_order_v2(bigint,text,text,date,time without time zone,text)'::regprocedure,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',
       'public.create_maintenance_order_v2(bigint,text,text,date,time without time zone,text)'::regprocedure,'EXECUTE')
     or exists (
       select 1 from pg_catalog.pg_proc p
       cross join lateral pg_catalog.aclexplode(
         coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
       where p.oid = 'public.create_maintenance_order_v2(bigint,text,text,date,time without time zone,text)'::regprocedure
         and acl.grantee=0 and acl.privilege_type='EXECUTE'
     ) then
    raise exception 'AVISO: firma o permisos de creación inválidos';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
