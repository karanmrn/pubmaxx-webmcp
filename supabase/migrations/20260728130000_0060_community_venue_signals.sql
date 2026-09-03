-- Community-observed pub signals share the existing community_prices
-- observation table, actor, timestamp, replacement rule, and API route.
-- The table name is now narrower than its contents, but keeping it avoids a
-- risky rename across deployed functions. Each row remains exactly one thing:
-- either a drink price or one categorical venue signal.

alter table public.community_prices
  add column if not exists signal_key text,
  add column if not exists signal_value text;

alter table public.community_prices
  alter column drink_category drop not null,
  alter column price_pennies drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_prices_observation_shape_check'
  ) then
    alter table public.community_prices
      add constraint community_prices_observation_shape_check
      check (
        (
          drink_category is not null
          and price_pennies is not null
          and signal_key is null
          and signal_value is null
        )
        or
        (
          drink_category is null
          and price_pennies is null
          and signal_key is not null
          and signal_value is not null
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_prices_signal_pair_check'
  ) then
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
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_prices_signal_actor_key'
  ) then
    alter table public.community_prices
      add constraint community_prices_signal_actor_key
      unique (venue_id, signal_key, actor);
  end if;
end $$;

create index if not exists community_prices_signal_venue_recent_idx
  on public.community_prices (venue_id, signal_key, submitted_at desc)
  where signal_key is not null;

create index if not exists community_prices_actor_contributions_idx
  on public.community_prices (actor)
  where actor is not null;

-- Future leaderboard seam. Opaque actor keys stay server-only under base-table
-- RLS; no route or screen is added in this migration.
create or replace view public.community_contributor_counts
with (security_invoker = true)
as
select
  actor as contributor_key,
  count(*) filter (where drink_category is not null)::integer as price_count,
  count(*) filter (where signal_key is not null)::integer as venue_signal_count,
  count(*)::integer as total
from public.community_prices
where actor is not null
group by actor;

revoke all on public.community_contributor_counts from anon, authenticated;
