-- Social Crew authority foundation. All Crew authority is service-only and
-- bound to stable private account IDs. Existing Plan capabilities are revoked
-- at conversion and every legacy mutation RPC is fenced below.
--
-- digest() calls below are qualified as extensions.digest(): Supabase
-- installs pgcrypto in the extensions schema, not public.

alter table public.plans
  add column social_owner_account_id uuid
    references public.private_social_accounts(id) on delete restrict;

alter table public.plan_crew_members
  add column social_account_id uuid
    references public.private_social_accounts(id) on delete restrict;

-- Browser Plan access remains available for legacy Plans only. The 0065
-- helper is the single policy seam used by Plans, Stops, and members.
create or replace function pubmax_private.rls_is_plan_participant(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_plan_id is not null
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.plans pl
      where pl.id = p_plan_id
        and pl.social_owner_account_id is null
        and (
          pl.owner_user_id = (select auth.uid())
          or exists (
            select 1
            from public.plan_crew_members m
            where m.plan_id = p_plan_id
              and m.user_id = (select auth.uid())
          )
        )
    );
$$;

-- 0066 granted table-wide SELECT before the private Social owner column
-- existed. Retain its prior column surface without exposing the new account ID.
revoke select on table public.plans from authenticated;
grant select (
  id, title, start_time, owner_user_id, created_at, status, night_context,
  ending, route_revision, creation_key_hash, creation_request_hash,
  anchor_venue_id, anchor_source, plan_outcome, route_ready_at
) on table public.plans to authenticated;

create unique index plan_crew_members_social_account_idx
  on public.plan_crew_members(plan_id, social_account_id)
  where social_account_id is not null;

-- Legacy collaboration mutations now enter through Plan-first RPCs. Removing
-- direct service-role DML prevents child-first lock order from racing Crew
-- conversion. Existing vote and decision RPCs are wrapped later in this file.
revoke insert, update, delete on table
  public.plan_invites,
  public.plan_constraints,
  public.plan_route_proposals,
  public.plan_votes,
  public.plan_vote_requests,
  public.plan_vibe_votes,
  public.plan_vibe_vote_requests
from service_role;

create function public.create_plan_invite_atomic(
  p_plan_id uuid,
  p_invite_id uuid,
  p_created_by_member_id uuid,
  p_token_hash text,
  p_idempotency_key text,
  p_created_at timestamptz,
  p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_invite public.plan_invites%rowtype;
begin
  select social_owner_account_id into v_owner
  from public.plans where id=p_plan_id for update;
  if not found or v_owner is not null then return jsonb_build_object('code','not_found'); end if;
  if not exists (
    select 1 from public.plan_crew_members
    where id=p_created_by_member_id and plan_id=p_plan_id and status='in'
  ) then return jsonb_build_object('code','not_found'); end if;
  select * into v_invite from public.plan_invites
  where plan_id=p_plan_id and created_by_member_id=p_created_by_member_id
    and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('code','replayed','row',to_jsonb(v_invite)); end if;
  insert into public.plan_invites(
    id,plan_id,created_by_member_id,role,token_hash,idempotency_key,
    created_at,expires_at,revoked_at,redeemed_at
  ) values(
    p_invite_id,p_plan_id,p_created_by_member_id,'guest',p_token_hash,p_idempotency_key,
    p_created_at,p_expires_at,null,null
  ) returning * into v_invite;
  return jsonb_build_object('code','created','row',to_jsonb(v_invite));
end;
$$;

create function public.revoke_plan_invite_atomic(
  p_plan_id uuid,
  p_invite_id uuid,
  p_revoked_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_invite public.plan_invites%rowtype;
begin
  select social_owner_account_id into v_owner
  from public.plans where id=p_plan_id for update;
  if not found or v_owner is not null then return jsonb_build_object('code','not_found'); end if;
  select * into v_invite from public.plan_invites
  where id=p_invite_id and plan_id=p_plan_id for update;
  if not found then return jsonb_build_object('code','not_found'); end if;
  if v_invite.revoked_at is null then
    update public.plan_invites set revoked_at=p_revoked_at where id=v_invite.id
    returning * into v_invite;
    return jsonb_build_object('code','revoked','row',to_jsonb(v_invite));
  end if;
  return jsonb_build_object('code','replayed','row',to_jsonb(v_invite));
end;
$$;

create function public.consume_plan_invite_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_redeemed_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_start_time timestamptz;
  v_invite public.plan_invites%rowtype;
begin
  select social_owner_account_id,start_time into v_owner,v_start_time
  from public.plans where id=p_plan_id for update;
  if not found or v_owner is not null then return jsonb_build_object('code','not_found'); end if;
  select * into v_invite from public.plan_invites
  where plan_id=p_plan_id and token_hash=p_token_hash for update;
  if not found then return jsonb_build_object('code','not_found'); end if;
  if v_invite.revoked_at is not null then return jsonb_build_object('code','revoked'); end if;
  if v_invite.expires_at <= p_redeemed_at then return jsonb_build_object('code','expired'); end if;
  if v_start_time + interval '8 hours' <= p_redeemed_at then return jsonb_build_object('code','expired'); end if;
  if v_invite.redeemed_at is not null then return jsonb_build_object('code','replayed'); end if;
  update public.plan_invites set redeemed_at=p_redeemed_at where id=v_invite.id
  returning * into v_invite;
  return jsonb_build_object('code','consumed','row',to_jsonb(v_invite));
end;
$$;

create function public.add_plan_constraint_atomic(
  p_plan_id uuid,
  p_constraint_id uuid,
  p_member_id uuid,
  p_kind text,
  p_value text,
  p_priority text,
  p_idempotency_key text,
  p_created_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_constraint public.plan_constraints%rowtype;
begin
  select social_owner_account_id into v_owner
  from public.plans where id=p_plan_id for update;
  if not found or v_owner is not null then return jsonb_build_object('code','not_found'); end if;
  if not exists (
    select 1 from public.plan_crew_members
    where id=p_member_id and plan_id=p_plan_id and status='in'
  ) then return jsonb_build_object('code','not_found'); end if;
  select * into v_constraint from public.plan_constraints
  where plan_id=p_plan_id and member_id=p_member_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('code','replayed','row',to_jsonb(v_constraint)); end if;
  insert into public.plan_constraints(
    id,plan_id,member_id,kind,value,priority,idempotency_key,created_at
  ) values(
    p_constraint_id,p_plan_id,p_member_id,p_kind,p_value,p_priority,p_idempotency_key,p_created_at
  ) returning * into v_constraint;
  return jsonb_build_object('code','created','row',to_jsonb(v_constraint));
end;
$$;

create function public.resolve_plan_constraint_atomic(
  p_plan_id uuid,
  p_constraint_id uuid,
  p_resolved_by_member_id uuid,
  p_resolution_evidence jsonb,
  p_resolution_idempotency_key text,
  p_resolved_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_constraint public.plan_constraints%rowtype;
begin
  select social_owner_account_id into v_owner
  from public.plans where id=p_plan_id for update;
  if not found or v_owner is not null then return jsonb_build_object('code','not_found'); end if;
  if not exists (
    select 1 from public.plan_crew_members
    where id=p_resolved_by_member_id and plan_id=p_plan_id and status='in'
  ) then return jsonb_build_object('code','not_found'); end if;
  select * into v_constraint from public.plan_constraints
  where id=p_constraint_id and plan_id=p_plan_id for update;
  if not found then return jsonb_build_object('code','not_found'); end if;
  if v_constraint.resolved_at is not null then
    return jsonb_build_object('code','replayed','row',to_jsonb(v_constraint));
  end if;
  update public.plan_constraints set
    resolved_at=p_resolved_at,
    resolved_by_member_id=p_resolved_by_member_id,
    resolution_evidence=p_resolution_evidence,
    resolution_idempotency_key=p_resolution_idempotency_key
  where id=v_constraint.id returning * into v_constraint;
  return jsonb_build_object('code','resolved','row',to_jsonb(v_constraint));
end;
$$;

create function public.create_plan_route_proposal_atomic(
  p_plan_id uuid,
  p_proposal_id uuid,
  p_proposed_by_member_id uuid,
  p_expected_route_revision integer,
  p_stops jsonb,
  p_reason text,
  p_resolved_constraint_ids jsonb,
  p_unresolved_constraint_ids jsonb,
  p_idempotency_key text,
  p_created_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_proposal public.plan_route_proposals%rowtype;
begin
  select social_owner_account_id into v_owner
  from public.plans where id=p_plan_id for update;
  if not found or v_owner is not null then return jsonb_build_object('code','not_found'); end if;
  if not exists (
    select 1 from public.plan_crew_members
    where id=p_proposed_by_member_id and plan_id=p_plan_id and status='in'
  ) then return jsonb_build_object('code','not_found'); end if;
  select * into v_proposal from public.plan_route_proposals
  where plan_id=p_plan_id and proposed_by_member_id=p_proposed_by_member_id
    and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('code','replayed','row',to_jsonb(v_proposal)); end if;
  insert into public.plan_route_proposals(
    id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,
    resolved_constraint_ids,unresolved_constraint_ids,status,idempotency_key,
    decision_idempotency_key,created_at,decided_at
  ) values(
    p_proposal_id,p_plan_id,p_proposed_by_member_id,p_expected_route_revision,p_stops,p_reason,
    p_resolved_constraint_ids,p_unresolved_constraint_ids,'pending',p_idempotency_key,
    null,p_created_at,null
  ) returning * into v_proposal;
  return jsonb_build_object('code','created','row',to_jsonb(v_proposal));
end;
$$;

revoke all on function
  public.create_plan_invite_atomic(uuid,uuid,uuid,text,text,timestamptz,timestamptz),
  public.revoke_plan_invite_atomic(uuid,uuid,timestamptz),
  public.consume_plan_invite_atomic(uuid,text,timestamptz),
  public.add_plan_constraint_atomic(uuid,uuid,uuid,text,text,text,text,timestamptz),
  public.resolve_plan_constraint_atomic(uuid,uuid,uuid,jsonb,text,timestamptz),
  public.create_plan_route_proposal_atomic(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb,text,timestamptz)
from public, anon, authenticated;
grant execute on function
  public.create_plan_invite_atomic(uuid,uuid,uuid,text,text,timestamptz,timestamptz),
  public.revoke_plan_invite_atomic(uuid,uuid,timestamptz),
  public.consume_plan_invite_atomic(uuid,text,timestamptz),
  public.add_plan_constraint_atomic(uuid,uuid,uuid,text,text,text,text,timestamptz),
  public.resolve_plan_constraint_atomic(uuid,uuid,uuid,jsonb,text,timestamptz),
  public.create_plan_route_proposal_atomic(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb,text,timestamptz)
to service_role;

create table public.social_crews (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.plans(id) on delete cascade,
  owner_account_id uuid not null references public.private_social_accounts(id) on delete restrict,
  visibility text not null default 'private' check (visibility in ('private','friends')),
  authority_revision integer not null default 1 check (authority_revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_crew_members (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.social_crews(id) on delete cascade,
  social_account_id uuid not null references public.private_social_accounts(id) on delete restrict,
  plan_member_id uuid not null references public.plan_crew_members(id) on delete restrict,
  role text not null check (role in ('owner','cohost','member')),
  state text not null default 'active' check (state in ('active','left','removed')),
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (crew_id, social_account_id),
  unique (crew_id, plan_member_id),
  check ((state = 'active' and ended_at is null) or (state <> 'active' and ended_at is not null))
);

create unique index social_crew_one_active_owner_idx
  on public.social_crew_members(crew_id)
  where role = 'owner' and state = 'active';
create index social_crew_members_account_idx
  on public.social_crew_members(social_account_id, state);
create index social_crew_members_active_page_idx
  on public.social_crew_members(social_account_id, joined_at desc, id desc)
  where state = 'active';

create table public.social_crew_invitations (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.social_crews(id) on delete cascade,
  target_account_id uuid not null references public.private_social_accounts(id) on delete restrict,
  invited_by_member_id uuid not null references public.social_crew_members(id) on delete restrict,
  state text not null default 'pending' check (state in ('pending','accepted','declined','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  check ((state = 'pending' and decided_at is null) or (state <> 'pending' and decided_at is not null)),
  check (expires_at > created_at)
);
create unique index social_crew_pending_invitation_idx
  on public.social_crew_invitations(crew_id, target_account_id)
  where state = 'pending';
create index social_crew_invitations_expiry_idx
  on public.social_crew_invitations(expires_at) where state = 'pending';

create table public.social_crew_join_requests (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.social_crews(id) on delete cascade,
  requester_account_id uuid not null references public.private_social_accounts(id) on delete restrict,
  decided_by_member_id uuid references public.social_crew_members(id) on delete restrict,
  state text not null default 'pending' check (state in ('pending','accepted','declined','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  check ((state = 'pending' and decided_at is null and decided_by_member_id is null)
    or (state <> 'pending' and decided_at is not null)),
  check (expires_at > created_at)
);
create unique index social_crew_pending_join_request_idx
  on public.social_crew_join_requests(crew_id, requester_account_id)
  where state = 'pending';
create index social_crew_join_requests_expiry_idx
  on public.social_crew_join_requests(expires_at) where state = 'pending';
create index social_crew_join_requests_history_idx
  on public.social_crew_join_requests(
    crew_id, requester_account_id, created_at desc, id desc
  );

create table public.private_social_crew_write_receipts (
  actor_account_id uuid not null references public.private_social_accounts(id) on delete restrict,
  operation text not null check (char_length(operation) between 1 and 80),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_account_id, operation, idempotency_key)
);

alter table public.social_crews enable row level security;
alter table public.social_crew_members enable row level security;
alter table public.social_crew_invitations enable row level security;
alter table public.social_crew_join_requests enable row level security;
alter table public.private_social_crew_write_receipts enable row level security;

revoke all on table public.social_crews, public.social_crew_members,
  public.social_crew_invitations, public.social_crew_join_requests,
  public.private_social_crew_write_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.social_crews,
  public.social_crew_members, public.social_crew_invitations,
  public.social_crew_join_requests, public.private_social_crew_write_receipts
  to service_role;

create function public.social_relationship_between_profiles(
  p_first_profile_id uuid,
  p_second_profile_id uuid
) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when p_first_profile_id = p_second_profile_id then 'self'
    when exists (
      select 1 from public.social_blocks
      where (blocker_profile_id = p_first_profile_id and blocked_profile_id = p_second_profile_id)
         or (blocker_profile_id = p_second_profile_id and blocked_profile_id = p_first_profile_id)
    ) then 'blocked'
    when exists (select 1 from public.follows where follower_id=p_first_profile_id and followee_id=p_second_profile_id)
     and exists (select 1 from public.follows where follower_id=p_second_profile_id and followee_id=p_first_profile_id)
      then 'mutual'
    else 'not_mutual'
  end;
$$;

create function public._social_crew_begin_write(
  p_actor uuid, p_operation text, p_key text, p_digest text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_receipt public.private_social_crew_write_receipts%rowtype;
begin
  if p_actor is null or not exists (
    select 1 from public.private_social_accounts where id=p_actor and ownership_state='active'
  ) or char_length(coalesce(p_key,'')) not between 16 and 128
    or coalesce(p_digest,'') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'code','invalid');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'social-crew:' || p_actor::text || ':' || p_operation || ':' || p_key, 0));
  select * into v_receipt from public.private_social_crew_write_receipts
    where actor_account_id=p_actor and operation=p_operation and idempotency_key=p_key;
  if found then
    if v_receipt.payload_digest <> p_digest then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
    if v_receipt.response @> '{"ok":true}'::jsonb then
      return v_receipt.response || jsonb_build_object('code','replayed');
    end if;
    return v_receipt.response;
  end if;
  return null;
end;
$$;

create function public._social_crew_finish_write(
  p_actor uuid, p_operation text, p_key text, p_digest text, p_response jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.private_social_crew_write_receipts(
    actor_account_id,operation,idempotency_key,payload_digest,response
  ) values(p_actor,p_operation,p_key,p_digest,p_response);
  return p_response;
end;
$$;

create function public._social_crew_fail_write(
  p_actor uuid,p_operation text,p_key text,p_digest text,p_code text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
begin
  return public._social_crew_finish_write(
    p_actor,p_operation,p_key,p_digest,jsonb_build_object('ok',false,'code',p_code)
  );
end;
$$;

create function public._social_crew_relationship_between_accounts(p_first uuid,p_second uuid)
returns text language sql stable security definer set search_path=''
as $$
  select public.social_relationship_between_profiles(first_account.profile_id,second_account.profile_id)
  from public.private_social_accounts first_account,
       public.private_social_accounts second_account
  where first_account.id=p_first and second_account.id=p_second
    and first_account.ownership_state='active' and second_account.ownership_state='active';
$$;

create function public._social_crew_member_role(p_crew uuid,p_actor uuid)
returns text language plpgsql stable security definer set search_path=''
as $$
declare v_role text; v_owner uuid;
begin
  select member.role,crew.owner_account_id into v_role,v_owner
  from public.social_crew_members member join public.social_crews crew on crew.id=member.crew_id
  where member.crew_id=p_crew and member.social_account_id=p_actor and member.state='active';
  if v_role is null then return null; end if;
  if v_role='owner' then return v_role; end if;
  if public._social_crew_relationship_between_accounts(p_actor,v_owner) is distinct from 'mutual' then return null; end if;
  return v_role;
end;
$$;

create function public._social_crew_plan_expiry(p_crew uuid)
returns timestamptz language sql stable security definer set search_path=''
as $$
  select least(now()+interval '7 days',plan.start_time+interval '8 hours')
  from public.social_crews crew join public.plans plan on plan.id=crew.plan_id
  where crew.id=p_crew and plan.status not in ('completed','abandoned')
    and now() < plan.start_time+interval '8 hours';
$$;

create function public._activate_social_crew_member(p_crew uuid,p_account uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_member public.social_crew_members%rowtype; v_plan uuid; v_handle text; v_plan_member uuid;
begin
  select * into v_member from public.social_crew_members
    where crew_id=p_crew and social_account_id=p_account for update;
  if found then
    if v_member.state <> 'active' then
      if (select count(*) from public.social_crew_members where crew_id=p_crew and state='active') >= 20 then
        return null;
      end if;
      update public.social_crew_members set state='active',role='member',ended_at=null,updated_at=now()
        where id=v_member.id;
      update public.social_crews set authority_revision=authority_revision+1,updated_at=now()
        where id=p_crew;
    end if;
    return v_member.id;
  end if;
  if (select count(*) from public.social_crew_members where crew_id=p_crew and state='active') >= 20 then
    return null;
  end if;
  select crew.plan_id,profile.handle into v_plan,v_handle
  from public.social_crews crew
  join public.private_social_accounts account on account.id=p_account and account.ownership_state='active'
  join public.profiles profile on profile.id=account.profile_id
  where crew.id=p_crew;
  if v_plan is null then return null; end if;
  v_plan_member := gen_random_uuid();
  perform pg_catalog.set_config('pubmax.social_crew_write','1',true);
  insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate,social_account_id)
  values(v_plan_member,v_plan,v_handle,encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text,'sha256'),'hex'),
    'in',now(),now(),true,p_account);
  insert into public.social_crew_members(crew_id,social_account_id,plan_member_id,role,state)
  values(p_crew,p_account,v_plan_member,'member','active') returning id into v_member.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now()
    where id=p_crew;
  return v_member.id;
end;
$$;

create function public.create_social_crew_atomic(
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

create function public.invite_social_crew_member_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_profile_id uuid,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_role text; v_target uuid; v_owner uuid; v_expiry timestamptz;
  v_id uuid:=gen_random_uuid(); v_inviter uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select account.id into v_target from public.private_social_accounts account
    where account.profile_id=p_target_profile_id and account.ownership_state='active';
  select owner_account_id into v_owner from public.social_crews where id=p_crew_id;
  if v_target is null or v_target=v_owner or public._social_crew_relationship_between_accounts(v_target,v_owner) is distinct from 'mutual'
    then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  v_expiry:=public._social_crew_plan_expiry(p_crew_id);
  if v_expiry is null or v_expiry<=now() then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'invalid'); end if;
  update public.social_crew_invitations set state='expired',decided_at=now()
    where crew_id=p_crew_id and target_account_id=v_target and state='pending' and now()>=expires_at;
  if exists(select 1 from public.social_crew_members where crew_id=p_crew_id and social_account_id=v_target and state='active') then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'already_member'); end if;
  if exists(select 1 from public.social_crew_invitations
    where crew_id=p_crew_id and target_account_id=v_target and state='pending') then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'already_pending'); end if;
  select id into v_inviter from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active';
  insert into public.social_crew_invitations(id,crew_id,target_account_id,invited_by_member_id,expires_at)
    values(v_id,p_crew_id,v_target,v_inviter,v_expiry);
  v_response:=jsonb_build_object('ok',true,'code','invited','invitation_id',v_id);
  return public._social_crew_finish_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create function public.accept_social_crew_invitation_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_invitation_id uuid,p_action text,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_operation text:='invitation-action:'||p_crew_id::text; v_replay jsonb;
  v_row public.social_crew_invitations%rowtype; v_owner uuid; v_member uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_row from public.social_crew_invitations
    where id=p_invitation_id and crew_id=p_crew_id for update;
  if not found or v_row.target_account_id<>p_actor_account_id then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_row.state<>'pending' then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'already_decided'); end if;
  if now()>=v_row.expires_at then
    update public.social_crew_invitations set state='expired',decided_at=now() where id=v_row.id;
    return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'expired');
  end if;
  if p_action='declined' then
    update public.social_crew_invitations set state='declined',decided_at=now() where id=v_row.id;
    v_response:=jsonb_build_object('ok',true,'code','declined');
  elsif p_action='accepted' then
    select owner_account_id into v_owner from public.social_crews where id=p_crew_id;
    if public._social_crew_relationship_between_accounts(p_actor_account_id,v_owner) is distinct from 'mutual' then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    v_member:=public._activate_social_crew_member(p_crew_id,p_actor_account_id);
    if v_member is null then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'full'); end if;
    update public.social_crew_invitations set state='accepted',decided_at=now() where id=v_row.id;
    v_response:=jsonb_build_object('ok',true,'code','accepted','member_id',v_member);
  else return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'invalid'); end if;
  return public._social_crew_finish_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create function public.revoke_social_crew_invitation_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_invitation_id uuid,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_operation text:='invitation-revoke:'||p_crew_id::text; v_replay jsonb;
  v_row public.social_crew_invitations%rowtype; v_role text; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_row from public.social_crew_invitations
    where id=p_invitation_id and crew_id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_row.state<>'pending' then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'already_decided'); end if;
  if now()>=v_row.expires_at then
    update public.social_crew_invitations set state='expired',decided_at=now() where id=v_row.id;
    return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'expired');
  end if;
  update public.social_crew_invitations set state='revoked',decided_at=now() where id=v_row.id;
  v_response:=jsonb_build_object('ok',true,'code','revoked','invitation_id',v_row.id);
  return public._social_crew_finish_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create function public.request_social_crew_join_atomic(
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

create function public.decide_social_crew_join_request_atomic(
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

create function public.set_social_crew_role_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_member_id uuid,p_role text,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_target public.social_crew_members%rowtype; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'set-role',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if public._social_crew_member_role(p_crew_id,p_actor_account_id) is distinct from 'owner' or p_role is null or p_role not in ('cohost','member')
    then return public._social_crew_fail_write(p_actor_account_id,'set-role',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_target from public.social_crew_members where id=p_target_member_id and crew_id=p_crew_id and state='active' for update;
  if not found or v_target.role='owner' then return public._social_crew_fail_write(p_actor_account_id,'set-role',p_idempotency_key,p_payload_digest,'not_found'); end if;
  update public.social_crew_members set role=p_role,updated_at=now() where id=v_target.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  v_response:=jsonb_build_object('ok',true,'code','updated','member_id',v_target.id);
  return public._social_crew_finish_write(p_actor_account_id,'set-role',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create function public.transfer_social_crew_owner_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_member_id uuid,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_target public.social_crew_members%rowtype; v_old uuid; v_plan uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  select plan_id into v_plan from public.social_crews where id=p_crew_id for update;
  if public._social_crew_member_role(p_crew_id,p_actor_account_id) is distinct from 'owner' then return public._social_crew_fail_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_target from public.social_crew_members where id=p_target_member_id and crew_id=p_crew_id and state='active' for update;
  if not found or v_target.role='owner' or public._social_crew_relationship_between_accounts(v_target.social_account_id,p_actor_account_id) is distinct from 'mutual'
    then return public._social_crew_fail_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select id into v_old from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active' for update;
  update public.social_crew_members set role='cohost',updated_at=now() where id=v_old;
  update public.social_crew_members set role='owner',updated_at=now() where id=v_target.id;
  update public.social_crews set owner_account_id=v_target.social_account_id,authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  update public.plans set social_owner_account_id=v_target.social_account_id where id=v_plan;
  v_response:=jsonb_build_object('ok',true,'code','transferred','member_id',v_target.id);
  return public._social_crew_finish_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create function public.remove_social_crew_member_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_member_id uuid,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_role text; v_target public.social_crew_members%rowtype; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_target from public.social_crew_members where id=p_target_member_id and crew_id=p_crew_id and state='active' for update;
  if not found or v_target.role='owner' then return public._social_crew_fail_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest,'not_found'); end if;
  update public.social_crew_members set state='removed',ended_at=now(),updated_at=now() where id=v_target.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  v_response:=jsonb_build_object('ok',true,'code','removed','member_id',v_target.id);
  return public._social_crew_finish_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create function public.leave_social_crew_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_member public.social_crew_members%rowtype; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'leave',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  select * into v_member from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active' for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,'leave',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_member.role='owner' then return public._social_crew_fail_write(p_actor_account_id,'leave',p_idempotency_key,p_payload_digest,'owner_cannot_leave'); end if;
  update public.social_crew_members set state='left',ended_at=now(),updated_at=now() where id=v_member.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  v_response:=jsonb_build_object('ok',true,'code','left','member_id',v_member.id);
  return public._social_crew_finish_write(p_actor_account_id,'leave',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create function public.update_social_crew_visibility_atomic(
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
create function public._social_plan_is_bound(p_plan_id uuid) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_owner uuid;
begin
  select social_owner_account_id into v_owner
  from public.plans where id=p_plan_id for update;
  return found and v_owner is not null;
end;
$$;

create function public.update_legacy_plan_status_context_atomic(
  p_plan_id uuid,p_token_hash text,p_status text,p_context jsonb
) returns text
language plpgsql security definer set search_path=''
as $$
declare v_plan public.plans%rowtype; v_host_token text;
begin
  select * into v_plan from public.plans where id=p_plan_id for update;
  if not found or v_plan.social_owner_account_id is not null then return 'not_found'; end if;

  select token_hash into v_host_token from public.plan_crew_members
    where plan_id=p_plan_id order by joined_at,id limit 1;
  if v_host_token is null or p_token_hash is null or v_host_token <> p_token_hash then return 'forbidden'; end if;

  if p_status is not null and (
    p_status not in ('draft','ready','active','ending','completed','abandoned')
    or not (
      p_status=v_plan.status
      or (v_plan.status='draft' and p_status in ('ready','abandoned'))
      or (v_plan.status='ready' and p_status in ('draft','active','abandoned'))
      or (v_plan.status='active' and p_status in ('ending','completed','abandoned'))
      or (v_plan.status='ending' and p_status in ('active','completed','abandoned'))
    )
  ) then return 'invalid'; end if;

  update public.plans set
    status=coalesce(p_status,status),
    night_context=coalesce(p_context,night_context)
  where id=p_plan_id;
  return 'ok';
end;
$$;

-- Social Crew reads resolve current account, relationship, membership, and
-- bound Plan data inside one PostgreSQL statement snapshot. Every JSON object
-- is an explicit server-to-store allowlist.
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

create function public.read_social_crew_member_page(
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

alter function public.join_plan_atomic(uuid,uuid,text,text,timestamptz,boolean) rename to _0075_join_plan_atomic;
create function public.join_plan_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean
) returns boolean
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return false; end if; return public._0075_join_plan_atomic($1,$2,$3,$4,$5,$6); end $$;

alter function public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text) rename to _0075_join_plan_idempotent_atomic;
create function public.join_plan_idempotent_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_join_plan_idempotent_atomic($1,$2,$3,$4,$5,$6,$7,$8); end $$;

alter function public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text) rename to _0075_redeem_plan_invite_idempotent_atomic;
create function public.redeem_plan_invite_idempotent_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_redeem_plan_invite_idempotent_atomic($1,$2,$3,$4,$5,$6,$7,$8); end $$;

alter function public.redeem_plan_invite_atomic(uuid,text,uuid,text,text,timestamptz) rename to _0075_redeem_plan_invite_atomic;
create function public.redeem_plan_invite_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_redeem_plan_invite_atomic($1,$2,$3,$4,$5,$6); end $$;

alter function public.upgrade_plan_member_invite_atomic(uuid,text,text,timestamptz) rename to _0075_upgrade_plan_member_invite_atomic;
create function public.upgrade_plan_member_invite_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_token_hash text,
  p_redeemed_at timestamptz
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_upgrade_plan_member_invite_atomic($1,$2,$3,$4); end $$;

alter function public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean) rename to _0075_replace_plan_route_atomic;
create function public.replace_plan_route_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_stops jsonb,
  p_context jsonb,
  p_grounded_upgrade boolean default false
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_replace_plan_route_atomic($1,$2,$3,$4,$5,$6); end $$;

alter function public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz) rename to _0075_add_plan_action_idempotent_atomic;
create function public.add_plan_action_idempotent_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_action_id uuid,
  p_type text,
  p_stop_position integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_created_at timestamptz
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_add_plan_action_idempotent_atomic($1,$2,$3,$4,$5,$6,$7,$8); end $$;

alter function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz) rename to _0075_complete_plan_atomic_8;
create function public.complete_plan_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_completion_id uuid,
  p_action_id uuid,
  p_ending text,
  p_terminal_venue_id text,
  p_completed_at timestamptz
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_complete_plan_atomic_8($1,$2,$3,$4,$5,$6,$7,$8); end $$;

alter function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz) rename to _0075_complete_plan_atomic_9;
create function public.complete_plan_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_completion_id uuid,
  p_action_id uuid,
  p_ending text,
  p_terminal_venue_id text,
  p_ending_selection jsonb,
  p_completed_at timestamptz
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_complete_plan_atomic_9($1,$2,$3,$4,$5,$6,$7,$8,$9); end $$;

alter function public.record_plan_vote_atomic(uuid,uuid,uuid,text,text,uuid,timestamptz) rename to _0075_record_plan_vote_atomic;
create function public.record_plan_vote_atomic(
  p_plan_id uuid,
  p_proposal_id uuid,
  p_member_id uuid,
  p_value text,
  p_idempotency_key text,
  p_vote_id uuid,
  p_created_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return jsonb_build_object('code','not_found'); end if; return public._0075_record_plan_vote_atomic($1,$2,$3,$4,$5,$6,$7); end $$;

alter function public.record_plan_vibe_vote_atomic(uuid,uuid,text,text,uuid,timestamptz) rename to _0075_record_plan_vibe_vote_atomic;
create function public.record_plan_vibe_vote_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_vibe text,
  p_idempotency_key text,
  p_vote_id uuid,
  p_created_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return jsonb_build_object('code','not_found'); end if; return public._0075_record_plan_vibe_vote_atomic($1,$2,$3,$4,$5,$6); end $$;

alter function public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz) rename to _0075_decide_plan_route_proposal_atomic;
create function public.decide_plan_route_proposal_atomic(
  p_plan_id uuid,
  p_proposal_id uuid,
  p_token_hash text,
  p_decision text,
  p_idempotency_key text,
  p_decided_at timestamptz
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_decide_plan_route_proposal_atomic($1,$2,$3,$4,$5,$6); end $$;

alter function public.create_plan_recap_atomic(uuid,uuid,text,timestamptz,jsonb) rename to _0075_create_plan_recap_atomic;
create function public.create_plan_recap_atomic(
  p_owner_id uuid,
  p_completion_id uuid,
  p_title text,
  p_completed_at timestamptz,
  p_stops jsonb
) returns uuid
language plpgsql security definer set search_path='' as $$ declare v_plan uuid; begin select plan_id into v_plan from public.plan_completions where id=$2; if public._social_plan_is_bound(v_plan) then return null; end if; return public._0075_create_plan_recap_atomic($1,$2,$3,$4,$5); end $$;

-- Renamed originals are rollback state, not callable escape hatches.
revoke all on function
  public._0075_join_plan_atomic(uuid,uuid,text,text,timestamptz,boolean),
  public._0075_join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text),
  public._0075_redeem_plan_invite_atomic(uuid,text,uuid,text,text,timestamptz),
  public._0075_redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text),
  public._0075_upgrade_plan_member_invite_atomic(uuid,text,text,timestamptz),
  public._0075_replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean),
  public._0075_add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz),
  public._0075_complete_plan_atomic_8(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public._0075_complete_plan_atomic_9(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz),
  public._0075_record_plan_vote_atomic(uuid,uuid,uuid,text,text,uuid,timestamptz),
  public._0075_record_plan_vibe_vote_atomic(uuid,uuid,text,text,uuid,timestamptz),
  public._0075_decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz),
  public._0075_create_plan_recap_atomic(uuid,uuid,text,timestamptz,jsonb)
from service_role;

revoke all on function
  public.social_relationship_between_profiles(uuid,uuid),
  public._social_crew_begin_write(uuid,text,text,text),
  public._social_crew_finish_write(uuid,text,text,text,jsonb),
  public._social_crew_fail_write(uuid,text,text,text,text),
  public._social_crew_relationship_between_accounts(uuid,uuid),
  public._social_crew_member_role(uuid,uuid),
  public._social_crew_plan_expiry(uuid),
  public._activate_social_crew_member(uuid,uuid),
  public._social_plan_is_bound(uuid),
  public.update_legacy_plan_status_context_atomic(uuid,text,text,jsonb),
  public.read_social_crew_snapshot(uuid,uuid,uuid),
  public.read_social_crew_member_page(uuid,uuid,timestamptz,uuid,integer),
  public.create_social_crew_atomic(uuid,uuid,text,text,text,text),
  public.invite_social_crew_member_atomic(uuid,uuid,uuid,text,text),
  public.accept_social_crew_invitation_atomic(uuid,uuid,uuid,text,text,text),
  public.revoke_social_crew_invitation_atomic(uuid,uuid,uuid,text,text),
  public.request_social_crew_join_atomic(uuid,uuid,text,text,text),
  public.decide_social_crew_join_request_atomic(uuid,uuid,uuid,text,text,text),
  public.set_social_crew_role_atomic(uuid,uuid,uuid,text,text,text),
  public.transfer_social_crew_owner_atomic(uuid,uuid,uuid,text,text),
  public.remove_social_crew_member_atomic(uuid,uuid,uuid,text,text),
  public.leave_social_crew_atomic(uuid,uuid,text,text),
  public.update_social_crew_visibility_atomic(uuid,uuid,text,integer,text,text),
  public.join_plan_atomic(uuid,uuid,text,text,timestamptz,boolean),
  public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text),
  public.redeem_plan_invite_atomic(uuid,text,uuid,text,text,timestamptz),
  public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text),
  public.upgrade_plan_member_invite_atomic(uuid,text,text,timestamptz),
  public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean),
  public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz),
  public.record_plan_vote_atomic(uuid,uuid,uuid,text,text,uuid,timestamptz),
  public.record_plan_vibe_vote_atomic(uuid,uuid,text,text,uuid,timestamptz),
  public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz),
  public.create_plan_recap_atomic(uuid,uuid,text,timestamptz,jsonb)
from public, anon, authenticated;

-- Existing backup functions retain their original ACLs. Public wrappers and
-- new Crew entry points are service-only.
grant execute on function
  public.social_relationship_between_profiles(uuid,uuid),
  public.update_legacy_plan_status_context_atomic(uuid,text,text,jsonb),
  public.read_social_crew_snapshot(uuid,uuid,uuid),
  public.read_social_crew_member_page(uuid,uuid,timestamptz,uuid,integer),
  public.create_social_crew_atomic(uuid,uuid,text,text,text,text),
  public.invite_social_crew_member_atomic(uuid,uuid,uuid,text,text),
  public.accept_social_crew_invitation_atomic(uuid,uuid,uuid,text,text,text),
  public.revoke_social_crew_invitation_atomic(uuid,uuid,uuid,text,text),
  public.request_social_crew_join_atomic(uuid,uuid,text,text,text),
  public.decide_social_crew_join_request_atomic(uuid,uuid,uuid,text,text,text),
  public.set_social_crew_role_atomic(uuid,uuid,uuid,text,text,text),
  public.transfer_social_crew_owner_atomic(uuid,uuid,uuid,text,text),
  public.remove_social_crew_member_atomic(uuid,uuid,uuid,text,text),
  public.leave_social_crew_atomic(uuid,uuid,text,text),
  public.update_social_crew_visibility_atomic(uuid,uuid,text,integer,text,text),
  public.join_plan_atomic(uuid,uuid,text,text,timestamptz,boolean),
  public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text),
  public.redeem_plan_invite_atomic(uuid,text,uuid,text,text,timestamptz),
  public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text),
  public.upgrade_plan_member_invite_atomic(uuid,text,text,timestamptz),
  public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean),
  public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz),
  public.record_plan_vote_atomic(uuid,uuid,uuid,text,text,uuid,timestamptz),
  public.record_plan_vibe_vote_atomic(uuid,uuid,text,text,uuid,timestamptz),
  public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz),
  public.create_plan_recap_atomic(uuid,uuid,text,timestamptz,jsonb)
to service_role;
