-- Rollback 0109: drop occupancy flag ledger and hide stamp.
--
-- Lossy for flags. Hidden readings become visible again. The observations
-- themselves stay: 0107 still owns the report rows, `reported_at`, and the
-- now / retake indexes built on it. Drop ONLY what 0109 added.

begin;

drop function if exists public.report_occupancy_report(uuid, text, text);

drop policy if exists venue_occupancy_flags_authenticated_deny on public.venue_occupancy_flags;
drop policy if exists venue_occupancy_flags_anon_deny on public.venue_occupancy_flags;

drop table if exists public.venue_occupancy_flags;

drop index if exists public.venue_occupancy_reports_review_idx;

alter table public.venue_occupancy_reports
  drop column if exists hidden_at,
  drop column if exists flagged_at,
  drop column if exists report_reason,
  drop column if exists report_count;

commit;
