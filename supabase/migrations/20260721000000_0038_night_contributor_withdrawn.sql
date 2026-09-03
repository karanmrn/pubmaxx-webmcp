-- 0038 · Night Story contributor "withdrawn" status (Wayfinder 5.5)
--
-- Widens the night_story_contributors.status CHECK to accept a new value,
-- 'withdrawn', which marks a contributor who has departed a PUBLISHED Story via
-- consent withdrawal or account deletion. The publish gate
-- (getPublishedRecapSource) reads this to redact their content + identity from
-- the shared Story without destroying anyone else's Story.
--
-- ADDITIVE-ONLY and non-destructive:
--   • No column is added or dropped; no row is rewritten.
--   • The constraint is only WIDENED (a superset of the prior allowed values),
--     so every existing row still satisfies it.
--   • 'withdrawn' <> 'removed', so the host-uniqueness partial index
--     (… where role = 'host' and status <> 'removed') keeps counting a withdrawn
--     host — the Story survives; only the departed person's content is redacted.
--
-- Safe to run before the app rollout: the widened constraint accepts both the
-- old and the new value.

alter table public.night_story_contributors
  drop constraint if exists night_story_contributors_status_check;

alter table public.night_story_contributors
  add constraint night_story_contributors_status_check
  check (status in ('invited', 'accepted', 'removed', 'withdrawn'));
