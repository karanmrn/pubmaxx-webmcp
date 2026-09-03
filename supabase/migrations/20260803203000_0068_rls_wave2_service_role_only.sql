-- RLS wave 2: remaining tables stay service-role only.
--
-- These tables either hold secrets (token hashes, rate-limit keys, OAuth
-- verifiers), are capability-gated in application code (plan invites, rounds
-- via share codes), or expose only derived DTOs through /api/*.
--
-- Prior migrations left RLS enabled with zero policies (deny-by-default).
-- That is correct behaviour but trips `rls_enabled_no_policy`. This file adds
-- explicit deny policies for anon + authenticated so the intent is reviewable
-- and the advisor is satisfied, without opening PostgREST access.
--
-- Also closes the accidental `using (true)` public reads on rounds* that
-- predate the private Round diary model.
--
-- Reverse: apply
-- supabase/migrations/rollback/20260803200000_rls_wave2_rollback.sql
-- which drops the client_deny policies and restores the prior
-- rounds_*_public_read definitions captured below as comments + in the
-- rollback script body.

begin;

-- ── Close open Round public reads (private diary / code-is-capability) ──────
-- Prior definitions (from 0011_rounds / 0057_round_spends), captured for
-- rollback. Each was: for select using (true) with no role restriction.
--
--   create policy rounds_public_read on public.rounds for select using (true);
--   create policy round_members_public_read on public.round_members
--     for select using (true);
--   create policy round_stops_public_read on public.round_stops
--     for select using (true);
--   create policy round_spends_public_read on public.round_spends
--     for select using (true);
drop policy if exists rounds_public_read on public.rounds;
drop policy if exists round_members_public_read on public.round_members;
drop policy if exists round_stops_public_read on public.round_stops;
drop policy if exists round_spends_public_read on public.round_spends;

-- ── Explicit client-deny policies ───────────────────────────────────────────
-- One permissive policy with using(false) is enough to (a) exist for the
-- advisor and (b) deny every row for that role. Service role bypasses RLS.

do $$
declare
  t text;
  tables text[] := array[
    -- capability / plan collaboration (token or member-gated in API)
    'plan_invites',
    'plan_constraints',
    'plan_route_proposals',
    'plan_votes',
    'plan_vote_requests',
    'plan_vibe_votes',
    'plan_vibe_vote_requests',
    'plan_actions',
    'plan_completions',
    -- rounds (code-is-capability; no auth.uid() membership column)
    'rounds',
    'round_members',
    'round_stops',
    'round_spends',
    'round_price_line_charges',
    -- moderation / report ledgers
    'community_price_reports',
    'pint_drop_reports',
    'pint_drop_reactions',
    'pint_drop_comments',
    -- crawl children (parent visibility filtered in API)
    'crawl_story_stops',
    -- infrastructure / secrets
    'rate_limits',
    'push_tokens',
    'social_oauth_states',
    'analytics_event_receipts',
    'email_subscribers',
    'feed_freshness',
    'weather_snapshots',
    'weather_recommendations',
    'area_demand',
    'walk_route_legs',
    -- operator rail
    'venue_operators',
    'operator_proposals',
    -- referrals / pro ledger (private account surfaces)
    'referral_invite_codes',
    'referral_erasure_blocks',
    'referral_edges',
    'referral_qualification_events',
    'pro_feature_unlock_ledger',
    -- ratings / presence / price confirms (API DTOs only)
    'drink_ratings',
    'venue_ratings',
    'pub_presence',
    'price_confirms',
    -- public catalogue restored with explicit select policies below when needed
    'drinks',
    'pub_heritage',
    -- night signal claims kept API-filtered
    'night_signal_claims'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      t
    );

    execute format('drop policy if exists %I on public.%I', t || '_client_deny', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      t || '_client_deny',
      t
    );
  end loop;
end $$;

-- Public catalogue tables that the product treats as public content: re-open
-- SELECT only (writes stay denied — no insert/update/delete policy).
-- drinks + pub_heritage had public-read policies historically; restore them
-- after the blanket client_deny above would have closed them.

drop policy if exists drinks_client_deny on public.drinks;
drop policy if exists drinks_public_read on public.drinks;
create policy drinks_public_read
  on public.drinks
  for select
  to anon, authenticated
  using (true);

drop policy if exists pub_heritage_client_deny on public.pub_heritage;
drop policy if exists "pub_heritage public read" on public.pub_heritage;
create policy "pub_heritage public read"
  on public.pub_heritage
  for select
  to anon, authenticated
  using (true);

grant select on table public.drinks to anon, authenticated;
grant select on table public.pub_heritage to anon, authenticated;

-- crawl_stories: keep published/unlisted public read (from 0006).
drop policy if exists crawl_stories_public_read on public.crawl_stories;
create policy crawl_stories_public_read
  on public.crawl_stories
  for select
  to anon, authenticated
  using (visibility in ('public', 'unlisted'));

grant select on table public.crawl_stories to anon, authenticated;
grant select, insert, update, delete on table public.crawl_stories to service_role;

-- night_signal_claims: approved current claims only (from 0034).
drop policy if exists night_signal_claims_client_deny on public.night_signal_claims;
drop policy if exists "Public reads current approved night signal claims"
  on public.night_signal_claims;
create policy "Public reads current approved night signal claims"
  on public.night_signal_claims
  for select
  to anon, authenticated
  using (
    review_state = 'approved'
    and observed_at <= now()
    and reviewed_at <= now()
    and expires_at > now()
  );

grant select (
  id, kind, entity_type, entity_id, claim, source_url, publisher, published_at,
  observed_at, expires_at, confidence, review_state, verification, route_effect,
  corroborating_sources, reviewed_at, review_authority, created_at
) on public.night_signal_claims to anon, authenticated;
grant select, insert, update, delete on table public.night_signal_claims to service_role;

commit;
