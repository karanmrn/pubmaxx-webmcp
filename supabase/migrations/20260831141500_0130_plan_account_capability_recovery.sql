-- Ledger reconciliation: this RPC is already live in production (applied
-- 2026-08-27 from PR #1237, which then closed unmerged). Body matches
-- production pg_get_functiondef output; see 0127's header.

-- Restore a lost Plan member capability after account sign-in.
-- The account must already own exactly one member row on this non-Social Plan.
-- No invite is consumed here. Invite recovery remains an application concern.

create or replace function public.recover_plan_account_membership_atomic(
  p_plan_id uuid,
  p_user_id uuid,
  p_member_token_hash text,
  p_recovered_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_member public.plan_crew_members%rowtype;
begin
  if p_plan_id is null
     or p_user_id is null
     or p_member_token_hash is null
     or p_recovered_at is null then
    return 'not_found';
  end if;
  if p_member_token_hash !~ '^[0-9a-f]{64}$' then
    return 'conflict';
  end if;

  -- Keep recovery in the same lock domain as join_plan_account_idempotent_atomic.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plan:join-account:' || p_plan_id::text || ':' || p_user_id::text,
      0
    )
  );

  select *
    into v_plan
  from public.plans
  where id = p_plan_id
    and social_owner_account_id is null
  for update;
  if not found then
    return 'not_found';
  end if;

  select *
    into v_member
  from public.plan_crew_members
  where plan_id = p_plan_id
    and user_id = p_user_id
  for update;
  if not found then
    return 'not_found';
  end if;

  -- The requested token identifies an already-completed recovery. Do not
  -- report replay for a different account or for a different token.
  if v_member.token_hash = p_member_token_hash then
    return 'replayed';
  end if;

  begin
    update public.plan_crew_members
    set token_hash = p_member_token_hash,
        updated_at = p_recovered_at
    where id = v_member.id
      and plan_id = p_plan_id
      and user_id = p_user_id;
    if not found then
      return 'not_found';
    end if;
    return 'recovered';
  exception
    when unique_violation then
      -- A token collision must not leave a partially rotated capability.
      return 'conflict';
  end;
end;
$$;

revoke all on function public.recover_plan_account_membership_atomic(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.recover_plan_account_membership_atomic(
  uuid, uuid, text, timestamptz
) to service_role;
