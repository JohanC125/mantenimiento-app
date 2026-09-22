-- Permite validar Copropiedad únicamente en las OT cuyo snapshot la requiere.
-- Aplicar después de 20260921_status_flow_correction.sql. No modifica datos.
begin;
set local lock_timeout = '10s';
set local search_path = pg_catalog, public;

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
declare
  order_requires_coproperty boolean;
begin
  if coalesce(public.maintenance_current_role(), '') not in ('administrador', 'auxiliar') then
    raise exception 'Solo auxiliar o administrador pueden validar documentos';
  end if;
  if p_status not in ('pendiente', 'cumple', 'no_cumple') then
    raise exception 'Estado documental inválido';
  end if;

  select requires_coproperty into order_requires_coproperty
  from public.maintenance_orders
  where id=p_order_id
    and deleted_at is null
    and status not in ('reprogramada', 'cancelada', 'completada');
  if not found then raise exception 'Orden no disponible'; end if;

  if p_check_type not in ('seguridad_social', 'sst', 'coass')
     and not (p_check_type='copropiedad' and order_requires_coproperty) then
    raise exception 'Tipo documental no aplicable a esta orden';
  end if;

  update public.order_document_checks
  set status=p_status,
      observation=nullif(trim(p_observation), ''),
      validated_by=case when p_status='pendiente' then null else auth.uid() end,
      validated_at=case when p_status='pendiente' then null else now() end
  where order_id=p_order_id and check_type=p_check_type;
  if not found then raise exception 'La validación documental no existe'; end if;

  insert into public.maintenance_events(order_id, actor_id, action, detail)
  values(p_order_id, auth.uid(), p_check_type,
    jsonb_build_object('status', p_status, 'observation', nullif(trim(p_observation), ''))::text);
end;
$$;

revoke all on function public.validate_order_document_check(bigint,text,text,text)
  from public, anon;
grant execute on function public.validate_order_document_check(bigint,text,text,text)
  to authenticated;

do $$
declare validation_def text;
begin
  select lower(replace(pg_get_functiondef('public.validate_order_document_check(bigint,text,text,text)'::regprocedure), ' ', ''))
    into validation_def;
  if validation_def not like '%requires_coproperty%'
     or validation_def not like '%''copropiedad''%'
     or validation_def not like '%''seguridad_social''%'
     or validation_def not like '%''sst''%'
     or validation_def not like '%''coass''%'
     or not has_function_privilege('authenticated', 'public.validate_order_document_check(bigint,text,text,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.validate_order_document_check(bigint,text,text,text)'::regprocedure, 'EXECUTE') then
    raise exception 'La validación documental de Copropiedad no quedó instalada según el contrato';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
