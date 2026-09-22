-- Solo lectura. Ejecutar ANTES de aprobar la migración.
select n.nspname as schema, c.relname as tabla, t.tgname, t.tgtype,
       ((t.tgtype & 1)=1) as for_each_row,
       ((t.tgtype & 2)=0 and (t.tgtype & 64)=0) as is_after,
       ((t.tgtype & 4)=4) as fires_on_insert,
       ((t.tgtype & (8|16|32))=0) as no_other_events,
       t.tgnargs, t.tgenabled, t.tgqual,
       pg_get_triggerdef(t.oid) as trigger_sql,
       pg_get_functiondef(t.tgfoid) as function_sql
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname='public'
and c.relname in ('maintenance_orders','order_document_checks');

select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
('create_maintenance_order','reprogram_maintenance_order','delete_maintenance_order');

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public'
and tablename in ('profiles','sites','providers','maintenance_orders','order_document_checks');

select table_name,column_name,data_type,is_nullable,column_default,is_identity,identity_generation
from information_schema.columns where table_schema='public'
and table_name in ('profiles','sites','providers','maintenance_orders','order_document_checks')
order by table_name,ordinal_position;

select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid in ('public.maintenance_orders'::regclass,'public.order_document_checks'::regclass);

-- Otras rutas privilegiadas: revisar el cuerpo, no solo el nombre de las RPC.
select p.oid::regprocedure as funcion,r.rolname as propietario,p.proconfig,p.proacl,
       pg_get_functiondef(p.oid) as definicion
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname in ('public','private') and p.prokind='f' and p.prosecdef;

select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in
('maintenance_orders','order_document_checks','maintenance_events','profiles','sites','providers');
select table_name,column_name,grantee,privilege_type from information_schema.column_privileges
where table_schema='public' and table_name in
('maintenance_orders','order_document_checks','maintenance_events','profiles','sites','providers');
select schemaname,viewname,definition from pg_views where schemaname='public';
select check_type,count(*) from public.order_document_checks group by check_type order by check_type;
