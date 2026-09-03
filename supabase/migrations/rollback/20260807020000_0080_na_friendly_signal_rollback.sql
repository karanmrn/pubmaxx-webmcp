-- Rollback for 0080_na_friendly_signal.
--
-- Restores community_prices_signal_pair_check to its pre-0080 shape
-- (20260728130000_0060_community_venue_signals.sql), dropping the
-- na-friendly branch.
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
  );
