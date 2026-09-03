import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REFERRAL_MILESTONES,
  REFERRAL_SIGNUP_PROOF_TTL_MS,
  referralSignupClaimFromUrl,
  nextReferralMilestone,
  parseReferralMilestone,
  referralMark,
  referralMarkDetail,
  referralMarkForCount,
  referralMilestoneReached,
} from "@/lib/referrals";

describe("referral milestone policy", () => {
  it("recognises 1, 3 and 5 qualified referrals, ascending", () => {
    expect(REFERRAL_MILESTONES).toEqual([1, 3, 5]);
    expect(REFERRAL_MILESTONES.map(referralMark)).toEqual([
      "Brought a mate in",
      "Brought 3 mates in",
      "Brought 5 mates in",
    ]);
  });

  it("reads an untrusted milestone or nothing, and never guesses", () => {
    expect(parseReferralMilestone(3)).toBe(3);
    expect(parseReferralMilestone("5")).toBe(5);
    expect(parseReferralMilestone(2)).toBeNull();
    expect(parseReferralMilestone(0)).toBeNull();
    expect(parseReferralMilestone(1.5)).toBeNull();
    expect(parseReferralMilestone(null)).toBeNull();
    expect(referralMark(2)).toBeNull();
    expect(referralMarkDetail(2)).toBeNull();
  });

  it("marks the highest milestone a count has reached and points at the next", () => {
    expect(referralMilestoneReached(0)).toBeNull();
    expect(referralMilestoneReached(2)).toBe(1);
    expect(referralMilestoneReached(9)).toBe(5);
    expect(referralMarkForCount(0)).toBeNull();
    expect(referralMarkForCount(4)).toBe("Brought 3 mates in");
    expect(nextReferralMilestone(0)).toBe(1);
    expect(nextReferralMilestone(3)).toBe(5);
    expect(nextReferralMilestone(5)).toBeNull();
  });

  it("says what the mark is not, in the founding-mark words", () => {
    for (const milestone of REFERRAL_MILESTONES) {
      expect(referralMarkDetail(milestone)).toContain(
        "Nothing is gated behind it.",
      );
    }
  });

  it("carries a valid referral fragment through the sign-up journey", () => {
    expect(
      referralSignupClaimFromUrl(
        "https://pubmaxxing.com/?city=london#referral=opaque_code_123456789&section=prices",
      ),
    ).toEqual({
      code: "opaque_code_123456789",
      cleanUrl: "/?city=london#section=prices",
    });
    expect(referralSignupClaimFromUrl("https://pubmaxxing.com/#section")).toBeNull();
    expect(
      referralSignupClaimFromUrl("https://pubmaxxing.com/#referral=short"),
    ).toEqual({ code: null, cleanUrl: "/" });
    expect(REFERRAL_SIGNUP_PROOF_TTL_MS).toBe(60 * 60 * 1_000);
  });

  it("serializes qualification before inserting and counting", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260728143000_0060_referrals.sql",
      ),
      "utf8",
    );
    const qualification = migration.slice(
      migration.indexOf(
        "create or replace function public.qualify_referral_from_contribution",
      ),
      migration.indexOf(
        "create or replace function public.read_private_referral_status",
      ),
    );
    expect(qualification.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(-1);
    expect(qualification.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      qualification.indexOf(
        "insert into public.referral_qualification_events",
      ),
    );
  });

  it("keeps attribution inside the deliberate auth callback", () => {
    const authProvider = readFileSync(
      join(process.cwd(), "components/auth/AuthProvider.tsx"),
      "utf8",
    );
    const identitySync = authProvider.slice(
      authProvider.indexOf("const syncIdentityAfterSignIn"),
      authProvider.indexOf("const onClaimConfirm"),
    );
    const callbackSuccess = authProvider.slice(
      authProvider.indexOf("if (exchangedSession)"),
      authProvider.indexOf("try {", authProvider.indexOf("if (exchangedSession)") + 1),
    );
    const landing = readFileSync(
      join(process.cwd(), "components/landing/LandingPage.tsx"),
      "utf8",
    );
    const analytics = readFileSync(
      join(process.cwd(), "lib/analytics.ts"),
      "utf8",
    );
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260728143000_0060_referrals.sql",
      ),
      "utf8",
    );

    expect(identitySync).not.toContain("claim-attribution");
    expect(callbackSuccess).toContain(
      "claimSignupReferralFromAuthCallback",
    );
    expect(landing).not.toContain("referralCaptureDecision");
    expect(analytics).not.toContain("claim-attribution");
    expect(migration).toContain("claim_referral_code");
    expect(migration).toContain("from auth.users");
    expect(migration).toContain(
      "invitee_created_at < p_auth_attempt_started_at",
    );
    expect(migration).not.toContain("referral_attribution_journeys");
    expect(
      existsSync(join(process.cwd(), "lib/referralAttributionCookie.ts")),
    ).toBe(false);
  });
});
