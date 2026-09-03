begin;

-- Restore the exact 0110 /out definition before removing the public preview
-- migration. The queue rollback follows, then 0110 can remove this function
-- with its own original rollback.
create or replace function public.list_open_social_crews(
  p_from timestamptz,
  p_until timestamptz,
  p_city text,
  p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(listed.row_obj order by listed.start_time, listed.crew_id), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'crewId', crew.id,
      'title', plan.title,
      'startTime', to_char(plan.start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'stopVenueId', stop.venue_id,
      'stopVenueName', stop.venue_name,
      'hostHandle', profile.handle,
      'memberCount', (
        select count(*)::integer
        from public.social_crew_members member
        join public.private_social_accounts member_account
          on member_account.id = member.social_account_id
          and member_account.ownership_state = 'active'
        join public.plan_crew_members plan_member
          on plan_member.id = member.plan_member_id
          and plan_member.plan_id = plan.id
          and plan_member.social_account_id = member.social_account_id
        where member.crew_id = crew.id and member.state = 'active'
      )
    ) as row_obj,
    plan.start_time,
    crew.id as crew_id
    from public.social_crews crew
    join public.plans plan
      on plan.id = crew.plan_id
      and plan.social_owner_account_id = crew.owner_account_id
    join public.private_social_accounts account
      on account.id = crew.owner_account_id
      and account.ownership_state = 'active'
    join public.profiles profile on profile.id = account.profile_id
    join lateral (
      select stop.venue_id, stop.venue_name
      from public.plan_stops stop
      where stop.plan_id = plan.id
      order by stop.position, stop.venue_id
      limit 1
    ) stop on true
    where crew.visibility = 'open'
      and plan.status not in ('completed','abandoned')
      and plan.start_time >= p_from
      and plan.start_time < p_until
      and public.open_plan_stop_matches_city(stop.venue_id, p_city)
    order by plan.start_time, crew.id
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
  ) listed;
$$;

revoke all on function public.list_open_social_crews(timestamptz, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.list_open_social_crews(timestamptz, timestamptz, text, integer) to service_role;

drop function if exists public.read_social_crew_public_preview(uuid);

commit;
