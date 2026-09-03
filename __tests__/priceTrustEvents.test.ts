import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { COMMUNITY_PRICE_MAX_AGE_MS } from "@/lib/communityPrice";
import {
  categoryIsTrusted,
  firstQualifyingCluster,
  profileIdFromActor,
  reversalFingerprint,
  trustEventFingerprint,
  type TrustObservation,
} from "@/lib/priceTrustEvents";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");

function observation(
  overrides: Partial<TrustObservation> & Pick<TrustObservation, "id" | "actor">,
): TrustObservation {
  return {
    venueId: "venue-one",
    drinkCategory: "beer",
    priceGbp: 4.2,
    submittedAt: NOW - 3_600_000,
    hidden: false,
    ...overrides,
  };
}

describe("firstQualifyingCluster", () => {
  it("credits every independent voice in the first threshold cluster", () => {
    const rows = [
      observation({ id: "obs-a", actor: "profile:aaa", submittedAt: NOW - 3_000 }),
      observation({ id: "obs-b", actor: "profile:bbb", submittedAt: NOW - 2_000 }),
      observation({ id: "obs-c", actor: "profile:ccc", submittedAt: NOW - 1_000 }),
    ];
    const cluster = firstQualifyingCluster(rows, NOW);
    expect(cluster).toEqual({
      observationIds: ["obs-a", "obs-b"],
      actors: ["profile:aaa", "profile:bbb"],
    });
  });

  it("does not form a cluster from one independent voice", () => {
    expect(
      firstQualifyingCluster(
        [observation({ id: "obs-a", actor: "profile:aaa" })],
        NOW,
      ),
    ).toBeNull();
  });

  it("ignores a later agreeing report when picking the first cluster", () => {
    const rows = [
      observation({ id: "obs-a", actor: "profile:aaa", submittedAt: NOW - 4_000 }),
      observation({ id: "obs-b", actor: "profile:bbb", submittedAt: NOW - 3_000 }),
      observation({
        id: "obs-late",
        actor: "profile:ccc",
        submittedAt: NOW - 100,
        priceGbp: 4.3,
      }),
    ];
    expect(firstQualifyingCluster(rows, NOW)?.observationIds).toEqual([
      "obs-a",
      "obs-b",
    ]);
  });

  it("does not let one actor count twice", () => {
    const rows = [
      observation({ id: "obs-a1", actor: "profile:aaa", submittedAt: NOW - 4_000 }),
      observation({ id: "obs-a2", actor: "profile:aaa", submittedAt: NOW - 2_000 }),
    ];
    expect(firstQualifyingCluster(rows, NOW)).toBeNull();
  });

  it("drops a hidden observation from the cluster", () => {
    const rows = [
      observation({ id: "obs-a", actor: "profile:aaa", submittedAt: NOW - 3_000 }),
      observation({
        id: "obs-b",
        actor: "profile:bbb",
        submittedAt: NOW - 2_000,
        hidden: true,
      }),
    ];
    expect(firstQualifyingCluster(rows, NOW)).toBeNull();
    expect(categoryIsTrusted(rows, NOW)).toBe(false);
  });

  it("refuses a pair that does not agree", () => {
    const rows = [
      observation({ id: "obs-a", actor: "profile:aaa", priceGbp: 4.2 }),
      observation({ id: "obs-b", actor: "profile:bbb", priceGbp: 9 }),
    ];
    expect(firstQualifyingCluster(rows, NOW)).toBeNull();
  });

  it("does not let an expired observation corroborate a current price", () => {
    const rows = [
      observation({
        id: "obs-expired",
        actor: "profile:aaa",
        submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
      }),
      observation({
        id: "obs-current",
        actor: "profile:bbb",
        submittedAt: NOW - 1_000,
      }),
    ];

    expect(firstQualifyingCluster(rows, NOW)).toBeNull();
    expect(categoryIsTrusted(rows, NOW)).toBe(false);
  });
});

describe("trustEventFingerprint", () => {
  it("is a stable hash of venue, category, and the sorted observation set", () => {
    const left = trustEventFingerprint("venue-one", "beer", [
      "obs-b",
      "obs-a",
    ]);
    const right = trustEventFingerprint("venue-one", "beer", [
      "obs-a",
      "obs-b",
    ]);
    const expected = createHash("sha256")
      .update("venue-one\u0000beer\u0000obs-a\u0000obs-b")
      .digest("hex");
    expect(left).toBe(right);
    expect(left).toBe(expected);
  });

  it("changes when the cluster, venue, or category changes", () => {
    const base = trustEventFingerprint("venue-one", "beer", ["obs-a", "obs-b"]);
    expect(trustEventFingerprint("venue-two", "beer", ["obs-a", "obs-b"])).not.toBe(
      base,
    );
    expect(trustEventFingerprint("venue-one", "wine", ["obs-a", "obs-b"])).not.toBe(
      base,
    );
    expect(trustEventFingerprint("venue-one", "beer", ["obs-a", "obs-c"])).not.toBe(
      base,
    );
  });
});

describe("reversalFingerprint", () => {
  it("is a deterministic derivative of the original fingerprint", () => {
    const original = trustEventFingerprint("venue-one", "beer", ["obs-a", "obs-b"]);
    const expected = createHash("sha256")
      .update(`reversal\u0000${original}`)
      .digest("hex");
    expect(reversalFingerprint(original)).toBe(expected);
    expect(reversalFingerprint(original)).not.toBe(original);
  });
});

describe("profileIdFromActor", () => {
  it("reads the profile id and refuses a handle-shaped actor", () => {
    expect(profileIdFromActor("profile:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(profileIdFromActor("night_owl")).toBeNull();
    expect(profileIdFromActor("a:night_owl")).toBeNull();
  });
});

describe("categoryIsTrusted", () => {
  it("uses the community-price predicates, not a second definition", () => {
    const live = [
      observation({ id: "obs-a", actor: "profile:aaa" }),
      observation({ id: "obs-b", actor: "profile:bbb" }),
    ];
    expect(categoryIsTrusted(live, NOW)).toBe(true);
    expect(
      categoryIsTrusted(
        live.map((row) => ({
          ...row,
          submittedAt: NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1,
        })),
        NOW,
      ),
    ).toBe(false);
    expect(COMMUNITY_PRICE_MAX_AGE_MS).toBeGreaterThan(0);
  });
});
