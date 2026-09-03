-- Social memory layer for PUBMAXXING: profiles, follows, saved pubs, pint-drop
-- reactions/comments/reports, and crawl stories. Apply AFTER 0005.
--
-- Runtime features that depend on these tables (profiles, follow graph, saved
-- lists, reactions, comments, crawl stories) degrade to demo/in-memory until
-- this migration is applied — the app never assumes the tables exist.
--
-- Style mirrors 0001_visit_reports.sql exactly:
--   • `create table if not exists` / `add column if not exists` — idempotent,
--     re-runnable, upgrades a table created by an earlier version in place.
--   • CHECK constraints added inside a DO block guarded by a pg_constraint
--     lookup (ADD CONSTRAINT has no IF NOT EXISTS).
--   • RLS on every table: public read where it makes sense, service-role-only
--     write (no anon/authenticated INSERT policy → those inserts are denied;
--     the service role bypasses RLS, so only the server route writes).
--
-- Auth note: `profiles.user_id` is a nullable uuid left for a FUTURE link to
-- `auth.users(id)`. It is intentionally NOT a hard foreign key so this migration
-- stays applicable to a demo project with no auth rows. When real auth lands,
-- add:  alter table public.profiles
--         add constraint profiles_user_fk
--         foreign key (user_id) references auth.users (id) on delete set null;
-- (and tighten the RLS write policies to `auth.uid()` ownership).

create extension if not exists "pgcrypto";

-- ── profiles ─────────────────────────────────────────────────────────────────
-- A public identity for a contributor. `handle` is the stable public key; the
-- optional `user_id` reserves the future auth link (see note above).
create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,                    -- future: references auth.users(id), see header
  handle       text not null unique,
  display_name text,
  avatar_url   text,
  home_city    text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles
  add column if not exists user_id      uuid,
  add column if not exists display_name text,
  add column if not exists avatar_url   text,
  add column if not exists home_city    text,
  add column if not exists bio          text,
  add column if not exists updated_at   timestamptz not null default now();

create index if not exists profiles_user_id_idx on public.profiles (user_id);

alter table public.profiles enable row level security;

-- Profiles are public identities — anyone may read them.
drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read
  on public.profiles
  for select
  using (true);

-- ── follows ──────────────────────────────────────────────────────────────────
-- Directed follow edge. One row per (follower, followee) pair; a self-follow is
-- rejected by a CHECK. Both sides reference profiles with ON DELETE CASCADE so a
-- deleted profile cleans up its edges.
create table if not exists public.follows (
  id          uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (follower_id, followee_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'follows_no_self_chk') then
    alter table public.follows
      add constraint follows_no_self_chk
      check (follower_id <> followee_id);
  end if;
end $$;

create index if not exists follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

-- The follow graph is public (a public follower/following count is expected).
drop policy if exists follows_public_read on public.follows;
create policy follows_public_read
  on public.follows
  for select
  using (true);

-- ── saved_pubs ───────────────────────────────────────────────────────────────
-- A profile's saved/bookmarked pubs, grouped by a free-text `list_type`
-- (e.g. 'want-to-go', 'favourites'). `venue_id` is the same text id used in
-- visit_reports — pubs live in-repo, not in a venues table, so no FK.
create table if not exists public.saved_pubs (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  venue_id   text not null,
  list_type  text not null default 'saved',
  note       text,
  created_at timestamptz not null default now(),
  unique (profile_id, venue_id, list_type)
);

create index if not exists saved_pubs_profile_idx on public.saved_pubs (profile_id);

alter table public.saved_pubs enable row level security;

-- Saved lists are public content (a shareable "my pubs" list).
drop policy if exists saved_pubs_public_read on public.saved_pubs;
create policy saved_pubs_public_read
  on public.saved_pubs
  for select
  using (true);

-- ── pint_drop_reactions ──────────────────────────────────────────────────────
-- Lightweight reactions on a pint drop, keyed by an `actor_hash` (a hashed,
-- unauthenticated actor id — same hashing spirit as rate-limit keys, never a raw
-- IP). One row per (drop, actor, reaction) so an actor can't double-count a
-- reaction. References visit_reports(id) so a deleted drop clears its reactions.
create table if not exists public.pint_drop_reactions (
  id            uuid primary key default gen_random_uuid(),
  pint_drop_id  uuid not null references public.visit_reports (id) on delete cascade,
  actor_hash    text not null,
  reaction      text not null,
  created_at    timestamptz not null default now(),
  unique (pint_drop_id, actor_hash, reaction)
);

create index if not exists pint_drop_reactions_drop_idx
  on public.pint_drop_reactions (pint_drop_id);

alter table public.pint_drop_reactions enable row level security;

-- Reaction counts are public (they render on the public drop).
drop policy if exists pint_drop_reactions_public_read on public.pint_drop_reactions;
create policy pint_drop_reactions_public_read
  on public.pint_drop_reactions
  for select
  using (true);

-- ── pint_drop_comments ───────────────────────────────────────────────────────
-- Public comments on a pint drop. `status` mirrors the drop moderation model
-- (visible/hidden/pending); only 'visible' comments are exposed by a public
-- read (RLS below), matching visit_reports_public_read.
create table if not exists public.pint_drop_comments (
  id           uuid primary key default gen_random_uuid(),
  pint_drop_id uuid not null references public.visit_reports (id) on delete cascade,
  actor_hash   text not null,
  handle       text,
  body         text not null,
  status       text not null default 'visible',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pint_drop_comments_status_chk') then
    alter table public.pint_drop_comments
      add constraint pint_drop_comments_status_chk
      check (status in ('visible', 'hidden', 'pending'));
  end if;
end $$;

create index if not exists pint_drop_comments_drop_created_idx
  on public.pint_drop_comments (pint_drop_id, created_at desc);

alter table public.pint_drop_comments enable row level security;

-- Public read is limited to visible comments; hidden/pending stay server-side
-- (mirrors visit_reports_public_read).
drop policy if exists pint_drop_comments_public_read on public.pint_drop_comments;
create policy pint_drop_comments_public_read
  on public.pint_drop_comments
  for select
  using (status = 'visible');

-- ── pint_drop_reports ────────────────────────────────────────────────────────
-- Abuse reports against a pint drop. Actor-scoped: unique (pint_drop_id,
-- actor_hash) so one actor reports a given drop exactly once (a second report is
-- a no-op upsert, not a counter bump). Reports are moderation metadata — NO
-- public read policy, so with RLS on they are server-only (service role reads).
create table if not exists public.pint_drop_reports (
  id           uuid primary key default gen_random_uuid(),
  pint_drop_id uuid not null references public.visit_reports (id) on delete cascade,
  actor_hash   text not null,
  reason       text,
  details      text,
  created_at   timestamptz not null default now(),
  unique (pint_drop_id, actor_hash)
);

create index if not exists pint_drop_reports_drop_idx
  on public.pint_drop_reports (pint_drop_id);

-- RLS on, and NO select policy on purpose: reports are moderation-only. Anon
-- reads are denied; the service role bypasses RLS to review them.
alter table public.pint_drop_reports enable row level security;

-- ── crawl_stories ────────────────────────────────────────────────────────────
-- A curated pub-crawl narrative authored by a profile. `visibility` gates the
-- public read: only 'public' (and 'unlisted', reachable by slug) stories are
-- exposed; 'draft' stays server-side. `slug` is the stable public URL key.
create table if not exists public.crawl_stories (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid references public.profiles (id) on delete set null,
  title           text not null,
  slug            text not null unique,
  summary         text,
  visibility      text not null default 'draft',
  cover_image_url text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crawl_stories_visibility_chk') then
    alter table public.crawl_stories
      add constraint crawl_stories_visibility_chk
      check (visibility in ('draft', 'public', 'unlisted'));
  end if;
end $$;

create index if not exists crawl_stories_author_idx on public.crawl_stories (author_id);

alter table public.crawl_stories enable row level security;

-- Public read: published stories only. Unlisted stories are readable too (they
-- are shared by slug, not listed); drafts stay server-side.
drop policy if exists crawl_stories_public_read on public.crawl_stories;
create policy crawl_stories_public_read
  on public.crawl_stories
  for select
  using (visibility in ('public', 'unlisted'));

-- ── crawl_story_stops ────────────────────────────────────────────────────────
-- An ordered stop on a crawl story. `position` orders the route; `venue_id` is
-- the in-repo pub id (no FK, see saved_pubs); `pint_drop_id` optionally links a
-- stop to the drop logged there. One stop per (story, position).
create table if not exists public.crawl_story_stops (
  id              uuid primary key default gen_random_uuid(),
  crawl_story_id  uuid not null references public.crawl_stories (id) on delete cascade,
  venue_id        text not null,
  position        int not null default 0,
  note            text,
  pint_drop_id    uuid references public.visit_reports (id) on delete set null,
  arrived_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (crawl_story_id, position)
);

create index if not exists crawl_story_stops_story_idx
  on public.crawl_story_stops (crawl_story_id, position);

alter table public.crawl_story_stops enable row level security;

-- A stop is as public as its parent story. Postgres RLS can't cheaply express
-- "readable iff parent visible" without a subquery, so this permissive read
-- exposes stop rows; the app only ever queries stops for a story it already
-- resolved through crawl_stories_public_read, and a stop carries no sensitive
-- data (a venue id, a note, an optional public drop id). Tighten to an EXISTS
-- subquery against crawl_stories if stops ever carry private fields.
drop policy if exists crawl_story_stops_public_read on public.crawl_story_stops;
create policy crawl_story_stops_public_read
  on public.crawl_story_stops
  for select
  using (true);
