-- Rollback 0110 open social crews. Restores 0075 write RPCs and the
-- 0084 snapshot. Open rows become private so the narrower CHECK can land.

begin;

update public.social_crews set visibility='private' where visibility='open';

alter table public.social_crews
  drop constraint if exists social_crews_visibility_check;
alter table public.social_crews
  add constraint social_crews_visibility_check
  check (visibility in ('private','friends'));

create or replace function public.create_social_crew_atomic(
  p_actor_account_id uuid,p_plan_id uuid,p_host_token_hash text,p_visibility text,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_plan public.plans%rowtype; v_host public.plan_crew_members%rowtype;
  v_crew uuid:=gen_random_uuid(); v_member uuid:=gen_random_uuid(); v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'create',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  if p_visibility is null or p_visibility not in ('private','friends') then return public._social_crew_fail_write(p_actor_account_id,'create',p_idempotency_key,p_payload_digest,'invalid'); end if;
  select * into v_plan from public.plans where id=p_plan_id for update;
  if not found or v_plan.status in ('completed','abandoned') or now() >= v_plan.start_time+interval '8 hours' then
    return public._social_crew_fail_write(p_actor_account_id,'create',p_idempotency_key,p_payload_digest,'not_found');
  end if;
  if v_plan.social_owner_account_id is not null then return public._social_crew_fail_write(p_actor_account_id,'create',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_host from public.plan_crew_members
    where plan_id=p_plan_id and token_hash=p_host_token_hash order by joined_at,id limit 1 for update;
  if not found or v_host.id <> (select id from public.plan_crew_members where plan_id=p_plan_id order by joined_at,id limit 1)
    then return public._social_crew_fail_write(p_actor_account_id,'create',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if not exists(select 1 from public.private_social_accounts where id=p_actor_account_id and ownership_state='active') then
    return public._social_crew_fail_write(p_actor_account_id,'create',p_idempotency_key,p_payload_digest,'not_found'); end if;
  insert into public.social_crews(id,plan_id,owner_account_id,visibility)
    values(v_crew,p_plan_id,p_actor_account_id,p_visibility);
  update public.plan_crew_members set token_hash=encode(extensions.digest(gen_random_uuid()::text || id::text || clock_timestamp()::text,'sha256'),'hex')
    where plan_id=p_plan_id;
  update public.plan_crew_members set social_account_id=p_actor_account_id where id=v_host.id;
  insert into public.social_crew_members(id,crew_id,social_account_id,plan_member_id,role,state)
    values(v_member,v_crew,p_actor_account_id,v_host.id,'owner','active');
  update public.plan_invites set revoked_at=now()
    where plan_id=p_plan_id and revoked_at is null and redeemed_at is null;
  update public.plans set social_owner_account_id=p_actor_account_id where id=p_plan_id;
  v_response:=jsonb_build_object('ok',true,'code','created','crew_id',v_crew,'member_id',v_member);
  return public._social_crew_finish_write(p_actor_account_id,'create',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.request_social_crew_join_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_action text,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_owner uuid; v_expiry timestamptz; v_request public.social_crew_join_requests%rowtype;
  v_id uuid:=gen_random_uuid(); v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  select owner_account_id into v_owner from public.social_crews where id=p_crew_id;
  if v_owner is null or public._social_crew_relationship_between_accounts(p_actor_account_id,v_owner) is distinct from 'mutual'
    then return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if p_action='cancelled' then
    select * into v_request from public.social_crew_join_requests
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending' for update;
    if not found then return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
    update public.social_crew_join_requests set state='cancelled',decided_at=now() where id=v_request.id;
    v_response:=jsonb_build_object('ok',true,'code','cancelled','request_id',v_request.id);
  elsif p_action='pending' then
    v_expiry:=public._social_crew_plan_expiry(p_crew_id);
    if v_expiry is null or v_expiry<=now() then return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'invalid'); end if;
    update public.social_crew_join_requests set state='expired',decided_at=now()
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending' and now()>=expires_at;
    if exists(select 1 from public.social_crew_members
      where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active') then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'already_member'); end if;
    if exists(select 1 from public.social_crew_join_requests
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending') then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'already_pending'); end if;
    insert into public.social_crew_join_requests(id,crew_id,requester_account_id,expires_at)
      values(v_id,p_crew_id,p_actor_account_id,v_expiry);
    v_response:=jsonb_build_object('ok',true,'code','requested','request_id',v_id);
  else return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'invalid'); end if;
  return public._social_crew_finish_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.decide_social_crew_join_request_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_request_id uuid,p_decision text,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_operation text:='join-decision:'||p_crew_id::text; v_replay jsonb;
  v_request public.social_crew_join_requests%rowtype; v_role text; v_decider uuid; v_owner uuid;
  v_member uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_request from public.social_crew_join_requests
    where id=p_request_id and crew_id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_request.state<>'pending' then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'already_decided'); end if;
  if now()>=v_request.expires_at then
    update public.social_crew_join_requests set state='expired',decided_at=now() where id=v_request.id;
    return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'expired'); end if;
  select id into v_decider from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active';
  if p_decision='accepted' then
    select owner_account_id into v_owner from public.social_crews where id=p_crew_id;
    if public._social_crew_relationship_between_accounts(v_request.requester_account_id,v_owner) is distinct from 'mutual' then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    v_member:=public._activate_social_crew_member(p_crew_id,v_request.requester_account_id);
    if v_member is null then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'full'); end if;
    v_response:=jsonb_build_object('ok',true,'code','accepted','member_id',v_member);
  elsif p_decision='declined' then v_response:=jsonb_build_object('ok',true,'code','declined');
  else return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'invalid'); end if;
  update public.social_crew_join_requests set state=p_decision,decided_at=now(),decided_by_member_id=v_decider where id=v_request.id;
  return public._social_crew_finish_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.update_social_crew_visibility_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_visibility text,p_expected_authority_revision integer,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_revision integer; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'visibility',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  select authority_revision into v_revision from public.social_crews where id=p_crew_id for update;
  if public._social_crew_member_role(p_crew_id,p_actor_account_id) is distinct from 'owner' or p_visibility is null or p_visibility not in ('private','friends')
    then return public._social_crew_fail_write(p_actor_account_id,'visibility',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_revision is distinct from p_expected_authority_revision then return public._social_crew_fail_write(p_actor_account_id,'visibility',p_idempotency_key,p_payload_digest,'conflict'); end if;
  update public.social_crews set visibility=p_visibility,authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id
    returning authority_revision into v_revision;
  v_response:=jsonb_build_object('ok',true,'code','updated','authority_revision',v_revision);
  return public._social_crew_finish_write(p_actor_account_id,'visibility',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

-- Preserve original function OIDs and ACLs under private migration names. The
-- public wrappers make Crew-bound Plans absent while delegating unbound Plans
-- byte-for-byte to the previous implementation. Rollback renames originals back.
create or replace function public.read_social_crew_snapshot(
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

create or replace function public.read_social_crew_member_page(
  p_viewer_account_id uuid,
  p_viewer_profile_id uuid,
  p_cursor_joined_at timestamptz,
  p_cursor_member_id uuid,
  p_limit integer
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with valid_input as (
    select p_limit as page_limit
    where p_limit between 1 and 50
      and ((p_cursor_joined_at is null and p_cursor_member_id is null)
        or (p_cursor_joined_at is not null and p_cursor_member_id is not null))
  ),
  actor as (
    select account.id as account_id, profile.id as profile_id
    from valid_input
    join public.private_social_accounts account
      on account.id=p_viewer_account_id
      and account.profile_id=p_viewer_profile_id
      and account.ownership_state='active'
    join public.profiles profile on profile.id=account.profile_id
  ),
  authorised as (
    select
      crew.id as crew_id,
      plan.title,
      plan.status,
      plan.night_context->'nightArea' as night_area,
      plan.start_time,
      member.id as member_id,
      member.social_account_id as account_id,
      actor.profile_id,
      member.role,
      member.state,
      member.joined_at
    from actor
    join public.social_crew_members member
      on member.social_account_id=actor.account_id and member.state='active'
    join public.social_crews crew on crew.id=member.crew_id
    join public.plans plan
      on plan.id=crew.plan_id
      and plan.social_owner_account_id=crew.owner_account_id
    join public.plan_crew_members plan_member
      on plan_member.id=member.plan_member_id
      and plan_member.plan_id=plan.id
      and plan_member.social_account_id=actor.account_id
    join public.private_social_accounts owner_account
      on owner_account.id=crew.owner_account_id and owner_account.ownership_state='active'
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
    where (
      crew.owner_account_id=actor.account_id
      or public.social_relationship_between_profiles(
        actor.profile_id,owner_account.profile_id
      )='mutual'
    )
      and (p_cursor_joined_at is null
        or (member.joined_at,member.id)<(p_cursor_joined_at,p_cursor_member_id))
  ),
  bounded as (
    select authorised.*
    from authorised
    order by joined_at desc,member_id desc
    limit (select page_limit+1 from valid_input)
  ),
  positioned as (
    select bounded.*,
      row_number() over(order by joined_at desc,member_id desc) as row_number
    from bounded
  ),
  page as (
    select
      count(*) as bounded_count,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'crewId',crew_id,
          'title',title,
          'status',status,
          'nightArea',night_area,
          'startsAt',to_char(start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'memberId',member_id,
          'accountId',account_id,
          'profileId',profile_id,
          'role',role,
          'state',state,
          'joinedAt',to_char(joined_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ) order by joined_at desc,member_id desc
      ) filter(where row_number<=(select page_limit from valid_input)),'[]'::jsonb) as items
    from positioned
  ),
  last_returned as (
    select joined_at,member_id
    from positioned
    where row_number=(select page_limit from valid_input)
  )
  select case when not exists(select 1 from actor) then null::jsonb else
    jsonb_build_object(
      'items',page.items,
      'hasMore',page.bounded_count>(select page_limit from valid_input),
      'cursorPosition',case
        when page.bounded_count>(select page_limit from valid_input) then (
          select jsonb_build_object(
            'joinedAt',to_char(last_returned.joined_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'memberId',last_returned.member_id
          ) from last_returned
        ) else null end
    ) end
  from page;
$$;

drop function if exists public.list_open_social_crews(timestamptz, timestamptz, text, integer);
drop function if exists public.list_open_social_crews(timestamptz, integer);
drop function if exists public.open_plan_stop_matches_city(text, text);

commit;
