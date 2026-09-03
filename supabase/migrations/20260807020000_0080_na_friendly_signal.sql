-- Community venue signals: add the 'na-friendly' signal key.
--
-- No-alcohol-first crawl styles need a reader-facing "did drinkers find good
-- alcohol-free options here" observation, the same shape as character, door
-- policy and people-eating: a closed vocabulary, standard (non-access) trust
-- rules, and the shared community_prices observation table.
--
-- 'na-friendly' is a taste/welcome signal, not a safety-critical access fact,
-- so it does NOT join the access-key set: a lone report may read as
-- "reported", an established answer needs corroboration, and an ageing
-- report demotes the same way character and door-policy do. Values are
-- 'good-na-options' / 'limited-na', a drinker's own judgement wording, in
-- line with how 'character' asks for rough/posh rather than a bare fact.
--
-- ADDITIVE-ONLY and non-destructive: no column is added or dropped, no row
-- is rewritten, and the constraint is only WIDENED (a superset of the prior
-- allowed values), so every existing row still satisfies it. All five
-- existing branches are preserved unchanged; only the sixth branch is new.
--
-- Safe to run before the app rollout: the widened constraint accepts both
-- the old and the new signal_key/signal_value pairs.

alter table public.community_prices
  drop constraint if exists community_prices_signal_pair_check;

alter table public.community_prices
  add constraint community_prices_signal_pair_check
  check (
    (signal_key is null and signal_value is null)
    or
    (signal_key = 'character' and signal_value in ('rough', 'posh'))
    or
    (
      signal_key in ('step-free-venue', 'step-free-toilets')
      and signal_value in ('step-free', 'steps')
    )
    or
    (
      signal_key = 'door-policy'
      and signal_value in ('no-issue', 'trainers', 'groups', 'late')
    )
    or
    (
      signal_key = 'people-eating'
      and signal_value in ('eating', 'drinks-only')
    )
    or
    (
      signal_key = 'na-friendly'
      and signal_value in ('good-na-options', 'limited-na')
    )
  );
