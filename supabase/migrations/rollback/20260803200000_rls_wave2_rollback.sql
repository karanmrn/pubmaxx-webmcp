-- Rollback for RLS wave 2 (0065–0069).
--
-- Apply ONLY when undoing an unapplied or recently applied wave 2. Does not
-- run automatically. Captain applies migrations; this is the clean down path.
--
-- Restores:
--   • prior rounds_*_public_read policies (using (true)) dropped by 0068
--   • public catalogue reads (drinks, pub_heritage, crawl_stories, night signals)
--   • drops every wave-2 policy (including 0067 renames: mastery select/insert,
--     night_stories host_or_public/host_write, contributors party/host_write,
--     publish_proposals party_all) plus legacy owner_all names if present
--   • drops every rls_* helper body wave 2 introduced
--   • revokes authenticated/anon grants this wave added
--   • restores pre-0069 PUBLIC execute on refresh_community_price_quality
--   • restores client and service-role privileges to their immediate pre-wave state
--
-- Does NOT drop tables or data. Does NOT re-open private_account_identities
-- writes (pre-wave-2 had no client grants either).

begin;

-- ── Drop wave-2 policies by known names (ignore missing) ────────────────────
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and (
        policyname like '%_anon_deny'
        or policyname like '%_client_deny'
        or policyname in (
          'plans_participant_select',
          'plan_stops_participant_select',
          'plan_crew_members_participant_select',
          'conversations_participant_select',
          'messages_participant_select',
          'saved_pubs_owner_select',
          'saved_pubs_owner_insert',
          'saved_pubs_owner_update',
          'saved_pubs_owner_delete',
          'community_prices_visible_select',
          'visit_reports_public_surface_select',
          'visit_reports_visible_or_owner_select',
          'private_account_identities_owner_select',
          'private_account_identities_owner_insert',
          'private_account_identities_owner_update',
          'private_account_identities_owner_delete',
          'notifications_recipient_select',
          'notifications_recipient_update',
          'saved_lists_owner_all',
          'saved_list_follows_owner_all',
          'follows_party_select',
          'follows_owner_insert',
          'follows_owner_delete',
          'check_ins_author_select',
          'check_ins_author_insert',
          'check_ins_author_delete',
          'pub_pals_owner_all',
          'pub_pal_memories_owner_all',
          -- 0067 creates select+insert (not a single owner_all) for mastery events.
          'pub_pal_mastery_events_owner_select',
          'pub_pal_mastery_events_owner_insert',
          'pub_pal_mastery_events_owner_all',
          'pub_pal_voice_usage_owner_all',
          'night_memories_owner_all',
          'night_moments_owner_all',
          'night_moment_consents_owner_all',
          -- 0067 renames host/party policies (legacy owner_all/host_all kept for safety).
          'night_stories_host_or_public_select',
          'night_stories_host_write',
          'night_stories_owner_all',
          'night_story_contributors_party_select',
          'night_story_contributors_host_write',
          'night_story_contributors_host_all',
          'night_story_moments_host_all',
          'night_story_moments_host_or_published_select',
          'night_story_moments_host_write',
          'night_story_publish_proposals_party_all',
          'night_story_publish_proposals_host_all',
          'structured_visit_reports_visible_select',
          'structured_visit_reports_visible_or_owner_select',
          'external_social_accounts_owner_all',
          'profile_handle_aliases_owner_select',
          'profiles_owner_select',
          'drinks_public_read',
          'pub_heritage public read',
          'crawl_stories_public_read',
          'Public reads current approved night signal claims'
        )
      )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ── Drop wave-2 helpers ─────────────────────────────────────────────────────
drop function if exists public.rls_can_read_visit_report(text, text, text);
drop function if exists public.rls_follows_handle(text);
drop function if exists public.rls_current_price_actor();
drop function if exists public.rls_is_conversation_participant(uuid);
drop function if exists public.rls_is_plan_participant(uuid);
drop function if exists public.rls_owns_handle(text);
drop function if exists public.rls_owns_profile(uuid);
drop function if exists public.rls_current_profile_id();

-- ── Revoke wave-2 authenticated grants (best-effort) ────────────────────────
do $$
declare
  t text;
  tables text[] := array[
    'plans', 'plan_stops', 'plan_crew_members',
    'conversations', 'messages', 'saved_pubs',
    'community_prices', 'visit_reports',
    'private_account_identities', 'notifications',
    'saved_lists', 'saved_list_follows', 'follows', 'check_ins',
    'pub_pals', 'pub_pal_memories', 'pub_pal_mastery_events', 'pub_pal_voice_usage',
    'night_memories', 'night_moments', 'night_moment_consents',
    'night_stories', 'night_story_contributors', 'night_story_moments',
    'night_story_publish_proposals',
    'structured_visit_reports', 'external_social_accounts',
    'profile_handle_aliases', 'profiles',
    'drinks', 'pub_heritage', 'crawl_stories', 'night_signal_claims',
    'rounds', 'round_members', 'round_stops', 'round_spends'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Restore client table privileges present immediately before wave 2. Older
-- Supabase projects granted DML on new public tables by default; later
-- migrations narrowed selected read surfaces to column grants.
do $$
declare
  t text;
  default_dml_tables text[] := array[
    'check_ins', 'community_price_reports', 'community_prices',
    'conversations', 'drink_ratings', 'email_subscribers', 'follows',
    'messages', 'notifications', 'pint_drop_reports', 'price_confirms',
    'pub_presence', 'rate_limits', 'round_members', 'round_stops', 'rounds',
    'saved_list_follows', 'saved_lists', 'saved_pubs', 'venue_ratings',
    'visit_reports'
  ];
  default_write_tables text[] := array[
    'crawl_stories', 'crawl_story_stops', 'drinks', 'pint_drop_comments',
    'pint_drop_reactions', 'profiles', 'pub_heritage'
  ];
begin
  foreach t in array default_dml_tables loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'grant select, insert, update, delete on table public.%I to anon, authenticated',
        t
      );
    end if;
  end loop;
  foreach t in array default_write_tables loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'grant insert, update, delete on table public.%I to anon, authenticated',
        t
      );
    end if;
  end loop;
end $$;

-- ── Restore pre-wave-2 Round public reads (0011 / 0057) ─────────────────────
do $$
begin
  if to_regclass('public.rounds') is not null then
    drop policy if exists rounds_public_read on public.rounds;
    create policy rounds_public_read on public.rounds for select using (true);
  end if;
  if to_regclass('public.round_members') is not null then
    drop policy if exists round_members_public_read on public.round_members;
    create policy round_members_public_read on public.round_members for select using (true);
  end if;
  if to_regclass('public.round_stops') is not null then
    drop policy if exists round_stops_public_read on public.round_stops;
    create policy round_stops_public_read on public.round_stops for select using (true);
  end if;
  if to_regclass('public.round_spends') is not null then
    drop policy if exists round_spends_public_read on public.round_spends;
    create policy round_spends_public_read on public.round_spends for select using (true);
  end if;
end $$;

-- ── Restore public catalogue / night signal reads if tables exist ───────────
do $$
begin
  if to_regclass('public.drinks') is not null then
    drop policy if exists drinks_public_read on public.drinks;
    create policy drinks_public_read on public.drinks for select using (true);
    grant select on table public.drinks to anon, authenticated;
  end if;
  if to_regclass('public.pub_heritage') is not null then
    drop policy if exists "pub_heritage public read" on public.pub_heritage;
    create policy "pub_heritage public read" on public.pub_heritage for select using (true);
    grant select on table public.pub_heritage to anon, authenticated;
  end if;
  if to_regclass('public.crawl_stories') is not null then
    drop policy if exists crawl_stories_public_read on public.crawl_stories;
    create policy crawl_stories_public_read
      on public.crawl_stories
      for select
      using (visibility in ('public', 'unlisted'));
    grant select on table public.crawl_stories to anon, authenticated;
  end if;
  if to_regclass('public.night_signal_claims') is not null then
    drop policy if exists "Public reads current approved night signal claims"
      on public.night_signal_claims;
    create policy "Public reads current approved night signal claims"
      on public.night_signal_claims
      for select
      using (
        review_state = 'approved'
        and observed_at <= now()
        and reviewed_at <= now()
        and expires_at > now()
      );
    grant select (
      id, kind, entity_type, entity_id, claim, source_url, publisher,
      published_at, observed_at, expires_at, confidence, review_state,
      verification, route_effect, corroborating_sources, reviewed_at,
      review_authority, created_at
    ) on public.night_signal_claims to anon, authenticated;
  end if;
end $$;

-- ── Restore pre-wave-2 EXECUTE on refresh RPC (0069 reverse) ────────────────
-- Wave 2 revoked PUBLIC/anon/authenticated. Prior default was PUBLIC execute.
do $$
begin
  if to_regprocedure('public.refresh_community_price_quality()') is not null then
    grant execute on function public.refresh_community_price_quality() to public;
    revoke execute on function public.refresh_community_price_quality()
      from service_role;
  end if;
end $$;

commit;
