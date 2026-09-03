-- RE-APPLICATION of 0014_realtime_publication (ledger version 20260707053327).
-- Applied to production twice (first 20260707010750, then here). The body is
-- idempotent (guarded `do $$ ... if not exists ... $$`), so re-running on a
-- fresh preview branch is a no-op. This file exists so the GitHub preview-branch
-- integration finds a local file for the duplicate remote ledger version. To
-- collapse the duplicate instead, see docs/RUNBOOK_SUPABASE_PREVIEW.md.
--
-- Add the social-layer tables to the `supabase_realtime` publication so
-- Supabase Realtime actually emits `postgres_changes` events for them (issue
-- surfaced against 0013_comment_replies.sql, which documented this SQL in a
-- comment but never shipped it as a runnable migration).
--
-- lib/realtime.ts subscribes to INSERTs on:
--   • public.pint_drop_comments — live replies (see 0013).
--   • public.visit_reports      — live drop pins/feed (see 0001, 0006).
-- Until a table is a member of the `supabase_realtime` publication, Postgres
-- never sends its change events over the replication slot Realtime reads from,
-- so subscribers silently fall back to lib/realtime.ts's polling path — no
-- error, just stale-feeling data. `alter publication ... add table` is NOT
-- idempotent on its own (re-adding an already-published table raises
-- `42710 duplicate_object`), so each addition is guarded by a
-- pg_publication_tables existence check, matching this repo's
-- `if not exists` / `do $$ ... $$` style used elsewhere (see 0006, 0013).
--
-- Apply with `supabase db push`, the Supabase SQL editor, or any Postgres
-- client connected as a role permitted to alter the publication (the
-- `postgres` / service role). Safe to re-run.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'pint_drop_comments'
  ) then
    alter publication supabase_realtime add table public.pint_drop_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'visit_reports'
  ) then
    alter publication supabase_realtime add table public.visit_reports;
  end if;
end $$;

-- Privacy note: adding these tables to the publication does NOT widen what a
-- reader sees. The raw INSERT row is never rendered — lib/realtime.ts treats
-- events as bare signals and refetches through the visibility-filtered read
-- paths (#29). RLS still governs any direct client read; publication
-- membership only controls whether a change event fires at all, not who
-- receives it or what columns are visible.
