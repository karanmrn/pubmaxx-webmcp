-- RE-APPLICATION of 0013_comment_replies (ledger version 20260707053307). This
-- migration was applied to production TWICE — first as 20260707010745, then
-- again here after a CLI/MCP re-run. Its body is fully idempotent
-- (`add column if not exists` / `create index if not exists`), so re-running it
-- on a fresh preview branch is a harmless no-op. This file exists only so the
-- GitHub preview-branch integration finds a local file for the duplicate remote
-- ledger version (it compares remote versions against local filename prefixes).
-- To collapse the duplicate instead, see docs/RUNBOOK_SUPABASE_PREVIEW.md.
--
-- Threaded replies on a Pint Drop comment (issue #37, PRD § "The For-You map" —
-- "X-style threaded replies so a story continues after the night"). ONE level of
-- nesting only: a comment may reply to a top-level comment, but a reply may not
-- itself be replied to. Apply AFTER 0006 (which created pint_drop_comments) and
-- alongside 0012.
--
-- Model: add a nullable self-referencing `parent_id` to pint_drop_comments.
--   • parent_id NULL      → a top-level comment (today's rows; the default, so
--                           every existing comment stays top-level, unchanged).
--   • parent_id = <id>    → a reply to that top-level comment.
-- The "one level only" rule (a reply's parent must itself be top-level, and the
-- parent must belong to the SAME drop) is enforced in the APP layer
-- (lib/commentsStore.ts addComment) — see the trust note below. `on delete
-- cascade` means deleting/removing a top-level comment removes its replies too.
--
-- Style mirrors 0001_visit_reports.sql / 0006_social_layer.sql / 0012 exactly:
--   • `add column if not exists` — idempotent, re-runnable, upgrades in place.
--   • `create index if not exists`.
--   • No new RLS policy needed: replies live in the SAME table, so the existing
--     pint_drop_comments_public_read (status = 'visible') already gates them.
--
-- Trust boundary: the one-level constraint is enforced in application code, not
-- a DB CHECK. Postgres can't express "parent_id must reference a row whose own
-- parent_id is NULL" as a simple CHECK (it needs a subquery / trigger). The
-- server is the single writer (service role) and validates on every insert
-- (parent exists + same drop + parent is itself top-level), the same app-layer
-- posture the rest of the social layer documents. Add a trigger later if a
-- second writer is ever introduced.

-- ── parent_id ────────────────────────────────────────────────────────────────
-- A reply points at the top-level comment it hangs under. Nullable so existing
-- rows and any insert that omits it stay top-level. Self-referencing FK with
-- ON DELETE CASCADE: removing a parent removes its whole reply subtree.
alter table public.pint_drop_comments
  add column if not exists parent_id uuid
  references public.pint_drop_comments (id) on delete cascade;

-- Fetch a comment's replies (and order them) without a table scan. Threads are
-- read as "top-level for this drop, then replies grouped by parent".
create index if not exists pint_drop_comments_parent_created_idx
  on public.pint_drop_comments (parent_id, created_at asc);

-- ─────────────────────────────────────────────────────────────────────────────
-- REALTIME PUBLICATION — moved to 0014_realtime_publication.sql.
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Realtime only emits `postgres_changes` for tables that belong to the
-- `supabase_realtime` publication. lib/realtime.ts subscribes to INSERTs on
-- `pint_drop_comments` (live replies) and `visit_reports` (live drop pins/feed);
-- until these tables are added to the publication, no realtime events fire and
-- the client silently uses its polling fallback. That ALTER PUBLICATION SQL now
-- lives in its own runnable, idempotent migration file — see
-- supabase/migrations/0014_realtime_publication.sql — instead of a comment here,
-- so it can actually be applied (`supabase db push` / SQL editor) and re-run
-- safely. See that file for the guarded DO blocks and the privacy note on why
-- publication membership doesn't widen what a reader sees.
