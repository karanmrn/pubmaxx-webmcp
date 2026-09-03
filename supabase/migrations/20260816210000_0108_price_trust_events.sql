-- Price trust events (0108): durable first-cluster unlocks and credits.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT A ROW IS: one append-only record that a (venue, drink category) first
-- became trusted under lib/communityPrice.ts, plus one credit per independent
-- account in that first cluster. A later agreeing report is not a second
-- unlock. A moderator hide writes a reversal row (reversal_of) and never
-- updates the original.
--
-- RLS: service-role only. The browser never reads or writes these tables.
-- GET /api/price-impact is the only reader.

begin;

create table if not exists public.price_trust_events (
  id uuid primary key,
  evidence_fingerprint text not null,
  venue_id text not null,
  category text not null,
  observation_ids text[] not null,
  created_at timestamptz not null default now(),
  reversal_of uuid references public.price_trust_events(id)
);

comment on table public.price_trust_events is
  'Append-only trust unlocks. One fingerprint per first qualifying cluster. Reversals are new rows.';
comment on column public.price_trust_events.evidence_fingerprint is
  'Stable hash of venue id, category, and the sorted observation ids in the first cluster.';
comment on column public.price_trust_events.observation_ids is
  'The threshold cluster: independent observation ids that first made the category trusted.';
comment on column public.price_trust_events.reversal_of is
  'Set on an audit reversal. The original row is never updated.';

alter table public.price_trust_events
  drop constraint if exists price_trust_events_fingerprint_key;
alter table public.price_trust_events
  add constraint price_trust_events_fingerprint_key unique (evidence_fingerprint);

alter table public.price_trust_events
  drop constraint if exists price_trust_events_category_check;
alter table public.price_trust_events
  add constraint price_trust_events_category_check
  check (category in (
    'beer',
    'wine',
    'whisky',
    'gin',
    'vodka',
    'rum',
    'cocktail',
    'shot',
    'alcohol-free',
    'soft-drink',
    'coffee',
    'other'
  ));

create index if not exists price_trust_events_venue_category_idx
  on public.price_trust_events (venue_id, category, created_at desc);

-- A moderator hide asks which events carry one observation id, so the array
-- membership read is indexed rather than scanning every event.
create index if not exists price_trust_events_observation_ids_idx
  on public.price_trust_events using gin (observation_ids);

create index if not exists price_trust_events_reversal_of_idx
  on public.price_trust_events (reversal_of)
  where reversal_of is not null;

create table if not exists public.price_trust_credits (
  user_id uuid not null references auth.users(id) on delete cascade,
  trust_event_id uuid not null references public.price_trust_events(id) on delete cascade,
  primary key (user_id, trust_event_id)
);

comment on table public.price_trust_credits is
  'Account-bound credits for a trust event. Unique per (user, event). Deleted with the account.';
comment on column public.price_trust_credits.user_id is
  'PUBMAXX User ID. Never a handle.';

create index if not exists price_trust_credits_event_idx
  on public.price_trust_credits (trust_event_id);

alter table public.price_trust_events enable row level security;
alter table public.price_trust_credits enable row level security;

revoke all on table public.price_trust_events from public, anon, authenticated;
revoke all on table public.price_trust_credits from public, anon, authenticated;
grant select, insert, update, delete on table public.price_trust_events to service_role;
grant select, insert, update, delete on table public.price_trust_credits to service_role;

drop policy if exists price_trust_events_anon_deny on public.price_trust_events;
create policy price_trust_events_anon_deny
  on public.price_trust_events for all to anon
  using (false) with check (false);

drop policy if exists price_trust_events_authenticated_deny on public.price_trust_events;
create policy price_trust_events_authenticated_deny
  on public.price_trust_events for all to authenticated
  using (false) with check (false);

drop policy if exists price_trust_credits_anon_deny on public.price_trust_credits;
create policy price_trust_credits_anon_deny
  on public.price_trust_credits for all to anon
  using (false) with check (false);

drop policy if exists price_trust_credits_authenticated_deny on public.price_trust_credits;
create policy price_trust_credits_authenticated_deny
  on public.price_trust_credits for all to authenticated
  using (false) with check (false);

commit;
