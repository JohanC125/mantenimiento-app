-- Retira proveedores del flujo operativo de órdenes.
-- Aplicar únicamente después de 20260921_reprogramming_correction.sql.
-- No elimina providers, provider_id ni modifica datos históricos.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='maintenance_orders'
      and column_name='provider_id'
  ) then
    raise exception 'No se encontró maintenance_orders.provider_id';
  end if;
end $$;

alter table public.maintenance_orders
  alter column provider_id drop not null;

create or replace function public.create_maintenance_order_v2(
  p_site_id bigint,
  p_maintenance_type text,
  p_description text,
  p_scheduled_date date,
  p_scheduled_time time without time zone
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  oid bigint;
  num bigint;
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador', 'planeador') then
    raise exception 'Solo administrador o planeador pueden crear órdenes';
  end if;
  if not exists (
    select 1 from public.sites where id=p_site_id and active=true
  ) then
    raise exception 'Sede no disponible';
  end if;
  if p_maintenance_type not in ('preventivo','correctivo')
     or nullif(trim(p_description),'') is null
     or p_scheduled_date is null
     or p_scheduled_time is null then
    raise exception 'Datos de orden inválidos: fecha y hora son obligatorias';
  end if;

  insert into public.maintenance_orders(
    parent_order_id, root_order_id, reprogramming_number,
    site_id, maintenance_type, description,
    scheduled_date, scheduled_time, status, approval_status, created_by
  ) values (
    null, null, 0,
    p_site_id, p_maintenance_type, trim(p_description),
    p_scheduled_date, p_scheduled_time, 'programada', 'pendiente', auth.uid()
  ) returning id, order_number into oid, num;

  update public.maintenance_orders set root_order_id=oid where id=oid;
  insert into public.maintenance_events(order_id, actor_id, action, detail)
    values (oid, auth.uid(), 'create', jsonb_build_object('created_by', auth.uid())::text);
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
language plpgsql
security definer
set search_path=''
as $$
declare
  o public.maintenance_orders%rowtype;
  child_id bigint;
  child_number bigint;
  reprogrammed_at_value timestamptz := now();
  reason_value text := nullif(trim(p_reason), '');
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador', 'planeador') then
    raise exception 'Solo administrador o planeador pueden reprogramar órdenes';
  end if;
  if p_new_scheduled_date is null or p_new_scheduled_time is null or reason_value is null then
    raise exception 'Nueva fecha, nueva hora y motivo son obligatorios';
  end if;
  select * into o from public.maintenance_orders where id=p_parent_order_id for update;
  if not found or o.deleted_at is not null or o.status in ('completada','cancelada','reprogramada') then
    raise exception 'Orden no reprogramable';
  end if;

  update public.maintenance_orders
  set status='reprogramada', reprogramming_reason=reason_value,
      reprogrammed_by=auth.uid(), reprogrammed_at=reprogrammed_at_value
  where id=o.id;

  insert into public.maintenance_orders(
    parent_order_id, root_order_id, reprogramming_number,
    site_id, provider_id, maintenance_type, description,
    scheduled_date, scheduled_time, status, approval_status, created_by,
    reprogramming_reason, reprogrammed_by, reprogrammed_at
  ) values (
    o.id, coalesce(o.root_order_id, o.id), o.reprogramming_number+1,
    o.site_id, null, o.maintenance_type, o.description,
    p_new_scheduled_date, p_new_scheduled_time, 'programada', 'pendiente', auth.uid(),
    reason_value, auth.uid(), reprogrammed_at_value
  ) returning id, order_number into child_id, child_number;

  insert into public.maintenance_events(order_id, actor_id, action, detail)
  values
    (o.id, auth.uid(), 'reprogram', jsonb_build_object(
      'child_order_id', child_id, 'child_order_number', child_number,
      'new_date', p_new_scheduled_date, 'new_time', p_new_scheduled_time,
      'reason', reason_value)::text),
    (child_id, auth.uid(), 'create', jsonb_build_object(
      'parent_order_id', o.id, 'root_order_id', coalesce(o.root_order_id, o.id),
      'reprogramming_number', o.reprogramming_number+1, 'reason', reason_value)::text);
  return child_number;
end;
$$;

-- Ninguna firma que acepte proveedor queda disponible para clientes.
revoke all on function public.create_maintenance_order_v2(bigint,bigint,text,text,date)
  from public, anon, authenticated;
revoke all on function public.create_maintenance_order_v2(bigint,bigint,text,text,date,time without time zone)
  from public, anon, authenticated;
revoke all on function public.create_maintenance_order_v2(bigint,text,text,date,time without time zone)
  from public, anon;
grant execute on function public.create_maintenance_order_v2(bigint,text,text,date,time without time zone)
  to authenticated;

revoke all on function public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text)
  from public, anon;
grant execute on function public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text)
  to authenticated;

do $$
declare nullable_value text;
begin
  select is_nullable into nullable_value
  from information_schema.columns
  where table_schema='public'
    and table_name='maintenance_orders'
    and column_name='provider_id';
  if nullable_value is distinct from 'YES' then
    raise exception 'maintenance_orders.provider_id no quedó nullable';
  end if;
end $$;

do $$
declare
  old_date_only regprocedure := to_regprocedure(
    'public.create_maintenance_order_v2(bigint,bigint,text,text,date)'
  );
  old_with_time regprocedure := to_regprocedure(
    'public.create_maintenance_order_v2(bigint,bigint,text,text,date,time without time zone)'
  );
  new_signature regprocedure := to_regprocedure(
    'public.create_maintenance_order_v2(bigint,text,text,date,time without time zone)'
  );
begin
  if old_date_only is not null and (
    has_function_privilege('authenticated', old_date_only, 'EXECUTE')
    or has_function_privilege('anon', old_date_only, 'EXECUTE')
    or exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid=old_date_only and a.grantee=0 and a.privilege_type='EXECUTE'
    )
  ) then
    raise exception 'La firma antigua sin hora sigue ejecutable';
  end if;
  if old_with_time is not null and (
    has_function_privilege('authenticated', old_with_time, 'EXECUTE')
    or has_function_privilege('anon', old_with_time, 'EXECUTE')
    or exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid=old_with_time and a.grantee=0 and a.privilege_type='EXECUTE'
    )
  ) then
    raise exception 'La firma antigua con proveedor sigue ejecutable';
  end if;
  if new_signature is null then
    raise exception 'No existe la nueva firma de create_maintenance_order_v2';
  end if;
  if not has_function_privilege('authenticated', new_signature, 'EXECUTE') then
    raise exception 'La nueva firma de create_maintenance_order_v2 no tiene EXECUTE';
  end if;
end $$;

do $$
declare definition text;
begin
  select pg_get_functiondef(
    'public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text)'::regprocedure
  ) into definition;
  if definition is null then
    raise exception 'No existe reprogram_maintenance_order_v2';
  end if;
  definition := lower(replace(definition, ' ', ''));
  if position('provider_id' in definition) = 0
     or position('o.site_id,null' in definition) = 0
     or position('o.site_id,o.provider_id' in definition) > 0 then
    raise exception 'La reprogramación no deja provider_id=NULL en la OT hija';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
