import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeNightSignalClaims,
  canAffectRoute,
  validateNightSignalClaim,
  validateNightSignalSnapshot,
} from "@/lib/nightSignalClaims";
// The scheduled importer is JavaScript by design; this test keeps its trust
// checks locked to the runtime validator.
// @ts-expect-error no declaration file for the scheduled ingestion script
import { approvedClaimsUnchanged, isValidNightSignalClaim, nightSignalBranchName } from "@/scripts/refresh_night_signal_claims.mjs";

const claim = {
  id: "opening:venue-1:20260716",
  kind: "opening",
  entity: { type: "venue", id: "venue-1" },
  claim: "Venue lists a later closing time for Friday.",
  sourceUrl: "https://venue.example/opening-hours",
  publisher: "Venue Example",
  publishedAt: "2026-07-15T09:00:00.000Z",
  observedAt: "2026-07-15T10:00:00.000Z",
  expiresAt: "2026-07-18T04:00:00.000Z",
  confidence: 0.9,
  reviewState: "approved",
  verification: "manual_review",
  routeEffect: "boost",
  corroboratingSources: [],
  reviewedAt: "2026-07-15T11:00:00.000Z",
  reviewAuthority: "operations",
};

describe("scheduled Night Signal claims", () => {
  it("skips timestamp-only refreshes and gives reruns distinct branch names", () => {
    expect(approvedClaimsUnchanged({ version: 1, generatedAt: "old", claims: [claim] }, [claim])).toBe(true);
    expect(approvedClaimsUnchanged({ version: 1, generatedAt: "old", claims: [] }, [claim])).toBe(false);
    const now = new Date("2026-07-16T12:00:00.000Z");
    expect(nightSignalBranchName(now, "123", "1")).toBe("night-signals/20260716-123-1");
    expect(nightSignalBranchName(now, "123", "2")).not.toBe(nightSignalBranchName(now, "123", "1"));
  });

  it("allows a pending database claim to be reviewed later without serving future reviews", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260716190000_0034_night_signal_claims.sql"), "utf8");
    expect(sql).not.toContain("reviewed_at <= created_at");
    expect(sql).toContain("reviewed_at <= now()");
  });
  it("validates complete provenance and admits reviewed active evidence", () => {
    const safe = validateNightSignalClaim(claim);
    expect(safe).not.toBeNull();
    expect(safe).toMatchObject({ reviewAuthority: "operations" });
    expect(safe).not.toHaveProperty("reviewedBy");
    expect(canAffectRoute(safe!)).toBe(true);
    expect(activeNightSignalClaims({ version: 1, generatedAt: "2026-07-15T12:00:00Z", claims: [claim] }, Date.parse("2026-07-16T20:00:00Z"))).toHaveLength(1);
  });

  it("never lets unknown, expired, rejected, or single-source claims change a route", () => {
    const single = validateNightSignalClaim({ ...claim, verification: "single_source", routeEffect: "none" })!;
    expect(canAffectRoute(single)).toBe(false);
    expect(validateNightSignalClaim({ ...claim, verification: "single_source", routeEffect: "boost" })).toBeNull();
    expect(activeNightSignalClaims({ version: 1, generatedAt: "2026-07-15T12:00:00Z", claims: [{ ...claim, reviewState: "pending", reviewedAt: null, reviewAuthority: null }] }, Date.parse("2026-07-16T20:00:00Z"))).toEqual([]);
    expect(activeNightSignalClaims({ version: 1, generatedAt: "2026-07-15T12:00:00Z", claims: [claim] }, Date.parse("2026-07-19T20:00:00Z"))).toEqual([]);
  });

  it("rejects incomplete attribution and fake corroboration", () => {
    expect(validateNightSignalClaim({ ...claim, sourceUrl: "query: opening hours" })).toBeNull();
    expect(validateNightSignalClaim({ ...claim, verification: "corroborated", corroboratingSources: [] })).toBeNull();
    const copiedPrimary = { sourceUrl: claim.sourceUrl, publisher: claim.publisher, publishedAt: claim.publishedAt };
    const fake = { ...claim, verification: "corroborated", corroboratingSources: [copiedPrimary] };
    expect(validateNightSignalClaim(fake)).toBeNull();
    expect(isValidNightSignalClaim(fake)).toBe(false);
    const samePublisherHost = { sourceUrl: "https://venue.example/other-page", publisher: "Renamed Publisher", publishedAt: claim.publishedAt };
    expect(validateNightSignalClaim({ ...claim, verification: "corroborated", corroboratingSources: [samePublisherHost] })).toBeNull();
    expect(validateNightSignalSnapshot({ version: 1, generatedAt: "bad", claims: [] })).toBeNull();
  });

  it("keeps secrets and personal reviewer identifiers out of public provenance", () => {
    expect(validateNightSignalClaim({ ...claim, sourceUrl: "https://user:pass@venue.example/hours" })).toBeNull();
    expect(validateNightSignalClaim({ ...claim, sourceUrl: "https://venue.example/hours?access_token=secret" })).toBeNull();
    expect(validateNightSignalClaim({ ...claim, sourceUrl: "https://venue.example/hours?X-Amz-Signature=secret" })).toBeNull();
    expect(validateNightSignalClaim({ ...claim, sourceUrl: "https://venue.example/hours#access_token=secret" })).toBeNull();
    expect(validateNightSignalClaim({ ...claim, reviewAuthority: "person-name" })).toBeNull();
    expect(isValidNightSignalClaim({ ...claim, sourceUrl: "https://venue.example/hours?api_key=secret" })).toBe(false);
  });

  it("does not let automated review masquerade as manual route authority", () => {
    const automated = { ...claim, reviewAuthority: "automated" as const };
    expect(validateNightSignalClaim(automated)).toBeNull();
    expect(isValidNightSignalClaim(automated)).toBe(false);
    expect(validateNightSignalClaim({ ...automated, routeEffect: "none" })).not.toBeNull();
    expect(canAffectRoute({ ...claim, reviewAuthority: "automated" } as never)).toBe(false);
    expect(canAffectRoute({ ...claim, reviewAuthority: null } as never)).toBe(false);
    expect(canAffectRoute({ ...claim, reviewAuthority: "editorial" } as never)).toBe(true);
  });

  it("rejects non-independent supplemental provenance in every review mode", () => {
    const sameSource = { sourceUrl: "https://venue.example/other-page", publisher: "Venue Example", publishedAt: claim.publishedAt };
    const manual = { ...claim, corroboratingSources: [sameSource] };
    expect(validateNightSignalClaim(manual)).toBeNull();
    expect(isValidNightSignalClaim(manual)).toBe(false);
  });

  it("rejects impossible future provenance and review ordering", () => {
    expect(validateNightSignalClaim({ ...claim, publishedAt: "2026-07-15T10:30:00.000Z" })).toBeNull();
    expect(validateNightSignalClaim({ ...claim, reviewedAt: "2026-07-15T09:30:00.000Z" })).toBeNull();
    expect(validateNightSignalSnapshot({
      version: 1,
      generatedAt: "2026-07-15T10:30:00.000Z",
      claims: [claim],
    })).toBeNull();
    expect(isValidNightSignalClaim({ ...claim, reviewedAt: "2999-07-15T11:00:00.000Z" })).toBe(false);
  });
});
