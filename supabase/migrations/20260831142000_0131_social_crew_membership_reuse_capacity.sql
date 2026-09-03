-- Ledger reconciliation: production's _activate_social_crew_member is already
-- the body below (applied 2026-08-27 from PR #1237, which then closed
-- unmerged; this file consolidates that PR's two rewrites into the final
-- form). It replaces 0075's definition: Open Crew acceptance reuses a Plan
-- seat already stamped with the account instead of inserting a Social-only
-- second seat, admission serialises on the crew row, and the 20-member cap is
-- checked before any Plan authority is granted. See 0127's header for the
-- production state this reconciliation records.

-- Open Crew acceptance and direct Plan invite acceptance must converge on one
-- account-owned Plan seat. Reuse a seat already stamped with the Supabase user
-- before creating a Social-only seat.

create or replace function public._activate_social_crew_member(p_crew uuid,p_account uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_member public.social_crew_members%rowtype;
  v_plan uuid;
  v_handle text;
  v_user uuid;
  v_plan_member public.plan_crew_members%rowtype;
begin
  select crew.plan_id,profile.handle,account.supabase_user_id
    into v_plan,v_handle,v_user
  from public.social_crews crew
  join public.private_social_accounts account
    on account.id=p_account and account.ownership_state='active'
  join public.profiles profile on profile.id=account.profile_id
  where crew.id=p_crew;
  if v_plan is null then return null; end if;

  perform 1 from public.social_crews where id=p_crew for update;

  if v_user is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('plan:join-account:' || v_plan::text || ':' || v_user::text,0)
    );
  end if;

  select * into v_member
  from public.social_crew_members
  where crew_id=p_crew and social_account_id=p_account
  for update;

  if found then
    select * into v_plan_member
    from public.plan_crew_members
    where id=v_member.plan_member_id and plan_id=v_plan
    for update;
    if not found
      or (v_plan_member.social_account_id is not null and v_plan_member.social_account_id<>p_account)
      or (v_user is not null and v_plan_member.user_id is not null and v_plan_member.user_id<>v_user)
      or (v_user is not null and exists(
        select 1 from public.plan_crew_members other
        where other.plan_id=v_plan and other.user_id=v_user and other.id<>v_plan_member.id
      )) then
      return null;
    end if;
    if v_member.state<>'active'
      and (select count(*) from public.social_crew_members
        where crew_id=p_crew and state='active')>=20 then
      return null;
    end if;
    update public.plan_crew_members
    set social_account_id=p_account,
        user_id=coalesce(user_id,v_user),
        status='in',
        can_collaborate=true,
        updated_at=now()
    where id=v_plan_member.id;
    if v_member.state<>'active' then
      update public.social_crew_members
      set state='active',role='member',ended_at=null,updated_at=now()
      where id=v_member.id;
      update public.social_crews
      set authority_revision=authority_revision+1,updated_at=now()
      where id=p_crew;
    end if;
    return v_member.id;
  end if;

  if (select count(*) from public.social_crew_members
      where crew_id=p_crew and state='active')>=20 then
    return null;
  end if;

  if v_user is not null then
    select * into v_plan_member
    from public.plan_crew_members
    where plan_id=v_plan and user_id=v_user
    for update;
  end if;
  if not found then
    select * into v_plan_member
    from public.plan_crew_members
    where plan_id=v_plan and social_account_id=p_account
    for update;
  end if;

  if found then
    if (v_plan_member.social_account_id is not null and v_plan_member.social_account_id<>p_account)
      or (v_user is not null and v_plan_member.user_id is not null and v_plan_member.user_id<>v_user) then
      return null;
    end if;
    update public.plan_crew_members
    set social_account_id=p_account,
        user_id=coalesce(user_id,v_user),
        status='in',
        can_collaborate=true,
        updated_at=now()
    where id=v_plan_member.id
    returning * into v_plan_member;
  else
    v_plan_member.id:=gen_random_uuid();
    perform pg_catalog.set_config('pubmax.social_crew_write','1',true);
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values(
      v_plan_member.id,v_plan,v_handle,
      encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text,'sha256'),'hex'),
      'in',v_user,now(),now(),true,p_account
    );
  end if;

  insert into public.social_crew_members(crew_id,social_account_id,plan_member_id,role,state)
  values(p_crew,p_account,v_plan_member.id,'member','active')
  returning * into v_member;
  update public.social_crews
  set authority_revision=authority_revision+1,updated_at=now()
  where id=p_crew;
  return v_member.id;
end;
$$;
