-- Keep the SQL snapshot context allowlist in step with the TS projection:
-- #871 added wetherspoonsPreferred to InferredNight and
-- lib/socialCrewProjection.server.ts, but read_social_crew_snapshot's
-- jsonb_build_object allowlist (0075) still dropped the key, so a member
-- snapshot lost the soft-prefer flag. Recreate the function with the field.
-- SQL only - the captain applies migrations.

drop function if exists public.read_social_crew_snapshot(uuid, uuid, uuid);

create function public.read_social_crew_snapshot(
  p_viewer_account_id uuid,
  p_viewer_profile_id uuid,
  p_crew_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select account.id as account_id, profile.id as profile_id
    from public.private_social_accounts account
    join public.profiles profile on profile.id=account.profile_id
    where account.id=p_viewer_account_id
      and account.profile_id=p_viewer_profile_id
      and account.ownership_state='active'
  ),
  authority as (
    select
      crew.id as crew_id,
      crew.plan_id,
      crew.owner_account_id,
      owner_account.profile_id as owner_profile_id,
      crew.visibility,
      crew.authority_revision,
      plan.title,
      plan.start_time,
      plan.created_at,
      plan.route_revision,
      plan.status,
      plan.night_context,
      plan.ending,
      plan.anchor_venue_id,
      plan.anchor_source,
      plan.plan_outcome,
      plan.route_ready_at
    from public.social_crews crew
    join public.plans plan
      on plan.id=crew.plan_id
      and plan.social_owner_account_id=crew.owner_account_id
    join public.private_social_accounts owner_account
      on owner_account.id=crew.owner_account_id
      and owner_account.ownership_state='active'
    join public.profiles owner_profile on owner_profile.id=owner_account.profile_id
    join public.social_crew_members owner_member
      on owner_member.crew_id=crew.id
      and owner_member.social_account_id=crew.owner_account_id
      and owner_member.role='owner'
      and owner_member.state='active'
    join public.plan_crew_members owner_plan_member
      on owner_plan_member.id=owner_member.plan_member_id
      and owner_plan_member.plan_id=plan.id
      and owner_plan_member.social_account_id=crew.owner_account_id
    where crew.id=p_crew_id
  ),
  relationship as (
    select case
      when actor.account_id=authority.owner_account_id then 'self'
      when public.social_relationship_between_profiles(
        actor.profile_id,authority.owner_profile_id
      )='mutual' then 'mutual'
      else 'denied'
    end as state
    from actor cross join authority
  ),
  viewer_membership as (
    select member.id,member.state,member.plan_member_id
    from actor
    join authority on true
    join public.social_crew_members member
      on member.crew_id=authority.crew_id
      and member.social_account_id=actor.account_id
  ),
  viewer_member_authority as (
    select viewer_membership.id
    from actor
    join authority on true
    join viewer_membership on viewer_membership.state='active'
    join public.plan_crew_members plan_member
      on plan_member.id=viewer_membership.plan_member_id
      and plan_member.plan_id=authority.plan_id
      and plan_member.social_account_id=actor.account_id
  ),
  latest_request as (
    select request.state, request.expires_at
    from actor cross join authority
    join public.social_crew_join_requests request
      on request.crew_id=authority.crew_id
      and request.requester_account_id=actor.account_id
    order by request.created_at desc,request.id desc
    limit 1
  ),
  request_projection as (
    select case
      when request.state='pending'
        and request.expires_at>statement_timestamp() then 'pending'
      when request.state='declined' then 'declined'
      else 'none'
    end as state
    from latest_request request
    union all
    select 'none'
    where not exists(select 1 from latest_request)
  ),
  active_members as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'memberId',member.id,
        'accountId',member.social_account_id,
        'profileId',account.profile_id,
        'planMemberId',member.plan_member_id,
        'handle',profile.handle,
        'role',member.role,
        'state',member.state,
        'joinedAt',to_char(member.joined_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) order by member.joined_at,member.id
    ),'[]'::jsonb) as rows
    from authority
    join public.social_crew_members member
      on member.crew_id=authority.crew_id and member.state='active'
    join public.private_social_accounts account
      on account.id=member.social_account_id and account.ownership_state='active'
    join public.profiles profile on profile.id=account.profile_id
    join public.plan_crew_members plan_member
      on plan_member.id=member.plan_member_id
      and plan_member.plan_id=authority.plan_id
      and plan_member.social_account_id=member.social_account_id
  ),
  stops as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'venueId',stop.venue_id,
        'venueName',stop.venue_name,
        'position',stop.position
      ) order by stop.position
    ),'[]'::jsonb) as rows
    from authority
    join public.plan_stops stop on stop.plan_id=authority.plan_id
  ),
  actions as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',action.id,
        'type',action.type,
        'stopPosition',action.stop_position,
        'ending',action.ending,
        'createdAt',to_char(action.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) order by action.created_at,action.id
    ),'[]'::jsonb) as rows
    from authority
    join public.plan_actions action on action.plan_id=authority.plan_id
  ),
  member_snapshot as (
    select jsonb_build_object(
      'kind','member',
      'ownerRelationship',relationship.state,
      'crew',jsonb_build_object(
        'crewId',authority.crew_id,
        'planId',authority.plan_id,
        'ownerAccountId',authority.owner_account_id,
        'ownerProfileId',authority.owner_profile_id,
        'visibility',authority.visibility,
        'authorityRevision',authority.authority_revision,
        'joinRequestState','none',
        'members',active_members.rows
      ),
      'plan',jsonb_build_object(
        'plan',jsonb_build_object(
          'id',authority.plan_id,
          'title',authority.title,
          'startTime',to_char(authority.start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'createdAt',to_char(authority.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'routeRevision',authority.route_revision,
          'status',authority.status,
          'anchorVenueId',authority.anchor_venue_id,
          'anchorSource',authority.anchor_source,
          'outcome',authority.plan_outcome,
          'routeReadyAt',case when authority.route_ready_at is null then null else
            to_char(authority.route_ready_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
        ),
        'stops',stops.rows,
        'context',case when authority.night_context is null then null else jsonb_build_object(
          'nightArea',authority.night_context->'nightArea',
          'daypart',authority.night_context->'daypart',
          'partyType',authority.night_context->'partyType',
          'groupSize',authority.night_context->'groupSize',
          'budget',authority.night_context->'budget',
          'budgetLimitPence',authority.night_context->'budgetLimitPence',
          'zeroProof',authority.night_context->'zeroProof',
          'wetherspoonsPreferred',authority.night_context->'wetherspoonsPreferred',
          'atmosphere',authority.night_context->'atmosphere',
          'foodNeeds',authority.night_context->'foodNeeds',
          'accessibility',authority.night_context->'accessibility',
          'transportConstraints',authority.night_context->'transportConstraints'
        ) end,
        'actions',actions.rows,
        'ending',authority.ending
      )
    ) as value
    from authority cross join relationship cross join active_members cross join stops cross join actions
  ),
  preview_snapshot as (
    select jsonb_build_object(
      'kind','preview',
      'preview',jsonb_build_object(
        'title',authority.title,
        'status',authority.status,
        'nightArea',authority.night_context->'nightArea',
        'startsAt',to_char(authority.start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'joinRequestState',request_projection.state
      )
    ) as value
    from authority cross join request_projection
  )
  select case
    when not exists(select 1 from actor)
      or not exists(select 1 from authority) then null::jsonb
    when exists(select 1 from viewer_member_authority) then
      case when (select state from relationship) in ('self','mutual')
        then (select value from member_snapshot)
        else null::jsonb end
    when exists(select 1 from viewer_membership) then null::jsonb
    when (select visibility from authority)='friends'
      and (select state from relationship)='mutual'
      then (select value from preview_snapshot)
    else null::jsonb
  end;
$$;
