-- Host queue for pending Social Crew join requests.
-- Captain applies. Agents ship SQL only.

begin;

create function public.read_social_crew_join_requests(
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
    select account.id
    from public.private_social_accounts account
    join public.profiles profile on profile.id = account.profile_id
    where account.id = p_viewer_account_id
      and account.profile_id = p_viewer_profile_id
      and account.ownership_state = 'active'
  ),
  manager as (
    select crew.id as crew_id, crew.owner_account_id
    from actor
    join public.social_crews crew on crew.id = p_crew_id
    join public.plans plan
      on plan.id = crew.plan_id
      and plan.social_owner_account_id = crew.owner_account_id
    join public.private_social_accounts owner_account
      on owner_account.id = crew.owner_account_id
      and owner_account.ownership_state = 'active'
    join public.social_crew_members owner_member
      on owner_member.crew_id = crew.id
      and owner_member.social_account_id = crew.owner_account_id
      and owner_member.role = 'owner'
      and owner_member.state = 'active'
    join public.plan_crew_members owner_plan_member
      on owner_plan_member.id = owner_member.plan_member_id
      and owner_plan_member.plan_id = crew.plan_id
      and owner_plan_member.social_account_id = crew.owner_account_id
    join public.social_crew_members member
      on member.crew_id = crew.id
      and member.social_account_id = actor.id
      and member.state = 'active'
    join public.plan_crew_members plan_member
      on plan_member.id = member.plan_member_id
      and plan_member.plan_id = crew.plan_id
      and plan_member.social_account_id = actor.id
    where public._social_crew_member_role(p_crew_id, actor.id)
      in ('owner','cohost')
      and crew.visibility = 'open'
  )
  select jsonb_build_object(
    'items',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'requestId', pending.id,
          'requesterHandle', pending.handle
        ) order by pending.created_at, pending.id
      )
      from (
        select request.id, profile.handle,
          request.created_at, request.expires_at
        from public.social_crew_join_requests request
        join public.private_social_accounts account
          on account.id = request.requester_account_id
          and account.ownership_state = 'active'
        join public.profiles profile on profile.id = account.profile_id
        where request.crew_id = manager.crew_id
          and request.state = 'pending'
          and request.expires_at > statement_timestamp()
          and public._social_crew_relationship_between_accounts(
            request.requester_account_id,
            manager.owner_account_id
          ) is distinct from 'blocked'
          and not exists (
            select 1
            from public.social_crew_members active_member
            where active_member.crew_id = request.crew_id
              and active_member.social_account_id = request.requester_account_id
              and active_member.state = 'active'
          )
        order by request.created_at, request.id
        limit 50
      ) pending
    ), '[]'::jsonb),
    'hasMore', exists(
      select 1
      from public.social_crew_join_requests request
      join public.private_social_accounts account
        on account.id = request.requester_account_id
        and account.ownership_state = 'active'
      where request.crew_id = manager.crew_id
        and request.state = 'pending'
        and request.expires_at > statement_timestamp()
        and public._social_crew_relationship_between_accounts(
          request.requester_account_id,
          manager.owner_account_id
        ) is distinct from 'blocked'
        and not exists (
          select 1
          from public.social_crew_members active_member
          where active_member.crew_id = request.crew_id
            and active_member.social_account_id = request.requester_account_id
            and active_member.state = 'active'
        )
      order by request.created_at, request.id
      offset 50
      limit 1
    )
  )
  from manager;
$$;

create index social_crew_pending_join_request_queue_idx
  on public.social_crew_join_requests(crew_id, created_at, id)
  where state = 'pending';

create function public._terminalize_social_crew_join_request_on_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'active' and (
    tg_op = 'INSERT' or old.state is distinct from 'active'
  ) then
    update public.social_crew_join_requests
    set state = 'expired', decided_at = statement_timestamp()
    where crew_id = new.crew_id
      and requester_account_id = new.social_account_id
      and state = 'pending'
      and expires_at <= statement_timestamp();
    update public.social_crew_join_requests
    set state = 'accepted', decided_at = statement_timestamp()
    where crew_id = new.crew_id
      and requester_account_id = new.social_account_id
      and state = 'pending'
      and expires_at > statement_timestamp();
  end if;
  return new;
end;
$$;

create trigger social_crew_members_terminalize_join_request
after insert or update of state on public.social_crew_members
for each row
execute function public._terminalize_social_crew_join_request_on_membership();

revoke all on function public.read_social_crew_join_requests(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_social_crew_join_requests(uuid, uuid, uuid)
  to service_role;
revoke all on function public._terminalize_social_crew_join_request_on_membership()
  from public, anon, authenticated;

commit;
