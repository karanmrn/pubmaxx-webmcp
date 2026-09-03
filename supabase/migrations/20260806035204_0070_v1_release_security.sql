-- V1 release boundary for Night Memory publication and Pub Pal voice quota.
-- Browser-authenticated writes stay behind service-role API ownership checks.

begin;

-- Policy helpers need EXECUTE for authenticated policy evaluation, but they
-- must not remain RPC endpoints in PostgREST's exposed public schema. Moving
-- each existing function preserves its OID and every policy dependency.
create schema if not exists pubmax_private;
revoke all on schema pubmax_private
  from public, anon, authenticated, service_role;
grant usage on schema pubmax_private to authenticated, service_role;

alter function public.rls_current_profile_id()
  set schema pubmax_private;
alter function public.rls_owns_profile(uuid)
  set schema pubmax_private;
alter function public.rls_owns_handle(text)
  set schema pubmax_private;
alter function public.rls_is_plan_participant(uuid)
  set schema pubmax_private;
alter function public.rls_is_conversation_participant(uuid)
  set schema pubmax_private;
alter function public.rls_current_price_actor()
  set schema pubmax_private;
alter function public.rls_follows_handle(text)
  set schema pubmax_private;
alter function public.rls_can_read_visit_report(text, text, text)
  set schema pubmax_private;

-- SQL-string bodies keep schema-qualified calls as text when their OID moves.
-- Replace only the three wrappers that call another moved helper.
create or replace function pubmax_private.rls_is_conversation_participant(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_conversation_id is not null
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.conversations c
      where c.id = p_conversation_id
        and (
          c.user_id_a = (select auth.uid())
          or c.user_id_b = (select auth.uid())
          or pubmax_private.rls_owns_handle(c.handle_a)
          or pubmax_private.rls_owns_handle(c.handle_b)
        )
    );
$$;

create or replace function pubmax_private.rls_current_price_actor()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pubmax_private.rls_current_profile_id() is null then null
    else 'profile:' || pubmax_private.rls_current_profile_id()::text
  end;
$$;

create or replace function pubmax_private.rls_can_read_visit_report(
  p_status text,
  p_visibility text,
  p_handle text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_status = 'visible'
    and (
      coalesce(nullif(btrim(p_visibility), ''), 'public') in ('public', 'anonymous')
      or pubmax_private.rls_owns_handle(p_handle)
      or (
        coalesce(nullif(btrim(p_visibility), ''), 'public') = 'friends'
        and pubmax_private.rls_follows_handle(p_handle)
      )
    );
$$;

revoke execute on function pubmax_private.rls_current_profile_id()
  from public, anon;
revoke execute on function pubmax_private.rls_owns_profile(uuid)
  from public, anon;
revoke execute on function pubmax_private.rls_owns_handle(text)
  from public, anon;
revoke execute on function pubmax_private.rls_is_plan_participant(uuid)
  from public, anon;
revoke execute on function pubmax_private.rls_is_conversation_participant(uuid)
  from public, anon;
revoke execute on function pubmax_private.rls_current_price_actor()
  from public, anon;
revoke execute on function pubmax_private.rls_follows_handle(text)
  from public, anon;
revoke execute on function pubmax_private.rls_can_read_visit_report(text, text, text)
  from public, anon;

grant execute on function pubmax_private.rls_current_profile_id()
  to authenticated, service_role;
grant execute on function pubmax_private.rls_owns_profile(uuid)
  to authenticated, service_role;
grant execute on function pubmax_private.rls_owns_handle(text)
  to authenticated, service_role;
grant execute on function pubmax_private.rls_is_plan_participant(uuid)
  to authenticated, service_role;
grant execute on function pubmax_private.rls_is_conversation_participant(uuid)
  to authenticated, service_role;
grant execute on function pubmax_private.rls_current_price_actor()
  to authenticated, service_role;
grant execute on function pubmax_private.rls_follows_handle(text)
  to authenticated, service_role;
grant execute on function pubmax_private.rls_can_read_visit_report(text, text, text)
  to authenticated, service_role;

-- Browser roles retain their existing SELECT grants. All mutation paths move
-- back behind the service-role APIs that already enforce account ownership,
-- consent, publication, and voice allowance rules.
revoke insert, update, delete on table public.night_memories from authenticated;
revoke insert, update, delete on table public.night_moments from authenticated;
revoke insert, update, delete on table public.night_moment_consents from authenticated;
revoke insert, update, delete on table public.night_stories from authenticated;
revoke insert, update, delete on table public.night_story_contributors from authenticated;
revoke insert, update, delete on table public.night_story_moments from authenticated;
revoke insert, update, delete on table public.night_story_publish_proposals from authenticated;
revoke insert, update, delete on table public.pub_pal_voice_usage from authenticated;

grant select, insert, update, delete on table public.night_memories to service_role;
grant select, insert, update, delete on table public.night_moments to service_role;
grant select, insert, update, delete on table public.night_moment_consents to service_role;
grant select, insert, update, delete on table public.night_stories to service_role;
grant select, insert, update, delete on table public.night_story_contributors to service_role;
grant select, insert, update, delete on table public.night_story_moments to service_role;
grant select, insert, update, delete on table public.night_story_publish_proposals to service_role;
grant select, insert, update, delete on table public.pub_pal_voice_usage to service_role;

-- Split read predicates away from the former FOR ALL policies. Existing
-- select-only Story policies remain unchanged.
drop policy if exists night_memories_owner_all on public.night_memories;
drop policy if exists night_memories_owner_select on public.night_memories;
create policy night_memories_owner_select
  on public.night_memories for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists night_moments_owner_all on public.night_moments;
drop policy if exists night_moments_owner_select on public.night_moments;
create policy night_moments_owner_select
  on public.night_moments for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists night_moment_consents_owner_all on public.night_moment_consents;
drop policy if exists night_moment_consents_owner_select on public.night_moment_consents;
create policy night_moment_consents_owner_select
  on public.night_moment_consents for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists night_stories_host_write on public.night_stories;
drop policy if exists night_story_contributors_host_write on public.night_story_contributors;
drop policy if exists night_story_moments_host_write on public.night_story_moments;

drop policy if exists night_story_publish_proposals_party_all
  on public.night_story_publish_proposals;
drop policy if exists night_story_publish_proposals_party_select
  on public.night_story_publish_proposals;
create policy night_story_publish_proposals_party_select
  on public.night_story_publish_proposals for select to authenticated
  using (
    requested_by = (select auth.uid())
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

drop policy if exists pub_pal_voice_usage_owner_all on public.pub_pal_voice_usage;
drop policy if exists pub_pal_voice_usage_owner_select on public.pub_pal_voice_usage;
create policy pub_pal_voice_usage_owner_select
  on public.pub_pal_voice_usage for select to authenticated
  using (owner_id = (select auth.uid()));

-- Reserve first, then compensate exactly one reservation if ElevenLabs cannot
-- allocate a session. Both quota RPCs are service-role only because the server
-- API owns allowance enforcement.
revoke all on function public.consume_pub_pal_voice_trial(uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.consume_pub_pal_voice_trial(uuid, date, integer)
  to service_role;

create or replace function public.release_pub_pal_voice_trial(
  p_owner_id uuid,
  p_month date
) returns boolean
language sql
security definer
set search_path = public
as $$
  with released as (
    update public.pub_pal_voice_usage
    set session_count = session_count - 1
    where owner_id = p_owner_id
      and usage_month = p_month
      and session_count > 0
    returning 1
  )
  select exists (select 1 from released);
$$;

revoke all on function public.release_pub_pal_voice_trial(uuid, date)
  from public, anon, authenticated;
grant execute on function public.release_pub_pal_voice_trial(uuid, date)
  to service_role;

commit;
