-- 0088: Pub Pal voice minute metering.
-- session_count stays a short-lived reservation while used_minutes is the monthly meter.
-- SQL only - the captain applies migrations.

begin;

alter table public.pub_pal_voice_usage
  add column if not exists used_minutes integer not null default 0
  check (used_minutes >= 0);

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
  insert into public.pub_pal_voice_usage (owner_id, usage_month, session_count, used_minutes)
  values (p_owner_id, p_month, 1, 0)
  on conflict (owner_id, usage_month) do update
  set session_count = public.pub_pal_voice_usage.session_count + 1
  where public.pub_pal_voice_usage.used_minutes < p_limit
    and public.pub_pal_voice_usage.session_count < 1
  returning session_count into next_count;
  return next_count is not null;
end;
$$;

create or replace function public.record_pub_pal_voice_minutes(
  p_owner_id uuid,
  p_month date,
  p_seconds integer
) returns boolean
language sql
security definer
set search_path = public
as $$
  with recorded as (
    update public.pub_pal_voice_usage
    set used_minutes = used_minutes + case
      when coalesce(p_seconds, 0) > 0 then greatest(1, (p_seconds + 59) / 60)
      else 0
    end
    where owner_id = p_owner_id
      and usage_month = p_month
    returning 1
  )
  select exists (select 1 from recorded);
$$;

revoke all on function public.record_pub_pal_voice_minutes(uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.record_pub_pal_voice_minutes(uuid, date, integer)
  to service_role;

commit;
