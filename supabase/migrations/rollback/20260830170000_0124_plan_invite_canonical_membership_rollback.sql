begin;

do $$
declare has_revoked_memberships boolean := false;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plan_crew_members'
      and column_name = 'membership_revoked_at'
  ) then
    execute 'select exists (select 1 from public.plan_crew_members where membership_revoked_at is not null)'
      into has_revoked_memberships;
  end if;

  if has_revoked_memberships then
    raise exception '0124 rollback requires explicit reconciliation of revoked Plan memberships';
  end if;
end;
$$;

drop function if exists public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
);
drop function if exists public.remove_plan_invite_rsvp_membership_atomic(uuid, uuid);

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

-- Restore RSVP-only rows without deleting valid Plan members. Some linked
-- members can predate this migration, and rollback cannot distinguish them
-- from members created through the invite acceptance path without risking
-- user-data loss.
alter table public.plan_invite_rsvps
  drop constraint if exists plan_invite_rsvps_member_id_fkey;

alter table public.plan_invite_rsvps
  drop constraint if exists plan_invite_rsvps_going_member_check;
drop index if exists public.plan_invite_rsvps_member_id_idx;
alter table public.plan_invite_rsvps
  drop column if exists member_id;

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
      )
    );
$$;

drop index if exists public.plan_crew_members_active_joined_idx;
alter table public.plan_crew_members
  drop column if exists membership_revoked_at;

commit;
