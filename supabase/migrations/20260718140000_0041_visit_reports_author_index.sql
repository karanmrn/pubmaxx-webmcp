-- Hot-path index for author-scoped pint-drop reads (a profile's own drops):
--   SELECT * FROM visit_reports
--   WHERE status = 'visible' AND handle = $author
--   ORDER BY created_at DESC
--
-- pintDropsStore.listVisible adds `.eq("handle", author)` on top of the visible
-- filter for the "my drops" / profile drop list. The existing indexes only help
-- the venue-scoped path (visit_reports_venue_created_idx) and the global visible
-- feed (visit_reports_visible_created_idx, keyed on created_at with no handle),
-- so the author lane falls back to a scan that degrades linearly as the table
-- grows. This partial composite mirrors the feed index's shape: it is scoped to
-- the visible rows the read actually returns, and orders by created_at desc so
-- the ORDER BY is served straight from the index.

create index if not exists visit_reports_handle_created_idx
  on public.visit_reports (handle, created_at desc)
  where status = 'visible';
