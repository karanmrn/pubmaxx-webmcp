alter table public.plan_crew_members
  add column if not exists can_collaborate boolean not null default false;

drop function if exists public.join_plan_atomic(uuid, uuid, text, text, timestamptz);
create function public.join_plan_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text, 0));
  if (select count(*) from public.plan_crew_members where plan_id = p_plan_id) >= 20 then return false; end if;
  insert into public.plan_crew_members (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate)
  values (p_member_id, p_plan_id, p_member_name, p_token_hash, 'in', p_joined_at, p_joined_at, p_can_collaborate);
  return true;
end;
$$;
revoke all on function public.join_plan_atomic(uuid, uuid, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.join_plan_atomic(uuid, uuid, text, text, timestamptz, boolean) to service_role;

create table if not exists public.plan_invites (
  id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  created_by_member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  role text not null default 'guest' check (role = 'guest'),
  token_hash text not null unique,
  idempotency_key text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_at timestamptz,
  unique(plan_id, created_by_member_id, idempotency_key)
);

create table if not exists public.plan_constraints (
  id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  kind text not null check (kind in ('accessibility','budget','zero_proof','timing','transport','other')),
  value text not null check (char_length(value) between 1 and 180),
  priority text not null check (priority in ('required','preference')),
  idempotency_key text not null,
  created_at timestamptz not null,
  unique(plan_id, member_id, idempotency_key)
);

alter table public.plan_constraints
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_member_id uuid references public.plan_crew_members(id) on delete set null,
  add column if not exists resolution_evidence jsonb,
  add column if not exists resolution_idempotency_key text;

create table if not exists public.plan_route_proposals (
  id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  proposed_by_member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  expected_route_revision integer not null check (expected_route_revision > 0),
  stops jsonb not null,
  reason text not null check (char_length(reason) between 1 and 300),
  resolved_constraint_ids jsonb not null default '[]'::jsonb,
  unresolved_constraint_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  idempotency_key text not null,
  decision_idempotency_key text,
  created_at timestamptz not null,
  decided_at timestamptz,
  unique(plan_id, proposed_by_member_id, idempotency_key)
);

create table if not exists public.plan_votes (
  id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  proposal_id uuid not null references public.plan_route_proposals(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  value text not null check (value in ('approve','reject','abstain')),
  idempotency_key text not null,
  created_at timestamptz not null,
  unique(proposal_id, member_id),
  unique(plan_id, member_id, idempotency_key)
);

create table if not exists public.plan_vote_requests (
  plan_id uuid not null references public.plans(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  idempotency_key text not null,
  vote_id uuid not null references public.plan_votes(id) on delete cascade,
  value text not null check (value in ('approve','reject','abstain')),
  created_at timestamptz not null,
  primary key (plan_id, member_id, idempotency_key)
);

create index if not exists plan_invites_plan_expiry_idx on public.plan_invites(plan_id, expires_at);
create index if not exists plan_constraints_plan_idx on public.plan_constraints(plan_id, created_at);
create index if not exists plan_proposals_plan_status_idx on public.plan_route_proposals(plan_id, status, created_at);
create index if not exists plan_votes_proposal_idx on public.plan_votes(proposal_id, created_at);

alter table public.plan_invites enable row level security;
alter table public.plan_constraints enable row level security;
alter table public.plan_route_proposals enable row level security;
alter table public.plan_votes enable row level security;
alter table public.plan_vote_requests enable row level security;

revoke all on public.plan_invites, public.plan_constraints, public.plan_route_proposals, public.plan_votes from anon, authenticated;
revoke all on public.plan_vote_requests from anon, authenticated;
grant all on public.plan_invites, public.plan_constraints, public.plan_route_proposals, public.plan_votes, public.plan_vote_requests to service_role;

create or replace function public.redeem_plan_invite_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invite public.plan_invites%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text, 0));
  select * into v_invite from public.plan_invites
  where plan_id = p_plan_id and token_hash = p_invite_token_hash
  for update;
  if not found then return 'not_found'; end if;
  if v_invite.revoked_at is not null then return 'revoked'; end if;
  if v_invite.redeemed_at is not null then return 'replayed'; end if;
  if v_invite.expires_at <= p_joined_at then return 'expired'; end if;
  if (select count(*) from public.plan_crew_members where plan_id = p_plan_id) >= 20 then return 'full'; end if;

  insert into public.plan_crew_members (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate)
  values (p_member_id, p_plan_id, p_member_name, p_member_token_hash, 'in', p_joined_at, p_joined_at, true);
  update public.plan_invites set redeemed_at = p_joined_at where id = v_invite.id;
  return 'joined';
end;
$$;
revoke all on function public.redeem_plan_invite_atomic(uuid, text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.redeem_plan_invite_atomic(uuid, text, uuid, text, text, timestamptz) to service_role;

create or replace function public.upgrade_plan_member_invite_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_token_hash text,
  p_redeemed_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invite public.plan_invites%rowtype;
  v_member public.plan_crew_members%rowtype;
  v_host_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text, 0));
  select * into v_member from public.plan_crew_members
  where plan_id = p_plan_id and token_hash = p_member_token_hash for update;
  if not found then return 'forbidden'; end if;
  select id into v_host_id from public.plan_crew_members where plan_id = p_plan_id order by joined_at, id limit 1;
  if v_member.id = v_host_id then return 'forbidden'; end if;
  if v_member.can_collaborate then return 'already_authorized'; end if;
  select * into v_invite from public.plan_invites
  where plan_id = p_plan_id and token_hash = p_invite_token_hash for update;
  if not found then return 'not_found'; end if;
  if v_invite.revoked_at is not null then return 'revoked'; end if;
  if v_invite.redeemed_at is not null then return 'replayed'; end if;
  if v_invite.expires_at <= p_redeemed_at then return 'expired'; end if;
  update public.plan_crew_members set can_collaborate = true where id = v_member.id;
  update public.plan_invites set redeemed_at = p_redeemed_at where id = v_invite.id;
  return 'upgraded';
end;
$$;
revoke all on function public.upgrade_plan_member_invite_atomic(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.upgrade_plan_member_invite_atomic(uuid, text, text, timestamptz) to service_role;

create or replace function public.record_plan_vote_atomic(
  p_plan_id uuid,
  p_proposal_id uuid,
  p_member_id uuid,
  p_value text,
  p_idempotency_key text,
  p_vote_id uuid,
  p_created_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_vote_id uuid;
  v_request public.plan_vote_requests%rowtype;
  v_proposal_id uuid;
begin
  if p_value not in ('approve', 'reject', 'abstain') then return null; end if;
  select * into v_request from public.plan_vote_requests
  where plan_id = p_plan_id and member_id = p_member_id and idempotency_key = p_idempotency_key;
  if found then
    select proposal_id into v_proposal_id from public.plan_votes where id = v_request.vote_id;
    return jsonb_build_object('id', v_request.vote_id, 'plan_id', p_plan_id, 'proposal_id', v_proposal_id, 'member_id', p_member_id, 'value', v_request.value, 'created_at', v_request.created_at);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text || ':' || p_member_id::text, 0));
  select * into v_request from public.plan_vote_requests
  where plan_id = p_plan_id and member_id = p_member_id and idempotency_key = p_idempotency_key;
  if found then
    select proposal_id into v_proposal_id from public.plan_votes where id = v_request.vote_id;
    return jsonb_build_object('id', v_request.vote_id, 'plan_id', p_plan_id, 'proposal_id', v_proposal_id, 'member_id', p_member_id, 'value', v_request.value, 'created_at', v_request.created_at);
  end if;
  if not exists (select 1 from public.plan_route_proposals where id = p_proposal_id and plan_id = p_plan_id and status = 'pending') then return null; end if;
  insert into public.plan_votes (id, plan_id, proposal_id, member_id, value, idempotency_key, created_at)
  values (p_vote_id, p_plan_id, p_proposal_id, p_member_id, p_value, p_idempotency_key, p_created_at)
  on conflict (proposal_id, member_id) do update set value = excluded.value, idempotency_key = excluded.idempotency_key, created_at = excluded.created_at
  returning id into v_vote_id;
  insert into public.plan_vote_requests (plan_id, member_id, idempotency_key, vote_id, value, created_at)
  values (p_plan_id, p_member_id, p_idempotency_key, v_vote_id, p_value, p_created_at);
  return jsonb_build_object('id', v_vote_id, 'plan_id', p_plan_id, 'proposal_id', p_proposal_id, 'member_id', p_member_id, 'value', p_value, 'created_at', p_created_at);
end;
$$;
revoke all on function public.record_plan_vote_atomic(uuid, uuid, uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_plan_vote_atomic(uuid, uuid, uuid, text, text, uuid, timestamptz) to service_role;

create or replace function public.decide_plan_route_proposal_atomic(
  p_plan_id uuid,
  p_proposal_id uuid,
  p_token_hash text,
  p_decision text,
  p_idempotency_key text,
  p_decided_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_hash text;
  v_proposal public.plan_route_proposals%rowtype;
  v_revision integer;
  v_status text;
  v_current_unresolved jsonb;
begin
  if p_decision not in ('accepted', 'rejected') then return 'invalid'; end if;

  select token_hash into v_host_hash
  from public.plan_crew_members
  where plan_id = p_plan_id
  order by joined_at, id
  limit 1;
  if v_host_hash is null or v_host_hash <> p_token_hash then return 'forbidden'; end if;

  select * into v_proposal
  from public.plan_route_proposals
  where id = p_proposal_id and plan_id = p_plan_id
  for update;
  if not found then return 'not_found'; end if;
  if v_proposal.status = p_decision and v_proposal.decision_idempotency_key = p_idempotency_key then return 'already_decided'; end if;
  if v_proposal.status <> 'pending' then return 'conflict'; end if;
  if p_decision = 'accepted' then
    select coalesce(jsonb_agg(constraint_row.id::text), '[]'::jsonb) into v_current_unresolved
    from public.plan_constraints constraint_row
    where constraint_row.plan_id = p_plan_id
      and constraint_row.priority = 'required'
      and not (
        constraint_row.resolution_evidence->>'proposalId' = p_proposal_id::text
        and constraint_row.resolution_evidence->'routeRevision' = to_jsonb(v_proposal.expected_route_revision)
        and (
          select count(distinct source->>'venueId')
          from jsonb_array_elements(coalesce(constraint_row.resolution_evidence->'sources', '[]'::jsonb)) source
          where exists (
            select 1 from jsonb_array_elements(v_proposal.stops) stop
            where stop->>'venueId' = source->>'venueId'
          )
        ) = 3
      );
    update public.plan_route_proposals set unresolved_constraint_ids = v_current_unresolved where id = p_proposal_id;
    if jsonb_array_length(v_current_unresolved) > 0 then return 'constraints_unresolved'; end if;
  end if;

  if p_decision = 'accepted' then
    if jsonb_array_length(v_proposal.stops) <> 3 then return 'invalid'; end if;
    if (
      select count(distinct item->>'venueId') <> 3
        or count(distinct item->>'position') <> 3
        or count(*) filter (
          where nullif(btrim(item->>'venueId'), '') is null
             or nullif(btrim(item->>'venueName'), '') is null
             or item->>'position' not in ('0', '1', '2')
        ) > 0
      from jsonb_array_elements(v_proposal.stops) item
    ) then return 'invalid'; end if;
    select route_revision, status into v_revision, v_status from public.plans where id = p_plan_id for update;
    if v_revision is null then return 'not_found'; end if;
    if v_status in ('completed', 'abandoned') then return 'invalid'; end if;
    if v_revision <> v_proposal.expected_route_revision then return 'conflict'; end if;

    delete from public.plan_stops where plan_id = p_plan_id;
    insert into public.plan_stops (plan_id, venue_id, venue_name, position)
    select p_plan_id, item->>'venueId', item->>'venueName', (item->>'position')::integer
    from jsonb_array_elements(v_proposal.stops) item;
    update public.plans set route_revision = route_revision + 1 where id = p_plan_id;
  end if;

  update public.plan_route_proposals
  set status = p_decision, decision_idempotency_key = p_idempotency_key, decided_at = p_decided_at
  where id = p_proposal_id;
  return 'decided';
end;
$$;

revoke all on function public.decide_plan_route_proposal_atomic(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.decide_plan_route_proposal_atomic(uuid, uuid, text, text, text, timestamptz) to service_role;
