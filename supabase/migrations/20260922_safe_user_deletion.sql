-- Forward-only support for historical user removal.
-- Run after the existing maintenance migrations. No historical rows are changed.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_catalog.pg_attribute parent_a
      on parent_a.attrelid = c.confrelid and parent_a.attnum = c.confkey[1]
    where c.contype = 'f' and c.conrelid = 'public.profiles'::regclass
      and c.confrelid = 'public.profiles'::regclass
      and pg_catalog.array_length(c.conkey, 1) = 1 and a.attname = 'deleted_by'
      and parent_a.attname = 'id'
  ) then
    alter table public.profiles add constraint profiles_deleted_by_fkey
      foreign key (deleted_by) references public.profiles(id);
  end if;
end $$;

create index if not exists profiles_deleted_at_idx on public.profiles(deleted_at);

-- Called only by the server with the service-role key. The transaction first
-- removes access and hides the profile, then permits Auth deletion only when
-- the catalog proves that the profile cascades from auth.users and no business
-- reference can be erased or detached by that deletion.
create function public.prepare_user_deletion(p_target_id uuid, p_actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  fk record;
  known_ref record;
  has_reference boolean;
begin
  if p_target_id is null or p_actor_id is null or p_target_id = p_actor_id then
    raise exception 'No se permite eliminar la propia cuenta';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and active = true and role = 'administrador'
      and deleted_at is null
  ) then
    raise exception 'Solo un administrador activo puede eliminar usuarios';
  end if;
  perform 1 from public.profiles
    where id = p_target_id and deleted_at is null for update;
  if not found then raise exception 'Usuario no disponible'; end if;

  update public.profiles
    set active = false, deleted_at = clock_timestamp(), deleted_by = p_actor_id
    where id = p_target_id;

  -- Without a verified cascade, Auth deletion might leave an orphan profile.
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute child_col
      on child_col.attrelid = c.conrelid and child_col.attnum = c.conkey[1]
    join pg_catalog.pg_attribute parent_col
      on parent_col.attrelid = c.confrelid and parent_col.attnum = c.confkey[1]
    where c.contype = 'f'
      and c.conrelid = 'public.profiles'::regclass
      and c.confrelid = 'auth.users'::regclass
      and c.confdeltype = 'c'
      and pg_catalog.array_length(c.conkey, 1) = 1
      and child_col.attname = 'id' and parent_col.attname = 'id'
  ) then
    return false;
  end if;

  -- Auth's own identities/sessions are managed by GoTrue. Every other FK to
  -- profiles/auth.users must be single-column, target the user ID, and block
  -- deletion rather than CASCADE/SET NULL/SET DEFAULT if a new row races us.
  for fk in
    select c.conrelid, c.confrelid, c.confdeltype,
           pg_catalog.array_length(c.conkey, 1) as key_count,
           child_col.attname as child_column,
           parent_col.attname as parent_column
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class child_table on child_table.oid = c.conrelid
    join pg_catalog.pg_namespace child_schema on child_schema.oid = child_table.relnamespace
    left join pg_catalog.pg_attribute child_col
      on child_col.attrelid = c.conrelid and child_col.attnum = c.conkey[1]
    left join pg_catalog.pg_attribute parent_col
      on parent_col.attrelid = c.confrelid and parent_col.attnum = c.confkey[1]
    where c.contype = 'f'
      and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
      and (c.confrelid = 'public.profiles'::regclass
           or child_schema.nspname <> 'auth')
  loop
    if fk.conrelid = 'public.profiles'::regclass
       and fk.confrelid = 'auth.users'::regclass
       and fk.child_column = 'id' and fk.parent_column = 'id'
       and fk.confdeltype = 'c' then
      continue;
    end if;
    if fk.key_count <> 1 or fk.parent_column <> 'id'
       or fk.confdeltype not in ('a', 'r') then
      return false;
    end if;
    execute pg_catalog.format(
      'select exists(select 1 from %s where %I = $1)',
      fk.conrelid::regclass, fk.child_column
    ) into has_reference using p_target_id;
    if has_reference then return false; end if;
  end loop;

  -- These fields are used as user references by the maintenance code. Check
  -- them even if a deployment's original schema omitted their foreign key.
  for known_ref in
    select refs.table_name, refs.column_name
    from (values
      ('maintenance_orders','created_by'),
      ('maintenance_orders','approved_by'),
      ('maintenance_orders','reprogrammed_by'),
      ('maintenance_orders','assigned_engineer_id'),
      ('maintenance_orders','deleted_by'),
      ('maintenance_events','actor_id'),
      ('order_document_checks','validated_by'),
      ('profiles','deleted_by')
    ) as refs(table_name,column_name)
    join pg_catalog.pg_class t
      on t.oid = pg_catalog.to_regclass('public.' || refs.table_name)
    join pg_catalog.pg_attribute a
      on a.attrelid = t.oid and a.attname = refs.column_name
      and a.attnum > 0 and not a.attisdropped
  loop
    execute pg_catalog.format(
      'select exists(select 1 from public.%I where %I = $1)',
      known_ref.table_name, known_ref.column_name
    ) into has_reference using p_target_id;
    if has_reference then return false; end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.prepare_user_deletion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_user_deletion(uuid, uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'deleted_at' and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_catalog.pg_attribute parent_a
      on parent_a.attrelid = c.confrelid and parent_a.attnum = c.confkey[1]
    where c.conrelid = 'public.profiles'::regclass
      and c.confrelid = 'public.profiles'::regclass
      and c.contype = 'f' and pg_catalog.array_length(c.conkey, 1) = 1
      and a.attname = 'deleted_by' and parent_a.attname = 'id'
  ) or not pg_catalog.has_function_privilege(
    'service_role', 'public.prepare_user_deletion(uuid,uuid)'::regprocedure, 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', 'public.prepare_user_deletion(uuid,uuid)'::regprocedure, 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon', 'public.prepare_user_deletion(uuid,uuid)'::regprocedure, 'EXECUTE'
  ) or exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    where p.oid = 'public.prepare_user_deletion(uuid,uuid)'::regprocedure
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'La protección de eliminación de usuarios no quedó instalada';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
