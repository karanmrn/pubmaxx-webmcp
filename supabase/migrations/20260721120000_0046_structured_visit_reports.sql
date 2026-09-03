-- Structured Visit Reports (0046): durable backing for Wayfinder 3.4 — a
-- structured, recency-weighted read of what a pub is like on the night (how
-- busy, the vibe, would-return, price sanity, an optional short note). This is
-- the STRUCTURED sibling of the free-text Pint Drop; it is deliberately a NEW
-- table (`structured_visit_reports`) and NOT the pre-existing `visit_reports`
-- table that already backs Pint Drops — the names are close, the data is not.
-- Apply AFTER 0045 (area demand). House style mirrors 0045_area_demand /
-- 0043_social_loop:
--   • `create table if not exists` — idempotent, re-runnable.
--   • RLS enabled with NO public/anon policy — the service-role route is the
--     ONLY reader/writer (reads go through the admin client, exactly like Pint
--     Drops). There is deliberately no anon/authenticated policy.
--   • No functions/RPCs are defined here, so there is no function search_path to
--     pin; the moderation counter is a route-level read-modify-write on the
--     `report_actors` array (per-actor dedupe), acceptable at this scale.
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the OWNER applies via
-- MCP / `supabase db push` and runs the advisor pass. Until then
-- lib/visitReportsStore.ts fails soft to process-memory, so capture keeps working
-- and becomes durable the moment this lands (no code change needed) — the same
-- soft degradation vibe votes (#435) / area demand (#474) ship with.
--
-- IDENTITY / PRIVACY:
--   • `handle` is the self-asserted demo identity (same posture as Pint Drops /
--     ratings) — low-sensitivity, already-public signal. No coordinates, no PII.
--   • ONE report per handle per venue per night: unique (venue_id, handle,
--     visited_at). A re-submission for the same night UPDATES in place (the store
--     upserts), never a second row.
--   • Every structured field is OPTIONAL except the app-level rule that at least
--     one signal is present (enforced in lib/visitReports.ts, not the DB).

create table if not exists public.structured_visit_reports (
  id             uuid primary key default gen_random_uuid(),
  venue_id       text not null,
  handle         text not null,
  -- The evening the visit happened, as a London calendar day (the store resolves
  -- pre-dawn hours back onto the prior night before writing).
  visited_at     date not null,
  busyness       text,
  atmosphere     text,
  would_return   text,
  price_sanity   text,
  note           text not null default '',
  status         text not null default 'visible',
  -- Per-actor report ledger, inlined as an array so one actor can never bump the
  -- hide counter twice (the array-column mirror of the Pint Drop report ledger).
  report_count   integer not null default 0,
  report_actors  text[] not null default '{}',
  reported_at    timestamptz,
  report_reason  text,
  moderated_at   timestamptz,
  moderator_note text,
  created_at     timestamptz not null default now(),
  unique (venue_id, handle, visited_at)
);

-- Vocabulary CHECK constraints (defence in depth): the real allowlists live in
-- lib/visitReports.ts, but the DB refuses an off-allowlist value too. NULL is
-- always allowed (the field is optional).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'svr_busyness_check') then
    alter table public.structured_visit_reports
      add constraint svr_busyness_check
      check (busyness is null or busyness in ('quiet', 'steady', 'rammed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'svr_atmosphere_check') then
    alter table public.structured_visit_reports
      add constraint svr_atmosphere_check
      check (atmosphere is null or atmosphere in ('cosy', 'lively', 'chilled', 'rowdy', 'traditional', 'sporty'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'svr_would_return_check') then
    alter table public.structured_visit_reports
      add constraint svr_would_return_check
      check (would_return is null or would_return in ('yes', 'no'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'svr_price_sanity_check') then
    alter table public.structured_visit_reports
      add constraint svr_price_sanity_check
      check (price_sanity is null or price_sanity in ('fine', 'steep'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'svr_status_check') then
    alter table public.structured_visit_reports
      add constraint svr_status_check
      check (status in ('visible', 'hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'svr_note_len_check') then
    alter table public.structured_visit_reports
      add constraint svr_note_len_check
      check (length(note) <= 140);
  end if;
end $$;

-- Public venue reads: newest visible rows for a venue.
create index if not exists structured_visit_reports_venue_idx
  on public.structured_visit_reports (venue_id, status, created_at desc);

-- Moderator review queue: hidden rows awaiting review.
create index if not exists structured_visit_reports_review_idx
  on public.structured_visit_reports (status, reported_at desc)
  where moderated_at is null;

alter table public.structured_visit_reports enable row level security;

drop policy if exists structured_visit_reports_public_read on public.structured_visit_reports;
-- Intentionally NO SELECT/INSERT/UPDATE/DELETE policy for anon / authenticated
-- roles: reads and writes flow through the service-role route (the admin client),
-- exactly like Pint Drops. Service-role only, by construction.
revoke all on public.structured_visit_reports from anon, authenticated;
grant all on public.structured_visit_reports to service_role;
