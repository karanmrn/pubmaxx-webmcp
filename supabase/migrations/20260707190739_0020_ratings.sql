-- Ratings (PRD E3): star ratings for BOTH drinks and pubs. Apply AFTER 0019.
-- House style mirrors the service-mediated tables:
--   • `create table if not exists` — idempotent, re-runnable.
--   • CHECK constraints added inside DO blocks guarded by a pg_constraint lookup.
--   • RLS on every table with no public/raw SELECT policy. The server route
--     reads and writes via the service role, then returns aggregate summaries.
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the integrator applies via
-- MCP / `supabase db push` and runs the advisor pass.
--
-- Model notes:
--   • One row = one handle's CURRENT rating of one item. Re-rating is an UPSERT
--     on the unique (ref, handle) pair — the latest vote replaces the old one,
--     and the store refreshes created_at so recency windows see the re-cast.
--   • `rating` is 1–5 in half-star steps: the CHECK pins both the range and the
--     0.5 granularity (rating * 2 must be an integer). Mirrors lib/ratings.ts.
--   • Identity is the self-asserted handle (no auth yet) — same trust posture
--     as reactions/comments/notifications: a rating is already-public, low-
--     sensitivity signal, noted honestly here and in lib/ratingsStore.ts.
--     Raw rows still carry handles, so direct anon/authenticated SQL reads stay
--     denied; public surfaces go through aggregate API responses. When auth
--     ownership merges, gate writes on auth.uid() ownership.
--   • `drink_ref` (text) is the stable drink key: the drink id from
--     lib/drinks.ts (e.g. "beer-<app_price_id>", "drink-prospect-wine") — or a
--     venueId+drinkName composite where no id exists. `venue_id` is the
--     slim-index stable venue id (text, NOT an FK — venues live in the
--     versioned public/data dataset, not a Postgres table), nullable on
--     drink_ratings because a drink ref can be self-contained.
--   • Aggregation (Bayesian prior, ≥10-vote display floor, recency windows,
--     percentile framing) happens in lib/ratings.ts — the tables store raw
--     votes only, so the maths can evolve without a migration.

create extension if not exists "pgcrypto";

-- ── drink_ratings ─────────────────────────────────────────────────────────────
create table if not exists public.drink_ratings (
  id         uuid primary key default gen_random_uuid(),
  drink_ref  text not null,
  venue_id   text,
  handle     text not null,
  rating     numeric(2,1) not null,
  created_at timestamptz not null default now(),
  unique (drink_ref, handle)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drink_ratings_rating_check'
  ) then
    alter table public.drink_ratings
      add constraint drink_ratings_rating_check
      check (rating >= 1 and rating <= 5 and (rating * 2) = floor(rating * 2));
  end if;
end $$;

-- The hot read: every vote for one drink (summaryFor batches with `in (...)`).
create index if not exists drink_ratings_ref_idx
  on public.drink_ratings (drink_ref);
-- Secondary: a venue's drink votes (venue menu surfaces).
create index if not exists drink_ratings_venue_idx
  on public.drink_ratings (venue_id);
-- Recency-aware reads over recent drink votes.
create index if not exists drink_ratings_created_idx
  on public.drink_ratings (created_at);

alter table public.drink_ratings enable row level security;

drop policy if exists drink_ratings_public_read on public.drink_ratings;
-- Intentionally no SELECT/INSERT/UPDATE/DELETE policy for anon/authenticated
-- roles: raw handles are API-only, and the service-role route bypasses RLS.

-- ── venue_ratings ─────────────────────────────────────────────────────────────
create table if not exists public.venue_ratings (
  id         uuid primary key default gen_random_uuid(),
  venue_id   text not null,
  handle     text not null,
  rating     numeric(2,1) not null,
  created_at timestamptz not null default now(),
  unique (venue_id, handle)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'venue_ratings_rating_check'
  ) then
    alter table public.venue_ratings
      add constraint venue_ratings_rating_check
      check (rating >= 1 and rating <= 5 and (rating * 2) = floor(rating * 2));
  end if;
end $$;

-- The hot read: every vote for one venue.
create index if not exists venue_ratings_venue_idx
  on public.venue_ratings (venue_id);
-- Recency-aware reads over recent venue votes.
create index if not exists venue_ratings_created_idx
  on public.venue_ratings (created_at);

alter table public.venue_ratings enable row level security;

drop policy if exists venue_ratings_public_read on public.venue_ratings;
-- Intentionally no SELECT/INSERT/UPDATE/DELETE policy for anon/authenticated
-- roles: raw handles are API-only, and the service-role route bypasses RLS.
