-- Retry-safe plan creation, ordinary joins, and live-night actions. Only
-- server-derived hashes are stored; raw request keys and member capabilities
-- never enter Postgres.

alter table public.plans
  add column if not exists creation_key_hash text,
  add column if not exists creation_request_hash text;
create unique index if not exists plans_creation_key_hash_idx
  on public.plans (creation_key_hash) where creation_key_hash is not null;

alter table public.plan_crew_members
  add column if not exists join_key_hash text,
  add column if not exists join_request_hash text;
create unique index if not exists plan_members_join_key_hash_idx
  on public.plan_crew_members (plan_id, join_key_hash) where join_key_hash is not null;

alter table public.plan_actions
  add column if not exists idempotency_key_hash text,
  add column if not exists request_hash text;
create unique index if not exists plan_actions_idempotency_idx
  on public.plan_actions (plan_id, actor_member_id, idempotency_key_hash)
  where actor_member_id is not null and idempotency_key_hash is not null;

alter table public.plans
  add constraint plans_creation_key_hash_format check (creation_key_hash is null or creation_key_hash ~ '^[0-9a-f]{64}$'),
  add constraint plans_creation_request_hash_format check (creation_request_hash is null or creation_request_hash ~ '^[0-9a-f]{64}$');
alter table public.plan_crew_members
  add constraint plan_members_join_key_hash_format check (join_key_hash is null or join_key_hash ~ '^[0-9a-f]{64}$'),
  add constraint plan_members_join_request_hash_format check (join_request_hash is null or join_request_hash ~ '^[0-9a-f]{64}$');
alter table public.plan_actions
  add constraint plan_actions_key_hash_format check (idempotency_key_hash is null or idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  add constraint plan_actions_request_hash_format check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$');

create or replace function public.create_plan_idempotent_atomic(
  p_id uuid,
  p_title text,
  p_start_time timestamptz,
  p_stops jsonb,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security invoker set search_path = public
as $$
declare existing_plan public.plans%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:create:' || p_idempotency_key_hash, 0));
  select * into existing_plan from public.plans where creation_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_plan.creation_request_hash = p_request_hash and existing_plan.id = p_id then return 'replayed'; end if;
    return 'conflict';
  end if;

  insert into public.plans (id, title, start_time, creation_key_hash, creation_request_hash)
  values (p_id, p_title, p_start_time, p_idempotency_key_hash, p_request_hash);
  insert into public.plan_stops (plan_id, venue_id, venue_name, position)
  select p_id, item.value->>'venueId', item.value->>'venueName', item.ordinality - 1
  from jsonb_array_elements(p_stops) with ordinality as item(value, ordinality);
  insert into public.plan_crew_members (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate)
  values (p_member_id, p_id, p_member_name, p_token_hash, 'in', p_joined_at, p_joined_at, true);
  return 'created';
end;
$$;

create or replace function public.join_plan_idempotent_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security invoker set search_path = public
as $$
declare existing_member public.plan_crew_members%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  select * into existing_member from public.plan_crew_members
  where plan_id = p_plan_id and join_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_member.join_request_hash = p_request_hash and existing_member.id = p_member_id then return 'replayed'; end if;
    return 'conflict';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id) then return 'not_found'; end if;
  if (select count(*) from public.plan_crew_members where plan_id = p_plan_id) >= 20 then return 'full'; end if;
  insert into public.plan_crew_members
    (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate, join_key_hash, join_request_hash)
  values
    (p_member_id, p_plan_id, p_member_name, p_token_hash, 'in', p_joined_at, p_joined_at, p_can_collaborate, p_idempotency_key_hash, p_request_hash);
  return 'joined';
end;
$$;

create or replace function public.add_plan_action_idempotent_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_action_id uuid,
  p_type text,
  p_stop_position integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_created_at timestamptz
) returns text
language plpgsql security invoker set search_path = public
as $$
declare actor public.plan_crew_members%rowtype;
declare existing_action public.plan_actions%rowtype;
declare host_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:action:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  perform 1 from public.plans where id = p_plan_id for update;
  if not found then return 'not_found'; end if;
  select * into actor from public.plan_crew_members where plan_id = p_plan_id and token_hash = p_token_hash;
  if not found then return 'forbidden'; end if;
  select id into host_id from public.plan_crew_members where plan_id = p_plan_id order by joined_at, id limit 1;
  if not actor.can_collaborate and actor.id <> host_id then return 'forbidden'; end if;
  if p_type = 'swapped' and actor.id <> host_id then return 'forbidden'; end if;
  if p_type not in ('arrived', 'skipped', 'swapped') or p_stop_position not between 0 and 7 then return 'invalid'; end if;

  select * into existing_action from public.plan_actions
  where plan_id = p_plan_id and actor_member_id = actor.id and idempotency_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_action.request_hash = p_request_hash and existing_action.id = p_action_id then return 'replayed'; end if;
    return 'conflict';
  end if;

  insert into public.plan_actions
    (id, plan_id, actor_member_id, type, stop_position, created_at, idempotency_key_hash, request_hash)
  values
    (p_action_id, p_plan_id, actor.id, p_type, p_stop_position, p_created_at, p_idempotency_key_hash, p_request_hash);
  update public.plans set status = 'active' where id = p_plan_id and status in ('draft', 'ready');
  return 'applied';
end;
$$;

create or replace function public.redeem_plan_invite_idempotent_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security invoker set search_path = public
as $$
declare invite public.plan_invites%rowtype;
declare existing_member public.plan_crew_members%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('plan:invite-join:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  select * into existing_member from public.plan_crew_members
  where plan_id = p_plan_id and join_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_member.join_request_hash = p_request_hash and existing_member.id = p_member_id then return 'replayed'; end if;
    return 'conflict';
  end if;

  select * into invite from public.plan_invites
  where plan_id = p_plan_id and token_hash = p_invite_token_hash for update;
  if not found then return 'not_found'; end if;
  if invite.revoked_at is not null then return 'revoked'; end if;
  if invite.expires_at <= p_joined_at then return 'expired'; end if;
  if invite.redeemed_at is not null then return 'capability_replayed'; end if;
  if (select count(*) from public.plan_crew_members where plan_id = p_plan_id) >= 20 then return 'full'; end if;

  insert into public.plan_crew_members
    (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate, join_key_hash, join_request_hash)
  values
    (p_member_id, p_plan_id, p_member_name, p_member_token_hash, 'in', p_joined_at, p_joined_at, true, p_idempotency_key_hash, p_request_hash);
  update public.plan_invites set redeemed_at = p_joined_at where id = invite.id;
  return 'joined';
end;
$$;

revoke all on function public.create_plan_idempotent_atomic(uuid, text, timestamptz, jsonb, uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.join_plan_idempotent_atomic(uuid, uuid, text, text, timestamptz, boolean, text, text) from public, anon, authenticated;
revoke all on function public.add_plan_action_idempotent_atomic(uuid, text, uuid, text, integer, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.redeem_plan_invite_idempotent_atomic(uuid, text, uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.create_plan_idempotent_atomic(uuid, text, timestamptz, jsonb, uuid, text, text, timestamptz, text, text) to service_role;
grant execute on function public.join_plan_idempotent_atomic(uuid, uuid, text, text, timestamptz, boolean, text, text) to service_role;
grant execute on function public.add_plan_action_idempotent_atomic(uuid, text, uuid, text, integer, text, text, timestamptz) to service_role;
grant execute on function public.redeem_plan_invite_idempotent_atomic(uuid, text, uuid, text, text, timestamptz, text, text) to service_role;
