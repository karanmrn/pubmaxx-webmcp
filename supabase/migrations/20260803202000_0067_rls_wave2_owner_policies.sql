-- RLS wave 2: owner-keyed tables with a clear auth.uid() / profile link.
-- Mirrors existing API ownership. Reverse: see
-- supabase/migrations/rollback/20260803200000_rls_wave2_rollback.sql

begin;

-- ── private_account_identities ──────────────────────────────────────────────
-- Owner-scoped SELECT is fine for a signed-in client. Direct INSERT / UPDATE /
-- DELETE skip onboarding, immutable date-of-birth and field rules in
-- lib/privateIdentityStore.ts — those writes stay service-role only.

revoke all on table public.private_account_identities from public, anon, authenticated;
grant select on table public.private_account_identities to authenticated;
grant select, insert, update, delete on table public.private_account_identities to service_role;

drop policy if exists private_account_identities_owner_select on public.private_account_identities;
create policy private_account_identities_owner_select
  on public.private_account_identities for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists private_account_identities_owner_insert on public.private_account_identities;
drop policy if exists private_account_identities_owner_update on public.private_account_identities;
drop policy if exists private_account_identities_owner_delete on public.private_account_identities;

drop policy if exists private_account_identities_anon_deny on public.private_account_identities;
create policy private_account_identities_anon_deny
  on public.private_account_identities for all to anon
  using (false) with check (false);

-- ── notifications (recipient handle → linked profile) ───────────────────────
revoke all on table public.notifications from anon, authenticated;
grant select, update on table public.notifications to authenticated;
grant select, insert, update, delete on table public.notifications to service_role;

drop policy if exists notifications_recipient_select on public.notifications;
create policy notifications_recipient_select
  on public.notifications for select to authenticated
  using (public.rls_owns_handle(recipient_handle));

drop policy if exists notifications_recipient_update on public.notifications;
create policy notifications_recipient_update
  on public.notifications for update to authenticated
  using (public.rls_owns_handle(recipient_handle))
  with check (public.rls_owns_handle(recipient_handle));

drop policy if exists notifications_anon_deny on public.notifications;
create policy notifications_anon_deny
  on public.notifications for all to anon
  using (false) with check (false);

-- ── saved_lists / saved_list_follows ────────────────────────────────────────
revoke all on table public.saved_lists from anon, authenticated;
revoke all on table public.saved_list_follows from anon, authenticated;
grant select, insert, update, delete on table public.saved_lists to authenticated;
grant select, insert, delete on table public.saved_list_follows to authenticated;
grant select, insert, update, delete on table public.saved_lists to service_role;
grant select, insert, update, delete on table public.saved_list_follows to service_role;

drop policy if exists saved_lists_owner_all on public.saved_lists;
create policy saved_lists_owner_all
  on public.saved_lists for all to authenticated
  using (public.rls_owns_profile(profile_id))
  with check (public.rls_owns_profile(profile_id));

drop policy if exists saved_lists_anon_deny on public.saved_lists;
create policy saved_lists_anon_deny
  on public.saved_lists for all to anon
  using (false) with check (false);

drop policy if exists saved_list_follows_owner_all on public.saved_list_follows;
create policy saved_list_follows_owner_all
  on public.saved_list_follows for all to authenticated
  using (public.rls_owns_profile(follower_profile_id))
  with check (public.rls_owns_profile(follower_profile_id));

drop policy if exists saved_list_follows_anon_deny on public.saved_list_follows;
create policy saved_list_follows_anon_deny
  on public.saved_list_follows for all to anon
  using (false) with check (false);

-- ── follows (either party may read their own edges) ─────────────────────────
revoke all on table public.follows from anon, authenticated;
grant select, insert, delete on table public.follows to authenticated;
grant select, insert, update, delete on table public.follows to service_role;

drop policy if exists follows_party_select on public.follows;
create policy follows_party_select
  on public.follows for select to authenticated
  using (
    public.rls_owns_profile(follower_id)
    or public.rls_owns_profile(followee_id)
  );

drop policy if exists follows_owner_insert on public.follows;
create policy follows_owner_insert
  on public.follows for insert to authenticated
  with check (public.rls_owns_profile(follower_id));

drop policy if exists follows_owner_delete on public.follows;
create policy follows_owner_delete
  on public.follows for delete to authenticated
  using (public.rls_owns_profile(follower_id));

drop policy if exists follows_anon_deny on public.follows;
create policy follows_anon_deny
  on public.follows for all to anon
  using (false) with check (false);

-- ── check_ins (author only — friends filter stays in the API) ───────────────
revoke all on table public.check_ins from anon, authenticated;
grant select, insert, delete on table public.check_ins to authenticated;
grant select, insert, update, delete on table public.check_ins to service_role;

drop policy if exists check_ins_author_select on public.check_ins;
create policy check_ins_author_select
  on public.check_ins for select to authenticated
  using (public.rls_owns_profile(author_id));

drop policy if exists check_ins_author_insert on public.check_ins;
create policy check_ins_author_insert
  on public.check_ins for insert to authenticated
  with check (public.rls_owns_profile(author_id));

drop policy if exists check_ins_author_delete on public.check_ins;
create policy check_ins_author_delete
  on public.check_ins for delete to authenticated
  using (public.rls_owns_profile(author_id));

drop policy if exists check_ins_anon_deny on public.check_ins;
create policy check_ins_anon_deny
  on public.check_ins for all to anon
  using (false) with check (false);

-- ── pub_pals + children (owner_id = auth.users) ─────────────────────────────
revoke all on table public.pub_pals from anon, authenticated;
revoke all on table public.pub_pal_memories from anon, authenticated;
revoke all on table public.pub_pal_mastery_events from anon, authenticated;
revoke all on table public.pub_pal_voice_usage from anon, authenticated;

grant select, insert, update, delete on table public.pub_pals to authenticated;
grant select, insert, update, delete on table public.pub_pal_memories to authenticated;
grant select, insert on table public.pub_pal_mastery_events to authenticated;
grant select, insert, update on table public.pub_pal_voice_usage to authenticated;

grant select, insert, update, delete on table public.pub_pals to service_role;
grant select, insert, update, delete on table public.pub_pal_memories to service_role;
grant select, insert, update, delete on table public.pub_pal_mastery_events to service_role;
grant select, insert, update, delete on table public.pub_pal_voice_usage to service_role;

drop policy if exists pub_pals_owner_all on public.pub_pals;
create policy pub_pals_owner_all
  on public.pub_pals for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists pub_pals_anon_deny on public.pub_pals;
create policy pub_pals_anon_deny
  on public.pub_pals for all to anon
  using (false) with check (false);

drop policy if exists pub_pal_memories_owner_all on public.pub_pal_memories;
create policy pub_pal_memories_owner_all
  on public.pub_pal_memories for all to authenticated
  using (
    exists (
      select 1 from public.pub_pals p
      where p.id = pal_id and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.pub_pals p
      where p.id = pal_id and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists pub_pal_memories_anon_deny on public.pub_pal_memories;
create policy pub_pal_memories_anon_deny
  on public.pub_pal_memories for all to anon
  using (false) with check (false);

drop policy if exists pub_pal_mastery_events_owner_select on public.pub_pal_mastery_events;
create policy pub_pal_mastery_events_owner_select
  on public.pub_pal_mastery_events for select to authenticated
  using (
    exists (
      select 1 from public.pub_pals p
      where p.id = pal_id and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists pub_pal_mastery_events_owner_insert on public.pub_pal_mastery_events;
create policy pub_pal_mastery_events_owner_insert
  on public.pub_pal_mastery_events for insert to authenticated
  with check (
    exists (
      select 1 from public.pub_pals p
      where p.id = pal_id and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists pub_pal_mastery_events_anon_deny on public.pub_pal_mastery_events;
create policy pub_pal_mastery_events_anon_deny
  on public.pub_pal_mastery_events for all to anon
  using (false) with check (false);

drop policy if exists pub_pal_voice_usage_owner_all on public.pub_pal_voice_usage;
create policy pub_pal_voice_usage_owner_all
  on public.pub_pal_voice_usage for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists pub_pal_voice_usage_anon_deny on public.pub_pal_voice_usage;
create policy pub_pal_voice_usage_anon_deny
  on public.pub_pal_voice_usage for all to anon
  using (false) with check (false);

-- ── night_memories / moments / consents (owner_id) ──────────────────────────
revoke all on table public.night_memories from anon, authenticated;
revoke all on table public.night_moments from anon, authenticated;
revoke all on table public.night_moment_consents from anon, authenticated;
revoke all on table public.night_stories from anon, authenticated;
revoke all on table public.night_story_contributors from anon, authenticated;
revoke all on table public.night_story_moments from anon, authenticated;
revoke all on table public.night_story_publish_proposals from anon, authenticated;

grant select, insert, update, delete on table public.night_memories to authenticated;
grant select, insert, update, delete on table public.night_moments to authenticated;
grant select, insert, update, delete on table public.night_moment_consents to authenticated;
grant select, insert, update, delete on table public.night_stories to authenticated;
grant select, insert, update, delete on table public.night_story_contributors to authenticated;
grant select, insert, update, delete on table public.night_story_moments to authenticated;
grant select, insert, update, delete on table public.night_story_publish_proposals to authenticated;

grant select, insert, update, delete on table public.night_memories to service_role;
grant select, insert, update, delete on table public.night_moments to service_role;
grant select, insert, update, delete on table public.night_moment_consents to service_role;
grant select, insert, update, delete on table public.night_stories to service_role;
grant select, insert, update, delete on table public.night_story_contributors to service_role;
grant select, insert, update, delete on table public.night_story_moments to service_role;
grant select, insert, update, delete on table public.night_story_publish_proposals to service_role;

drop policy if exists night_memories_owner_all on public.night_memories;
create policy night_memories_owner_all
  on public.night_memories for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists night_memories_anon_deny on public.night_memories;
create policy night_memories_anon_deny
  on public.night_memories for all to anon
  using (false) with check (false);

drop policy if exists night_moments_owner_all on public.night_moments;
create policy night_moments_owner_all
  on public.night_moments for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists night_moments_anon_deny on public.night_moments;
create policy night_moments_anon_deny
  on public.night_moments for all to anon
  using (false) with check (false);

drop policy if exists night_moment_consents_owner_all on public.night_moment_consents;
create policy night_moment_consents_owner_all
  on public.night_moment_consents for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists night_moment_consents_anon_deny on public.night_moment_consents;
create policy night_moment_consents_anon_deny
  on public.night_moment_consents for all to anon
  using (false) with check (false);

drop policy if exists night_stories_host_or_public_select on public.night_stories;
create policy night_stories_host_or_public_select
  on public.night_stories for select to authenticated
  using (
    host_editor_id = (select auth.uid())
    or (
      status = 'published'
      and visibility in ('public', 'unlisted')
    )
  );

drop policy if exists night_stories_host_write on public.night_stories;
create policy night_stories_host_write
  on public.night_stories for all to authenticated
  using (host_editor_id = (select auth.uid()))
  with check (host_editor_id = (select auth.uid()));

drop policy if exists night_stories_anon_deny on public.night_stories;
create policy night_stories_anon_deny
  on public.night_stories for all to anon
  using (false) with check (false);

drop policy if exists night_story_contributors_party_select on public.night_story_contributors;
create policy night_story_contributors_party_select
  on public.night_story_contributors for select to authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

drop policy if exists night_story_contributors_host_write on public.night_story_contributors;
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

drop policy if exists night_story_contributors_anon_deny on public.night_story_contributors;
create policy night_story_contributors_anon_deny
  on public.night_story_contributors for all to anon
  using (false) with check (false);

-- Published/unlisted stories may be READs for any signed-in client. Writes
-- (including DELETE) stay host-only. A prior FOR ALL policy put the published
-- predicate in USING, so PostgreSQL allowed any authenticated user to DELETE
-- join rows on a published story (WITH CHECK is not used for DELETE). Split
-- so a published-row predicate never rides a write verb.
drop policy if exists night_story_moments_host_all on public.night_story_moments;
drop policy if exists night_story_moments_host_or_published_select
  on public.night_story_moments;
drop policy if exists night_story_moments_host_write on public.night_story_moments;

create policy night_story_moments_host_or_published_select
  on public.night_story_moments for select to authenticated
  using (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id
        and s.status = 'published'
        and s.visibility in ('public', 'unlisted')
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

drop policy if exists night_story_moments_anon_deny on public.night_story_moments;
create policy night_story_moments_anon_deny
  on public.night_story_moments for all to anon
  using (false) with check (false);

drop policy if exists night_story_publish_proposals_party_all on public.night_story_publish_proposals;
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

drop policy if exists night_story_publish_proposals_anon_deny on public.night_story_publish_proposals;
create policy night_story_publish_proposals_anon_deny
  on public.night_story_publish_proposals for all to anon
  using (false) with check (false);

-- ── structured_visit_reports ────────────────────────────────────────────────
-- Visit Report API returns visible rows only (hidden is a separate moderator
-- lane). Owner exception for hidden rows is looser than the product filter —
-- status = 'visible' is the only authenticated SELECT predicate.

revoke all on table public.structured_visit_reports from anon, authenticated;
grant select on table public.structured_visit_reports to authenticated;
grant select, insert, update, delete on table public.structured_visit_reports to service_role;

drop policy if exists structured_visit_reports_visible_or_owner_select
  on public.structured_visit_reports;
drop policy if exists structured_visit_reports_visible_select
  on public.structured_visit_reports;
create policy structured_visit_reports_visible_select
  on public.structured_visit_reports for select to authenticated
  using (status = 'visible');

drop policy if exists structured_visit_reports_anon_deny on public.structured_visit_reports;
create policy structured_visit_reports_anon_deny
  on public.structured_visit_reports for all to anon
  using (false) with check (false);

-- ── external_social_accounts (owner_id → auth.users) ────────────────────────
revoke all on table public.external_social_accounts from anon, authenticated;
grant select, insert, update, delete on table public.external_social_accounts to authenticated;
grant select, insert, update, delete on table public.external_social_accounts to service_role;

drop policy if exists external_social_accounts_owner_all on public.external_social_accounts;
create policy external_social_accounts_owner_all
  on public.external_social_accounts for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists external_social_accounts_anon_deny on public.external_social_accounts;
create policy external_social_accounts_anon_deny
  on public.external_social_accounts for all to anon
  using (false) with check (false);

-- ── profile_handle_aliases: owner reads own aliases ─────────────────────────
revoke all on table public.profile_handle_aliases from anon, authenticated;
grant select on table public.profile_handle_aliases to authenticated;
grant select, insert, update, delete on table public.profile_handle_aliases to service_role;

drop policy if exists profile_handle_aliases_owner_select on public.profile_handle_aliases;
create policy profile_handle_aliases_owner_select
  on public.profile_handle_aliases for select to authenticated
  using (public.rls_owns_profile(profile_id));

drop policy if exists profile_handle_aliases_anon_deny on public.profile_handle_aliases;
create policy profile_handle_aliases_anon_deny
  on public.profile_handle_aliases for all to anon
  using (false) with check (false);

-- ── profiles: restore owner SELECT (public_read was removed in 0050) ────────
grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

drop policy if exists profiles_owner_select on public.profiles;
create policy profiles_owner_select
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

-- Keep existing profiles_owner_insert / profiles_owner_update from 0009.

commit;
