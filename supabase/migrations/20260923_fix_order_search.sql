begin;

-- Keep the existing bucket, role and AVISO-family behavior. Interpret OT
-- numbers against the displayed six-digit format without casting user input.
create or replace function public.search_maintenance_orders_v2(p_query text, p_bucket text)
returns table(order_id bigint, aviso_match boolean)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  term text := pg_catalog.btrim(p_query);
  is_ot_search boolean;
  order_digits text;
  normalized_number text;
  is_partial_number boolean;
  pattern text;
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

  is_ot_search := term ~* '^(OT-?)?[0-9]+$';
  if is_ot_search then
    order_digits := pg_catalog.regexp_replace(term, '^OT-?', '', 'i');
    normalized_number := coalesce(nullif(pg_catalog.ltrim(order_digits, '0'), ''), '0');
    is_partial_number := pg_catalog.length(order_digits) < 6
      and pg_catalog.left(order_digits, 1) = '0';
  end if;

  pattern := '%' || pg_catalog.replace(pg_catalog.replace(
    pg_catalog.replace(term, pg_catalog.chr(92), pg_catalog.chr(92) || pg_catalog.chr(92)),
    '%', pg_catalog.chr(92) || '%'), '_', pg_catalog.chr(92) || '_') || '%';

  return query
  with matching_roots as (
    select distinct coalesce(m.root_order_id,m.id) as root_id
    from public.maintenance_orders m
    where not is_ot_search and m.aviso ilike pattern escape pg_catalog.chr(92)
  )
  select o.id,
    (not is_ot_search and exists(
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
    (is_ot_search and (
      o.order_number::text = normalized_number
      or (is_partial_number and pg_catalog.left(
        pg_catalog.lpad(o.order_number::text, 6, '0'),
        pg_catalog.length(order_digits)
      ) = order_digits)
    ))
    or (not is_ot_search and (
      exists(select 1 from matching_roots r where r.root_id=coalesce(o.root_order_id,o.id))
      or o.order_number::text ilike pattern escape pg_catalog.chr(92)
      or o.description ilike pattern escape pg_catalog.chr(92)
      or s.name ilike pattern escape pg_catalog.chr(92)
    ))
  )
  order by o.id desc;
end;
$$;

revoke all on function public.search_maintenance_orders_v2(text,text)
  from public,anon,authenticated;
grant execute on function public.search_maintenance_orders_v2(text,text)
  to authenticated;

commit;
