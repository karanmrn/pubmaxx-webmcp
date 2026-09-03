-- A Going RSVP is one canonical Plan crew membership. Maybe stays an RSVP
-- projection only. Raw member capabilities remain in the app response and
-- cookie; Postgres stores only the salted capability hash.

begin;

alter table public.plan_crew_members
  add column if not exists membership_revoked_at timestamptz;

create index if not exists plan_crew_members_active_joined_idx
  on public.plan_crew_members(plan_id, joined_at)
  where membership_revoked_at is null;

create or replace function public.rls_is_plan_participant(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_plan_id is not null
    and (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.plans pl
        where pl.id = p_plan_id
          and pl.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.plan_crew_members m
        where m.plan_id = p_plan_id
          and m.user_id = (select auth.uid())
          and m.membership_revoked_at is null
      )
    );
$$;

alter table public.plan_invite_rsvps
  add column if not exists member_id uuid references public.plan_crew_members(id) on delete cascade;

create unique index if not exists plan_invite_rsvps_member_id_idx
  on public.plan_invite_rsvps(member_id)
  where member_id is not null;

-- Safely attach existing Going rows while respecting the canonical 20-person
-- crew ceiling. Rows above remaining capacity become Maybe, which is the only
-- RSVP-only state. A later Going replay rotates the placeholder hash to the
-- app-derived capability without creating a second member.
with ranked as (
  select
    rsvp.id as rsvp_id,
    rsvp.plan_id,
    rsvp.display_name,
    row_number() over (
      partition by rsvp.plan_id
      order by rsvp.created_at, rsvp.id
    ) as position,
    (
      select count(*)
      from public.plan_crew_members member_count
      where member_count.plan_id = rsvp.plan_id
        and member_count.membership_revoked_at is null
    ) as existing_members
  from public.plan_invite_rsvps rsvp
  where rsvp.status = 'going' and rsvp.member_id is null
),
candidates as materialized (
  select
    ranked.*,
    gen_random_uuid() as member_id,
    now() as joined_at
  from ranked
  where ranked.position <= greatest(0, 20 - ranked.existing_members)
),
inserted as (
  insert into public.plan_crew_members (
    id,
    plan_id,
    name,
    token_hash,
    status,
    joined_at,
    updated_at,
    can_collaborate
  )
  select
    candidates.member_id,
    candidates.plan_id,
    left(candidates.display_name, 40),
    encode(extensions.gen_random_bytes(32), 'hex'),
    'in',
    candidates.joined_at,
    candidates.joined_at,
    false
  from candidates
  returning id
)
update public.plan_invite_rsvps rsvp
set member_id = candidates.member_id,
    updated_at = now()
from candidates
join inserted on inserted.id = candidates.member_id
where rsvp.id = candidates.rsvp_id;

update public.plan_invite_rsvps
set status = 'maybe', updated_at = now()
where status = 'going' and member_id is null;

alter table public.plan_invite_rsvps
  add constraint plan_invite_rsvps_going_member_check
  check (status <> 'going' or member_id is not null);

create or replace function public.upsert_plan_invite_rsvp_membership_atomic(
  p_plan_id uuid,
  p_submitter_hash text,
  p_display_name text,
  p_status text,
  p_member_id uuid,
  p_existing_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_member_join_key_hash text,
  p_member_request_hash text,
  p_joined_at timestamptz,
  p_rsvp_ceiling integer
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rsvp public.plan_invite_rsvps%rowtype;
  v_member public.plan_crew_members%rowtype;
  v_host_id uuid;
  v_social_owner_account_id uuid;
  v_is_update boolean := false;
begin
  if p_status not in ('going', 'maybe')
     or char_length(p_display_name) not between 1 and 60
     or char_length(p_member_name) not between 1 and 40
     or p_submitter_hash !~ '^[0-9a-f]{64}$'
     or p_member_token_hash !~ '^[0-9a-f]{64}$'
     or p_member_join_key_hash !~ '^[0-9a-f]{64}$'
     or p_member_request_hash !~ '^[0-9a-f]{64}$'
     or p_rsvp_ceiling < 1 then
    return jsonb_build_object('outcome', 'invalid', 'is_update', false, 'member_id', null);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('plan:invite-rsvp:' || p_plan_id::text || ':' || p_submitter_hash, 0)
  );

  select social_owner_account_id into v_social_owner_account_id
  from public.plans where id = p_plan_id for update;
  if not found or v_social_owner_account_id is not null then
    return jsonb_build_object('outcome', 'not_found', 'is_update', false, 'member_id', null);
  end if;

  select * into v_rsvp
  from public.plan_invite_rsvps
  where plan_id = p_plan_id and submitter_hash = p_submitter_hash
  for update;
  v_is_update := found;

  if not v_is_update and (
    select count(*) from public.plan_invite_rsvps where plan_id = p_plan_id
  ) >= p_rsvp_ceiling then
    return jsonb_build_object('outcome', 'rsvp_full', 'is_update', false, 'member_id', null);
  end if;

  select id into v_host_id
  from public.plan_crew_members
  where plan_id = p_plan_id and membership_revoked_at is null
  order by joined_at, id
  limit 1;

  if p_existing_member_id is not null then
    if not v_is_update or v_rsvp.member_id is distinct from p_existing_member_id then
      return jsonb_build_object('outcome', 'forbidden', 'is_update', v_is_update, 'member_id', null);
    end if;
    select * into v_member
    from public.plan_crew_members
    where id = p_existing_member_id and plan_id = p_plan_id
    for update;
    if not found or v_member.id = v_host_id then
      return jsonb_build_object('outcome', 'forbidden', 'is_update', v_is_update, 'member_id', null);
    end if;
  end if;

  if p_status = 'going' then
    if p_existing_member_id is null and v_is_update and v_rsvp.member_id is not null then
      select * into v_member
      from public.plan_crew_members
      where id = v_rsvp.member_id and plan_id = p_plan_id
      for update;
    end if;

    if p_existing_member_id is null and v_member.id is null then
      select * into v_member
      from public.plan_crew_members
      where plan_id = p_plan_id and join_key_hash = p_member_join_key_hash
      for update;
    end if;

    if p_existing_member_id is null and v_member.id is not null and v_member.id = v_host_id then
      return jsonb_build_object('outcome', 'invalid', 'is_update', v_is_update, 'member_id', null);
    end if;

    if v_member.id is null or v_member.membership_revoked_at is not null then
      if (
        select count(*) from public.plan_crew_members
        where plan_id = p_plan_id and membership_revoked_at is null
      ) >= 20 then
        return jsonb_build_object('outcome', 'crew_full', 'is_update', v_is_update, 'member_id', null);
      end if;
    end if;

    if v_member.id is null then
      insert into public.plan_crew_members (
        id,
        plan_id,
        name,
        token_hash,
        status,
        joined_at,
        updated_at,
        can_collaborate,
        join_key_hash,
        join_request_hash
      ) values (
        p_member_id,
        p_plan_id,
        p_member_name,
        p_member_token_hash,
        'in',
        p_joined_at,
        p_joined_at,
        false,
        p_member_join_key_hash,
        p_member_request_hash
      )
      returning * into v_member;
    elsif p_existing_member_id is null then
      update public.plan_crew_members
      set name = p_member_name,
          status = 'in',
          token_hash = p_member_token_hash,
          membership_revoked_at = null,
          join_key_hash = p_member_join_key_hash,
          join_request_hash = p_member_request_hash,
          updated_at = p_joined_at
      where id = v_member.id
      returning * into v_member;
    end if;
  else
    if v_is_update and v_rsvp.member_id is not null then
      update public.plan_invite_rsvps
      set status = 'maybe', member_id = null, updated_at = p_joined_at
      where id = v_rsvp.id;
      update public.plan_crew_members
      set membership_revoked_at = p_joined_at,
          token_hash = encode(extensions.gen_random_bytes(32), 'hex'),
          updated_at = p_joined_at
      where id = v_rsvp.member_id
        and plan_id = p_plan_id
        and id <> v_host_id
        and membership_revoked_at is null;
    end if;
    v_member.id := null;
  end if;

  insert into public.plan_invite_rsvps (
    plan_id,
    submitter_hash,
    display_name,
    status,
    member_id,
    updated_at
  ) values (
    p_plan_id,
    p_submitter_hash,
    p_display_name,
    p_status,
    v_member.id,
    p_joined_at
  )
  on conflict (plan_id, submitter_hash) do update
  set display_name = excluded.display_name,
      status = excluded.status,
      member_id = excluded.member_id,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'outcome', 'saved',
    'is_update', v_is_update,
    'member_id', v_member.id
  );
end;
$$;

create or replace function public.remove_plan_invite_rsvp_membership_atomic(
  p_plan_id uuid,
  p_rsvp_id uuid
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rsvp public.plan_invite_rsvps%rowtype;
  v_host_id uuid;
  v_social_owner_account_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  select social_owner_account_id into v_social_owner_account_id
  from public.plans where id = p_plan_id for update;
  if not found or v_social_owner_account_id is not null then return 'missing'; end if;
  select * into v_rsvp
  from public.plan_invite_rsvps
  where id = p_rsvp_id and plan_id = p_plan_id
  for update;
  if not found then return 'missing'; end if;

  select id into v_host_id
  from public.plan_crew_members
  where plan_id = p_plan_id and membership_revoked_at is null
  order by joined_at, id
  limit 1;
  if v_rsvp.member_id = v_host_id then return 'forbidden'; end if;

  if v_rsvp.member_id is not null then
    update public.plan_crew_members
    set membership_revoked_at = now(),
        token_hash = encode(extensions.gen_random_bytes(32), 'hex'),
        updated_at = now()
    where id = v_rsvp.member_id
      and plan_id = p_plan_id
      and v_rsvp.member_id <> v_host_id
      and membership_revoked_at is null;
  end if;
  delete from public.plan_invite_rsvps where id = v_rsvp.id;
  return 'removed';
end;
$$;

-- Revoked invite members remain as audit rows. Ordinary joins and private
-- host invites therefore count only active memberships and can reactivate an
-- exact idempotent join without creating a duplicate member.
create or replace function public._0075_join_plan_idempotent_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare existing_member public.plan_crew_members%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  select * into existing_member from public.plan_crew_members
  where plan_id = p_plan_id and join_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_member.join_request_hash <> p_request_hash or existing_member.id <> p_member_id then
      return 'conflict';
    end if;
    if existing_member.membership_revoked_at is null then return 'replayed'; end if;
    if (
      select count(*) from public.plan_crew_members
      where plan_id = p_plan_id and membership_revoked_at is null
    ) >= 20 then return 'full'; end if;
    update public.plan_crew_members
    set name = p_member_name,
        token_hash = p_token_hash,
        status = 'in',
        updated_at = p_joined_at,
        can_collaborate = p_can_collaborate,
        membership_revoked_at = null
    where id = existing_member.id;
    return 'joined';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id) then return 'not_found'; end if;
  if (
    select count(*) from public.plan_crew_members
    where plan_id = p_plan_id and membership_revoked_at is null
  ) >= 20 then return 'full'; end if;
  insert into public.plan_crew_members
    (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate, join_key_hash, join_request_hash)
  values
    (p_member_id, p_plan_id, p_member_name, p_token_hash, 'in', p_joined_at, p_joined_at, p_can_collaborate, p_idempotency_key_hash, p_request_hash);
  return 'joined';
end;
$$;

create or replace function public._0075_redeem_plan_invite_idempotent_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare invite public.plan_invites%rowtype;
declare existing_member public.plan_crew_members%rowtype;
declare reactivate boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('plan:invite-join:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  select * into existing_member from public.plan_crew_members
  where plan_id = p_plan_id and join_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_member.join_request_hash <> p_request_hash or existing_member.id <> p_member_id then
      return 'conflict';
    end if;
    if existing_member.membership_revoked_at is null then return 'replayed'; end if;
    reactivate := true;
  end if;

  select * into invite from public.plan_invites
  where plan_id = p_plan_id and token_hash = p_invite_token_hash for update;
  if not found then return 'not_found'; end if;
  if invite.revoked_at is not null then return 'revoked'; end if;
  if invite.expires_at <= p_joined_at then return 'expired'; end if;
  if invite.redeemed_at is not null then return 'capability_replayed'; end if;
  if (
    select count(*) from public.plan_crew_members
    where plan_id = p_plan_id and membership_revoked_at is null
  ) >= 20 then return 'full'; end if;

  if reactivate then
    update public.plan_crew_members
    set name = p_member_name,
        token_hash = p_member_token_hash,
        status = 'in',
        updated_at = p_joined_at,
        can_collaborate = true,
        membership_revoked_at = null
    where id = existing_member.id;
  else
    insert into public.plan_crew_members
      (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate, join_key_hash, join_request_hash)
    values
      (p_member_id, p_plan_id, p_member_name, p_member_token_hash, 'in', p_joined_at, p_joined_at, true, p_idempotency_key_hash, p_request_hash);
  end if;
  update public.plan_invites set redeemed_at = p_joined_at where id = invite.id;
  return 'joined';
end;
$$;

revoke all on function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) to service_role;

revoke all on function public.remove_plan_invite_rsvp_membership_atomic(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_plan_invite_rsvp_membership_atomic(uuid, uuid)
  to service_role;

commit;
