-- Corrección posterior a 20260921_operations.sql.
-- No reescribe la migración anterior ni modifica datos históricos.
-- Aplicar manualmente, después de revisar en staging. No ejecutada por Codex.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

-- Preflight exacto de los constraints desplegados y del estado actual.
do $$
declare role_definition text; type_definition text; status_definition text; ingenieros integer;
begin
  select pg_get_constraintdef(oid) into role_definition from pg_constraint
    where conrelid='public.profiles'::regclass and conname='profiles_role_check' and contype='c' and convalidated;
  select pg_get_constraintdef(oid) into type_definition from pg_constraint
    where conrelid='public.order_document_checks'::regclass and conname='order_document_checks_type_check' and contype='c' and convalidated;
  select pg_get_constraintdef(oid) into status_definition from pg_constraint
    where conrelid='public.order_document_checks'::regclass and conname='order_document_checks_status_check' and contype='c' and convalidated;
  if role_definition is null or lower(role_definition) not like '%ingeniero%' or lower(role_definition) not like '%auxiliar%' or lower(role_definition) not like '%administrador%' then
    raise exception 'profiles_role_check no coincide con el contrato esperado';
  end if;
  if type_definition is null or lower(type_definition) not like '%seguridad_social%' or lower(type_definition) not like '%coach%' or lower(type_definition) not like '%sst%' or lower(type_definition) not like '%copropiedad%' or lower(type_definition) like '%coass%' then
    raise exception 'order_document_checks_type_check no coincide con el contrato histórico esperado';
  end if;
  if status_definition is null or lower(status_definition) not like '%pendiente%' or lower(status_definition) not like '%cumple%' or lower(status_definition) not like '%no_cumple%' then
    raise exception 'order_document_checks_status_check no coincide con los estados esperados';
  end if;
  select count(*) into ingenieros from public.profiles where role='ingeniero';
  if ingenieros <> 1 then raise exception 'Se esperaba exactamente un perfil ingeniero para convertir; encontrados: %', ingenieros; end if;
end $$;

create temp table _reprogramming_historical_check_counts on commit drop as
select check_type, count(*)::bigint as total
from public.order_document_checks
where check_type in ('coach','copropiedad')
group by check_type;

-- Transición dentro de la misma transacción: nunca se desactiva la validación.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check
  (role = any (array['ingeniero'::text,'planeador'::text,'auxiliar'::text,'administrador'::text]));
update public.profiles set role='planeador' where role='ingeniero';
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check
  (role = any (array['planeador'::text,'auxiliar'::text,'administrador'::text]));

alter table public.order_document_checks drop constraint order_document_checks_type_check;
alter table public.order_document_checks add constraint order_document_checks_type_check check
  (check_type = any (array['seguridad_social'::text,'sst'::text,'coass'::text,'coach'::text,'copropiedad'::text]));

alter table public.maintenance_orders
  add column if not exists scheduled_time time without time zone;
alter table public.maintenance_orders
  add column if not exists approval_status text default 'pendiente';
alter table public.maintenance_orders
  add column if not exists approved_by uuid references public.profiles(id);
alter table public.maintenance_orders
  add column if not exists approved_at timestamptz;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.maintenance_orders'::regclass and conname='maintenance_orders_approval_status_check') then
    alter table public.maintenance_orders add constraint maintenance_orders_approval_status_check
      check (approval_status is null or approval_status in ('pendiente','aprobada'));
  end if;
end $$;
create index if not exists maintenance_scheduled_at_idx
  on public.maintenance_orders(scheduled_date, scheduled_time);

-- ÚNICA fuente documental para toda OT nueva, normal o hija.
-- No toca checks históricos; el UNIQUE evita cualquier fila repetida.
create or replace function public.create_order_document_checks()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.order_document_checks(order_id,check_type,status)
  values (NEW.id,'seguridad_social','pendiente'),
         (NEW.id,'sst','pendiente'),
         (NEW.id,'coass','pendiente')
  on conflict(order_id,check_type) do nothing;
  return NEW;
end;
$$;

-- Neutraliza por completo el entrypoint histórico de campo. Las columnas
-- assigned_engineer_id/arrived_at/started_at/completed_at/work_report se conservan,
-- pero ya no controlan el flujo operativo ni pueden invocarse por cliente.
create or replace function public.maintenance_workflow(
  p_order_id bigint,p_action text,p_engineer_id uuid default null,
  p_date date default null,p_report text default null
)
returns void language plpgsql security definer set search_path=''
as $$
begin
  raise exception 'maintenance_workflow fue retirado del modelo operativo';
end;
$$;

-- La identidad del creador siempre procede de auth.uid(); no existe parámetro
-- created_by que el cliente pueda falsificar. Planeador y administrador conservan
-- el permiso de creación; el valor siempre se obtiene de auth.uid().
create or replace function public.create_maintenance_order_v2(
  p_site_id bigint,
  p_provider_id bigint,
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
declare oid bigint; num bigint;
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador', 'planeador') then
    raise exception 'Solo administrador o planeador pueden crear órdenes';
  end if;
  if not exists(select 1 from public.sites where id=p_site_id and active=true) then
    raise exception 'Sede no disponible';
  end if;
  if not exists(select 1 from public.providers where id=p_provider_id and site_id=p_site_id and active=true) then
    raise exception 'Proveedor no disponible para la sede seleccionada';
  end if;
  if p_maintenance_type not in ('preventivo','correctivo')
     or nullif(trim(p_description),'') is null or p_scheduled_date is null or p_scheduled_time is null then
    raise exception 'Datos de orden inválidos: fecha y hora son obligatorias';
  end if;
  insert into public.maintenance_orders(
    parent_order_id,root_order_id,reprogramming_number,site_id,provider_id,
    maintenance_type,description,scheduled_date,scheduled_time,status,approval_status,created_by
  ) values(
    null,null,0,p_site_id,p_provider_id,p_maintenance_type,trim(p_description),
    p_scheduled_date,p_scheduled_time,'programada','pendiente',auth.uid()
  ) returning id,order_number into oid,num;
  update public.maintenance_orders set root_order_id=oid where id=oid;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
    values(oid,auth.uid(),'create',jsonb_build_object('created_by',auth.uid())::text);
  return num;
end;
$$;

-- Administrador conserva acceso total; auxiliar no puede reprogramar.
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
    o.site_id, o.provider_id, o.maintenance_type, o.description,
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

create or replace function public.approve_maintenance_order(p_order_id bigint)
returns void language plpgsql security definer set search_path=''
as $$
declare
  total_checks integer;
  complete_checks integer;
  current_approval text;
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador','auxiliar') then
    raise exception 'Solo auxiliar o administrador pueden aprobar órdenes';
  end if;
  select approval_status into current_approval from public.maintenance_orders
  where id=p_order_id and deleted_at is null and status not in ('reprogramada','cancelada','completada') for update;
  if not found then raise exception 'Orden no disponible'; end if;
  select count(*), count(*) filter (where status='cumple')
    into total_checks, complete_checks
  from public.order_document_checks
  where order_id=p_order_id
    and check_type in ('seguridad_social','sst','coass');
  if total_checks <> 3 or complete_checks <> 3 then
    raise exception 'La orden requiere Seguridad Social, SST y COASS en estado cumple';
  end if;
  update public.maintenance_orders set approval_status='aprobada', approved_by=auth.uid(), approved_at=now()
  where id=p_order_id;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
    values(p_order_id,auth.uid(),'approve',jsonb_build_object('previous_status',current_approval)::text);
end;
$$;

-- Permite al auxiliar revisar los tres checks de una OT hija. La escritura
-- sigue pasando por SECURITY DEFINER y nunca por INSERT/UPDATE directo.
create or replace function public.validate_order_document_check(
  p_order_id bigint,
  p_check_type text,
  p_status text,
  p_observation text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador', 'auxiliar') then
    raise exception 'Solo auxiliar o administrador pueden validar documentos';
  end if;
  if p_check_type not in ('seguridad_social', 'sst', 'coass')
     or p_status not in ('pendiente', 'cumple', 'no_cumple') then
    raise exception 'Tipo o estado documental inválido';
  end if;
  if not exists(select 1 from public.maintenance_orders where id=p_order_id and deleted_at is null and status not in ('reprogramada','cancelada','completada')) then
    raise exception 'Orden no disponible';
  end if;
  update public.order_document_checks
  set status=p_status,
      observation=nullif(trim(p_observation), ''),
      validated_by=case when p_status='pendiente' then null else auth.uid() end,
      validated_at=case when p_status='pendiente' then null else now() end
  where order_id=p_order_id and check_type=p_check_type;
  if not found then raise exception 'La validación documental no existe'; end if;
  insert into public.maintenance_events(order_id,actor_id,action,detail)
  values(p_order_id,auth.uid(),p_check_type,
    jsonb_build_object('status',p_status,'observation',nullif(trim(p_observation),''))::text);
end;
$$;

-- Deshabilita la firma antigua sin hora; la firma aplicada en esta migración
-- conserva proveedor y exige fecha y hora.
revoke all on function public.create_maintenance_order_v2(bigint,bigint,text,text,date)
  from public, anon, authenticated;
revoke all on function public.create_maintenance_order_v2(bigint,bigint,text,text,date,time without time zone)
  from public, anon;
grant execute on function public.create_maintenance_order_v2(bigint,bigint,text,text,date,time without time zone)
  to authenticated;
-- La función histórica se conserva por compatibilidad de catálogo, pero deja
-- de ser una superficie operativa y ningún cliente puede invocarla.
revoke all on function public.maintenance_workflow(bigint,text,uuid,date,text)
  from public, anon, authenticated;
revoke all on function public.reprogram_maintenance_order_v2(bigint,date,text)
  from public, anon, authenticated;
revoke all on function public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text)
  from public, anon;
grant execute on function public.reprogram_maintenance_order_v2(bigint,date,time without time zone,text)
  to authenticated;
revoke all on function public.validate_order_document_check(bigint,text,text,text), public.approve_maintenance_order(bigint)
  from public, anon;
grant execute on function public.validate_order_document_check(bigint,text,text,text)
  to authenticated;
grant execute on function public.approve_maintenance_order(bigint) to authenticated;

-- Sustituye las condiciones antiguas de rol de las policies ya creadas.
drop policy if exists maintenance_visible_v2 on public.maintenance_orders;
create policy maintenance_visible_v2 on public.maintenance_orders for select to authenticated
using (public.maintenance_current_role() in ('administrador','auxiliar')
       or public.maintenance_current_role()='planeador');
drop policy if exists profiles_read_v2 on public.profiles;
create policy profiles_read_v2 on public.profiles for select to authenticated
using (id=auth.uid() or public.maintenance_current_role()='administrador'
       or (public.maintenance_current_role()='auxiliar' and role='planeador' and active));

-- Postchecks dentro de la transacción: cualquier fallo impide el COMMIT.
do $$
declare role_definition text; type_definition text; approval_definition text; planeadores integer; ingenieros integer;
begin
  select count(*) into ingenieros from public.profiles where role='ingeniero';
  select count(*) into planeadores from public.profiles where role='planeador';
  if ingenieros<>0 or planeadores<>1 then
    raise exception 'Conversión de roles inválida: ingenieros=%, planeadores=%', ingenieros, planeadores;
  end if;
  select lower(pg_get_constraintdef(oid)) into role_definition from pg_constraint
    where conrelid='public.profiles'::regclass and conname='profiles_role_check' and convalidated;
  if role_definition is null or role_definition like '%ingeniero%' or role_definition not like '%planeador%' or role_definition not like '%auxiliar%' or role_definition not like '%administrador%' then
    raise exception 'profiles_role_check final inválido';
  end if;
  select lower(pg_get_constraintdef(oid)) into type_definition from pg_constraint
    where conrelid='public.order_document_checks'::regclass and conname='order_document_checks_type_check' and convalidated;
  if type_definition is null or type_definition not like '%seguridad_social%' or type_definition not like '%sst%' or type_definition not like '%coass%' or type_definition not like '%coach%' or type_definition not like '%copropiedad%' then
    raise exception 'order_document_checks_type_check final inválido';
  end if;
  select lower(pg_get_functiondef('public.approve_maintenance_order(bigint)'::regprocedure)) into approval_definition;
  if approval_definition is null
     or approval_definition not like '%check_type in (''seguridad_social'',''sst'',''coass'')%'
     or approval_definition not like '%status=''cumple''%' then
    raise exception 'approve_maintenance_order no limita la evaluación a los tres checks requeridos';
  end if;
  if exists(select 1 from public.order_document_checks group by order_id,check_type having count(*)>1) then
    raise exception 'Existen duplicados en order_document_checks';
  end if;
  if exists(select 1 from _reprogramming_historical_check_counts h where h.total <> (select count(*) from public.order_document_checks c where c.check_type=h.check_type)) then
    raise exception 'Se modificaron checks históricos';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgrelid='public.maintenance_orders'::regclass and tgname='trigger_create_order_document_checks')<>1 then
    raise exception 'El trigger documental no es único';
  end if;
  if not exists(select 1 from pg_trigger t where not t.tgisinternal and t.tgrelid='public.maintenance_orders'::regclass and t.tgname='trigger_create_order_document_checks' and t.tgfoid=to_regprocedure('public.create_order_document_checks()') and (t.tgtype & 1)=1 and (t.tgtype & 2)=0 and (t.tgtype & 4)=4 and (t.tgtype & (8|16|32))=0 and (t.tgtype & 64)=0 and t.tgnargs=0 and t.tgqual is null and t.tgenabled='O') then
    raise exception 'El trigger documental no coincide con AFTER INSERT FOR EACH ROW';
  end if;
  if lower(pg_get_functiondef('public.create_order_document_checks()'::regprocedure)) like '%coach%' or lower(pg_get_functiondef('public.create_order_document_checks()'::regprocedure)) like '%copropiedad%' or lower(pg_get_functiondef('public.create_order_document_checks()'::regprocedure)) not like '%seguridad_social%' or lower(pg_get_functiondef('public.create_order_document_checks()'::regprocedure)) not like '%sst%' or lower(pg_get_functiondef('public.create_order_document_checks()'::regprocedure)) not like '%coass%' then
    raise exception 'La función documental no genera exactamente los tres checks nuevos';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
