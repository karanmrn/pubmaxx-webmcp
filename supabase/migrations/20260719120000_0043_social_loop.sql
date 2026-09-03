-- Social Loop v1 (0043): private friend graph + "we're out" check-ins. Apply
-- AFTER 0042 (email_subscribers). House style mirrors 0006_social_layer /
-- 0042_email_subscribers:
--   • `create table if not exists` / guarded CHECK constraints — idempotent.
--   • RLS enabled with NO anon/authenticated policy — the service-role route is
--     the ONLY reader/writer. Friends-only content never leaves the API boundary.
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the integrator applies via
-- MCP / `supabase db push` and runs the advisor pass. Until then
-- lib/checkInStore.ts fails soft to process-memory (the whole social loop keeps
-- working in demo/dev), and it becomes durable the moment this lands.
--
-- TWO changes, both in service of the Social Loop privacy model:
--
-- 1. FOLLOW EDGES GO PRIVATE. Migration 0006 shipped `follows_public_read`
--    (`using (true)`) — a PUBLIC follow graph with public follower/following
--    counts. The Social Loop's non-negotiable is the opposite: follow edges are
--    private to the two parties, and NO follower counts are public anywhere.
--    Dropping the public-read policy leaves RLS on with no SELECT policy, so
--    anon/authenticated reads are denied and the graph is readable ONLY through
--    the service-role server routes (which apply the participant filter). Every
--    existing follow read already goes through the service role
--    (lib/followStore.ts -> admin()), so this tightens the posture without
--    changing any server behaviour.
--
-- 2. CHECK-INS. A lightweight "we're out" post: area-level location ONLY (a
--    night-area slug, never coordinates), an OPTIONAL explicitly-picked venue
--    tag, friends-only by DEFAULT (the `visibility` column is extensible — an
--    'area' value is reserved for a future public opt-in, owner decision
--    pending). Rows auto-expire from the feed after 12h (`expires_at`, set by the
--    store). `author_id` references profiles(id) ON DELETE CASCADE so a deleted
--    profile takes its check-ins with it (deletion cascades non-negotiable).

create extension if not exists "pgcrypto";

-- ── follows: drop the public-read policy (edges private to the two parties) ────
drop policy if exists follows_public_read on public.follows;
-- RLS stays enabled (from 0006). With no SELECT policy, anon/authenticated reads
-- are denied; the service role bypasses RLS, so the follow graph is server-only.

-- ── check_ins ──────────────────────────────────────────────────────────────────
-- One "we're out" post. `handle` is denormalised for read convenience; the FK
-- `author_id` is the durable identity + cascade key. `area_slug` is a night-area
-- vocabulary slug (lib/nightAreas.ts) — area-level, never a coordinate. `venue_id`
-- is the same in-repo pub id used by visit_reports (no FK), present ONLY when the
-- author explicitly tagged a venue. `visibility` defaults to 'friends'.
create table if not exists public.check_ins (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  handle      text not null,
  area_slug   text not null,
  venue_id    text,
  note        text,
  visibility  text not null default 'friends',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Visibility allowlist: friends-only today, 'area' reserved for the pending
-- public opt-in. A spoofed body cannot invent a visibility outside this set.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'check_ins_visibility_chk') then
    alter table public.check_ins
      add constraint check_ins_visibility_chk
      check (visibility in ('friends', 'area'));
  end if;
end $$;

-- The "your lot" read scans a handful of friend handles for non-expired rows;
-- the expiry sweep + area read scan expires_at. Indexes for both access paths.
create index if not exists check_ins_author_idx on public.check_ins (author_id);
create index if not exists check_ins_expires_idx on public.check_ins (expires_at);
create index if not exists check_ins_handle_active_idx
  on public.check_ins (handle, created_at desc);

alter table public.check_ins enable row level security;

drop policy if exists check_ins_public_read on public.check_ins;
-- Intentionally NO SELECT/INSERT/UPDATE/DELETE policy for anon / authenticated:
-- friends-only check-ins must never reach a public query. The service-role route
-- (app/api/check-ins) is the only reader/writer and applies the mutual-follow
-- (your lot) filter in lib/socialFeed.ts. Service-role only, by construction.
