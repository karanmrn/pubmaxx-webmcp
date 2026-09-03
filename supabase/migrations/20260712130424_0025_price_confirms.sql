-- Price confirms (B1): durable backing for the "Still £4.20?" micro-signal on
-- the venue sheet. Apply AFTER 0024. House style mirrors 0020_ratings:
--   • `create table if not exists` — idempotent, re-runnable.
--   • RLS enabled with NO public/raw policy — the service-role route reads and
--     writes, then returns only an aggregate tally ({confirms, lastConfirmedAt}).
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the integrator applies via
-- MCP / `supabase db push` and runs the advisor pass. Until then lib/
-- priceConfirmStore.ts fails soft to process-memory, so the chip keeps working
-- and becomes durable the moment this lands (no code change needed).
--
-- Model notes:
--   • One row = one actor's confirmation that a (venue, price) is STILL right.
--     A re-tap is an UPSERT on (venue_id, price_pennies, actor): it refreshes
--     last_confirmed_at, never inserts a second row — so the tally stays an
--     honest count of DISTINCT confirmers, exactly like the in-memory store.
--   • This is NOT a pricing source: it never stores or edits a price of its own,
--     only a penny value that was already displayed. Provenance can't be
--     laundered through it.
--   • `venue_id` (text) is the slim-index stable venue id — NOT an FK (venues
--     live in the versioned dataset, not a Postgres table). `price_pennies` is
--     the integer-penny normalisation of the confirmed GBP price (£4.20 → 420).
--   • `actor` is the server-derived hashed-IP token (or a per-call anon token
--     when hashing is unavailable). Low-sensitivity, but raw tokens stay
--     API-only — hence RLS with no read policy.

create table if not exists public.price_confirms (
  id                uuid primary key default gen_random_uuid(),
  venue_id          text not null,
  price_pennies     integer not null,
  actor             text not null,
  last_confirmed_at timestamptz not null default now(),
  unique (venue_id, price_pennies, actor)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'price_confirms_pennies_check'
  ) then
    alter table public.price_confirms
      add constraint price_confirms_pennies_check
      check (price_pennies >= 1 and price_pennies <= 100000);
  end if;
end $$;

-- The hot read: every confirm for one (venue, price) — counted as distinct
-- actors and reduced to a max timestamp by the store.
create index if not exists price_confirms_key_idx
  on public.price_confirms (venue_id, price_pennies);

alter table public.price_confirms enable row level security;

drop policy if exists price_confirms_public_read on public.price_confirms;
-- Intentionally no SELECT/INSERT/UPDATE/DELETE policy for anon/authenticated
-- roles: raw actor tokens are API-only, and the service-role route bypasses RLS.
