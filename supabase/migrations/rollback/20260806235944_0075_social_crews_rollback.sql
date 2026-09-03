-- Restore the pre-0075 Plan RPCs before removing the Social Crew schema.

drop function if exists public.create_plan_invite_atomic(uuid,uuid,uuid,text,text,timestamptz,timestamptz);
drop function if exists public.revoke_plan_invite_atomic(uuid,uuid,timestamptz);
drop function if exists public.consume_plan_invite_atomic(uuid,text,timestamptz);
drop function if exists public.add_plan_constraint_atomic(uuid,uuid,uuid,text,text,text,text,timestamptz);
drop function if exists public.resolve_plan_constraint_atomic(uuid,uuid,uuid,jsonb,text,timestamptz);
drop function if exists public.create_plan_route_proposal_atomic(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb,text,timestamptz);

grant insert, update, delete on table
  public.plan_invites,
  public.plan_constraints,
  public.plan_route_proposals,
  public.plan_votes,
  public.plan_vote_requests,
  public.plan_vibe_votes,
  public.plan_vibe_vote_requests
to service_role;

drop function if exists public.join_plan_atomic(uuid,uuid,text,text,timestamptz,boolean);
alter function public._0075_join_plan_atomic(uuid,uuid,text,text,timestamptz,boolean) rename to join_plan_atomic;

drop function if exists public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text);
alter function public._0075_join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text) rename to join_plan_idempotent_atomic;

drop function if exists public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text);
alter function public._0075_redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text) rename to redeem_plan_invite_idempotent_atomic;

drop function if exists public.redeem_plan_invite_atomic(uuid,text,uuid,text,text,timestamptz);
alter function public._0075_redeem_plan_invite_atomic(uuid,text,uuid,text,text,timestamptz) rename to redeem_plan_invite_atomic;

drop function if exists public.upgrade_plan_member_invite_atomic(uuid,text,text,timestamptz);
alter function public._0075_upgrade_plan_member_invite_atomic(uuid,text,text,timestamptz) rename to upgrade_plan_member_invite_atomic;

drop function if exists public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean);
alter function public._0075_replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean) rename to replace_plan_route_atomic;

drop function if exists public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz);
alter function public._0075_add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz) rename to add_plan_action_idempotent_atomic;

drop function if exists public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz);
alter function public._0075_complete_plan_atomic_8(uuid,text,integer,uuid,uuid,text,text,timestamptz) rename to complete_plan_atomic;

drop function if exists public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz);
alter function public._0075_complete_plan_atomic_9(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz) rename to complete_plan_atomic;

drop function if exists public.record_plan_vote_atomic(uuid,uuid,uuid,text,text,uuid,timestamptz);
alter function public._0075_record_plan_vote_atomic(uuid,uuid,uuid,text,text,uuid,timestamptz) rename to record_plan_vote_atomic;

drop function if exists public.record_plan_vibe_vote_atomic(uuid,uuid,text,text,uuid,timestamptz);
alter function public._0075_record_plan_vibe_vote_atomic(uuid,uuid,text,text,uuid,timestamptz) rename to record_plan_vibe_vote_atomic;

drop function if exists public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz);
alter function public._0075_decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz) rename to decide_plan_route_proposal_atomic;

drop function if exists public.create_plan_recap_atomic(uuid,uuid,text,timestamptz,jsonb);
alter function public._0075_create_plan_recap_atomic(uuid,uuid,text,timestamptz,jsonb) rename to create_plan_recap_atomic;

grant execute on function
  public.join_plan_atomic(uuid,uuid,text,text,timestamptz,boolean),
  public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text),
  public.redeem_plan_invite_atomic(uuid,text,uuid,text,text,timestamptz),
  public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text),
  public.upgrade_plan_member_invite_atomic(uuid,text,text,timestamptz),
  public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean),
  public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz),
  public.record_plan_vote_atomic(uuid,uuid,uuid,text,text,uuid,timestamptz),
  public.record_plan_vibe_vote_atomic(uuid,uuid,text,text,uuid,timestamptz),
  public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz),
  public.create_plan_recap_atomic(uuid,uuid,text,timestamptz,jsonb)
to service_role;

drop function if exists public.update_legacy_plan_status_context_atomic(uuid,text,text,jsonb);
drop function if exists public._social_plan_is_bound(uuid);
drop function if exists public.read_social_crew_member_page(uuid,uuid,timestamptz,uuid,integer);
drop function if exists public.read_social_crew_snapshot(uuid,uuid,uuid);

drop function if exists public.update_social_crew_visibility_atomic(uuid,uuid,text,integer,text,text);
drop function if exists public.leave_social_crew_atomic(uuid,uuid,text,text);
drop function if exists public.remove_social_crew_member_atomic(uuid,uuid,uuid,text,text);
drop function if exists public.transfer_social_crew_owner_atomic(uuid,uuid,uuid,text,text);
drop function if exists public.set_social_crew_role_atomic(uuid,uuid,uuid,text,text,text);
drop function if exists public.decide_social_crew_join_request_atomic(uuid,uuid,uuid,text,text,text);
drop function if exists public.request_social_crew_join_atomic(uuid,uuid,text,text,text);
drop function if exists public.accept_social_crew_invitation_atomic(uuid,uuid,uuid,text,text,text);
drop function if exists public.revoke_social_crew_invitation_atomic(uuid,uuid,uuid,text,text);
drop function if exists public.invite_social_crew_member_atomic(uuid,uuid,uuid,text,text);
drop function if exists public.create_social_crew_atomic(uuid,uuid,text,text,text,text);
drop function if exists public._activate_social_crew_member(uuid,uuid);
drop function if exists public._social_crew_plan_expiry(uuid);
drop function if exists public._social_crew_member_role(uuid,uuid);
drop function if exists public._social_crew_relationship_between_accounts(uuid,uuid);
drop function if exists public._social_crew_fail_write(uuid,text,text,text,text);
drop function if exists public._social_crew_finish_write(uuid,text,text,text,jsonb);
drop function if exists public._social_crew_begin_write(uuid,text,text,text);
drop function if exists public.social_relationship_between_profiles(uuid,uuid);

drop table if exists public.private_social_crew_write_receipts;
drop table if exists public.social_crew_join_requests;
drop table if exists public.social_crew_invitations;
drop table if exists public.social_crew_members;
drop table if exists public.social_crews;

revoke select (
  id, title, start_time, owner_user_id, created_at, status, night_context,
  ending, route_revision, creation_key_hash, creation_request_hash,
  anchor_venue_id, anchor_source, plan_outcome, route_ready_at
) on table public.plans from authenticated;

create or replace function pubmax_private.rls_is_plan_participant(p_plan_id uuid)
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

drop index if exists public.plan_crew_members_social_account_idx;
alter table public.plan_crew_members drop column if exists social_account_id;
alter table public.plans drop column if exists social_owner_account_id;
grant select on table public.plans to authenticated;
