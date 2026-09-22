-- Flujo oficial de estados posterior a 20260921_coproperty_by_site.sql.
-- No modifica migraciones anteriores ni datos existentes.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

create or replace function public.create_maintenance_order_v2(
  p_site_id bigint,
  p_maintenance_type text,
  p_description text,
  p_scheduled_date date,
  p_scheduled_time time without time zone
)
returns bigint
language plpgsql security definer set search_path=''
as $$
declare oid bigint; num bigint; site_requires_coproperty boolean;
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador','planeador') then
    raise exception 'Solo administrador o planeador pueden crear órdenes';
  end if;
  select requires_coproperty into site_requires_coproperty from public.sites where id=p_site_id and active=true;
  if not found then
    raise exception 'Sede no disponible';
  end if;
  if p_maintenance_type is null or p_maintenance_type not in ('preventivo','correctivo')
     or nullif(trim(p_description),'') is null
     or p_scheduled_date is null or p_scheduled_time is null then
    raise exception 'Datos de orden inválidos: fecha y hora son obligatorias';
  end if;
  insert into public.maintenance_orders(
    parent_order_id,root_order_id,reprogramming_number,site_id,
    maintenance_type,description,scheduled_date,scheduled_time,
    status,approval_status,created_by,requires_coproperty,provider_id
  ) values(
    null,null,0,p_site_id,p_maintenance_type,trim(p_description),
    p_scheduled_date,p_scheduled_time,'pendiente','pendiente',auth.uid(),site_requires_coproperty,null
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
language plpgsql security definer set search_path=''
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
  select requires_coproperty into site_requires_coproperty from public.sites where id=o.site_id;
  if not found then raise exception 'Sede no disponible'; end if;
  update public.maintenance_orders
    set status='reprogramada',reprogramming_reason=reason_value,
        reprogrammed_by=auth.uid(),reprogrammed_at=reprogrammed_at_value
    where id=o.id;
  insert into public.maintenance_orders(
    parent_order_id,root_order_id,reprogramming_number,site_id,provider_id,
    maintenance_type,description,scheduled_date,scheduled_time,
    status,approval_status,created_by,reprogramming_reason,reprogrammed_by,reprogrammed_at,requires_coproperty
  ) values(
    o.id,coalesce(o.root_order_id,o.id),o.reprogramming_number+1,o.site_id,null,
    o.maintenance_type,o.description,p_new_scheduled_date,p_new_scheduled_time,
    'pendiente','pendiente',auth.uid(),reason_value,auth.uid(),reprogrammed_at_value,site_requires_coproperty
  ) returning id,order_number into child_id,child_number;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
  values
    (o.id,auth.uid(),'reprogram',jsonb_build_object('child_order_id',child_id,'child_order_number',child_number,'new_date',p_new_scheduled_date,'new_time',p_new_scheduled_time,'reason',reason_value)::text),
    (child_id,auth.uid(),'create',jsonb_build_object('parent_order_id',o.id,'root_order_id',coalesce(o.root_order_id,o.id),'reprogramming_number',o.reprogramming_number+1,'reason',reason_value)::text);
  return child_number;
end;
$$;

create or replace function public.approve_maintenance_order(p_order_id bigint)
returns void language plpgsql security definer set search_path=''
as $$
declare required_types text[] := array['seguridad_social','sst','coass'];
  required_count integer; complete_count integer; current_approval text; requires_coproperty boolean;
begin
  if coalesce(public.maintenance_current_role(),'') not in ('administrador','auxiliar') then
    raise exception 'Solo auxiliar o administrador pueden aprobar órdenes';
  end if;
  select mo.approval_status,mo.requires_coproperty into current_approval,requires_coproperty
  from public.maintenance_orders mo
  where mo.id=p_order_id and mo.deleted_at is null
    and mo.status='pendiente' and mo.approval_status='pendiente' for update of mo;
  if not found then raise exception 'Orden no disponible'; end if;
  if requires_coproperty then required_types := array_append(required_types,'copropiedad'); end if;
  select count(*) filter(where c.check_type=any(required_types)),
         count(*) filter(where c.check_type=any(required_types) and c.status='cumple')
    into required_count,complete_count
  from public.order_document_checks c where c.order_id=p_order_id;
  if required_count <> cardinality(required_types) or complete_count <> cardinality(required_types) then
    raise exception 'La orden requiere todas las validaciones documentales aplicables en estado cumple';
  end if;
  update public.maintenance_orders
    set approval_status='aprobada',approved_by=auth.uid(),approved_at=now(),status='programada'
    where id=p_order_id and status='pendiente';
  if not found then raise exception 'La orden no está pendiente de aprobación'; end if;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
    values(p_order_id,auth.uid(),'approve',jsonb_build_object('previous_status','pendiente','new_status','programada','previous_approval_status',current_approval)::text);
end;
$$;

-- Inicio administrativo de gestión: no usa ni reactiva el flujo histórico de
-- ingenieros, asignaciones, llegadas o reportes de campo.
create or replace function public.start_maintenance_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador','planeador') then
    raise exception 'Solo administrador o planeador pueden iniciar gestión';
  end if;

  update public.maintenance_orders
  set status='en_ejecucion'
  where id=p_order_id
    and deleted_at is null
    and status='programada'
    and approval_status='aprobada';
  if not found then
    raise exception 'Solo se puede iniciar gestión de una orden programada y aprobada';
  end if;

  insert into public.maintenance_events(order_id,actor_id,action,detail)
    values(p_order_id,auth.uid(),'start_management',
      jsonb_build_object('previous_status','programada','new_status','en_ejecucion')::text);
end;
$$;

revoke all on function public.create_maintenance_order_v2(bigint,text,text,date,time without time zone),
  public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text),
  public.approve_maintenance_order(bigint),
  public.start_maintenance_order(bigint) from public,anon;
grant execute on function public.create_maintenance_order_v2(bigint,text,text,date,time without time zone),
  public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text),
  public.approve_maintenance_order(bigint),
  public.start_maintenance_order(bigint) to authenticated;

do $$
declare create_def text; reprogram_def text; approve_def text; start_def text;
begin
  select pg_get_functiondef('public.create_maintenance_order_v2(bigint,text,text,date,time without time zone)'::regprocedure) into create_def;
  select pg_get_functiondef('public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text)'::regprocedure) into reprogram_def;
  select pg_get_functiondef('public.approve_maintenance_order(bigint)'::regprocedure) into approve_def;
  select pg_get_functiondef('public.start_maintenance_order(bigint)'::regprocedure) into start_def;
  if lower(replace(create_def,' ','')) not like '%''pendiente'',''pendiente''%'
     or lower(replace(reprogram_def,' ','')) not like '%''pendiente'',''pendiente''%'
     or lower(replace(approve_def,' ','')) not like '%status=''programada''%'
     or lower(replace(start_def,' ','')) not like '%status=''programada''%'
     or lower(replace(start_def,' ','')) not like '%approval_status=''aprobada''%'
     or lower(replace(start_def,' ','')) not like '%start_management%' then
    raise exception 'Flujo de estados no quedó instalado según el contrato';
  end if;
end $$;

-- Finalización explícita: no reintroduce el workflow de campo retirado.
create or replace function public.complete_maintenance_order(p_order_id bigint)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if coalesce(public.maintenance_current_role(),'') not in ('administrador','planeador') then
    raise exception 'Solo administrador o planeador pueden completar órdenes';
  end if;
  update public.maintenance_orders set status='completada'
  where id=p_order_id and deleted_at is null
    and status='en_ejecucion' and approval_status='aprobada';
  if not found then raise exception 'Solo se puede completar una orden aprobada en ejecución'; end if;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
  values(p_order_id,auth.uid(),'complete',jsonb_build_object('previous_status','en_ejecucion','new_status','completada')::text);
end;
$$;
revoke all on function public.complete_maintenance_order(bigint) from public,anon;
grant execute on function public.complete_maintenance_order(bigint) to authenticated;

do $$
declare
  start_def text;
  complete_def text;
  start_oid oid := 'public.start_maintenance_order(bigint)'::regprocedure;
  complete_oid oid := 'public.complete_maintenance_order(bigint)'::regprocedure;
begin
  select lower(replace(pg_get_functiondef(start_oid),' ',''))
    into start_def;
  select lower(replace(pg_get_functiondef('public.complete_maintenance_order(bigint)'::regprocedure),' ',''))
    into complete_def;

  if start_def not like '%status=''programada''%'
     or start_def not like '%approval_status=''aprobada''%'
     or start_def not like '%deleted_atisnull%'
     or start_def not like '%status=''en_ejecucion''%'
     or complete_def not like '%status=''en_ejecucion''%'
     or complete_def not like '%approval_status=''aprobada''%'
     or complete_def not like '%deleted_atisnull%'
     or complete_def not like '%status=''completada''%'
     or complete_def not like '%''complete''%'
     or not has_function_privilege('authenticated',start_oid,'EXECUTE')
     or not has_function_privilege('authenticated',complete_oid,'EXECUTE')
     or has_function_privilege('anon',start_oid,'EXECUTE')
     or has_function_privilege('anon',complete_oid,'EXECUTE')
     or exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid in (start_oid, complete_oid)
         and acl.grantee=0
         and acl.privilege_type='EXECUTE'
     ) then
    raise exception 'Inicio o finalización no quedaron instalados según el contrato';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
