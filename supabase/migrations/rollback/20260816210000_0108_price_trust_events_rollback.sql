-- Rollback 0108: drop trust events and credits.
--
-- Lossy by design: visible lifetime unlocks go with the tables. Community
-- prices stay. The personal impact card falls back to observations only.

begin;

drop policy if exists price_trust_credits_authenticated_deny on public.price_trust_credits;
drop policy if exists price_trust_credits_anon_deny on public.price_trust_credits;
drop policy if exists price_trust_events_authenticated_deny on public.price_trust_events;
drop policy if exists price_trust_events_anon_deny on public.price_trust_events;

drop index if exists public.price_trust_credits_event_idx;
drop index if exists public.price_trust_events_reversal_of_idx;
drop index if exists public.price_trust_events_observation_ids_idx;
drop index if exists public.price_trust_events_venue_category_idx;

drop table if exists public.price_trust_credits;
drop table if exists public.price_trust_events;

commit;
