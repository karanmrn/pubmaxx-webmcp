/**
 * RLS wave 2 — migration contract tests (SQL text shape).
 *
 * Pins policy predicates and grants in the migration files. Effective
 * deny/allow against a real Postgres session lives in
 * __tests__/rlsWave2Session.test.ts — do not treat this file as an RLS proof.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

const HELPERS = readMigration("20260803200000_0065_rls_wave2_helpers.sql");
const PRIORITY = readMigration("20260803201000_0066_rls_wave2_priority_policies.sql");
const OWNER = readMigration("20260803202000_0067_rls_wave2_owner_policies.sql");
const SERVICE = readMigration("20260803203000_0068_rls_wave2_service_role_only.sql");
const RPC = readMigration("20260803204000_0069_rls_wave2_rpc_hardening.sql");

const N_HELPERS = normalize(HELPERS);
const N_PRIORITY = normalize(PRIORITY);
const N_OWNER = normalize(OWNER);
const N_SERVICE = normalize(SERVICE);
const N_RPC = normalize(RPC);
const ALL = `${HELPERS}\n${PRIORITY}\n${OWNER}\n${SERVICE}\n${RPC}`;
const N_ALL = normalize(ALL);

/** Extract one create policy body (normalized) for assertions. */
function policyBody(sql: string, policyName: string): string {
  const re = new RegExp(
    `create\\s+policy\\s+${policyName}\\s+on\\s+public\\.(\\w+)([\\s\\S]*?)(?=\\n(?:drop\\s+policy|create\\s+policy|revoke\\s+|grant\\s+|commit|begin|-- ═))`,
    "i",
  );
  const m = sql.match(re);
  expect(m, `expected policy ${policyName}`).toBeTruthy();
  return normalize(m![0]);
}

describe("RLS wave 2 helpers", () => {
  it("ships security-definer helpers that read auth.uid(), never a client-supplied uid", () => {
    expect(N_HELPERS).toContain("create or replace function public.rls_owns_profile");
    expect(N_HELPERS).toContain("create or replace function public.rls_owns_handle");
    expect(N_HELPERS).toContain("create or replace function public.rls_is_plan_participant");
    expect(N_HELPERS).toContain("create or replace function public.rls_is_conversation_participant");
    expect(N_HELPERS).toContain("create or replace function public.rls_current_price_actor");
    expect(N_HELPERS).toContain("create or replace function public.rls_follows_handle");
    expect(N_HELPERS).toContain("create or replace function public.rls_can_read_visit_report");
    expect(N_HELPERS).toContain("security definer");
    expect(N_HELPERS).toContain("auth.uid()");
    // Helpers must not take a user id parameter a client could forge.
    expect(HELPERS).not.toMatch(/rls_owns_profile\s*\(\s*p_user/i);
    expect(N_HELPERS).toContain("revoke all on function public.rls_owns_profile(uuid) from public, anon");
    expect(N_HELPERS).toContain("grant execute on function public.rls_owns_profile(uuid) to authenticated, service_role");
  });
});

describe("plans — anon deny, owner/participant allow, other deny", () => {
  it("denies every anon operation", () => {
    const body = policyBody(PRIORITY, "plans_anon_deny");
    expect(body).toContain("to anon");
    expect(body).toContain("using (false)");
    expect(body).toContain("with check (false)");
  });

  it("allows authenticated select only via plan participant helper (owner or linked crew)", () => {
    const body = policyBody(PRIORITY, "plans_participant_select");
    expect(body).toContain("for select");
    expect(body).toContain("to authenticated");
    expect(body).toContain("rls_is_plan_participant(id)");
    // No open read.
    expect(body).not.toContain("using (true)");
  });

  it("does not grant authenticated write on plans (other and owner write via API/service role)", () => {
    expect(N_PRIORITY).not.toMatch(
      /grant\s+(insert|update|delete|all)\s+on\s+table\s+public\.plans\s+to\s+authenticated/,
    );
    expect(N_PRIORITY).not.toMatch(
      /create\s+policy\s+plans_\w+\s+on\s+public\.plans\s+for\s+(insert|update|delete)/,
    );
  });

  it("keeps plan_crew_members.token_hash off the authenticated column grant", () => {
    expect(PRIORITY).toMatch(
      /grant select\s*\(\s*id,\s*plan_id,\s*name,\s*status,\s*user_id,\s*joined_at,\s*updated_at\s*\)\s*on table public\.plan_crew_members to authenticated/i,
    );
    expect(N_PRIORITY).not.toMatch(
      /grant select\s*\([^)]*token_hash[^)]*\)\s*on table public\.plan_crew_members to authenticated/,
    );
    // Full-table select would include token_hash.
    expect(N_PRIORITY).not.toContain(
      "grant select on table public.plan_crew_members to authenticated",
    );
  });

  it("helper treats owner_user_id and crew user_id as participants (not arbitrary others)", () => {
    expect(N_HELPERS).toContain("pl.owner_user_id = (select auth.uid())");
    expect(N_HELPERS).toContain("m.user_id = (select auth.uid())");
  });
});

describe("messages — anon deny, participant allow, other deny", () => {
  it("denies anon on conversations and messages", () => {
    expect(policyBody(PRIORITY, "conversations_anon_deny")).toContain("using (false)");
    expect(policyBody(PRIORITY, "messages_anon_deny")).toContain("using (false)");
  });

  it("allows authenticated select only for conversation participants", () => {
    const conv = policyBody(PRIORITY, "conversations_participant_select");
    expect(conv).toContain("for select");
    expect(conv).toContain("to authenticated");
    expect(conv).toContain("user_id_a = (select auth.uid())");
    expect(conv).toContain("user_id_b = (select auth.uid())");
    expect(conv).toContain("rls_owns_handle(handle_a)");
    expect(conv).toContain("rls_owns_handle(handle_b)");
    expect(conv).not.toContain("using (true)");

    const msg = policyBody(PRIORITY, "messages_participant_select");
    expect(msg).toContain("rls_is_conversation_participant(conversation_id)");
  });

  it("does not open authenticated insert/update/delete on messages (writes stay API-mediated)", () => {
    expect(N_PRIORITY).not.toMatch(
      /create\s+policy\s+messages_\w+\s+on\s+public\.messages\s+for\s+(insert|update|delete)/,
    );
  });
});

describe("saved_pubs — anon deny, owner allow, other deny", () => {
  it("denies anon", () => {
    expect(policyBody(PRIORITY, "saved_pubs_anon_deny")).toContain("using (false)");
  });

  it("scopes every authenticated verb to rls_owns_profile(profile_id)", () => {
    for (const name of [
      "saved_pubs_owner_select",
      "saved_pubs_owner_insert",
      "saved_pubs_owner_update",
      "saved_pubs_owner_delete",
    ]) {
      const body = policyBody(PRIORITY, name);
      expect(body).toContain("to authenticated");
      expect(body).toContain("rls_owns_profile(profile_id)");
      expect(body).not.toContain("using (true)");
    }
  });

  it("owner helper is auth.uid()-bound so another signed-in user fails", () => {
    expect(N_HELPERS).toContain("p.user_id = (select auth.uid())");
    expect(N_HELPERS).toContain("p.id = p_profile_id");
  });
});

describe("community_prices — anon deny, non-hidden only, no author hidden leak", () => {
  it("denies anon entirely", () => {
    expect(policyBody(PRIORITY, "community_prices_anon_deny")).toContain("using (false)");
    expect(N_PRIORITY).not.toMatch(
      /grant\s+select[\s\S]*on table public\.community_prices to anon/,
    );
  });

  it("allows authenticated select only when hidden_at is null (no actor exception)", () => {
    const body = policyBody(PRIORITY, "community_prices_visible_select");
    expect(body).toContain("for select");
    expect(body).toContain("to authenticated");
    expect(body).toContain("hidden_at is null");
    // Hidden must not leak to the contributing actor via PostgREST.
    expect(body).not.toContain("rls_current_price_actor");
    expect(body).not.toContain("using (true)");
  });

  it("does not grant actor or moderation columns to authenticated", () => {
    const grant = PRIORITY.match(
      /grant select\s*\(([^)]*)\)\s*on table public\.community_prices to authenticated/i,
    );
    expect(grant, "expected community_prices column grant").toBeTruthy();
    const cols = grant![1].toLowerCase();
    expect(cols).toContain("venue_id");
    expect(cols).toContain("price_pennies");
    expect(cols).not.toMatch(/\bactor\b/);
    expect(cols).not.toContain("hidden_at");
    expect(cols).not.toContain("moderator_note");
    expect(cols).not.toContain("report_reason");
  });

  it("does not allow authenticated insert/update/delete (submit/hide stay service-role)", () => {
    expect(N_PRIORITY).not.toMatch(
      /create\s+policy\s+community_prices_\w+\s+on\s+public\.community_prices\s+for\s+(insert|update|delete)/,
    );
  });
});

describe("visit_reports — friends-gated public-surface select", () => {
  it("denies anon", () => {
    expect(policyBody(PRIORITY, "visit_reports_anon_deny")).toContain("using (false)");
  });

  it("uses rls_can_read_visit_report (not bare status=visible or owner exception)", () => {
    const body = policyBody(PRIORITY, "visit_reports_public_surface_select");
    expect(body).toContain("for select");
    expect(body).toContain("to authenticated");
    expect(body).toContain("rls_can_read_visit_report(status, visibility, handle)");
    // Old leaky shape must not return.
    expect(N_PRIORITY).not.toMatch(
      /status = 'visible'\s+or\s+public\.rls_owns_handle\(handle\)/,
    );
    expect(body).not.toContain("using (true)");
  });

  it("helper requires status=visible and friends follower gate", () => {
    expect(N_HELPERS).toContain("p_status = 'visible'");
    expect(N_HELPERS).toContain("rls_follows_handle");
    expect(N_HELPERS).toContain("'public', 'anonymous'");
    expect(N_HELPERS).toContain("= 'friends'");
  });

  it("does not allow authenticated write (composer is service-role API)", () => {
    expect(N_PRIORITY).not.toMatch(
      /create\s+policy\s+visit_reports_\w+\s+on\s+public\.visit_reports\s+for\s+(insert|update|delete)/,
    );
  });
});

describe("RPC hardening", () => {
  it("revokes anon/authenticated execute on refresh_community_price_quality", () => {
    expect(N_RPC).toContain(
      "revoke all on function public.refresh_community_price_quality() from public, anon, authenticated",
    );
    expect(N_RPC).toContain(
      "grant execute on function public.refresh_community_price_quality() to service_role",
    );
  });

  it("keeps public_contributor_leaderboard service_role-only (not anon-callable)", () => {
    // Documented intentional: product leaderboard is served via API, not raw RPC.
    expect(N_RPC).toContain(
      "revoke all on function public.public_contributor_leaderboard() from public, anon, authenticated",
    );
    expect(N_RPC).toContain(
      "grant execute on function public.public_contributor_leaderboard() to service_role",
    );
  });
});

describe("service-role-only tables and rounds closure", () => {
  it("drops the open rounds public-read policies", () => {
    expect(N_SERVICE).toContain("drop policy if exists rounds_public_read on public.rounds");
    expect(N_SERVICE).toContain(
      "drop policy if exists round_members_public_read on public.round_members",
    );
    expect(N_SERVICE).toContain(
      "drop policy if exists round_spends_public_read on public.round_spends",
    );
  });

  it("installs client_deny using(false) for private infrastructure tables", () => {
    // Policy names are built at runtime as t || '_client_deny' over this list.
    for (const table of [
      "rate_limits",
      "push_tokens",
      "social_oauth_states",
      "community_price_reports",
      "plan_invites",
      "referral_edges",
      "rounds",
    ]) {
      expect(N_SERVICE).toContain(`'${table}'`);
    }
    expect(N_SERVICE).toContain("t || '_client_deny'");
    expect(N_SERVICE).toContain("using (false)");
    expect(N_SERVICE).toContain("with check (false)");
  });

  it("restores public catalogue reads for drinks and pub_heritage only", () => {
    expect(N_SERVICE).toContain("create policy drinks_public_read");
    expect(N_SERVICE).toContain('create policy "pub_heritage public read"');
    expect(N_SERVICE).toContain(
      "grant select on table public.drinks to anon, authenticated",
    );
  });
});

describe("owner-keyed extras", () => {
  it("binds private_account_identities to owner SELECT only (no client write)", () => {
    const body = policyBody(OWNER, "private_account_identities_owner_select");
    expect(body).toContain("for select");
    expect(body).toContain("user_id = (select auth.uid())");
    expect(N_OWNER).toMatch(
      /grant select on table public\.private_account_identities to authenticated/,
    );
    expect(N_OWNER).not.toMatch(
      /grant select, insert, update, delete on table public\.private_account_identities to authenticated/,
    );
    // drop policy if exists remains (idempotent cleanup); create must not.
    expect(N_OWNER).not.toMatch(
      /create\s+policy\s+private_account_identities_owner_insert/i,
    );
    expect(N_OWNER).not.toMatch(
      /create\s+policy\s+private_account_identities_owner_update/i,
    );
    expect(N_OWNER).not.toMatch(
      /create\s+policy\s+private_account_identities_owner_delete/i,
    );
  });

  it("binds notifications to the recipient handle", () => {
    expect(N_OWNER).toContain("rls_owns_handle(recipient_handle)");
  });

  it("binds pub_pals and night_memories to owner_id = auth.uid()", () => {
    expect(N_OWNER).toContain("owner_id = (select auth.uid())");
    expect(N_OWNER).toContain("create policy pub_pals_owner_all");
    expect(N_OWNER).toContain("create policy night_memories_owner_all");
  });

  it("structured_visit_reports allows only status=visible (no owner hidden leak)", () => {
    const body = policyBody(OWNER, "structured_visit_reports_visible_select");
    expect(body).toContain("status = 'visible'");
    expect(body).not.toContain("rls_owns_handle");
  });
});

describe("rollback path is shipped", () => {
  const ROLLBACK = readFileSync(
    join(MIGRATIONS_DIR, "rollback/20260803200000_rls_wave2_rollback.sql"),
    "utf8",
  );
  const N_ROLLBACK = normalize(ROLLBACK);

  it("includes a runnable rollback script restoring prior rounds policies", () => {
    expect(N_ROLLBACK).toContain("create policy rounds_public_read");
    expect(N_ROLLBACK).toContain("using (true)");
    expect(N_ROLLBACK).toContain("drop function if exists public.rls_can_read_visit_report");
  });

  it("drops every forward policy the 0067 renames (not only legacy owner_all names)", () => {
    // Gate failure: rollback listed pre-rename names only, so seven wave-2
    // policies survived a down migration. Names must appear as SQL string
    // literals in the drop inventory.
    const mustDrop = [
      "pub_pal_mastery_events_owner_select",
      "pub_pal_mastery_events_owner_insert",
      "night_stories_host_or_public_select",
      "night_stories_host_write",
      "night_story_contributors_party_select",
      "night_story_contributors_host_write",
      "night_story_publish_proposals_party_all",
    ] as const;
    for (const name of mustDrop) {
      expect(ROLLBACK, `rollback must drop ${name}`).toContain(`'${name}'`);
    }
  });

  it("drops every rls_* helper body wave 2 introduced", () => {
    for (const fn of [
      "rls_can_read_visit_report",
      "rls_follows_handle",
      "rls_current_price_actor",
      "rls_is_conversation_participant",
      "rls_is_plan_participant",
      "rls_owns_handle",
      "rls_owns_profile",
      "rls_current_profile_id",
    ]) {
      expect(N_ROLLBACK).toContain(`drop function if exists public.${fn}`);
    }
  });
});

describe("coverage inventory (honest)", () => {
  /**
   * REAL session-tested policies: exercised by rlsWave2Session.test.ts against
   * a throwaway Postgres with anon / owner / other / friend roles.
   */
  const REAL_SESSION_TESTED = [
    "visit_reports",
    "community_prices",
    "private_account_identities",
    "plans",
    "messages",
    "saved_pubs",
    "structured_visit_reports",
    "rounds",
    "night_moments",
    "night_stories",
    "night_story_moments",
    "pub_pal_voice_usage",
    "night_memories",
    "night_moment_consents",
    "night_story_contributors",
    "night_story_publish_proposals",
  ] as const;

  /**
   * Policy declared in wave-2 SQL, but NOT proven with a real session in this
   * branch. A name in a migration is not an RLS proof.
   */
  const POLICY_DECLARED_UNTESTED = [
    "plan_stops",
    "plan_crew_members",
    "conversations",
    "notifications",
    "saved_lists",
    "saved_list_follows",
    "follows",
    "check_ins",
    "pub_pals",
    "pub_pal_memories",
    "pub_pal_mastery_events",
    "external_social_accounts",
    "profile_handle_aliases",
    "profiles",
    "drinks",
    "pub_heritage",
    "crawl_stories",
    "night_signal_claims",
    "round_members",
    "round_stops",
    "round_spends",
    "round_price_line_charges",
    "plan_invites",
    "plan_constraints",
    "plan_route_proposals",
    "plan_votes",
    "plan_vote_requests",
    "plan_vibe_votes",
    "plan_vibe_vote_requests",
    "plan_actions",
    "plan_completions",
    "community_price_reports",
    "pint_drop_reports",
    "pint_drop_reactions",
    "pint_drop_comments",
    "crawl_story_stops",
    "rate_limits",
    "push_tokens",
    "social_oauth_states",
    "analytics_event_receipts",
    "email_subscribers",
    "feed_freshness",
    "weather_snapshots",
    "weather_recommendations",
    "area_demand",
    "walk_route_legs",
    "venue_operators",
    "operator_proposals",
    "referral_invite_codes",
    "referral_erasure_blocks",
    "referral_edges",
    "referral_qualification_events",
    "pro_feature_unlock_ledger",
    "drink_ratings",
    "venue_ratings",
    "pub_presence",
    "price_confirms",
  ] as const;

  it("names the real session-tested tables (honest floor, not a false 68)", () => {
    expect(REAL_SESSION_TESTED).toEqual([
      "visit_reports",
      "community_prices",
      "private_account_identities",
      "plans",
      "messages",
      "saved_pubs",
      "structured_visit_reports",
      "rounds",
      "night_moments",
      "night_stories",
      "night_story_moments",
      "pub_pal_voice_usage",
      "night_memories",
      "night_moment_consents",
      "night_story_contributors",
      "night_story_publish_proposals",
    ]);
    // 16 real policy-table proofs. Storage deny-by-default is tracked apart.
    expect(REAL_SESSION_TESTED).toHaveLength(16);
    expect(POLICY_DECLARED_UNTESTED.length).toBeGreaterThan(40);
  });

  it("does not claim coverage from a bare table-name mention", () => {
    // Guard against the previous false-positive inventory: a name in a comment
    // must not satisfy a "covered" check. This suite only pins REAL_SESSION_TESTED
    // and the declared-untested list — never N_ALL.includes(table).
    expect(REAL_SESSION_TESTED).not.toContain("analytics_event_receipts");
  });

  it("does not apply migrations (files only) and leaves auth settings untouched", () => {
    expect(N_ALL).not.toContain("alter system");
    expect(N_ALL).not.toContain("auth.config");
    expect(N_ALL).not.toContain("leaked_password");
    expect(ALL).not.toMatch(/\btruncate\b|\bdrop table\b/i);
  });

  it("migration files are present under supabase/migrations", () => {
    const names = readdirSync(MIGRATIONS_DIR);
    for (const f of [
      "20260803200000_0065_rls_wave2_helpers.sql",
      "20260803201000_0066_rls_wave2_priority_policies.sql",
      "20260803202000_0067_rls_wave2_owner_policies.sql",
      "20260803203000_0068_rls_wave2_service_role_only.sql",
      "20260803204000_0069_rls_wave2_rpc_hardening.sql",
    ]) {
      expect(names).toContain(f);
    }
    expect(readdirSync(join(MIGRATIONS_DIR, "rollback"))).toContain(
      "20260803200000_rls_wave2_rollback.sql",
    );
  });
});

describe("post-0070 Wanteds policies (0093)", () => {
  // Migration 0070 moved RLS helpers into pubmax_private. New policy SQL
  // must qualify that schema; public.rls_owns_profile no longer exists.
  const WANTEDS = readMigration("20260808210000_0093_wanteds.sql");
  const N_WANTEDS = normalize(WANTEDS);

  it("qualifies rls_owns_profile via pubmax_private, never public", () => {
    expect(N_WANTEDS).toContain("pubmax_private.rls_owns_profile");
    expect(WANTEDS).not.toMatch(/public\.rls_owns_profile\b/);
    expect((WANTEDS.match(/pubmax_private\.rls_owns_profile/g) ?? []).length).toBe(5);
  });
});
