-- Restore migration 0112's verified report function. The 0112 rollback remains
-- responsible for removing the verified-report ledger itself.

drop function if exists public.report_pint_drop_anonymous(uuid, text, text);
drop function if exists public.append_profile_cover_photo_report_actor(uuid, text, text);
drop function if exists public.moderate_profile_cover_across_stores(text, text, text);

create or replace function public.report_pint_drop_v2(
  p_id uuid,
  p_actor_hash text,
  p_reason text,
  p_hide_threshold int
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_count int;
begin
  if not exists (select 1 from public.visit_reports where id = p_id) then
    return null;
  end if;

  insert into public.pint_drop_verified_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    select verified_report_count into v_count
      from public.visit_reports
     where id = p_id;
    return v_count;
  end if;

  update public.visit_reports
     set verified_report_count = verified_report_count + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         status = case
                    when verified_report_count + 1 >= greatest(p_hide_threshold, 1)
                      then 'hidden'
                    else status
                  end
   where id = p_id
   returning verified_report_count into v_count;

  return v_count;
end;
$$;

revoke all on function public.report_pint_drop_v2(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.report_pint_drop_v2(uuid, text, text, int) to service_role;
