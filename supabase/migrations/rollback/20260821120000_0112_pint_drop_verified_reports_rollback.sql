-- Roll back migration 0112. This restores mixed legacy counter behaviour and
-- removes verified-report evidence written after 0112.

create or replace function public.report_pint_drop_v2(
  p_id uuid,
  p_actor_hash text,
  p_reason text,
  p_hide_threshold int
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_count int;
begin
  if not exists (select 1 from public.visit_reports where id = p_id) then
    return null;
  end if;

  insert into public.pint_drop_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    select report_count into v_count
      from public.visit_reports
     where id = p_id;
    return v_count;
  end if;

  update public.visit_reports
     set report_count = coalesce(report_count, 0) + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         status = case
                    when coalesce(report_count, 0) + 1 >= p_hide_threshold
                      then 'hidden'
                    else status
                  end
   where id = p_id
   returning report_count into v_count;

  return v_count;
end;
$$;

drop table if exists public.pint_drop_verified_reports;
alter table public.visit_reports drop column if exists verified_report_count;

