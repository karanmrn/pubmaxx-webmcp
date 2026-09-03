-- Rollback for 0079_handle_claim_no_inheritance.
--
-- Restores public_contributor_leaderboard() to its pre-0079 definition
-- (20260728140000_0059_contributor_leaderboard.sql), which joins visible
-- contributions to profile_handle_aliases on handle alone, with no time
-- bound against the alias's claimed_at.
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
    select profile.handle, contribution.lane
      from visible_contributions as contribution
      join public.profile_handle_aliases as alias
        on lower(alias.handle) = lower(contribution.handle)
      join public.profiles as profile
        on profile.id = alias.profile_id
  )
  select handle,
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
