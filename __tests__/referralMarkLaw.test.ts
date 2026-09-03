// THE LAW: a referral milestone confers RECOGNITION and never a capability.
//
// This is `__tests__/foundingMembers.test.ts`'s law fence applied to the second
// status the product hands out, and it exists because referrals used to work
// the other way. Migration 0060 and `lib/referrals.ts` built a capability-grant
// model: milestones 1, 3 and 5 each named a pro feature, the ledger could
// record a `feature_granted` event, and one flag (`REFERRAL_GRANT_GATE`, plus
// the session variable `pubmaxx.referral_grants_enabled`) held it shut. Nothing
// failed while that model sat there switched off, which is exactly why a fence
// is owed: a mute button reads as a decision right up until somebody flips it.
//
// Captain decision 2026-08-10 deleted the model. These cases hold the deletion.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import * as referrals from "@/lib/referrals";
import { memoryReferralStore, __resetMemoryReferrals } from "@/lib/referralStore";

const ROOT = process.cwd();

/** The vocabulary of a grant. None of it may describe a referral any more. */
const GRANT_WORDS =
  /feature_granted|grantedFeatures|grantsEnabled|REFERRAL_GRANT_GATE|referralFeaturesGrantedBy|referralFeatureForMilestone|collaborative_night_credit|continuing_memories|post_trial_collaboration|referral_grants_enabled|ReferralEarnedReward/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if ([".ts", ".tsx"].includes(extname(path))) out.push(path);
  }
  return out;
}

describe("the referral policy module holds a status, not an entitlement", () => {
  it("exports no feature, grant, unlock or entitlement name", () => {
    const offenders = Object.keys(referrals).filter((name) =>
      /feature|grant|unlock|entitle|reward|perk|tier|bounty/i.test(name),
    );
    expect(offenders).toEqual([]);
  });

  it("exports the recognition set and nothing that decides what runs", () => {
    expect(Object.keys(referrals).sort()).toEqual([
      "REFERRAL_MILESTONES",
      "REFERRAL_RECOGNITION_NOTE",
      "REFERRAL_SIGNUP_PROOF_TTL_MS",
      "isReferralCode",
      "isReferralMilestone",
      "nextReferralMilestone",
      "parseReferralMilestone",
      "referralMark",
      "referralMarkDetail",
      "referralMarkForCount",
      "referralMilestoneReached",
      "referralSignupClaimFromUrl",
    ]);
  });

  it("carries none of the retired grant vocabulary in its source", () => {
    for (const file of ["lib/referrals.ts", "lib/referralStore.ts"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      // Strip comments: this file's own history is written down in them, and
      // the rule is about what the code does.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, file).not.toMatch(GRANT_WORDS);
    }
  });
});

describe("nothing in the product branches on referral status", () => {
  it("is imported by the referral lane alone, never by a feature surface", () => {
    const allowed = new Set([
      // The store, the routes that own the lane, the one card that prints the
      // mark, and the two pure helpers that read a signup fragment or a TTL.
      "lib/referralStore.ts",
      "lib/referralClaimClient.ts",
      "lib/referralSignupProof.server.ts",
      "app/api/referrals/status/route.ts",
      "app/api/referrals/invite-link/route.ts",
      "app/api/referrals/claim-attribution/route.ts",
      "app/api/profiles/[handle]/route.ts",
      "components/profile/PubmaxxAccountHub.tsx",
    ]);
    const importers: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const source = readFileSync(file, "utf8");
        if (!/from "@\/lib\/referrals(Store)?"/.test(source)) continue;
        const rel = relative(ROOT, file);
        if (rel === "lib/referrals.ts") continue;
        if (!allowed.has(rel)) importers.push(rel);
      }
    }
    // A new importer is not automatically wrong, but it is a decision: add it
    // here only after checking it PRINTS the status rather than branching on it.
    expect(importers).toEqual([]);
  });

  it("gives a five-referral account no field a caller could gate on", async () => {
    __resetMemoryReferrals();
    for (let index = 0; index < 5; index += 1) {
      await memoryReferralStore.recordEdge("inviter", `invitee-${index}`);
      await memoryReferralStore.qualify({
        inviteeUserId: `invitee-${index}`,
        contributionKind: "community_price",
        contributionId: `price-${index}`,
      });
    }
    const status = await memoryReferralStore.privateStatus("inviter");
    __resetMemoryReferrals();

    expect(Object.keys(status).sort()).toEqual([
      "attributedCount",
      "earned",
      "mark",
      "nextMilestone",
      "qualifiedCount",
    ]);
    // Every value is a count, a date or a sentence. Nothing is a boolean or a
    // key, which is the shape a capability check needs.
    expect(status.mark).toBe("Brought 5 mates in");
    expect(JSON.stringify(status)).not.toMatch(GRANT_WORDS);
    for (const row of status.earned) {
      expect(Object.keys(row).sort()).toEqual([
        "earnedAt",
        "event",
        "mark",
        "milestone",
        "permanent",
        "qualifiedCount",
      ]);
    }
  });
});

describe("the durable ledger records a mark, not an unlocked feature", () => {
  const MIGRATION = join(
    ROOT,
    "supabase/migrations/20260810160000_0101_referral_marks_not_features.sql",
  );
  const ROLLBACK = join(
    ROOT,
    "supabase/migrations/rollback/20260810160000_0101_referral_marks_not_features_rollback.sql",
  );

  it("drops the grant gate rather than leaving it switched off", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("drop trigger if exists referral_grant_insert_gate");
    expect(sql).toContain("drop function if exists public.referral_grant_insert_guard()");
    expect(sql).toContain("drop column if exists feature_key");
    expect(sql).toContain("drop column if exists grant_status");
    expect(sql).toContain("check (event_type = 'milestone_earned')");
    expect(sql).toContain("rename to referral_milestone_ledger");
    // The gate's own switch may not survive anywhere in the applied migration.
    expect(sql).not.toContain("current_setting('pubmaxx.referral_grants_enabled'");
  });

  it("does not name a plpgsql variable after the ledger column it conflicts with", () => {
    // 0060 declared `milestone integer` in the qualification RPC, which made
    // its own `on conflict (beneficiary_user_id, event_type, milestone)` raise
    // "column reference is ambiguous". Nothing caught it because no route calls
    // that seam, so the function had never run. Both SQL files here were proved
    // against PostgreSQL 16 before landing.
    for (const path of [MIGRATION, ROLLBACK]) {
      const sql = readFileSync(path, "utf8");
      expect(sql, path).not.toMatch(/^\s*milestone integer;/m);
      expect(sql, path).toContain("milestone_value integer;");
    }
  });

  it("restates the search path the referral RPCs need to reach digest()", () => {
    // create or replace drops any SET clause it does not carry, so a rewritten
    // function silently loses migration 0086's repair and answers 503 again.
    const sql = readFileSync(MIGRATION, "utf8");
    for (const fn of [
      "qualify_referral_from_contribution",
      "read_private_referral_status",
      "erase_referral_account",
    ]) {
      const body = sql.slice(
        sql.indexOf(`create or replace function public.${fn}`),
      );
      expect(body.slice(0, 400)).toContain(
        "set search_path = public, extensions, pg_temp",
      );
    }
  });

  it("has a rollback that restores the retired columns losslessly", () => {
    const sql = readFileSync(ROLLBACK, "utf8");
    expect(sql).toContain("rename to pro_feature_unlock_ledger");
    expect(sql).toContain("add column if not exists feature_key");
    expect(sql).toContain("add column if not exists grant_status");
    // The gate goes back CLOSED: a rollback may not be the thing that opens it.
    expect(sql).toContain("referral feature grants are disabled");
  });
});
