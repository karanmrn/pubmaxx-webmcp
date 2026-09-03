-- Drinks: generalise the beer-only price model to every category (PRD E1 —
-- "all drinks"). Apply AFTER 0015. Style mirrors 0011_rounds.sql /
-- 0006_social_layer.sql:
--   • `create table if not exists` / `add column if not exists` — idempotent,
--     re-runnable.
--   • CHECK constraint added inside a DO block guarded by a pg_constraint lookup.
--   • RLS on the table, public read, service-role-only write (no anon/
--     authenticated INSERT policy → those inserts are denied; the server route
--     writes via service role). Matches the whole first-party-price discipline.
--
-- ⚠️ NOT APPLIED this session: Supabase MCP is unauthenticated, so this ships as
-- SQL only. The integrator applies it (`supabase db push` / MCP once re-authed)
-- and runs the advisor pass. Nothing in the app reads this table yet — the Menu
-- UI reads the pure lib/drinkMenu.ts path (legacy pints + seeds); this table is
-- the durable home a live price/metadata fetcher (E2) will write into.
--
-- Model note: one row = one drink fact, carrying its OWN provenance
-- {source, licence, observed_at} — provenance never flattens (app-wide
-- invariant). A pint is simply category='beer'; the existing pint/cheapest-price
-- paths are untouched. Mirrors lib/drinks.ts `Drink` exactly.

create extension if not exists "pgcrypto";

-- ── drinks ───────────────────────────────────────────────────────────────────
-- `venue_id` is the slim-index stable venue id (text, as elsewhere in the social
-- layer — e.g. round_stops.venue_id), NOT an FK: venues live in the versioned
-- public/data dataset, not a Postgres table. `category` is the closed taxonomy
-- from lib/drinks.ts, pinned by the CHECK below. Price is required (a menu item
-- must carry a price). `abv` is numeric(4,1) — a percent like 45.8 — nullable
-- because ABV is honestly unknown for many pours, never defaulted to 0.
create table if not exists public.drinks (
  id           uuid primary key default gen_random_uuid(),
  venue_id     text not null,
  category     text not null,
  name         text not null,
  producer     text,
  abv          numeric(4,1),
  style        text,
  region       text,
  serving_size text,
  price_gbp    numeric(6,2) not null,
  -- Provenance — every drink fact stamps its own source/licence/observed-at.
  source       text not null,
  licence      text not null,
  observed_at  timestamptz not null,
  created_at   timestamptz not null default now()
);

-- Idempotent column adds (safe if the table pre-existed a partial run).
alter table public.drinks add column if not exists producer text;
alter table public.drinks add column if not exists abv numeric(4,1);
alter table public.drinks add column if not exists style text;
alter table public.drinks add column if not exists region text;
alter table public.drinks add column if not exists serving_size text;

-- Category taxonomy CHECK — the closed set from lib/drinks.ts DRINK_CATEGORIES.
-- Added in a guarded DO block so re-running the migration doesn't error on a
-- duplicate constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drinks_category_check'
  ) then
    alter table public.drinks
      add constraint drinks_category_check
      check (category in (
        'beer','wine','whisky','gin','vodka','rum','cocktail','shot','other'
      ));
  end if;
end $$;

-- The hot read: a venue's whole menu (all categories) in one lookup.
create index if not exists drinks_venue_idx on public.drinks (venue_id);
-- Secondary: a category slice within a venue (e.g. "just the whisky").
create index if not exists drinks_venue_category_idx
  on public.drinks (venue_id, category);

alter table public.drinks enable row level security;

-- Public read — drink menus are public content, like prices and the social
-- layer. Service-role-only write (no INSERT/UPDATE/DELETE policy for anon or
-- authenticated → the server route is the only writer, via service role).
drop policy if exists drinks_public_read on public.drinks;
create policy drinks_public_read
  on public.drinks
  for select
  using (true);
