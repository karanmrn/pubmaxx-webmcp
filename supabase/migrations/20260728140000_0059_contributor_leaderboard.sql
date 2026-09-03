-- Public contributor record.
--
-- Ranking stays a plain count. These columns retain signals a later policy can
-- weight without changing source rows or running another backfill. Existing
-- anonymous price rows remain anonymous and never enter a named board.

alter table public.community_prices
  add column if not exists contributor_handle text,
  add column if not exists corroborated_at timestamptz,
  add column if not exists contradicted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'community_prices_contributor_handle_check'
  ) then
    alter table public.community_prices
      add constraint community_prices_contributor_handle_check
      check (
        contributor_handle is null
        or contributor_handle ~ '^[a-z0-9_]{1,30}$'
      );
  end if;
end $$;

create index if not exists community_prices_contributor_idx
  on public.community_prices (contributor_handle, submitted_at desc)
  where contributor_handle is not null;

-- Stamp historical usefulness signals after writes. Corroboration means a
-- second independent actor agrees within the product's 50p or 10% window.
-- Contradiction means a later visible row falls outside that window.
create or replace function public.refresh_community_price_quality()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.community_prices as candidate
     set corroborated_at = coalesce(
           candidate.corroborated_at,
           case when (
             select count(distinct coalesce(peer.actor, 'anon:*'))
             from public.community_prices as peer
             where peer.venue_id = candidate.venue_id
               and peer.drink_category = candidate.drink_category
               and peer.hidden_at is null
               and abs(peer.price_pennies - candidate.price_pennies)
                   <= greatest(50, round(candidate.price_pennies * 0.10))
           ) >= 2 then now() end
         ),
         contradicted_at = coalesce(
           candidate.contradicted_at,
           case when exists (
             select 1
             from public.community_prices as later
             where later.venue_id = candidate.venue_id
               and later.drink_category = candidate.drink_category
               and later.hidden_at is null
               and later.submitted_at > candidate.submitted_at
               and abs(later.price_pennies - candidate.price_pennies)
                   > greatest(50, round(candidate.price_pennies * 0.10))
           ) then now() end
         )
   where candidate.venue_id = new.venue_id
     and candidate.drink_category = new.drink_category;
  return new;
end;
$$;

drop trigger if exists community_price_quality_after_write
  on public.community_prices;
create trigger community_price_quality_after_write
after insert or update of
  price_pennies, actor, contributor_handle, hidden_at
on public.community_prices
for each row execute function public.refresh_community_price_quality();

-- Backfill every existing venue/category once through the same trigger owner.
-- Updating one row to its present figure fires an UPDATE OF trigger without
-- changing the observation. The trigger then stamps the whole group.
do $$
declare
  price_group record;
begin
  for price_group in
    select venue_id, drink_category
    from public.community_prices
    group by venue_id, drink_category
  loop
    update public.community_prices
       set price_pennies = price_pennies
     where id = (
       select id
       from public.community_prices
       where venue_id = price_group.venue_id
         and drink_category = price_group.drink_category
       order by submitted_at asc, id asc
       limit 1
     );
  end loop;
end $$;

alter table public.weather_recommendations
  add column if not exists status text not null default 'visible',
  add column if not exists moderated_at timestamptz,
  add column if not exists moderator_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'weather_recommendations_status_check'
  ) then
    alter table public.weather_recommendations
      add constraint weather_recommendations_status_check
      check (status in ('visible', 'hidden'));
  end if;
end $$;

create index if not exists weather_recommendations_contributor_status_idx
  on public.weather_recommendations (contributor_handle, status);

-- Exact all-time aggregation. No cache or materialized view sits between the
-- source rows and this answer, so a moderation decision changes rank at once.
create or replace function public.public_contributor_leaderboard()
returns table (
  handle text,
  prices bigint,
  reviews bigint,
  recommendations bigint,
  total bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible_contributions as (
    select contributor_handle as handle, 'price'::text as lane
      from public.community_prices
     where contributor_handle is not null
       and hidden_at is null
    union all
    select handle, 'review'::text as lane
      from public.structured_visit_reports
     where status = 'visible'
    union all
    select contributor_handle as handle, 'recommendation'::text as lane
      from public.weather_recommendations
     where status = 'visible'
  ),
  canonical_contributions as (
    select profile.handle,
           contribution.lane
      from visible_contributions as contribution
      join public.profile_handle_aliases as alias
        on lower(alias.handle) = lower(contribution.handle)
      join public.profiles as profile
        on profile.id = alias.profile_id
  )
  select
    handle,
    count(*) filter (where lane = 'price') as prices,
    count(*) filter (where lane = 'review') as reviews,
    count(*) filter (where lane = 'recommendation') as recommendations,
    count(*) as total
  from canonical_contributions
  group by handle
  order by total desc, handle asc;
$$;

revoke all on function public.public_contributor_leaderboard() from public;
grant execute on function public.public_contributor_leaderboard() to service_role;
