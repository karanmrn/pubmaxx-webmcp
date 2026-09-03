-- Restores 0075's _activate_social_crew_member definition.
create or replace function public._activate_social_crew_member(p_crew uuid,p_account uuid)
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
