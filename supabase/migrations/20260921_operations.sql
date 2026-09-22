  -- MANUAL, NO EJECUTADA. Revisar diagnostics/01_inspect.sql y docs/OPERACION.md primero.
  -- Conserva órdenes, proveedores y checks históricos. No elimina triggers desconocidos.
  begin;
  set local lock_timeout = '10s';
  set local search_path = pg_catalog, public;
  -- Fallar sin cambios si el contrato confirmado no coincide con el catálogo.
  do $$ begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.order_document_checks'::regclass
      and c.conname='order_document_checks_unique' and c.contype='u'
      and not c.condeferrable and c.convalidated
      and c.conkey=array[
        (select attnum from pg_attribute where attrelid=c.conrelid and attname='order_id'),
        (select attnum from pg_attribute where attrelid=c.conrelid and attname='check_type')
      ]::smallint[]
  ) then raise exception 'Revisar order_document_checks_unique: se requiere UNIQUE no diferible (order_id, check_type)'; end if;
  if exists (
    select 1 from pg_trigger where not tgisinternal
    and tgrelid='public.maintenance_orders'::regclass
    and tgname='trigger_create_order_document_checks'
    and (tgfoid is distinct from to_regprocedure('public.create_order_document_checks()')
         -- pg_trigger.tgtype es una máscara de bits:
         -- ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16,
         -- TRUNCATE=32 e INSTEAD=64. AFTER no tiene bit propio.
         or (tgtype & 1)<>1
         or (tgtype & 4)<>4
         or (tgtype & 2)<>0
         or (tgtype & 8)<>0
         or (tgtype & 16)<>0
         or (tgtype & 32)<>0
         or (tgtype & 64)<>0
         or tgnargs<>0 or tgqual is not null or tgenabled<>'O')
  ) then raise exception 'El trigger documental tiene una definición inesperada; revisar manualmente'; end if;
  if exists (
    select 1 from pg_trigger where not tgisinternal
    and tgfoid=to_regprocedure('public.create_order_document_checks()')
    and (tgrelid<>'public.maintenance_orders'::regclass or tgname<>'trigger_create_order_document_checks')
  ) then raise exception 'Otra vinculación del trigger documental requiere revisión manual'; end if;
  end $$;

  -- ÚNICA fuente de nuevos checks. Nunca recorre ni borra registros históricos.
  create or replace function public.create_order_document_checks()
  returns trigger language plpgsql security definer set search_path='' as $$
  begin
  if TG_TABLE_SCHEMA<>'public' or TG_TABLE_NAME<>'maintenance_orders'
      or TG_OP<>'INSERT' or TG_WHEN<>'AFTER' or TG_LEVEL<>'ROW' then
    raise exception 'Contexto de trigger documental inválido';
  end if;
  insert into public.order_document_checks(order_id,check_type,status)
  values(NEW.id,'seguridad_social','pendiente')
  on conflict(order_id,check_type) do nothing;
  return NEW;
  end; $$;
  revoke all on function public.create_order_document_checks() from public,anon,authenticated;
  do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.maintenance_orders'::regclass
                and tgname='trigger_create_order_document_checks' and not tgisinternal) then
    create trigger trigger_create_order_document_checks after insert on public.maintenance_orders
    for each row execute function public.create_order_document_checks();
  end if;
  end $$;
  alter table public.maintenance_orders add column if not exists assigned_engineer_id uuid references public.profiles(id);
  alter table public.maintenance_orders add column if not exists arrived_at timestamptz;
  alter table public.maintenance_orders add column if not exists started_at timestamptz;
  alter table public.maintenance_orders add column if not exists completed_at timestamptz;
  alter table public.maintenance_orders add column if not exists work_report text;
  alter table public.maintenance_orders add column if not exists deleted_at timestamptz;
  alter table public.maintenance_orders add column if not exists deleted_by uuid references public.profiles(id);
  alter table public.maintenance_orders add column if not exists deletion_reason text;
  create index if not exists maintenance_assignee_date_idx on public.maintenance_orders(assigned_engineer_id, scheduled_date);
  create index if not exists maintenance_root_idx on public.maintenance_orders(root_order_id);

  create or replace function public.maintenance_current_role() returns text
  language sql stable security definer set search_path='' as $$
  select role::text from public.profiles where id=auth.uid() and active=true;
  $$;
  revoke all on function public.maintenance_current_role() from public, anon;
  grant execute on function public.maintenance_current_role() to authenticated;

  create table if not exists public.maintenance_events (
    id bigint generated always as identity primary key,
    order_id bigint not null references public.maintenance_orders(id),
    actor_id uuid not null references public.profiles(id),
    action text not null,
    detail text,
    created_at timestamptz not null default now()
  );
  alter table public.maintenance_events enable row level security;
  drop policy if exists maintenance_events_read on public.maintenance_events;
  create policy maintenance_events_read on public.maintenance_events for select to authenticated using (
    exists(select 1 from public.maintenance_orders o where o.id=order_id)
  );
  grant select on public.maintenance_events to authenticated;
  revoke insert,update,delete on public.maintenance_events from authenticated,anon;
  drop policy if exists maintenance_events_scope on public.maintenance_events;
  create policy maintenance_events_scope on public.maintenance_events as restrictive for select to authenticated
  using(exists(select 1 from public.maintenance_orders o where o.id=order_id));
  drop policy if exists maintenance_events_write_gate on public.maintenance_events;
  create policy maintenance_events_write_gate on public.maintenance_events as restrictive for all to authenticated
  using(exists(select 1 from public.maintenance_orders o where o.id=order_id)) with check(false);
  drop policy if exists maintenance_events_delete_gate on public.maintenance_events;
  create policy maintenance_events_delete_gate on public.maintenance_events as restrictive for delete to authenticated using(false);

  create or replace function public.maintenance_workflow(p_order_id bigint,p_action text,p_engineer_id uuid default null,p_date date default null,p_report text default null)
  returns void language plpgsql security definer set search_path='' as $$
  declare o public.maintenance_orders%rowtype; r text := public.maintenance_current_role();
  begin
  if auth.uid() is null or r is null then raise exception 'Sesión no autorizada'; end if;
  select * into o from public.maintenance_orders where id=p_order_id for update;
  if not found or o.deleted_at is not null or o.status in ('completada','cancelada','reprogramada') then raise exception 'Orden no disponible para esta acción'; end if;
  if p_action='assign' then
    if r not in ('administrador','auxiliar') then raise exception 'Sin permiso para programar'; end if;
    if o.status<>'programada' or o.arrived_at is not null or o.started_at is not null then raise exception 'Solo se asignan órdenes programadas sin iniciar'; end if;
    if p_date is null or not exists(select 1 from public.profiles where id=p_engineer_id and role='ingeniero' and active=true) then raise exception 'Selecciona un ingeniero activo y una fecha'; end if;
    if o.status='programada' and o.scheduled_date is distinct from p_date then raise exception 'Usa Reprogramar para cambiar la fecha y conservar el motivo'; end if;
    update public.maintenance_orders set assigned_engineer_id=p_engineer_id,scheduled_date=p_date,status='programada' where id=o.id;
  else
    if r<>'ingeniero' or o.assigned_engineer_id is distinct from auth.uid() then raise exception 'Solo el ingeniero asignado puede registrar trabajo'; end if;
    if p_action='arrive' and o.status='programada' and o.arrived_at is null then
      update public.maintenance_orders set arrived_at=now() where id=o.id;
    elsif p_action='start' and o.status='programada' and o.arrived_at is not null and o.started_at is null then
      update public.maintenance_orders set started_at=now(),status='en_ejecucion' where id=o.id;
    elsif p_action='complete' and o.status='en_ejecucion' and o.started_at is not null and nullif(trim(p_report),'') is not null then
      update public.maintenance_orders set completed_at=now(),status='completada',work_report=trim(p_report) where id=o.id;
    else raise exception 'Transición inválida o informe vacío'; end if;
  end if;
  insert into public.maintenance_events(order_id,actor_id,action,detail) values(o.id,auth.uid(),p_action,case when p_action='assign' then p_engineer_id::text || ' / ' || p_date::text else p_report end);
  end; $$;

  create or replace function public.create_maintenance_order_v2(p_site_id bigint,p_provider_id bigint,p_maintenance_type text,p_description text,p_scheduled_date date)
  returns bigint language plpgsql security definer set search_path='' as $$
  declare oid bigint; num bigint;
  begin
  if coalesce(public.maintenance_current_role(),'') not in ('administrador','auxiliar') then raise exception 'Sin permiso para crear órdenes'; end if;
  if not exists(select 1 from public.sites where id=p_site_id and active=true) then raise exception 'Sede no disponible'; end if;
  if not exists(select 1 from public.providers where id=p_provider_id and site_id=p_site_id and active=true) then raise exception 'Proveedor no disponible para esta sede'; end if;
  if p_maintenance_type is null or p_maintenance_type not in ('preventivo','correctivo') or nullif(trim(p_description),'') is null or p_scheduled_date is null then raise exception 'Datos de orden inválidos'; end if;
  -- La identidad genera order_number. No usar MAX + 1.
  insert into public.maintenance_orders(parent_order_id,root_order_id,reprogramming_number,site_id,provider_id,maintenance_type,description,scheduled_date,status,created_by)
  values(null,null,0,p_site_id,p_provider_id,p_maintenance_type,trim(p_description),p_scheduled_date,'programada',auth.uid()) returning id,order_number into oid,num;
  update public.maintenance_orders set root_order_id=oid where id=oid;
  -- El trigger AFTER INSERT crea Seguridad Social, no esta RPC.
  insert into public.maintenance_events(order_id,actor_id,action) values(oid,auth.uid(),'create');
  return num;
  end; $$;

  create or replace function public.reprogram_maintenance_order_v2(p_parent_order_id bigint,p_new_scheduled_date date,p_reason text)
  returns bigint language plpgsql security definer set search_path='' as $$
  declare o public.maintenance_orders%rowtype; oid bigint; num bigint;
  begin
  if coalesce(public.maintenance_current_role(),'') not in ('administrador','auxiliar') then raise exception 'Sin permiso para reprogramar'; end if;
  select * into o from public.maintenance_orders where id=p_parent_order_id for update;
  if not found or o.deleted_at is not null or o.status in ('completada','cancelada','reprogramada') then raise exception 'Orden no reprogramable'; end if;
  if o.status='en_ejecucion' or o.arrived_at is not null or o.started_at is not null then raise exception 'No se puede reprogramar un trabajo iniciado'; end if;
  if p_new_scheduled_date is null or nullif(trim(p_reason),'') is null then raise exception 'Fecha y motivo obligatorios'; end if;
  insert into public.maintenance_orders(parent_order_id,root_order_id,reprogramming_number,site_id,provider_id,maintenance_type,description,scheduled_date,status,created_by,reprogramming_reason,reprogrammed_by,reprogrammed_at,assigned_engineer_id)
  values(o.id,coalesce(o.root_order_id,o.id),o.reprogramming_number+1,o.site_id,o.provider_id,o.maintenance_type,o.description,p_new_scheduled_date,'programada',auth.uid(),trim(p_reason),auth.uid(),now(),o.assigned_engineer_id)
  returning id,order_number into oid,num;
  update public.maintenance_orders set status='reprogramada' where id=o.id;
  -- Nueva OT, nuevo check creado exclusivamente por el trigger.
  insert into public.maintenance_events(order_id,actor_id,action,detail) values(o.id,auth.uid(),'reprogram',format('Nueva OT id=%s; motivo=%s',oid,trim(p_reason)));
  insert into public.maintenance_events(order_id,actor_id,action,detail) values(oid,auth.uid(),'reprogram',trim(p_reason));
  return num;
  end; $$;

  create or replace function public.delete_maintenance_order_v2(p_order_id bigint,p_reason text)
  returns void language plpgsql security definer set search_path='' as $$
  begin
  if public.maintenance_current_role() is distinct from 'administrador' then raise exception 'Solo administrador'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Motivo obligatorio'; end if;
  update public.maintenance_orders set deleted_at=now(),deleted_by=auth.uid(),deletion_reason=trim(p_reason) where id=p_order_id and deleted_at is null;
  if not found then raise exception 'Orden no disponible'; end if;
  insert into public.maintenance_events(order_id,actor_id,action,detail) values(p_order_id,auth.uid(),'delete',trim(p_reason));
  end; $$;

  create or replace function public.validate_security_social(p_order_id bigint,p_status text,p_observation text default null)
  returns void language plpgsql security definer set search_path='' as $$
  declare o public.maintenance_orders%rowtype;
  begin
  if coalesce(public.maintenance_current_role(),'') not in ('administrador','auxiliar') then raise exception 'Sin permiso para validar'; end if;
  if p_status is null or p_status not in ('pendiente','cumple','no_cumple') then raise exception 'Estado inválido'; end if;
  select * into o from public.maintenance_orders where id=p_order_id for update;
  if not found or o.deleted_at is not null then raise exception 'Orden no disponible'; end if;
  update public.order_document_checks set status=p_status,observation=nullif(trim(p_observation),''),
  validated_by=case when p_status='pendiente' then null else auth.uid() end,
  validated_at=case when p_status='pendiente' then null else now() end
  where order_id=p_order_id and check_type='seguridad_social';
  if not found then raise exception 'Falta Seguridad Social: revisar integridad de esta OT; no se crean checks durante la validación'; end if;
  insert into public.maintenance_events(order_id,actor_id,action,detail) values(p_order_id,auth.uid(),'seguridad_social',jsonb_build_object('status',p_status,'observation',nullif(trim(p_observation),''))::text);
  end; $$;

  -- Restrict execution of the new mutation functions.
  revoke all on function public.maintenance_workflow(bigint,text,uuid,date,text), public.create_maintenance_order_v2(bigint,bigint,text,text,date),public.reprogram_maintenance_order_v2(bigint,date,text),public.delete_maintenance_order_v2(bigint,text),public.validate_security_social(bigint,text,text) from public,anon;
  grant execute on function public.maintenance_workflow(bigint,text,uuid,date,text),public.create_maintenance_order_v2(bigint,bigint,text,text,date),public.reprogram_maintenance_order_v2(bigint,date,text),public.delete_maintenance_order_v2(bigint,text),public.validate_security_social(bigint,text,text) to authenticated;

  -- The previous SECURITY DEFINER entrypoints must not bypass the new matrix.
  -- Preserve their definitions; revoke client execution, do not drop functions.
  do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_maintenance_order','reprogram_maintenance_order','delete_maintenance_order') loop
  execute format('revoke execute on function %s from public, anon, authenticated',f.signature);
  end loop;
  end $$;

  alter table public.maintenance_orders enable row level security;
  -- Reemplazar explícitamente las políticas conocidas del esquema desplegado.
  drop policy if exists "Ingenieros y administradores pueden modificar ordenes" on public.maintenance_orders;
  drop policy if exists "Usuarios autenticados pueden consultar ordenes" on public.maintenance_orders;
  drop policy if exists maintenance_visible_v2 on public.maintenance_orders;
  create policy maintenance_visible_v2 on public.maintenance_orders for select to authenticated using (public.maintenance_current_role() in ('administrador','auxiliar') or (public.maintenance_current_role()='ingeniero' and assigned_engineer_id=auth.uid()));
  drop policy if exists maintenance_insert_v2 on public.maintenance_orders;
  create policy maintenance_insert_v2 on public.maintenance_orders as restrictive for insert to authenticated with check(false);
  drop policy if exists maintenance_update_v2 on public.maintenance_orders;
  create policy maintenance_update_v2 on public.maintenance_orders as restrictive for update to authenticated using(false);
  drop policy if exists maintenance_delete_v2 on public.maintenance_orders;
  create policy maintenance_delete_v2 on public.maintenance_orders as restrictive for delete to authenticated using(false);
  alter table public.order_document_checks enable row level security;
  drop policy if exists "Auxiliares y administradores pueden actualizar validaciones" on public.order_document_checks;
  drop policy if exists "Usuarios autenticados pueden consultar validaciones" on public.order_document_checks;
  drop policy if exists checks_read_v2 on public.order_document_checks;
  create policy checks_read_v2 on public.order_document_checks for select to authenticated using(exists(select 1 from public.maintenance_orders where id=order_id));
  drop policy if exists checks_insert_v2 on public.order_document_checks;
  create policy checks_insert_v2 on public.order_document_checks as restrictive for insert to authenticated with check(false);
  drop policy if exists checks_update_v2 on public.order_document_checks;
  create policy checks_update_v2 on public.order_document_checks as restrictive for update to authenticated using(false);
  drop policy if exists checks_delete_v2 on public.order_document_checks;
  create policy checks_delete_v2 on public.order_document_checks as restrictive for delete to authenticated using(false);

  -- profiles: own profile, administrators, and active engineer directory for coordinators.
  alter table public.profiles enable row level security;
  drop policy if exists "Usuarios pueden consultar su propio perfil" on public.profiles;
  drop policy if exists profiles_read_v2 on public.profiles;
  create policy profiles_read_v2 on public.profiles for select to authenticated using(id=auth.uid() or public.maintenance_current_role()='administrador' or (public.maintenance_current_role()='auxiliar' and role='ingeniero' and active));
  drop policy if exists profiles_insert_v2 on public.profiles;
  create policy profiles_insert_v2 on public.profiles as restrictive for insert to authenticated with check(false);
  drop policy if exists profiles_update_v2 on public.profiles;
  create policy profiles_update_v2 on public.profiles as restrictive for update to authenticated using(false);
  drop policy if exists profiles_delete_v2 on public.profiles;
  create policy profiles_delete_v2 on public.profiles as restrictive for delete to authenticated using(false);

  -- Read inactive references as well, so historical orders retain their labels.
  alter table public.sites enable row level security;
  alter table public.providers enable row level security;
  drop policy if exists "Administradores pueden crear sedes" on public.sites;
  drop policy if exists "Administradores pueden modificar sedes" on public.sites;
  drop policy if exists "Usuarios autenticados pueden consultar sedes" on public.sites;
  drop policy if exists "Usuarios autenticados pueden consultar sedes activas" on public.sites;
  drop policy if exists "Administradores pueden crear proveedores" on public.providers;
  drop policy if exists "Administradores pueden modificar proveedores" on public.providers;
  drop policy if exists "Usuarios autenticados pueden consultar proveedores" on public.providers;
  drop policy if exists sites_read_v2 on public.sites;
  create policy sites_read_v2 on public.sites for select to authenticated using(public.maintenance_current_role() is not null);
  drop policy if exists providers_read_v2 on public.providers;
  create policy providers_read_v2 on public.providers for select to authenticated using(public.maintenance_current_role() is not null);
  drop policy if exists providers_admin_insert_v2 on public.providers;
  create policy providers_admin_insert_v2 on public.providers for insert to authenticated with check(public.maintenance_current_role()='administrador');
  drop policy if exists providers_admin_update_v2 on public.providers;
  create policy providers_admin_update_v2 on public.providers for update to authenticated using(public.maintenance_current_role()='administrador') with check(public.maintenance_current_role()='administrador');
  drop policy if exists sites_admin_insert_v2 on public.sites;
  create policy sites_admin_insert_v2 on public.sites for insert to authenticated with check(public.maintenance_current_role()='administrador');
  drop policy if exists sites_admin_update_v2 on public.sites;
  create policy sites_admin_update_v2 on public.sites for update to authenticated using(public.maintenance_current_role()='administrador') with check(public.maintenance_current_role()='administrador');
  drop policy if exists sites_insert_gate_v2 on public.sites;
  drop policy if exists sites_update_gate_v2 on public.sites;
  drop policy if exists sites_delete_gate_v2 on public.sites;
  create policy sites_delete_gate_v2 on public.sites as restrictive for delete to authenticated using(false);
  drop policy if exists providers_insert_gate_v2 on public.providers;
  drop policy if exists providers_update_gate_v2 on public.providers;
  drop policy if exists providers_delete_gate_v2 on public.providers;
  create policy providers_delete_gate_v2 on public.providers as restrictive for delete to authenticated using(false);
  -- RLS no controla TRUNCATE. Eliminar también privilegios heredados de PUBLIC.
  revoke all on public.profiles,public.sites,public.providers,public.maintenance_orders,public.order_document_checks,public.maintenance_events from public,anon;
  revoke all on public.profiles,public.maintenance_orders,public.order_document_checks,public.maintenance_events from authenticated;
  grant select on public.profiles,public.sites,public.providers,public.maintenance_orders,public.order_document_checks,public.maintenance_events to authenticated;
  revoke delete,truncate,references,trigger on public.sites,public.providers from authenticated;
  grant insert,update on public.sites,public.providers to authenticated;

  -- CREATE OR REPLACE conserva el propietario: impedir propietarios cliente o sujetos
  -- a RLS en helpers DEFINER (recursión de profiles / RPC bloqueadas por las gates).
  do $$ begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_roles r on r.oid=p.proowner
    where n.nspname='public' and p.proname in ('maintenance_current_role',
    'create_order_document_checks','maintenance_workflow','create_maintenance_order_v2',
    'reprogram_maintenance_order_v2','delete_maintenance_order_v2','validate_security_social')
    and (r.rolname in ('anon','authenticated','authenticator') or not (r.rolsuper or r.rolbypassrls))) then
    raise exception 'Revisar propietarios de funciones: requieren un propietario administrativo BYPASSRLS, nunca un rol cliente';
  end if;
  end $$;
  notify pgrst, 'reload schema';
  commit;
