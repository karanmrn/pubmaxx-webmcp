-- Rollback 0107: drop crowd occupancy reports.
--
-- Lossy by design: the reports go with the table. Now surfaces that had a
-- fresh reading go back to "No fresh reading". Forecast work (R-012) has
-- nothing to read until the table is re-applied.

begin;

drop policy if exists venue_occupancy_reports_authenticated_deny on public.venue_occupancy_reports;
drop policy if exists venue_occupancy_reports_anon_deny on public.venue_occupancy_reports;

drop index if exists public.venue_occupancy_reports_retake_idx;
drop index if exists public.venue_occupancy_reports_now_idx;

drop table if exists public.venue_occupancy_reports;

commit;
