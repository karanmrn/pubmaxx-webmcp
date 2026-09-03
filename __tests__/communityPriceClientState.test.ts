import { describe, expect, it } from "vitest";

import {
  planProvisionalBaseVenueRead,
  provisionalBaseBackoffMs,
  PROVISIONAL_BASE_BACKOFF_MS,
  readCategoryPriceIndexLoad,
  readCommunityPriceAttribution,
  readProvisionalVenueIdsLoad,
  rejectedCommunitySubmission,
  readVenueSignalLoad,
  readVenuePriceLoad,
  rollbackOptimisticPrice,
  rollbackOptimisticVenueSignal,
} from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { CommunityVenueSignal } from "@/lib/communityVenueSignals";

const storedBeer: CommunityPrice = {
  venueId: "venue-uk-n123",
  drinkCategory: "beer",
  priceGbp: 4.6,
  submittedAt: 2_000,
  source: "community",
  corroborations: 1,
};

const optimisticBeer: CommunityPrice = {
  venueId: "venue-uk-n123",
  drinkCategory: "beer",
  priceGbp: 5.2,
  submittedAt: 3_000,
  source: "community",
  corroborations: 1,
};

// The durable limiter records a hit even when it refuses one, so a client that
// cannot tell 429 from a dropped connection retries into its own lockout and
// never gets a base mark again for the rest of the session.
describe("provisionalBaseBackoffMs", () => {
  it("keeps a transient failure retryable and only stands down on a refusal", () => {
    expect(provisionalBaseBackoffMs(200, null)).toBeNull();
    expect(provisionalBaseBackoffMs(500, null)).toBeNull();
    expect(provisionalBaseBackoffMs(503, "30")).toBeNull();
    expect(provisionalBaseBackoffMs(429, null)).toBe(PROVISIONAL_BASE_BACKOFF_MS);
  });

  it("respects Retry-After as seconds or as a date", () => {
    const now = Date.UTC(2026, 6, 28, 21, 0, 0);
    expect(provisionalBaseBackoffMs(429, "30", now)).toBe(30_000);
    expect(
      provisionalBaseBackoffMs(429, new Date(now + 45_000).toUTCString(), now),
    ).toBe(45_000);
  });

  it("bounds a header it cannot use, in both directions", () => {
    const now = Date.UTC(2026, 6, 28, 21, 0, 0);
    // Never busy-retry: a zero or past deadline still costs a real pause.
    expect(provisionalBaseBackoffMs(429, "0", now)).toBe(1_000);
    expect(
      provisionalBaseBackoffMs(429, new Date(now - 60_000).toUTCString(), now),
    ).toBe(1_000);
    // …and never mute the layer for the session on one server's say-so.
    expect(provisionalBaseBackoffMs(429, "99999", now)).toBe(300_000);
    // Unparseable falls back to the window we know the server runs.
    expect(provisionalBaseBackoffMs(429, "soon", now)).toBe(
      PROVISIONAL_BASE_BACKOFF_MS,
    );
    expect(provisionalBaseBackoffMs(429, "  ", now)).toBe(
      PROVISIONAL_BASE_BACKOFF_MS,
    );
  });
});

describe("community price client state", () => {
  it("preserves write-time authentication expiry for the contribution gate", () => {
    expect(
      rejectedCommunitySubmission(401, "Sign in.", "Could not log."),
    ).toEqual({
      ok: false,
      error: "Sign in.",
      reason: "rejected",
      status: "sign_in_required",
    });
    expect(
      rejectedCommunitySubmission(503, undefined, "Could not log."),
    ).toEqual({
      ok: false,
      error: "Could not log.",
      reason: "rejected",
    });
    expect(
      rejectedCommunitySubmission(
        409,
        "Finish setup.",
        "Could not log.",
        "onboarding_required",
      ),
    ).toEqual({
      ok: false,
      error: "Finish setup.",
      reason: "rejected",
      status: "onboarding_required",
    });
    expect(
      rejectedCommunitySubmission(
        403,
        "Rejected.",
        "Could not log.",
        "age_restricted",
      ),
    ).toEqual({
      ok: false,
      error: "Rejected.",
      reason: "rejected",
    });
  });

  it("trusts only a server-confirmed contributor attribution", () => {
    expect(
      readCommunityPriceAttribution({
        status: "credited",
        handle: "@Night_Owl",
      }),
    ).toEqual({ status: "credited", handle: "night_owl" });
    expect(
      readCommunityPriceAttribution({
        status: "credited",
        handle: "",
      }),
    ).toEqual({ status: "anonymous" });
    expect(readCommunityPriceAttribution(null)).toEqual({
      status: "anonymous",
    });
  });

  it("reads only newly visible stable base ids", () => {
    expect(
      planProvisionalBaseVenueRead(
        [
          "venue-uk-w2",
          "venue-curated",
          "venue-uk-n1",
          "venue-uk-w2",
          "venue-uk-n3",
        ],
        new Set(["venue-uk-n1", "venue-uk-n3"]),
      ),
    ).toEqual({
      visible: ["venue-uk-n1", "venue-uk-n3", "venue-uk-w2"],
      unread: ["venue-uk-w2"],
    });
  });

  it("accepts only stable base ids from a provisional viewport response", () => {
    expect(
      readProvisionalVenueIdsLoad({
        venueIds: [
          "venue-uk-n123",
          "venue-curated",
          "",
          "venue-uk-n456",
          "venue-uk-n999",
        ],
      },
        new Set(["venue-uk-n123", "venue-uk-n456"]),
      ),
    ).toEqual({
      status: "ready",
      venueIds: ["venue-uk-n123", "venue-uk-n456"],
    });
    expect(
      readProvisionalVenueIdsLoad(
        {
          venueIds: [],
          degraded: true,
        },
        new Set(),
      ),
    ).toEqual({ status: "degraded", venueIds: [] });
    expect(readProvisionalVenueIdsLoad({ venueIds: "bad" }, new Set())).toEqual({
      status: "invalid",
      venueIds: [],
    });
  });

  it("distinguishes an honest empty lens index from a degraded one", () => {
    expect(readCategoryPriceIndexLoad({ prices: [], truncated: false })).toEqual({
      status: "ready",
      prices: [],
      truncated: false,
    });
    expect(
      readCategoryPriceIndexLoad({
        prices: [],
        truncated: false,
        degraded: true,
      }),
    ).toEqual({
      status: "degraded",
      prices: [],
      truncated: false,
    });
    expect(readCategoryPriceIndexLoad({ prices: "bad" })).toEqual({
      status: "invalid",
      prices: [],
      truncated: false,
    });
  });
  it("keeps a degraded empty read unknown instead of confirming no price", () => {
    expect(readVenuePriceLoad({ prices: [], degraded: true })).toEqual({
      status: "degraded",
      prices: [],
    });
    expect(readVenuePriceLoad({ prices: [] })).toEqual({
      status: "ready",
      prices: [],
    });
  });

  it("rolls back only its optimistic row after a concurrent read", () => {
    const storedWine: CommunityPrice = {
      venueId: "venue-uk-n123",
      drinkCategory: "wine",
      priceGbp: 8.5,
      submittedAt: 2_500,
      source: "community",
      corroborations: 1,
    };

    expect(
      rollbackOptimisticPrice(
        [optimisticBeer, storedWine],
        optimisticBeer,
        [storedBeer, storedWine],
        true,
      ),
    ).toEqual([storedWine, storedBeer]);
  });
});

describe("community venue signal client state", () => {
  const stored: CommunityVenueSignal = {
    venueId: "venue-xjf3n0",
    signalKey: "step-free-venue",
    signalValue: "steps",
    submittedAt: 2_000,
    source: "community",
    corroborations: 1,
    establishedCandidate: {
      signalValue: "step-free",
      submittedAt: 1_000,
      corroborations: 2,
    },
  };

  const optimistic: CommunityVenueSignal = {
    venueId: "venue-xjf3n0",
    signalKey: "step-free-venue",
    signalValue: "step-free",
    submittedAt: 3_000,
    source: "community",
    corroborations: 1,
  };

  it("narrows a combined venue response without trusting malformed signal rows", () => {
    expect(
      readVenueSignalLoad({
        signals: [
          stored,
          {
            ...stored,
            signalKey: "music",
            signalValue: "loud",
          },
        ],
      }),
    ).toEqual({
      status: "ready",
      signals: [stored],
    });
  });

  it("distinguishes an honest empty signal read from a failed read", () => {
    expect(readVenueSignalLoad({ signals: [] })).toEqual({
      status: "ready",
      signals: [],
    });
    expect(
      readVenueSignalLoad({ signals: [], degraded: true }),
    ).toEqual({
      status: "degraded",
      signals: [],
    });
    // A payload with no `signals` key is an older deployment answering about
    // prices alone, not an unreadable one: calling it invalid dropped that
    // venue's perfectly good prices for the whole session.
    expect(readVenueSignalLoad({ prices: [] })).toEqual({
      status: "ready",
      signals: [],
    });
    expect(readVenueSignalLoad({ signals: "soon" })).toEqual({
      status: "invalid",
      signals: [],
    });
    expect(readVenueSignalLoad({ signals: [{ signalKey: "music" }] })).toEqual({
      status: "invalid",
      signals: [],
    });
  });

  it("keeps the observation id a reader can flag", () => {
    expect(
      readVenueSignalLoad({ signals: [{ ...stored, id: "obs-1" }] }),
    ).toEqual({
      status: "ready",
      signals: [{ ...stored, id: "obs-1" }],
    });
  });

  it("rolls back only the optimistic answer after a rejected write", () => {
    expect(
      rollbackOptimisticVenueSignal(
        [optimistic],
        optimistic,
        [stored],
        true,
      ),
    ).toEqual([stored]);
  });
});
