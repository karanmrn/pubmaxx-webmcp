-- Rollback for the V1 release Night Memory and Pub Pal voice boundary.
-- Restores the exact grants and authenticated policies present after 0069.

begin;

-- Restore the helper catalog to its exact post-0069 public-schema state.
-- ALTER FUNCTION keeps the original OIDs and updates policy dependencies.
alter function pubmax_private.rls_current_profile_id()
  set schema public;
alter function pubmax_private.rls_owns_profile(uuid)
  set schema public;
alter function pubmax_private.rls_owns_handle(text)
  set schema public;
alter function pubmax_private.rls_is_plan_participant(uuid)
  set schema public;
alter function pubmax_private.rls_is_conversation_participant(uuid)
  set schema public;
alter function pubmax_private.rls_current_price_actor()
  set schema public;
alter function pubmax_private.rls_follows_handle(text)
  set schema public;
alter function pubmax_private.rls_can_read_visit_report(text, text, text)
  set schema public;

create or replace function public.rls_is_conversation_participant(
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
          or public.rls_owns_handle(c.handle_a)
          or public.rls_owns_handle(c.handle_b)
        )
    );
$$;

create or replace function public.rls_current_price_actor()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.rls_current_profile_id() is null then null
    else 'profile:' || public.rls_current_profile_id()::text
  end;
$$;

create or replace function public.rls_can_read_visit_report(
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
      or public.rls_owns_handle(p_handle)
      or (
        coalesce(nullif(btrim(p_visibility), ''), 'public') = 'friends'
        and public.rls_follows_handle(p_handle)
      )
    );
$$;

revoke execute on function public.rls_current_profile_id()
  from public, anon;
revoke execute on function public.rls_owns_profile(uuid)
  from public, anon;
revoke execute on function public.rls_owns_handle(text)
  from public, anon;
revoke execute on function public.rls_is_plan_participant(uuid)
  from public, anon;
revoke execute on function public.rls_is_conversation_participant(uuid)
  from public, anon;
revoke execute on function public.rls_current_price_actor()
  from public, anon;
revoke execute on function public.rls_follows_handle(text)
  from public, anon;
revoke execute on function public.rls_can_read_visit_report(text, text, text)
  from public, anon;

grant execute on function public.rls_current_profile_id()
  to authenticated, service_role;
grant execute on function public.rls_owns_profile(uuid)
  to authenticated, service_role;
grant execute on function public.rls_owns_handle(text)
  to authenticated, service_role;
grant execute on function public.rls_is_plan_participant(uuid)
  to authenticated, service_role;
grant execute on function public.rls_is_conversation_participant(uuid)
  to authenticated, service_role;
grant execute on function public.rls_current_price_actor()
  to authenticated, service_role;
grant execute on function public.rls_follows_handle(text)
  to authenticated, service_role;
grant execute on function public.rls_can_read_visit_report(text, text, text)
  to authenticated, service_role;

drop schema pubmax_private;

drop policy if exists night_memories_owner_select on public.night_memories;
create policy night_memories_owner_all
  on public.night_memories for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists night_moments_owner_select on public.night_moments;
create policy night_moments_owner_all
  on public.night_moments for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists night_moment_consents_owner_select on public.night_moment_consents;
create policy night_moment_consents_owner_all
  on public.night_moment_consents for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy night_stories_host_write
  on public.night_stories for all to authenticated
  using (host_editor_id = (select auth.uid()))
  with check (host_editor_id = (select auth.uid()));

create policy night_story_contributors_host_write
  on public.night_story_contributors for all to authenticated
  using (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

create policy night_story_moments_host_write
  on public.night_story_moments for all to authenticated
  using (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

drop policy if exists night_story_publish_proposals_party_select
  on public.night_story_publish_proposals;
create policy night_story_publish_proposals_party_all
  on public.night_story_publish_proposals for all to authenticated
  using (
    requested_by = (select auth.uid())
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  )
  with check (
    requested_by = (select auth.uid())
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

drop policy if exists pub_pal_voice_usage_owner_select on public.pub_pal_voice_usage;
create policy pub_pal_voice_usage_owner_all
  on public.pub_pal_voice_usage for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

grant insert, update, delete on table public.night_memories to authenticated;
grant insert, update, delete on table public.night_moments to authenticated;
grant insert, update, delete on table public.night_moment_consents to authenticated;
grant insert, update, delete on table public.night_stories to authenticated;
grant insert, update, delete on table public.night_story_contributors to authenticated;
grant insert, update, delete on table public.night_story_moments to authenticated;
grant insert, update, delete on table public.night_story_publish_proposals to authenticated;
grant insert, update on table public.pub_pal_voice_usage to authenticated;

revoke execute on function public.consume_pub_pal_voice_trial(uuid, date, integer)
  from service_role;
drop function if exists public.release_pub_pal_voice_trial(uuid, date);

commit;
