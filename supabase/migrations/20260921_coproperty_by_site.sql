-- Copropiedad configurable por sede.
-- Aplicar después de 20260921_remove_providers_from_orders.sql.
-- No modifica órdenes ni checks históricos.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

alter table public.sites
  add column if not exists requires_coproperty boolean not null default false;

alter table public.maintenance_orders
  add column if not exists requires_coproperty boolean not null default false;

-- Una única fuente documental para OT nuevas y OT hijas. La configuración se
-- consulta en el momento de insertar la OT, por lo que una hija usa la
-- configuración vigente de su sede y nunca copia estados anteriores.
create or replace function public.create_order_document_checks()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.order_document_checks(order_id, check_type, status)
  values
    (new.id, 'seguridad_social', 'pendiente'),
    (new.id, 'sst', 'pendiente'),
    (new.id, 'coass', 'pendiente');

  if new.requires_coproperty then
    insert into public.order_document_checks(order_id, check_type, status)
    values (new.id, 'copropiedad', 'pendiente');
  end if;
  return new;
end;
$$;

-- La OT captura la configuración vigente de la sede al crearse. El cliente
-- nunca envía requires_coproperty; el valor se obtiene exclusivamente aquí.
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
  site_requires_coproperty boolean;
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador', 'planeador') then
    raise exception 'Solo administrador o planeador pueden crear órdenes';
  end if;
  select s.requires_coproperty into site_requires_coproperty
  from public.sites s
  where s.id=p_site_id and s.active=true;
  if not found then raise exception 'Sede no disponible'; end if;
  if p_maintenance_type not in ('preventivo','correctivo')
     or nullif(trim(p_description),'') is null
     or p_scheduled_date is null
     or p_scheduled_time is null then
    raise exception 'Datos de orden inválidos: fecha y hora son obligatorias';
  end if;
  insert into public.maintenance_orders(
    parent_order_id, root_order_id, reprogramming_number, site_id,
    maintenance_type, description, scheduled_date, scheduled_time,
    status, approval_status, created_by, requires_coproperty
  ) values (
    null, null, 0, p_site_id, p_maintenance_type, trim(p_description),
    p_scheduled_date, p_scheduled_time, 'programada', 'pendiente', auth.uid(),
    site_requires_coproperty
  ) returning id, order_number into oid, num;
  update public.maintenance_orders set root_order_id=oid where id=oid;
  insert into public.maintenance_events(order_id, actor_id, action, detail)
    values (oid, auth.uid(), 'create', jsonb_build_object('created_by', auth.uid())::text);
  return num;
end;
$$;

-- Una reprogramación crea una OT nueva y captura de nuevo la configuración
-- vigente de la sede; nunca copia el snapshot de la OT padre.
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
  site_requires_coproperty boolean;
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
  select s.requires_coproperty into site_requires_coproperty
  from public.sites s where s.id=o.site_id;
  if not found then raise exception 'Sede no disponible'; end if;
  update public.maintenance_orders
  set status='reprogramada', reprogramming_reason=reason_value,
      reprogrammed_by=auth.uid(), reprogrammed_at=now()
  where id=o.id;
  insert into public.maintenance_orders(
    parent_order_id, root_order_id, reprogramming_number, site_id,
    maintenance_type, description, scheduled_date, scheduled_time,
    status, approval_status, created_by, reprogramming_reason,
    reprogrammed_by, reprogrammed_at, requires_coproperty
  ) values (
    o.id, coalesce(o.root_order_id, o.id), o.reprogramming_number+1, o.site_id,
    o.maintenance_type, o.description, p_new_scheduled_date, p_new_scheduled_time,
    'programada', 'pendiente', auth.uid(), reason_value, auth.uid(), now(),
    site_requires_coproperty
  ) returning id, order_number into child_id, child_number;
  insert into public.maintenance_events(order_id, actor_id, action, detail)
  values
    (o.id, auth.uid(), 'reprogram', jsonb_build_object('child_order_id', child_id, 'child_order_number', child_number, 'reason', reason_value)::text),
    (child_id, auth.uid(), 'create', jsonb_build_object('parent_order_id', o.id, 'reason', reason_value)::text);
  return child_number;
end;
$$;

create or replace function public.approve_maintenance_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  required_types text[] := array['seguridad_social', 'sst', 'coass'];
  required_count integer;
  complete_count integer;
  current_approval text;
  requires_coproperty boolean;
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador','auxiliar') then
    raise exception 'Solo auxiliar o administrador pueden aprobar órdenes';
  end if;

  select mo.approval_status, mo.requires_coproperty
    into current_approval, requires_coproperty
  from public.maintenance_orders mo
  where mo.id=p_order_id
    and mo.deleted_at is null
    and mo.status not in ('reprogramada','cancelada','completada')
  for update of mo;
  if not found then raise exception 'Orden no disponible'; end if;

  if requires_coproperty then
    required_types := array_append(required_types, 'copropiedad');
  end if;

  select count(*) filter (where c.check_type=any(required_types)),
         count(*) filter (where c.check_type=any(required_types) and c.status='cumple')
    into required_count, complete_count
  from public.order_document_checks c
  where c.order_id=p_order_id;

  if required_count <> cardinality(required_types)
     or complete_count <> cardinality(required_types) then
    raise exception 'La orden requiere todas las validaciones documentales aplicables en estado cumple';
  end if;

  update public.maintenance_orders
  set approval_status='aprobada', approved_by=auth.uid(), approved_at=now()
  where id=p_order_id;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
    values(p_order_id,auth.uid(),'approve',jsonb_build_object('previous_status',current_approval)::text);
end;
$$;

-- La firma pública de aprobación se conserva; se refuerzan sus permisos.
revoke all on function public.approve_maintenance_order(bigint)
  from public, anon;
grant execute on function public.approve_maintenance_order(bigint) to authenticated;

do $$
declare
  nullable_value text;
  trigger_definition text;
  approval_definition text;
begin
  select is_nullable into nullable_value
  from information_schema.columns
  where table_schema='public' and table_name='sites'
    and column_name='requires_coproperty';
  if nullable_value is distinct from 'NO' then
    raise exception 'sites.requires_coproperty no quedó NOT NULL';
  end if;

  select is_nullable into nullable_value
  from information_schema.columns
  where table_schema='public' and table_name='maintenance_orders'
    and column_name='requires_coproperty';
  if nullable_value is distinct from 'NO' then
    raise exception 'maintenance_orders.requires_coproperty no quedó NOT NULL';
  end if;

  if (select count(*) from pg_trigger
      where not tgisinternal
        and tgrelid='public.maintenance_orders'::regclass
        and tgname='trigger_create_order_document_checks') <> 1
     or not exists (
       select 1 from pg_trigger
       where not tgisinternal
         and tgrelid='public.maintenance_orders'::regclass
         and tgname='trigger_create_order_document_checks'
         and tgfoid=to_regprocedure('public.create_order_document_checks()')
         and tgenabled='O'
         and (tgtype & 1)=1
         and (tgtype & 2)=0
         and (tgtype & 4)=4
     )
     or exists (
       select 1 from pg_trigger
       where not tgisinternal
         and tgfoid=to_regprocedure('public.create_order_document_checks()')
         and (tgrelid<>'public.maintenance_orders'::regclass
              or tgname<>'trigger_create_order_document_checks')
     ) then
    raise exception 'Debe existir exactamente un trigger documental operativo y vinculado';
  end if;

  select pg_get_functiondef('public.create_order_document_checks()'::regprocedure)
    into trigger_definition;
  trigger_definition := lower(replace(trigger_definition, ' ', ''));
  if position('seguridad_social' in trigger_definition)=0
     or position('sst' in trigger_definition)=0
     or position('coass' in trigger_definition)=0
     or position('requires_coproperty' in trigger_definition)=0
     or position('copropiedad' in trigger_definition)=0 then
    raise exception 'El generador documental no contempla la configuración de copropiedad';
  end if;

  select pg_get_functiondef('public.approve_maintenance_order(bigint)'::regprocedure)
    into approval_definition;
  approval_definition := lower(replace(approval_definition, ' ', ''));
  if position('requires_coproperty' in approval_definition)=0
     or position('cardinality(required_types)' in approval_definition)=0
     or position('check_type=any(required_types)' in approval_definition)=0 then
    raise exception 'La aprobación no evalúa dinámicamente los checks requeridos';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
