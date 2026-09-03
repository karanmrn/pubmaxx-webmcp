-- Rollback 0088: restore session-count quota on consume and drop minute metering.

begin;

drop function if exists public.record_pub_pal_voice_minutes(uuid, date, integer);

create or replace function public.consume_pub_pal_voice_trial(
  p_owner_id uuid,
  p_month date,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  insert into public.pub_pal_voice_usage (owner_id, usage_month, session_count)
  values (p_owner_id, p_month, 1)
  on conflict (owner_id, usage_month) do update
  set session_count = public.pub_pal_voice_usage.session_count + 1
  where public.pub_pal_voice_usage.session_count < p_limit
  returning session_count into next_count;
  return next_count is not null and next_count <= p_limit;
end;
$$;

alter table public.pub_pal_voice_usage
  drop column if exists used_minutes;

commit;
