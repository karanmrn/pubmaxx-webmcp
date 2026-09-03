-- Handle claims stop inheriting pre-claim contributions.
--
-- Captain decision 2026-07-31: claiming an unlinked handle gives the
-- claimant that name from the claim forward only. A contribution recorded
-- before the claim stays unattributed to any profile.
--
-- public_contributor_leaderboard() joined visible contributions to
-- profile_handle_aliases on the handle string alone, with no time bound.
-- A claim on a previously unlinked handle silently back-dated every
-- historic row under that string to the new owner's profile. This
-- redefinition carries each contribution's own recorded-at timestamp
-- through visible_contributions and bounds the alias join to rows at or
-- after the alias's claimed_at, which the claim RPC already stamps at the
-- true claim moment. No new column or backfill is needed.
--
-- This does not change what a source row DISPLAYS. contributor_handle and
-- handle stay as stored on community_prices, structured_visit_reports, and
-- weather_recommendations; a pre-claim row still shows its own handle
-- string on its own surface. It only stops counting toward the claimant's
-- profile aggregate.
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
    select contributor_handle as handle, 'price'::text as lane,
           submitted_at as recorded_at
      from public.community_prices
     where contributor_handle is not null
       and hidden_at is null
    union all
    select handle, 'review'::text as lane,
           created_at as recorded_at
      from public.structured_visit_reports
     where status = 'visible'
    union all
    select contributor_handle as handle, 'recommendation'::text as lane,
           submitted_at as recorded_at
      from public.weather_recommendations
     where status = 'visible'
  ),
  canonical_contributions as (
    select profile.handle,
           contribution.lane
      from visible_contributions as contribution
      join public.profile_handle_aliases as alias
        on lower(alias.handle) = lower(contribution.handle)
       and contribution.recorded_at >= alias.claimed_at
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
