-- Keep automatic Pint Drop hiding independent from legacy anonymous reports.
--
-- report_count predates account verification and can contain anonymous or
-- otherwise unverifiable reports. It remains moderation evidence. Automatic
-- hiding now reads only a new ledger written by the verified-account RPC.
-- Existing mixed rows are not backfilled because their actor class cannot be
-- recovered safely. This deliberately starts the verified threshold at zero.

alter table public.visit_reports
  add column if not exists verified_report_count integer not null default 0;

create table if not exists public.pint_drop_verified_reports (
  id uuid primary key default gen_random_uuid(),
  pint_drop_id uuid not null references public.visit_reports(id) on delete cascade,
  actor_hash text not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint pint_drop_verified_reports_actor_unique
    unique (pint_drop_id, actor_hash)
);

create index if not exists pint_drop_verified_reports_drop_idx
  on public.pint_drop_verified_reports (pint_drop_id, created_at desc);

alter table public.pint_drop_verified_reports enable row level security;
revoke all on table public.pint_drop_verified_reports from public, anon, authenticated;
grant all on table public.pint_drop_verified_reports to service_role;

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

comment on column public.visit_reports.verified_report_count is
  'Distinct verified-account reports recorded after migration 0112. Sole automatic-hide counter.';

