-- RE-APPLICATION of 0015_index_cleanup (ledger version 20260707053355). Applied
-- to production twice (first 20260707010941, then here). The body is idempotent
-- (guarded `do $$ ... $$` drop + `create index if not exists`), so re-running on
-- a fresh preview branch is a no-op. This file exists so the GitHub preview-
-- branch integration finds a local file for the duplicate remote ledger version.
-- To collapse the duplicate instead, see docs/RUNBOOK_SUPABASE_PREVIEW.md.
--
-- Performance cleanup surfaced by the Supabase database linter (perf advisors).
-- Two real findings; the linter's "unused index" notices are ignored on purpose
-- (every social table is still empty, so no index has been exercised yet — they
-- are not dead, just un-warmed).
--
-- Idempotent + re-runnable, matching 0008_report_unique.sql / 0014 style:
--   • guarded DROP CONSTRAINT / DROP INDEX inside DO blocks;
--   • `create index if not exists`.

-- ── 1. Duplicate unique index on pint_drop_reports ───────────────────────────
-- Both 0006 (inline `unique (pint_drop_id, actor_hash)`, auto-named
-- `pint_drop_reports_pint_drop_id_actor_hash_key`) and 0008 (explicit
-- `pint_drop_reports_actor_unique`) placed an identical unique constraint on the
-- same columns, so a table that ran BOTH now carries two identical unique
-- indexes — double the write cost, no read benefit (linter 0009_duplicate_index).
-- Keep the explicitly-named 0008 constraint (documented as the write path's
-- idempotent-no-op key); drop the auto-named 0006 one. Guarded so it is a no-op
-- on a DB that only ever had one of them.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'pint_drop_reports_pint_drop_id_actor_hash_key'
  )
  and exists (
    select 1 from pg_constraint where conname = 'pint_drop_reports_actor_unique'
  )
  then
    alter table public.pint_drop_reports
      drop constraint pint_drop_reports_pint_drop_id_actor_hash_key;
  end if;
end $$;

-- ── 2. Covering index for crawl_story_stops.pint_drop_id FK ──────────────────
-- The FK crawl_story_stops_pint_drop_id_fkey had no covering index, so cascades
-- and joins on it fall back to a sequential scan (linter 0001_unindexed_fkeys).
create index if not exists crawl_story_stops_pint_drop_idx
  on public.crawl_story_stops (pint_drop_id);
