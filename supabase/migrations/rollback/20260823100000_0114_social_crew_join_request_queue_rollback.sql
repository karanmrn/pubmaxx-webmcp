-- Manual rollback for 0114. Removes host join-request reads.

begin;

drop trigger if exists social_crew_members_terminalize_join_request
  on public.social_crew_members;
drop function if exists public._terminalize_social_crew_join_request_on_membership();
drop function if exists public.read_social_crew_join_requests(uuid, uuid, uuid);
drop index if exists public.social_crew_pending_join_request_queue_idx;

commit;
