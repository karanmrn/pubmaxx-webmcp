begin;

alter table public.plan_crew_members
  add column if not exists recovery_key_hash text,
  add column if not exists recovery_request_hash text;

create unique index if not exists plan_crew_members_recovery_key_idx
  on public.plan_crew_members(plan_id, user_id, recovery_key_hash)
  where user_id is not null and recovery_key_hash is not null;

alter table public.plan_crew_members
  add constraint plan_members_recovery_key_hash_format
    check (recovery_key_hash is null or recovery_key_hash ~ '^[0-9a-f]{64}$'),
  add constraint plan_members_recovery_request_hash_format
    check (recovery_request_hash is null or recovery_request_hash ~ '^[0-9a-f]{64}$');

create or replace function public.recover_plan_account_membership_atomic(
  p_plan_id uuid,
  p_user_id uuid,
  p_member_token_hash text,
  p_idempotency_key_hash text,
  p_request_hash text,
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
     or p_idempotency_key_hash is null
     or p_request_hash is null
     or p_recovered_at is null then
    return 'not_found';
  end if;
  if p_member_token_hash !~ '^[0-9a-f]{64}$'
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_request_hash !~ '^[0-9a-f]{64}$' then
    return 'conflict';
  end if;

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
    and membership_revoked_at is null
  for update;
  if not found then
    return 'not_found';
  end if;

  if v_member.recovery_key_hash is not null
     and v_member.recovery_request_hash is not null
     and v_member.token_hash = p_member_token_hash then
    if v_member.recovery_key_hash = p_idempotency_key_hash
       and v_member.recovery_request_hash = p_request_hash
    then
      return 'replayed';
    end if;
    return 'conflict';
  end if;

  begin
    update public.plan_crew_members
    set token_hash = p_member_token_hash,
        recovery_key_hash = p_idempotency_key_hash,
        recovery_request_hash = p_request_hash,
        updated_at = p_recovered_at
    where id = v_member.id
      and plan_id = p_plan_id
      and user_id = p_user_id
      and membership_revoked_at is null;
    if not found then
      return 'not_found';
    end if;
    return 'recovered';
  exception
    when unique_violation then
      return 'conflict';
  end;
end;
$$;

revoke all on function public.recover_plan_account_membership_atomic(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.recover_plan_account_membership_atomic(
  uuid, uuid, text, text, text, timestamptz
) to service_role;

commit;
