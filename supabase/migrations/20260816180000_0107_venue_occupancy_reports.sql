-- Crowd occupancy reports (0107): one-tap now reading of seats.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT A ROW IS: one signed-in crowd report about how busy a pub is right
-- now. Empty / some seats / full. It is NOT a Visit Report (a remembered
-- night) and NOT a community venue signal. Trust is derived on READ: only
-- rows inside 90 minutes may answer "now". Older rows stay for the forecast
-- (R-012) and are never stored as trusted.
--
-- WHY SIGNED-IN ONLY: simpler trust for layer 1. Anonymous reports come later.
--
-- RLS: service-role only. The browser never reads or writes this table. GET
-- and POST /api/venues/[id]/occupancy are the only seams.

begin;

create table if not exists public.venue_occupancy_reports (
  id uuid primary key,
  venue_id text not null,
  reported_at timestamptz not null default now(),
  level text not null,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'crowd'
);

comment on table public.venue_occupancy_reports is
  'Signed-in crowd occupancy reports. Trust is derived on read: only reports under 90 minutes may answer now.';
comment on column public.venue_occupancy_reports.level is
  'empty | some_seats | full. Maps to Visit Report busyness quiet | steady | rammed.';
comment on column public.venue_occupancy_reports.source is
  'Layer-1 source is always crowd. Later layers may add publish.';
comment on column public.venue_occupancy_reports.reporter_user_id is
  'Signed-in account. Deleted with the account.';

alter table public.venue_occupancy_reports
  drop constraint if exists venue_occupancy_reports_level_check;
alter table public.venue_occupancy_reports
  add constraint venue_occupancy_reports_level_check
  check (level in ('empty', 'some_seats', 'full'));

alter table public.venue_occupancy_reports
  drop constraint if exists venue_occupancy_reports_source_check;
alter table public.venue_occupancy_reports
  add constraint venue_occupancy_reports_source_check
  check (source = 'crowd');

create index if not exists venue_occupancy_reports_now_idx
  on public.venue_occupancy_reports (venue_id, reported_at desc);

create index if not exists venue_occupancy_reports_retake_idx
  on public.venue_occupancy_reports (venue_id, reporter_user_id, reported_at desc);

alter table public.venue_occupancy_reports enable row level security;

revoke all on table public.venue_occupancy_reports from public, anon, authenticated;
grant select, insert, update, delete on table public.venue_occupancy_reports to service_role;

drop policy if exists venue_occupancy_reports_anon_deny on public.venue_occupancy_reports;
create policy venue_occupancy_reports_anon_deny
  on public.venue_occupancy_reports for all to anon
  using (false) with check (false);

drop policy if exists venue_occupancy_reports_authenticated_deny on public.venue_occupancy_reports;
create policy venue_occupancy_reports_authenticated_deny
  on public.venue_occupancy_reports for all to authenticated
  using (false) with check (false);

commit;
