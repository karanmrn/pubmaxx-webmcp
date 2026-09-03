-- Community price submissions (fm/price-submission): durable backing for
-- "tap a pub, log tonight's price" on the venue sheet. Apply AFTER 0053.
-- House style mirrors 0025_price_confirms:
--   • `create table if not exists` - idempotent, re-runnable.
--   • RLS enabled with NO public/raw policy - the service-role route reads and
--     writes, then returns only the derived per-category freshest price.
--
-- ⚠️ NOT APPLIED this session - ships as SQL only; the integrator applies via
-- MCP / `supabase db push` and runs the advisor pass. Until then
-- lib/communityPriceStore.ts fails soft to process-memory OUTSIDE production
-- (onMissingDurableWrite refuses the ephemeral fallback in a deployed
-- production instance), so keyless dev keeps working and the surface becomes
-- durable the moment this lands - no code change needed.
--
-- Model notes:
--   • One row = one observation: "at THIS venue, a THIS-category drink cost
--     £X, seen at time T". APPEND-ONLY with respect to the rest of the system:
--     nothing here ever edits the versioned venue dataset or visit_reports. The
--     scraped/sourced baseline and a community price coexist, each read back
--     with its own timestamp and source, so provenance is never flattened.
--   • This is a SIBLING of price_confirms, not a replacement. price_confirms
--     counts vouches for an already-displayed figure; this table is the first
--     time a figure is submitted by a drinker.
--   • `venue_id` (text) is the slim-index stable venue id - NOT an FK (venues
--     live in the versioned dataset, not a Postgres table). `price_pennies` is
--     the integer-penny normalisation of the GBP price (£4.20 → 420).
--   • `drink_category` matches the closed DRINK_CATEGORIES union in
--     lib/drinks.ts. Constrained here so a drifting client can never widen it.
--   • `actor` is the server-derived hashed-IP token, or NULL when hashing was
--     unavailable. The unique constraint below lets one device REPLACE its
--     own earlier observation for a drink (an upsert correction) rather than
--     stacking rows, so one person can't weight a venue twice - while
--     anonymous (NULL-actor) rows stay insert-only, because NULLs never equal
--     each other under a plain unique constraint, matching the memory store.
--     Low-sensitivity, but raw tokens stay API-only - hence RLS with no policy.
--   • The penny CHECK mirrors COMMUNITY_PRICE_MIN/MAX_GBP (£1 … £30) in
--     lib/communityPrice.ts and the store's own envelope: three layers agreeing.

create table if not exists public.community_prices (
  id              uuid primary key default gen_random_uuid(),
  venue_id        text not null,
  drink_category  text not null,
  price_pennies   integer not null,
  actor           text,
  submitted_at    timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'community_prices_pennies_check'
  ) then
    alter table public.community_prices
      add constraint community_prices_pennies_check
      check (price_pennies >= 100 and price_pennies <= 3000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'community_prices_category_check'
  ) then
    alter table public.community_prices
      add constraint community_prices_category_check
      check (drink_category in (
        'beer', 'wine', 'whisky', 'gin', 'vodka', 'rum', 'cocktail', 'shot', 'other'
      ));
  end if;
end $$;

-- One live observation per (venue, drink, device) - the upsert conflict target
-- (`onConflict: "venue_id,drink_category,actor"` in lib/communityPriceStore.ts).
-- A full table constraint, not a partial index, because PostgREST's ON CONFLICT
-- carries no index predicate, so only a constraint can arbitrate the upsert -
-- the same reason 0025_price_confirms uses one. Anonymous rows (actor is null)
-- are still never collapsed together: NULLs never equal each other under a
-- plain unique constraint, so two different phones behind a broken hash stay
-- two observations, not one.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'community_prices_actor_key'
  ) then
    alter table public.community_prices
      add constraint community_prices_actor_key
      unique (venue_id, drink_category, actor);
  end if;
end $$;

-- The hot read: every observation for one venue, newest first, reduced by the
-- store to the freshest price per drink category.
create index if not exists community_prices_venue_recent_idx
  on public.community_prices (venue_id, submitted_at desc);

alter table public.community_prices enable row level security;

drop policy if exists community_prices_public_read on public.community_prices;
-- Intentionally no SELECT/INSERT/UPDATE/DELETE policy for anon/authenticated
-- roles: raw actor tokens are API-only, and the service-role route bypasses RLS.
