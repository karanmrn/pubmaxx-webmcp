-- RLS wave 2: priority tables that Clerk-signed-in clients must be able to
-- read under their own JWT without seeing anyone else's private rows.
--
-- Derived from the live API rules (not invented):
--   plans*          — private working state; owner or linked crew only
--   conversations / messages — participant only (handle or user_id)
--   saved_pubs      — owning profile only
--   community_prices — non-hidden sheet rows for any signed-in reader only;
--                      hidden never leaves the filter (freshestPerCategory);
--                      writes and moderation stay service-role
--   visit_reports   — same gate as canViewOnPublicSurface: status=visible,
--                      public/anonymous for any signed-in reader, friends for
--                      author + author's followers, legacy for author only.
--                      Hidden/pending never readable via PostgREST.
--
-- Anon stays denied on every table here. Service role bypasses RLS.
-- Reverse: see supabase/migrations/rollback/20260803200000_rls_wave2_rollback.sql

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- plans / plan_stops / plan_crew_members
-- ═══════════════════════════════════════════════════════════════════════════
-- 0024 revoked ALL from anon/authenticated and left zero policies. Re-open
-- SELECT only for account-linked participants. token_hash stays ungrafted to
-- browser roles (column privilege) so a member cannot scrape every invite
-- capability via PostgREST.

revoke all on table public.plans from anon, authenticated;
revoke all on table public.plan_stops from anon, authenticated;
revoke all on table public.plan_crew_members from anon, authenticated;

grant select on table public.plans to authenticated;
grant select on table public.plan_stops to authenticated;
-- Every column except token_hash.
grant select (
  id, plan_id, name, status, user_id, joined_at, updated_at
) on table public.plan_crew_members to authenticated;

grant select, insert, update, delete on table public.plans to service_role;
grant select, insert, update, delete on table public.plan_stops to service_role;
grant select, insert, update, delete on table public.plan_crew_members to service_role;

drop policy if exists plans_participant_select on public.plans;
create policy plans_participant_select
  on public.plans
  for select
  to authenticated
  using (public.rls_is_plan_participant(id));

drop policy if exists plans_anon_deny on public.plans;
create policy plans_anon_deny
  on public.plans
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists plan_stops_participant_select on public.plan_stops;
create policy plan_stops_participant_select
  on public.plan_stops
  for select
  to authenticated
  using (public.rls_is_plan_participant(plan_id));

drop policy if exists plan_stops_anon_deny on public.plan_stops;
create policy plan_stops_anon_deny
  on public.plan_stops
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists plan_crew_members_participant_select on public.plan_crew_members;
create policy plan_crew_members_participant_select
  on public.plan_crew_members
  for select
  to authenticated
  using (public.rls_is_plan_participant(plan_id));

drop policy if exists plan_crew_members_anon_deny on public.plan_crew_members;
create policy plan_crew_members_anon_deny
  on public.plan_crew_members
  for all
  to anon
  using (false)
  with check (false);

-- ═══════════════════════════════════════════════════════════════════════════
-- conversations / messages
-- ═══════════════════════════════════════════════════════════════════════════
-- 0019 shipped deny-all (no policies). Participant SELECT only; sends still
-- go through /api/messages so body length, rate limits and report seams stay
-- in application code.

revoke all on table public.conversations from anon, authenticated;
revoke all on table public.messages from anon, authenticated;

grant select on table public.conversations to authenticated;
grant select on table public.messages to authenticated;

grant select, insert, update, delete on table public.conversations to service_role;
grant select, insert, update, delete on table public.messages to service_role;

drop policy if exists conversations_participant_select on public.conversations;
create policy conversations_participant_select
  on public.conversations
  for select
  to authenticated
  using (
    user_id_a = (select auth.uid())
    or user_id_b = (select auth.uid())
    or public.rls_owns_handle(handle_a)
    or public.rls_owns_handle(handle_b)
  );

drop policy if exists conversations_anon_deny on public.conversations;
create policy conversations_anon_deny
  on public.conversations
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists messages_participant_select on public.messages;
create policy messages_participant_select
  on public.messages
  for select
  to authenticated
  using (public.rls_is_conversation_participant(conversation_id));

drop policy if exists messages_anon_deny on public.messages;
create policy messages_anon_deny
  on public.messages
  for all
  to anon
  using (false)
  with check (false);

-- ═══════════════════════════════════════════════════════════════════════════
-- saved_pubs
-- ═══════════════════════════════════════════════════════════════════════════
-- Owning profile only (list/toggle via /api/saved-pubs). 0023 dropped the
-- open public-read policy; this restores owner access for a signed-in JWT.

revoke all on table public.saved_pubs from anon, authenticated;
grant select, insert, update, delete on table public.saved_pubs to authenticated;
grant select, insert, update, delete on table public.saved_pubs to service_role;

drop policy if exists saved_pubs_owner_select on public.saved_pubs;
create policy saved_pubs_owner_select
  on public.saved_pubs
  for select
  to authenticated
  using (public.rls_owns_profile(profile_id));

drop policy if exists saved_pubs_owner_insert on public.saved_pubs;
create policy saved_pubs_owner_insert
  on public.saved_pubs
  for insert
  to authenticated
  with check (public.rls_owns_profile(profile_id));

drop policy if exists saved_pubs_owner_update on public.saved_pubs;
create policy saved_pubs_owner_update
  on public.saved_pubs
  for update
  to authenticated
  using (public.rls_owns_profile(profile_id))
  with check (public.rls_owns_profile(profile_id));

drop policy if exists saved_pubs_owner_delete on public.saved_pubs;
create policy saved_pubs_owner_delete
  on public.saved_pubs
  for delete
  to authenticated
  using (public.rls_owns_profile(profile_id));

drop policy if exists saved_pubs_anon_deny on public.saved_pubs;
create policy saved_pubs_anon_deny
  on public.saved_pubs
  for all
  to anon
  using (false)
  with check (false);

-- ═══════════════════════════════════════════════════════════════════════════
-- community_prices
-- ═══════════════════════════════════════════════════════════════════════════
-- Sheet shows every non-hidden observation (corroboration is a map authority
-- question, not a row visibility question). A hidden row is filtered from the
-- sheet, the corroboration count and the map candidate together
-- (freshestPerCategory) — so PostgREST must not surface it either, including
-- to the contributing actor. Actor tokens and moderation columns stay out of
-- the client column grant. Writes, reports and hides stay on the service-role
-- route.

revoke all on table public.community_prices from anon, authenticated;

grant select (
  id,
  venue_id,
  drink_category,
  price_pennies,
  submitted_at,
  contributor_handle,
  corroborated_at,
  contradicted_at
) on table public.community_prices to authenticated;

grant select, insert, update, delete on table public.community_prices to service_role;

drop policy if exists community_prices_visible_select on public.community_prices;
create policy community_prices_visible_select
  on public.community_prices
  for select
  to authenticated
  using (hidden_at is null);

drop policy if exists community_prices_anon_deny on public.community_prices;
create policy community_prices_anon_deny
  on public.community_prices
  for all
  to anon
  using (false)
  with check (false);

-- ═══════════════════════════════════════════════════════════════════════════
-- visit_reports (Pint Drops)
-- ═══════════════════════════════════════════════════════════════════════════
-- Same gate as app/p/[id] + canViewOnPublicSurface: only status='visible'
-- rows; public/anonymous for any signed-in reader; friends for author and the
-- author's followers; legacy for author only. Hidden/pending never leave the
-- service-role path. Photo keys stay usable; Storage itself is private + signed.

revoke all on table public.visit_reports from anon, authenticated;

grant select on table public.visit_reports to authenticated;
grant select, insert, update, delete on table public.visit_reports to service_role;

drop policy if exists visit_reports_visible_or_owner_select on public.visit_reports;
drop policy if exists visit_reports_public_surface_select on public.visit_reports;
create policy visit_reports_public_surface_select
  on public.visit_reports
  for select
  to authenticated
  using (
    public.rls_can_read_visit_report(status, visibility, handle)
  );

drop policy if exists visit_reports_anon_deny on public.visit_reports;
create policy visit_reports_anon_deny
  on public.visit_reports
  for all
  to anon
  using (false)
  with check (false);

commit;
