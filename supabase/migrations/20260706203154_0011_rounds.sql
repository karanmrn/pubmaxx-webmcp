-- The Round: a group crawl that builds itself live (GH #26, PRD § The Spill).
-- Apply AFTER 0010. Style mirrors 0006_social_layer.sql / 0010_notifications.sql:
--   • `create table if not exists` / `add column if not exists` — idempotent,
--     re-runnable.
--   • CHECK constraints added inside a DO block guarded by a pg_constraint lookup.
--   • RLS on every table, service-role-only write (no anon/authenticated INSERT
--     policy → those inserts are denied; the server route writes via service role).
--   • Public read, like the rest of the social layer.
--
-- Identity note: like the whole social layer, everything here is keyed by the
-- self-asserted `handle` (no auth yet — profiles.user_id stays the reserved future
-- link, see 0006/0009). A Round joins by a short shareable code, not an account.
-- The code IS the capability: anyone who knows it can read the Round's state and
-- (via the server route) join / add a stop. That's the design — a Round is a thing
-- you tell your mates ("tell your mates: JXKQ7M"), not a private resource. Nothing
-- here carries content beyond a pub name + a device handle, all already public in
-- the feed. When auth lands, tighten writes to member ownership.

create extension if not exists "pgcrypto";

-- ── rounds ───────────────────────────────────────────────────────────────────
-- One row per group crawl session. `code` is the short, human-shareable join key
-- (unambiguous alphabet, no vowels — see lib/rounds.ts ROUND_CODE_ALPHABET — so it
-- never spells a word and never confuses O/0 or I/1). `closed_at` NULL = still out.
create table if not exists public.rounds (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  title             text not null,
  created_by_handle text not null,
  created_at        timestamptz not null default now(),
  closed_at         timestamptz
);

alter table public.rounds
  add column if not exists closed_at timestamptz;

-- The join lookup is by code — the one hot path (getByCode).
create index if not exists rounds_code_idx on public.rounds (code);

alter table public.rounds enable row level security;

-- Public read: a Round is a shareable session (see header). Service-role-only
-- write — only the server route creates / closes a Round.
drop policy if exists rounds_public_read on public.rounds;
create policy rounds_public_read
  on public.rounds
  for select
  using (true);

-- ── round_members ────────────────────────────────────────────────────────────
-- Who is in a Round, by self-asserted handle. unique(round_id, handle) makes a
-- join idempotent — re-joining with the same handle is a no-op, not a duplicate.
create table if not exists public.round_members (
  id        uuid primary key default gen_random_uuid(),
  round_id  uuid not null references public.rounds (id) on delete cascade,
  handle    text not null,
  joined_at timestamptz not null default now(),
  unique (round_id, handle)
);

create index if not exists round_members_round_idx on public.round_members (round_id);

alter table public.round_members enable row level security;

drop policy if exists round_members_public_read on public.round_members;
create policy round_members_public_read
  on public.round_members
  for select
  using (true);

-- ── round_stops ──────────────────────────────────────────────────────────────
-- The self-building route: one row per pub added to the Round, in insert order
-- (created_at). `venue_id` is the slim-index venue id; `venue_name` is denormalised
-- so the read side renders the stop list without a venue lookup. `added_by_handle`
-- attributes the stop to the member who added it ("who added what"). `drop_ref` is
-- the optional Pint Drop this stop was logged from — the "builds itself" seam (a
-- drop at a new pub appends a stop); nullable because a stop can also be added
-- directly by a member without logging a drop first. unique(round_id, venue_id)
-- keeps the route a set of distinct pubs — the same pub isn't a second stop.
create table if not exists public.round_stops (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references public.rounds (id) on delete cascade,
  venue_id        text not null,
  venue_name      text not null,
  added_by_handle text not null,
  drop_ref        text,
  created_at      timestamptz not null default now(),
  unique (round_id, venue_id)
);

alter table public.round_stops
  add column if not exists drop_ref text;

-- The hot read: a Round's stops in insert order (the route as it built itself).
create index if not exists round_stops_round_created_idx
  on public.round_stops (round_id, created_at);

alter table public.round_stops enable row level security;

drop policy if exists round_stops_public_read on public.round_stops;
create policy round_stops_public_read
  on public.round_stops
  for select
  using (true);
