-- Community-price moderation (fm/trust-quickfixes): the receiving side of the
-- open write path. Apply AFTER 0054.
--
-- Until now a community price could be submitted by anyone and removed by
-- nobody - the only remediation for a wrong or malicious figure was hand-written
-- SQL. This migration adds the minimum that makes a complaint answerable in
-- product: a reader can FLAG a row, a moderator can HIDE it.
--
-- HIDE, NEVER DELETE - the same rule the Pint Drop and comment paths follow.
-- `hidden_at` is a stamp, not a tombstone: the observation, its price, its date
-- and its report metadata all survive, so a wrong moderation call is one UPDATE
-- away from reversal and the audit trail is intact.
--
-- REPORTING NEVER AUTO-HIDES, unlike pint drops (which hide at
-- REPORT_HIDE_THRESHOLD). A community price is what the map is made of, and the
-- write path is anonymous on both sides: an auto-hide threshold here would hand
-- a griefer a one-tap eraser for any price they disliked. `report_count` is
-- evidence for a human, and nothing in the read path consults it.
--
-- Per-actor report uniqueness is DURABLE (community_price_reports' unique pair),
-- exactly as 0017 made it durable for pint drops, so the route's windowed rate
-- limit is flood protection rather than the correctness guarantee.
--
-- Reads: lib/communityPriceStore.ts filters `hidden_at is not null` rows in
-- application code (freshestPerCategory), not in SQL, so the process-memory and
-- durable backends cannot disagree about what hiding removes - the sheet row,
-- the corroboration count, and the map candidate all go at once.

alter table public.community_prices
  add column if not exists hidden_at      timestamptz,
  add column if not exists moderated_at   timestamptz,
  add column if not exists moderator_note text,
  add column if not exists reported_at    timestamptz,
  add column if not exists report_reason  text,
  add column if not exists report_count   integer not null default 0;

-- The moderation queue read: reported and/or hidden rows, newest report first.
create index if not exists community_prices_review_idx
  on public.community_prices (reported_at desc)
  where report_count > 0 or hidden_at is not null;

-- The durable per-actor ledger. `actor_hash` is the same server-derived hashed
-- token the rest of the anonymous surfaces use, never a raw IP. Null actor
-- (hashing unavailable) stays insert-only: NULLs never equal each other under a
-- plain unique constraint, matching community_prices.actor's own rule.
create table if not exists public.community_price_reports (
  id                 uuid primary key default gen_random_uuid(),
  community_price_id uuid not null references public.community_prices (id) on delete cascade,
  actor_hash         text,
  reason             text,
  created_at         timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'community_price_reports_actor_key'
  ) then
    alter table public.community_price_reports
      add constraint community_price_reports_actor_key
      unique (community_price_id, actor_hash);
  end if;
end $$;

alter table public.community_price_reports enable row level security;
-- Same posture as community_prices: no anon/authenticated policy at all. Raw
-- actor tokens are API-only and the service-role route bypasses RLS.

-- Insert-the-ledger-then-count, in one statement, mirroring report_pint_drop_v2:
--   • unknown price id            → null (the caller maps it to a 404);
--   • fresh (price, actor) pair   → ledger row + one atomic counter UPDATE;
--   • duplicate (price, actor)    → idempotent no-op, counter untouched.
-- Deliberately WITHOUT a hide threshold: see the header. Nothing in this
-- function may set hidden_at.
create or replace function report_community_price(
  p_id uuid,
  p_actor_hash text,
  p_reason text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  if not exists (select 1 from public.community_prices where id = p_id) then
    return null;
  end if;

  insert into public.community_price_reports (community_price_id, actor_hash, reason)
  values (p_id, nullif(p_actor_hash, ''), nullif(p_reason, ''))
  on conflict (community_price_id, actor_hash) do nothing;
  v_inserted := found;

  -- A same-actor repeat is answered "yes, we have your report" without moving
  -- the counter: the row is flagged either way, and the count must keep meaning
  -- "how many different people".
  if not v_inserted then
    return true;
  end if;

  update public.community_prices
     set report_count  = coalesce(report_count, 0) + 1,
         reported_at   = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason)
   where id = p_id;

  return true;
end;
$$;
