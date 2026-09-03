-- Pint Drop price-drop trust + gamification support (feat/price-drops-v2).
--
-- Three additive, idempotent changes to public.visit_reports. All are safe to
-- run against a live table with existing rows (no rewrite, no lock beyond a
-- brief index build) and match the house pattern in 0001/0017: guard every
-- non-idempotent DDL with a catalog lookup.
--
-- 1. DUPLICATE-GUARD / DEDUPE INDEX. The write path enforces "one PRICED drop
--    per venue+identity+London-day" (lib/pintDropsStore.hasPricedDropToday +
--    the route's 409). It reads the contributor's single newest priced row at a
--    venue; this partial index makes that an index-only seek instead of a scan.
--
--    Why not a durable UNIQUE index on the London day? A day bucket needs
--    timezone('Europe/London', created_at)::date, and timezone(text, timestamptz)
--    is only STABLE (not IMMUTABLE), so Postgres refuses it in an index/constraint
--    expression. Enforcing the day boundary in the app (against this index) keeps
--    the bucket logic in one place — londonDayKey(), shared with the streak maths —
--    and matches how per-actor report uniqueness is split app/RPC in 0017.
--
-- 2. AUTHOR STATS INDEX. The gamification stats route (GET /api/pint-drops/stats)
--    reads a handle's own drops to compute streak + per-borough tally. Index the
--    (handle, created_at desc) access path so a contributor's passport/You-page
--    card never scans the table.
--
-- 3. PRICE FLOOR (defence in depth). validatePintDrop already rejects < £1
--    (a fat-fingered £0.45 for £4.50). Mirror that ceiling-and-floor at the DB,
--    but add it NOT VALID so the migration can't fail on any legacy sub-£1 row
--    written under the old (> 0) rule — it enforces every NEW write while leaving
--    history untouched. The original visit_reports_price_chk (> 0 and <= 20) is
--    deliberately kept; this only tightens the floor for fresh inserts.

create index if not exists visit_reports_venue_handle_priced_idx
  on public.visit_reports (venue_id, handle, created_at desc)
  where price_gbp is not null;

create index if not exists visit_reports_handle_created_idx
  on public.visit_reports (handle, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visit_reports_price_floor_chk'
  ) then
    alter table public.visit_reports
      add constraint visit_reports_price_floor_chk
      check (price_gbp is null or price_gbp >= 1)
      not valid;
  end if;
end $$;
