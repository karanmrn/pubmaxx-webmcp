-- Hot-path index for the global visible feed:
--   SELECT * FROM visit_reports
--   WHERE status = 'visible' AND visibility <> 'legacy'
--   ORDER BY created_at DESC
--   LIMIT 500
--
-- The existing (venue_id, created_at desc) index only helps venue-scoped reads.

create index if not exists visit_reports_visible_created_idx
  on public.visit_reports (created_at desc)
  where status = 'visible' and (visibility is distinct from 'legacy');
