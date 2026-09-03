-- Ledger reconciliation: this object is already live in production. PR #1237's
-- migrations were applied on 2026-08-27 and the PR then closed unmerged, so the
-- ledger lacked what production runs. Bodies below match pg_get_functiondef
-- output from production (verified 2026-08-30, re-verified 2026-08-31 after
-- #1270 landed); applying is an idempotent no-op against production and brings
-- a fresh database up to the same state.
--
-- These bodies RECORD production, they do not correct it. #1270's 0124 added
-- plan_crew_members.membership_revoked_at after these functions were applied,
-- and production's bodies do not read that column. A revoked member therefore
-- still holds the (plan_id, user_id) seat that 0128's unique index governs.
-- That gap is a separate finding: changing a body here would make this ledger
-- entry describe something production does not run, which is the exact defect
-- this wave exists to close.

-- Bind an existing guest Plan capability to the account created afterwards.
-- One RPC call owns both member and host-owner writes so a partial claim cannot
-- leave the Plan attached to two accounts. Browser roles never call it.

create or replace function public.claim_plan_membership(
  p_plan_id uuid,
  p_member_id uuid,
  p_user_id uuid
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_user_id uuid;
  v_member_user_id uuid;
  v_host_member_id uuid;
begin
  select owner_user_id
    into v_owner_user_id
  from public.plans
  where id = p_plan_id
    and social_owner_account_id is null
  for update;
  if not found then return 'not_found'; end if;

  select user_id
    into v_member_user_id
  from public.plan_crew_members
  where id = p_member_id
    and plan_id = p_plan_id
  for update;
  if not found then return 'not_found'; end if;

  select id
    into v_host_member_id
  from public.plan_crew_members
  where plan_id = p_plan_id
  order by joined_at, id
  limit 1;

  if exists (
    select 1
    from public.plan_crew_members
    where plan_id = p_plan_id
      and id <> p_member_id
      and user_id = p_user_id
  ) then
    return 'conflict';
  end if;

  if v_member_user_id is not null and v_member_user_id <> p_user_id then
    return 'conflict';
  end if;
  if p_member_id = v_host_member_id
     and v_owner_user_id is not null
     and v_owner_user_id <> p_user_id then
    return 'conflict';
  end if;

  if v_member_user_id = p_user_id
     and (p_member_id <> v_host_member_id or v_owner_user_id = p_user_id) then
    return 'already_claimed';
  end if;

  update public.plan_crew_members
  set user_id = p_user_id,
      updated_at = now()
  where id = p_member_id
    and plan_id = p_plan_id;

  if p_member_id = v_host_member_id then
    update public.plans
    set owner_user_id = p_user_id
    where id = p_plan_id;
  end if;

  return 'claimed';
end;
$$;

revoke all on function public.claim_plan_membership(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_plan_membership(uuid, uuid, uuid)
  to service_role;
