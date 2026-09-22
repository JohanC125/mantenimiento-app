-- SOLO LECTURA. Ejecutar manualmente después de aplicar; Codex no lo ejecuta.
select t.tgname,t.tgtype,
       ((t.tgtype & 1)=1) as for_each_row,
       ((t.tgtype & 2)=0 and (t.tgtype & 64)=0) as is_after,
       ((t.tgtype & 4)=4) as fires_on_insert,
       ((t.tgtype & (8|16|32))=0) as no_other_events,
       t.tgnargs,t.tgenabled,t.tgqual,
       pg_get_triggerdef(t.oid),pg_get_functiondef(t.tgfoid)
from pg_trigger t where not t.tgisinternal
and t.tgrelid in ('public.maintenance_orders'::regclass,'public.order_document_checks'::regclass);

-- Debe devolver exactamente una fila válida para el trigger documental.
select n.nspname as trigger_schema,c.relname as table_name,t.tgname,t.tgtype,
       pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal
and n.nspname='public' and c.relname='maintenance_orders'
and t.tgname='trigger_create_order_document_checks'
and t.tgfoid=to_regprocedure('public.create_order_document_checks()')
and (t.tgtype & 1)=1
and (t.tgtype & 2)=0
and (t.tgtype & 4)=4
and (t.tgtype & (8|16|32))=0
and (t.tgtype & 64)=0
and t.tgnargs=0 and t.tgqual is null and t.tgenabled='O';

select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.order_document_checks'::regclass and conname='order_document_checks_unique';

select p.oid::regprocedure as funcion,r.rolname as propietario,p.prosecdef,p.proconfig,
has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in
('create_order_document_checks','maintenance_current_role','maintenance_workflow',
'create_maintenance_order','reprogram_maintenance_order','delete_maintenance_order',
'create_maintenance_order_v2','reprogram_maintenance_order_v2','delete_maintenance_order_v2','validate_security_social');

select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in
('maintenance_orders','order_document_checks','maintenance_events','profiles','sites','providers');

-- Debe devolver cero filas: ninguna política antigua conocida puede permanecer.
select schemaname,tablename,policyname from pg_policies
where schemaname='public' and policyname in (
 'Ingenieros y administradores pueden modificar ordenes',
 'Usuarios autenticados pueden consultar ordenes',
 'Auxiliares y administradores pueden actualizar validaciones',
 'Usuarios autenticados pueden consultar validaciones',
 'Usuarios pueden consultar su propio perfil',
 'Administradores pueden crear proveedores',
 'Administradores pueden modificar proveedores',
 'Usuarios autenticados pueden consultar proveedores',
 'Administradores pueden crear sedes',
 'Administradores pueden modificar sedes',
 'Usuarios autenticados pueden consultar sedes',
 'Usuarios autenticados pueden consultar sedes activas'
);

-- Debe devolver cero filas: ninguna consulta amplia sobre órdenes.
select tablename,policyname,cmd,qual from pg_policies
where schemaname='public' and tablename='maintenance_orders'
and cmd='SELECT' and lower(coalesce(qual,'')) in ('true','(true)');

-- Debe devolver cero filas: ninguna policy de UPDATE permite a ingenieros.
select tablename,policyname,qual,with_check from pg_policies
where schemaname='public' and tablename='maintenance_orders' and cmd='UPDATE'
and (lower(coalesce(qual,'')) like '%ingeniero%' or lower(coalesce(with_check,'')) like '%ingeniero%');

-- Inventario esperado de policies nuevas. Debe devolver cero filas.
with expected(tablename,policyname,cmd) as (values
 ('maintenance_orders','maintenance_visible_v2','SELECT'),
 ('maintenance_orders','maintenance_insert_v2','INSERT'),
 ('maintenance_orders','maintenance_update_v2','UPDATE'),
 ('maintenance_orders','maintenance_delete_v2','DELETE'),
 ('order_document_checks','checks_read_v2','SELECT'),
 ('order_document_checks','checks_insert_v2','INSERT'),
 ('order_document_checks','checks_update_v2','UPDATE'),
 ('order_document_checks','checks_delete_v2','DELETE'),
 ('profiles','profiles_read_v2','SELECT'),
 ('profiles','profiles_insert_v2','INSERT'),
 ('profiles','profiles_update_v2','UPDATE'),
 ('profiles','profiles_delete_v2','DELETE'),
 ('sites','sites_read_v2','SELECT'),('sites','sites_admin_insert_v2','INSERT'),
 ('sites','sites_admin_update_v2','UPDATE'),('sites','sites_delete_gate_v2','DELETE'),
 ('providers','providers_read_v2','SELECT'),('providers','providers_admin_insert_v2','INSERT'),
 ('providers','providers_admin_update_v2','UPDATE'),('providers','providers_delete_gate_v2','DELETE')
) select e.* from expected e left join pg_policies p
 on p.schemaname='public' and p.tablename=e.tablename and p.policyname=e.policyname and p.cmd=e.cmd
 where p.policyname is null;

select c.relname as tablename,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
('maintenance_orders','order_document_checks','maintenance_events','profiles','sites','providers');

-- Debe devolver cero filas.
select order_id,check_type,count(*) from public.order_document_checks
group by order_id,check_type having count(*)>1;

-- Comparar antes/después de migrar, sin escrituras concurrentes: mismos totales.
select check_type,count(*) from public.order_document_checks group by check_type order by check_type;

-- Inventario de carencias históricas, no las repara.
select o.id,o.order_number from public.maintenance_orders o
where not exists(select 1 from public.order_document_checks c
where c.order_id=o.id and c.check_type='seguridad_social');

-- Verificar los IDs de prueba concretos obtenidos desde la aplicación.
-- SELECT order_id,check_type,status FROM public.order_document_checks WHERE order_id IN (...);
-- SELECT * FROM public.maintenance_events WHERE order_id IN (...) ORDER BY id;
-- Cada OT nueva debe tener exactamente UN check: seguridad_social.
