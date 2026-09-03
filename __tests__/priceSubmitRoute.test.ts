import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Two Vercel-vs-local seams to pin (both would otherwise pass locally and fail
// on Vercel - the classic green-local/red-Vercel trap):
//
// 1. lib/pintDrops (imported for isLimited) pulls @/lib/supabase → node:crypto
//    and the durable rate limiter. On Vercel, SUPABASE_URL/SERVICE_ROLE_KEY are
//    preset, so the limiter would try a live table and the store would flip to
//    the durable backend mid-suite. Pin isSupabaseConfigured() false so both
//    stay on their process-memory paths; hashIp/clientIp/hashActor pass through
//    via ...actual, exactly as the sibling write-route tests do.
// 2. The rate limiter is shared and in-process. Reset it before every case so
//    the actor-wide and per-venue budgets stay deterministic.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
    verifyCallerAuth: async () =>
      authState.userId
        ? {
            status: "verified" as const,
            identity: {
              id: authState.userId,
              email: null,
              createdAt: null,
            },
          }
        : { status: "absent" as const },
  };
});

// Lets one case simulate the requested city pack failing to load; every other
// case passes through to the real city-scoped canonical lookup on disk.
const venueIndexState = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  return {
    ...actual,
    lookupCanonicalVenue: async (id: string) => {
      const canonicalId = id === "legacy-price-pub" ? "venue-xjf3n0" : id;
      return venueIndexState.unavailable
        ? { status: "unavailable" as const, canonicalId }
        : actual.lookupCanonicalVenue(canonicalId);
    },
  };
});

// Same seam for the UK base index: an unavailable result must produce a
// retryable 503 for a base id it cannot validate.
const ukBaseIndexState = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/ukBaseIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukBaseIndex")>();
  return {
    ...actual,
    getUkBaseIdIndex: async () =>
      ukBaseIndexState.unavailable
        ? { status: "unavailable" as const }
        : actual.getUkBaseIdIndex(),
  };
});

// Lets the read-back race cases pin what the POST fallback answers when the
// read-back no longer holds the submitter's own figure. The race itself (a
// rival contributor's write landing between this write and the read-back) cannot be
// produced deterministically through the real store from a sequential test, so
// the override stands in for the read-back's result; every other case passes
// through untouched.
const readBackState = vi.hoisted(() => ({
  override: null as import("@/lib/communityPrice").CommunityPrice[] | null,
  statusOverride: null as {
    prices: import("@/lib/communityPrice").CommunityPrice[];
    degraded: boolean;
  } | null,
}));
const oneTapState = vi.hoisted(() => ({
  forcedOutcome: undefined as
    | import("@/lib/oneTapPintDrop.server").OneTapPintDropOutcome
    | undefined,
  beforeOutcome: null as (() => Promise<void>) | null,
}));
const trustSyncState = vi.hoisted(() => ({
  override: null as { status: "synced" | "unavailable" } | null,
  calls: 0,
}));
vi.mock("@/lib/oneTapPintDrop.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/oneTapPintDrop.server")>();
  return {
    ...actual,
    writeOneTapPintDrop: async (
      input: Parameters<typeof actual.writeOneTapPintDrop>[0],
      photos?: Parameters<typeof actual.writeOneTapPintDrop>[1],
    ) => {
      if (oneTapState.forcedOutcome !== undefined) {
        await oneTapState.beforeOutcome?.();
        return oneTapState.forcedOutcome;
      }
      return actual.writeOneTapPintDrop(input, photos);
    },
  };
});
vi.mock("@/lib/priceTrustImpact.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/priceTrustImpact.server")>();
  return {
    ...actual,
    syncTrustAfterPriceWrite: async (
      ...args: Parameters<typeof actual.syncTrustAfterPriceWrite>
    ) => {
      trustSyncState.calls += 1;
      return trustSyncState.override ?? actual.syncTrustAfterPriceWrite(...args);
    },
  };
});
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return {
    ...actual,
    moderateCommunityPrice: vi.fn(actual.moderateCommunityPrice),
    readCommunityPrices: async (venueId: string, now?: number) =>
      readBackState.override ?? actual.readCommunityPrices(venueId, now),
    readCommunityPricesWithStatus: async (venueId: string, now?: number) =>
      readBackState.statusOverride ?? {
        prices: await actual.readCommunityPrices(venueId, now),
        degraded: false,
      },
  };
});

import { GET, POST } from "@/app/api/price-submit/route";
import {
  __resetCommunityPrices,
  memoryCommunityPriceStore,
  moderateCommunityPrice,
  readCommunityPrices,
} from "@/lib/communityPriceStore";
import {
  __resetMemoryPriceTrustEvents,
  priceTrustEventStore,
} from "@/lib/priceTrustEventStore";
import {
  readPriceTrustImpact,
  syncTrustAfterPriceWrite,
} from "@/lib/priceTrustImpact.server";
import { COMMUNITY_PRICE_MAX_GBP, submitCategoryLabel } from "@/lib/communityPrice";
import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import { __resetPintDrops, listVisiblePintDrops } from "@/lib/pintDrops";
import {
  __resetMemoryProfiles,
  memoryProfileStore,
} from "@/lib/profileStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { getUkBaseIdIndex } from "@/lib/ukBaseIndex";
import {
  MAX_PROVISIONAL_BASE_VENUE_IDS,
  UK_BASE_ID_PREFIX,
} from "@/lib/ukBasePubs";
import { getVenueIndex } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";

type PriceBody = {
  ok?: boolean;
  error?: string;
  trustReconciliation?: "synced" | "pending";
  attribution?: { status: "credited"; handle: string } | { status: "anonymous" };
  price?: {
    priceGbp: number;
    drinkCategory: string;
    source: string;
    submittedAt: number;
    corroborations?: number;
    mapCandidate?: { priceGbp: number; submittedAt: number; corroborations: number };
  };
  signal?: {
    venueId: string;
    signalKey: string;
    signalValue: string;
    source: string;
    submittedAt: number;
    corroborations?: number;
    establishedCandidate?: {
      signalValue: string;
      submittedAt: number;
      corroborations: number;
    };
  };
  signals?: Array<{
    id?: string;
    venueId: string;
    signalKey: string;
    signalValue: string;
    source: string;
    submittedAt: number;
    corroborations?: number;
  }>;
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/price-submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(query: string): Request {
  return new Request(`http://localhost/api/price-submit${query}`);
}

async function authorizeContributor(
  userId: string,
  handle: string,
  dateOfBirth = "1990-01-01",
): Promise<void> {
  authState.userId = userId;
  const onboarding = await memoryPrivateIdentityStore.completeOnboarding({
    userId,
    handle,
    dateOfBirth,
  });
  expect(onboarding).toMatchObject({ ok: true });
}

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeEach(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  venueIndexState.unavailable = false;
  ukBaseIndexState.unavailable = false;
  readBackState.override = null;
  readBackState.statusOverride = null;
  oneTapState.forcedOutcome = undefined;
  oneTapState.beforeOutcome = null;
  trustSyncState.override = null;
  trustSyncState.calls = 0;
  authState.userId = null;
  __resetCommunityPrices();
  __resetMemoryPriceTrustEvents();
  __resetMemoryIdentityHandles();
  __resetMemoryProfiles();
  __resetMemoryPrivateIdentities();
  __resetPintDrops();
  await authorizeContributor("user-default", "default_contributor");
  const actualCommunityPriceStore =
    await vi.importActual<typeof import("@/lib/communityPriceStore")>(
      "@/lib/communityPriceStore",
    );
  vi.mocked(moderateCommunityPrice).mockReset();
  vi.mocked(moderateCommunityPrice).mockImplementation(
    actualCommunityPriceStore.moderateCommunityPrice,
  );
});

afterEach(async () => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  }
});

describe("POST /api/price-submit", () => {
  it("records an account-bound submission (201) stamped community", async () => {
    const res = await POST(
      post({ venueId: "venue-xjf3n0", drinkCategory: "beer", priceGbp: 4.2 }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as PriceBody;
    expect(data.ok).toBe(true);
    expect(data.trustReconciliation).toBe("synced");
    expect(data.price?.priceGbp).toBe(4.2);
    expect(data.price?.source).toBe("community");
    expect(typeof data.price?.submittedAt).toBe("number");
    expect(data.attribution).toEqual({
      status: "credited",
      handle: "default_contributor",
    });
    expect(
      (await memoryCommunityPriceStore.listLeaderboardContributions()).records,
    ).toMatchObject([
      {
        handle: "default_contributor",
        lane: "price",
        visible: true,
      },
    ]);
    const drops = listVisiblePintDrops("venue-xjf3n0");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      venueId: "venue-xjf3n0",
      handle: "default_contributor",
      priceGbp: 4.2,
      drink: submitCategoryLabel("beer"),
      authorityKey: pintDropAuthorityKey("venue-xjf3n0", authState.userId),
    });
  });

  it("keeps an accepted price at 201 while trust reconciliation is pending", async () => {
    trustSyncState.override = { status: "unavailable" };

    const res = await POST(
      post({ venueId: "venue-xjf3n0", drinkCategory: "beer", priceGbp: 4.2 }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      ok: true,
      trustReconciliation: "pending",
      price: {
        venueId: "venue-xjf3n0",
        drinkCategory: "beer",
        priceGbp: 4.2,
      },
    });
    expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(1);
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(1);
  });

  it("pairs a second same-day price with its own Pint Drop", async () => {
    const venueId = "venue-xjf3n0";
    const first = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(first.status).toBe(201);
    expect(listVisiblePintDrops(venueId)).toHaveLength(1);

    const second = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.5 }));
    expect(second.status).toBe(201);
    expect((await second.json() as PriceBody).price?.priceGbp).toBe(4.5);
    expect(listVisiblePintDrops(venueId)).toHaveLength(2);
    expect(await readCommunityPrices(venueId)).toMatchObject([{ priceGbp: 4.5 }]);
  });

  it("hides the community price when the paired visit report write fails", async () => {
    oneTapState.forcedOutcome = {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };
    const venueId = "venue-xjf3n0";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(503);
    expect(await readCommunityPrices(venueId)).toEqual([]);
    expect(listVisiblePintDrops(venueId)).toHaveLength(0);
  });

  it("reverses trust that lands before a failed Pint Drop pairing rolls its price back", async () => {
    const venueId = "venue-xjf3n0";
    expect(
      (await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }))).status,
    ).toBe(201);
    await authorizeContributor("user-second", "second_contributor");
    oneTapState.beforeOutcome = async () => {
      expect(await syncTrustAfterPriceWrite(venueId, "beer")).toEqual({
        status: "synced",
      });
      expect((await priceTrustEventStore().liveEventsFor(venueId, "beer")).events).toHaveLength(1);
    };
    oneTapState.forcedOutcome = {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };

    const response = await POST(
      post({ venueId, drinkCategory: "beer", priceGbp: 4.3 }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
    expect(await readCommunityPrices(venueId)).toMatchObject([{ priceGbp: 4.2 }]);
    expect((await priceTrustEventStore().liveEventsFor(venueId, "beer")).events).toEqual([]);
    expect((await priceTrustEventStore().listPendingReconciliations(20)).tasks).toEqual([]);
    expect(await readPriceTrustImpact("user-default")).toMatchObject({
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact("user-second")).toMatchObject({
      lifetimeTrustUnlocks: 0,
    });
  });

  it("keeps failed hidden-state trust cleanup queued and reports pairing repair required", async () => {
    const venueId = "venue-xjf3n0";
    expect(
      (await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }))).status,
    ).toBe(201);
    await authorizeContributor("user-second", "second_contributor");
    const store = priceTrustEventStore();
    oneTapState.beforeOutcome = async () => {
      expect(await syncTrustAfterPriceWrite(venueId, "beer")).toEqual({
        status: "synced",
      });
      vi.spyOn(store, "ackReconciliation").mockResolvedValue({
        acknowledged: false,
        failed: true,
      });
    };
    oneTapState.forcedOutcome = {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };

    const response = await POST(
      post({ venueId, drinkCategory: "beer", priceGbp: 4.3 }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "PAIRING_REPAIR_REQUIRED",
      retryable: true,
    });
    expect(await readCommunityPrices(venueId)).toMatchObject([{ priceGbp: 4.2 }]);
    expect((await store.liveEventsFor(venueId, "beer")).events).toEqual([]);
    expect((await store.listPendingReconciliations(20)).tasks).toHaveLength(1);
    expect(await readPriceTrustImpact("user-default")).toMatchObject({
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact("user-second")).toMatchObject({
      lifetimeTrustUnlocks: 0,
    });
  });

  it("never reports success when the price and Pint Drop split", async () => {
    oneTapState.forcedOutcome = {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };
    vi.mocked(moderateCommunityPrice).mockResolvedValue(false);
    const venueId = "venue-xjf3n0";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: "PAIRING_REPAIR_REQUIRED",
      retryable: true,
    });
    expect(await readCommunityPrices(venueId)).toHaveLength(1);
    expect(listVisiblePintDrops(venueId)).toHaveLength(0);
  });

  it("ignores a client-asserted handle and credits the authenticated account", async () => {
    const res = await POST(
      post({
        venueId: "venue-xjf3n0",
        drinkCategory: "beer",
        priceGbp: 4.2,
        contributorHandle: "@Night_Owl",
      }),
    );

    expect(res.status).toBe(201);
    expect((await res.json() as PriceBody).attribution).toEqual({
      status: "credited",
      handle: "default_contributor",
    });
    expect(await memoryProfileStore.getByHandle("night_owl")).toBeNull();
    expect(
      (await memoryCommunityPriceStore.listLeaderboardContributions()).records,
    ).toMatchObject([{ handle: "default_contributor" }]);
  });

  it("credits a renamed handle through its immutable owned identity", async () => {
    await authorizeContributor("user-night-owl", "night_owl");
    expect(
      await memoryIdentityHandleStore.rename("user-night-owl", "dawn_owl"),
    ).toMatchObject({
      ok: true,
      previousHandle: "night_owl",
      handle: "dawn_owl",
    });

    const res = await POST(
      post({
        venueId: "venue-xjf3n0",
        drinkCategory: "beer",
        priceGbp: 4.2,
        contributorHandle: "night_owl",
      }),
    );

    expect(res.status).toBe(201);
    expect((await res.json() as PriceBody).attribution).toEqual({
      status: "credited",
      handle: "dawn_owl",
    });
    const read =
      await memoryCommunityPriceStore.listLeaderboardContributions();
    expect(read).toMatchObject({
      status: "ready",
      records: [
        {
          handle: "dawn_owl",
          lane: "price",
          visible: true,
        },
      ],
    });
    expect(JSON.stringify(read)).not.toContain("actor");
  });

  it("requires sign-in before storing a contribution", async () => {
    authState.userId = null;

    const res = await POST(
      post({
        venueId: "venue-xjf3n0",
        drinkCategory: "beer",
        priceGbp: 4.2,
        contributorHandle: "night_owl",
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      status: "sign_in_required",
      error: "Sign in to contribute.",
    });
    expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(0);
    expect(
      (await memoryCommunityPriceStore.listLeaderboardContributions()).records,
    ).toEqual([]);
  });

  it("requires completed onboarding but allows contributions at any age", async () => {
    authState.userId = "user-not-onboarded";
    let res = await POST(
      post({ venueId: "venue-xjf3n0", drinkCategory: "beer", priceGbp: 4.2 }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ status: "onboarding_required" });

    await authorizeContributor("user-young", "young_person", "2015-02-03");
    res = await POST(
      post({ venueId: "venue-xjf3n0", drinkCategory: "beer", priceGbp: 4.2 }),
    );
    expect(res.status).toBe(201);
    res = await POST(
      post({
        kind: "venue-signal",
        venueId: "venue-xjf3n0",
        signalKey: "character",
        signalValue: "rough",
      }),
    );
    expect(res.status).toBe(201);
    expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(1);
  });

  it("refuses a contribution when account identity lookup fails", async () => {
    vi.spyOn(memoryProfileStore, "getByUserId").mockRejectedValueOnce(
      new Error("profile store unavailable"),
    );

    const res = await POST(
      post({
        venueId: "venue-xjf3n0",
        drinkCategory: "beer",
        priceGbp: 4.2,
        contributorHandle: "night_owl",
      }),
    );

    expect(res.status).toBe(503);
    expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(0);
    expect(
      (await memoryCommunityPriceStore.listLeaderboardContributions()).records,
    ).toEqual([]);
  });

  it("never trusts a client-supplied timestamp or source", async () => {
    const res = await POST(
      post({
        venueId: "venue-lrz4u2",
        drinkCategory: "beer",
        priceGbp: 5,
        submittedAt: 1,
        source: "sourced",
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as PriceBody;
    expect(data.price?.source).toBe("community");
    expect(data.price?.submittedAt).toBeGreaterThan(1);
  });

  it("rejects a price under the floor with a friendly message (400)", async () => {
    const res = await POST(
      post({ venueId: "route-floor", drinkCategory: "beer", priceGbp: 0.45 }),
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as PriceBody;
    expect(data.error).toContain("£4.50");
    // Nothing was stored - a bounced price never reaches the map.
    expect(await readCommunityPrices("route-floor")).toEqual([]);
  });

  it("rejects a price over the ceiling with a friendly message (400)", async () => {
    const res = await POST(
      post({ venueId: "route-ceiling", drinkCategory: "beer", priceGbp: 99 }),
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as PriceBody;
    expect(data.error).toContain(`£${COMMUNITY_PRICE_MAX_GBP}`);
  });

  it("rejects a missing venue, an unknown drink, and a malformed body (400)", async () => {
    expect((await POST(post({ drinkCategory: "beer", priceGbp: 4.2 }))).status).toBe(400);
    expect(
      (await POST(post({ venueId: "route-bad", drinkCategory: "mead", priceGbp: 4.2 }))).status,
    ).toBe(400);
    const malformed = new Request("http://localhost/api/price-submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect((await POST(malformed)).status).toBe(400);
  });

  it("rate-limits an account spraying prices at one venue (429)", async () => {
    for (let i = 0; i < 9; i += 1) {
      const res = await POST(
        post({ venueId: "venue-1f5ygjb", drinkCategory: "beer", priceGbp: 4 + i / 100 }),
      );
      expect(res.status, `submission ${i + 1}`).toBe(i < 8 ? 201 : 429);
      if (i === 8) {
        const data = (await res.json()) as PriceBody;
        expect(data.error).toContain("slow down");
      }
    }
  });

  it("rate-limits one actor across different venues after 30 submissions (429)", async () => {
    const venueIds = [...(await getVenueIndex()).values()]
      .filter((venue) => isPubVenueKind(venue.kind))
      .map((venue) => venue.id)
      .slice(0, 31);
    expect(venueIds).toHaveLength(31);

    for (const [index, venueId] of venueIds.entries()) {
      const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
      expect(res.status, `submission ${index + 1}`).toBe(index < 30 ? 201 : 429);
    }
  });

  it("rejects venue ids absent from the slim index without storing them", async () => {
    const venueId = "totally-fake-venue-xyz";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));

    expect(res.status).toBe(400);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("rejects non-pub anchor prices without storing them", async () => {
    const venueId = "bar-american-bar-savoy";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 8.5 }));

    expect(res.status).toBe(400);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("canonicalizes a legacy venue id before persistence", async () => {
    const res = await POST(
      post({ venueId: "legacy-price-pub", drinkCategory: "beer", priceGbp: 4.2 }),
    );

    expect(res.status).toBe(201);
    expect(await readCommunityPrices("legacy-price-pub")).toEqual([]);
    expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(1);
  });

  it("answers 503 (retryable), not 400, when the venue index is unavailable", async () => {
    venueIndexState.unavailable = true;
    const venueId = "venue-xjf3n0";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));

    expect(res.status).toBe(503);
    const data = (await res.json()) as PriceBody;
    expect(data.error).toContain("try again");
    // Nothing was stored while the membership check could not run.
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });
});

describe("POST /api/price-submit venue signals", () => {
  function postSignal(
    body: Record<string, unknown>,
    forwardedFor = "203.0.113.10",
  ): Request {
    return new Request("http://localhost/api/price-submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": forwardedFor,
      },
      body: JSON.stringify({ kind: "venue-signal", ...body }),
    });
  }

  it("records a signal through the existing route with server metadata", async () => {
    const response = await POST(
      postSignal({
        venueId: "venue-xjf3n0",
        signalKey: "character",
        signalValue: "rough",
        submittedAt: 1,
        corroborations: 99,
        source: "editorial",
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as PriceBody;
    expect(body.ok).toBe(true);
    expect(body.trustReconciliation).toBeUndefined();
    expect(trustSyncState.calls).toBe(0);
    expect(body.signal).toMatchObject({
      venueId: "venue-xjf3n0",
      signalKey: "character",
      signalValue: "rough",
      source: "community",
      corroborations: 1,
    });
    expect(body.signal!.submittedAt).toBeGreaterThan(1);
  });

  it("rejects a value belonging to another signal question", async () => {
    const response = await POST(
      postSignal({
        venueId: "venue-xjf3n0",
        signalKey: "character",
        signalValue: "step-free",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Pick what you noticed.");
  });

  it("needs two independent actors before the response is corroborated", async () => {
    const submission = {
      venueId: "venue-xjf3n0",
      signalKey: "step-free-venue",
      signalValue: "step-free",
    };
    const first = (await (
      await POST(postSignal(submission, "203.0.113.11"))
    ).json()) as PriceBody;
    await authorizeContributor("user-signal-second", "signal_second");
    const second = (await (
      await POST(postSignal(submission, "203.0.113.12"))
    ).json()) as PriceBody;

    expect(first.signal?.corroborations).toBe(1);
    expect(second.signal?.corroborations).toBe(2);
    expect(second.signal?.establishedCandidate?.signalValue).toBe("step-free");
  });

  it("shares the existing per-venue write budget", async () => {
    for (let index = 0; index < 9; index += 1) {
      const response = await POST(
        postSignal({
          venueId: "venue-1f5ygjb",
          signalKey: "character",
          signalValue: index % 2 === 0 ? "rough" : "posh",
        }),
      );
      expect(response.status, `submission ${index + 1}`).toBe(
        index < 8 ? 201 : 429,
      );
    }
  });
});

// UK base pubs live outside the curated venue index by design, but they ARE a
// submission target ("No price yet - be the first"). The route checks their
// ids against the committed base shard pack (lib/ukBaseIndex.ts) instead —
// membership somewhere real, never shape alone.
describe("POST /api/price-submit UK base pubs", () => {
  async function realBaseId(): Promise<string> {
    const result = await getUkBaseIdIndex();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("base index unavailable");
    const first = result.ids.values().next().value;
    expect(typeof first).toBe("string");
    return first as string;
  }

  it("accepts a submission for a committed base pub (201) stamped community", async () => {
    const venueId = await realBaseId();
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as PriceBody;
    expect(data.ok).toBe(true);
    expect(data.price?.source).toBe("community");
  });

  it("accepts a base pub while the unrelated curated index is unavailable", async () => {
    venueIndexState.unavailable = true;
    const venueId = await realBaseId();

    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));

    expect(res.status).toBe(201);
  });

  it("rejects a well-formed but non-existent venue-uk id (400) without storing", async () => {
    const venueId = `${UK_BASE_ID_PREFIX}n0000000000`;
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as PriceBody;
    expect(data.error).toContain("Pick a venue");
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("answers 503 (retryable) for a base id when the base index is unavailable", async () => {
    ukBaseIndexState.unavailable = true;
    const venueId = `${UK_BASE_ID_PREFIX}n266819667`;
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(503);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("still rejects a curated-shaped id absent from the slim index (400), untouched by the base branch", async () => {
    const venueId = "totally-fake-venue-xyz";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(400);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });
});

describe("GET /api/price-submit", () => {
  it("returns provisional visibility only for requested base ids", async () => {
    const result = await getUkBaseIdIndex();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("base index unavailable");
    const [marked, empty] = [...result.ids].slice(0, 2);
    expect(marked).toBeTruthy();
    expect(empty).toBeTruthy();
    await POST(
      post({ venueId: marked, drinkCategory: "beer", priceGbp: 4.2 }),
    );

    const response = await GET(
      get(
        `?scope=provisional-base&venueId=${encodeURIComponent(marked)}&venueId=${encodeURIComponent(empty)}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      venueIds: string[];
      degraded?: boolean;
    };
    expect(body).toEqual({ venueIds: [marked] });
    expect(JSON.stringify(body)).not.toContain("priceGbp");
  });

  it("budgets the provisional base read like the paths that write (429)", async () => {
    // The one unauthenticated read here that pages the store per request, and
    // answers no-store so nothing is shared between callers. It gets the same
    // per-actor plumbing every mutating branch on this route uses.
    let limited: Response | null = null;
    for (let index = 0; index < 200 && limited === null; index += 1) {
      const response = await GET(
        get(`?scope=provisional-base&venueId=venue-uk-n${index}`),
      );
      if (response.status === 429) limited = response;
      else expect(response.status, `read ${index + 1}`).toBe(200);
    }
    expect(limited).not.toBeNull();
    if (!limited) throw new Error("budget never refused a read");
    // And it NAMES the window. The durable limiter records a hit even when it
    // refuses one, so a client left to guess retries into its own lockout.
    const retryAfter = Number(limited.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(300);
    expect(((await limited.json()) as { error: string }).error).toContain(
      "slow down",
    );
  });

  it("rejects curated ids and an over-limit provisional base request", async () => {
    expect(
      (
        await GET(
          get("?scope=provisional-base&venueId=venue-xjf3n0"),
        )
      ).status,
    ).toBe(400);

    const query = Array.from(
      { length: MAX_PROVISIONAL_BASE_VENUE_IDS + 1 },
      (_, index) => `venueId=venue-uk-n${index}`,
    ).join("&");
    expect(
      (await GET(get(`?scope=provisional-base&${query}`))).status,
    ).toBe(400);
  });

  it("records soft-drink, alcohol-free and coffee on the same venue", async () => {
    const venueId = "venue-xjf3n0";
    for (const entry of [
      { drinkCategory: "soft-drink", priceGbp: 2.8 },
      { drinkCategory: "alcohol-free", priceGbp: 4.6 },
      { drinkCategory: "coffee", priceGbp: 2.5 },
    ] as const) {
      const res = await POST(post({ venueId, ...entry }));
      expect(res.status, entry.drinkCategory).toBe(201);
      const data = (await res.json()) as PriceBody;
      expect(data.ok).toBe(true);
      expect(data.price).toMatchObject({
        venueId,
        drinkCategory: entry.drinkCategory,
        priceGbp: entry.priceGbp,
        source: "community",
      });
    }

    const prices = await readCommunityPrices(venueId);
    expect(
      prices.map((row) => row.drinkCategory).sort(),
    ).toEqual(["alcohol-free", "coffee", "soft-drink"]);
    expect(prices.find((row) => row.drinkCategory === "coffee")?.priceGbp).toBe(
      2.5,
    );
  });

  it("returns the no-alcohol category index without beer rows", async () => {
    const venueId = "venue-xjf3n0";
    await POST(post({
      venueId,
      drinkCategory: "soft-drink",
      priceGbp: 3.2,
    }));
    await POST(post({
      venueId,
      drinkCategory: "beer",
      priceGbp: 6.2,
    }));

    const response = await GET(get("?lens=no-alcohol"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      prices: Array<{ venueId: string; drinkCategory: string }>;
      degraded?: boolean;
      truncated?: boolean;
    };
    expect(body.prices).toEqual([
      expect.objectContaining({ venueId, drinkCategory: "soft-drink" }),
    ]);
    expect(body.truncated).toBe(false);
    expect(JSON.stringify(body)).not.toContain("actor");
  });

  it("returns only the requested drink category across venues", async () => {
    const venueId = "venue-xjf3n0";
    await POST(post({ venueId, drinkCategory: "whisky", priceGbp: 6 }));
    await POST(post({ venueId, drinkCategory: "wine", priceGbp: 8 }));

    const response = await GET(get("?drinkCategory=whisky"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      prices: Array<{ venueId: string; drinkCategory: string }>;
      truncated?: boolean;
    };
    expect(body.prices).toEqual([
      expect.objectContaining({ venueId, drinkCategory: "whisky" }),
    ]);
    expect(body.truncated).toBe(false);
  });

  it("reads back the freshest community price per drink category", async () => {
    const venueId = "venue-3h52h";
    await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    await POST(post({ venueId, drinkCategory: "wine", priceGbp: 8.5 }));

    const res = await GET(get(`?venueId=${venueId}`));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { prices: Array<{ drinkCategory: string }> };
    expect(data.prices.map((row) => row.drinkCategory).sort()).toEqual(["beer", "wine"]);
    expect(data).not.toHaveProperty("degraded");
  });

  it("reads venue signals beside prices from the same route", async () => {
    await POST(
      post({
        kind: "venue-signal",
        venueId: "venue-xjf3n0",
        signalKey: "people-eating",
        signalValue: "eating",
      }),
    );

    const response = await GET(get("?venueId=venue-xjf3n0"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as PriceBody;
    expect(body.signals).toEqual([
      expect.objectContaining({
        venueId: "venue-xjf3n0",
        signalKey: "people-eating",
        signalValue: "eating",
        source: "community",
        corroborations: 1,
      }),
    ]);
    // The id rides along so a wrong answer has a flag handle, the same way a
    // wrong figure does. Hiding it stays a moderator's call.
    expect(body.signals?.[0]?.id).toBeTruthy();
  });

  it("takes a reader's flag on a venue signal, and hides nothing", async () => {
    await POST(
      post({
        kind: "venue-signal",
        venueId: "venue-xjf3n0",
        signalKey: "step-free-venue",
        signalValue: "step-free",
      }),
    );
    const listed = (await (
      await GET(get("?venueId=venue-xjf3n0"))
    ).json()) as PriceBody;
    const id = listed.signals?.[0]?.id;
    expect(id).toBeTruthy();

    const flagged = await POST(post({ action: "report", id, reason: "wrong" }));
    expect(flagged.status).toBe(200);

    const after = (await (
      await GET(get("?venueId=venue-xjf3n0"))
    ).json()) as PriceBody;
    expect(after.signals).toHaveLength(1);
  });

  it("reads a legacy venue id from its canonical storage key", async () => {
    await POST(
      post({ venueId: "legacy-price-pub", drinkCategory: "beer", priceGbp: 4.2 }),
    );

    const res = await GET(get("?venueId=legacy-price-pub"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      prices: [{ drinkCategory: "beer", priceGbp: 4.2 }],
    });
  });

  it("is honest-empty when canonical venue data is unavailable", async () => {
    await POST(
      post({ venueId: "venue-xjf3n0", drinkCategory: "beer", priceGbp: 4.2 }),
    );
    venueIndexState.unavailable = true;

    const res = await GET(get("?venueId=venue-xjf3n0"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prices: [] });
  });

  it("is honest-empty (200) for a missing or unknown venue, never a 500", async () => {
    expect((await GET(get(""))).status).toBe(200);
    expect(await (await GET(get(""))).json()).toEqual({ prices: [] });
    expect(await (await GET(get("?venueId=nobody-here"))).json()).toEqual({ prices: [] });
  });

  it("adds a degraded signal without changing the fail-soft prices payload", async () => {
    readBackState.statusOverride = { prices: [], degraded: true };

    const res = await GET(get("?venueId=venue-3h52h"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      prices: [],
      signals: [],
      degraded: true,
    });
  });
});

// The corroboration count the POST answers with is what promotes a submission
// from the pub's sheet onto the map, so the route has to state it - and has to
// derive it, never accept it. Identity here is the authenticated profile id, so
// changing IP cannot manufacture another voice.
describe("POST /api/price-submit corroboration", () => {
  async function submitAs(account: string, body: unknown): Promise<Response> {
    await authorizeContributor(`user-${account}`, `handle_${account}`);
    return POST(post(body));
  }

  async function priceOf(res: Response) {
    expect(res.status).toBe(201);
    return ((await res.json()) as PriceBody).price;
  }

  // A REAL venue id per case: the route checks slim-index membership before
  // anything else, so a made-up id would 400 and never exercise the count.
  // Drawn from the far end of the index so these can never collide with the
  // cross-venue rate-limit case above, which consumes the first 31 ids.
  async function realVenueId(offset: number): Promise<string> {
    const ids = [...(await getVenueIndex()).values()]
      .filter((venue) => isPubVenueKind(venue.kind))
      .map((venue) => venue.id);
    expect(ids.length).toBeGreaterThan(31 + offset);
    return ids[ids.length - 1 - offset];
  }

  it("answers a first report with one voice - the tap landed, the map did not move", async () => {
    const venueId = await realVenueId(0);
    const price = await priceOf(
      await submitAs("one_a", { venueId, drinkCategory: "beer", priceGbp: 4.2 }),
    );
    expect(price?.corroborations).toBe(1);
  });

  it("answers the second independent agreeing report with two", async () => {
    const venueId = await realVenueId(1);
    await submitAs("two_a", { venueId, drinkCategory: "beer", priceGbp: 4.2 });
    const price = await priceOf(
      await submitAs("two_b", { venueId, drinkCategory: "beer", priceGbp: 4.5 }),
    );
    // The response is the submitter's own figure, now backed by two accounts.
    expect(price?.priceGbp).toBe(4.5);
    expect(price?.corroborations).toBe(2);
    expect(await readPriceTrustImpact("user-two_a")).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact("user-two_b")).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
  });

  it("does not credit a third agreeing report with a new unlock", async () => {
    const venueId = await realVenueId(6);
    await submitAs("late_a", { venueId, drinkCategory: "beer", priceGbp: 4.2 });
    await submitAs("late_b", { venueId, drinkCategory: "beer", priceGbp: 4.2 });
    await submitAs("late_c", { venueId, drinkCategory: "beer", priceGbp: 4.3 });
    expect(await readPriceTrustImpact("user-late_c")).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact("user-late_a")).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
  });

  it("keeps one voice when the same account logs again", async () => {
    const venueId = await realVenueId(2);
    await submitAs("three_a", { venueId, drinkCategory: "beer", priceGbp: 4.2 });
    const price = await priceOf(
      await submitAs("three_a", { venueId, drinkCategory: "beer", priceGbp: 4.3 }),
    );
    expect(price?.corroborations).toBe(1);
  });

  it("keeps one voice when a second contributor contradicts rather than agrees", async () => {
    const venueId = await realVenueId(3);
    await submitAs("four_a", { venueId, drinkCategory: "beer", priceGbp: 4.2 });
    const price = await priceOf(
      await submitAs("four_b", { venueId, drinkCategory: "beer", priceGbp: 7.5 }),
    );
    expect(price?.corroborations).toBe(1);
  });

  it("refuses a client-supplied corroboration count outright", async () => {
    const venueId = await realVenueId(4);
    const price = await priceOf(
      await POST(
        post({
          venueId,
          drinkCategory: "beer",
          priceGbp: 4.2,
          corroborations: 99,
        }),
      ),
    );
    // A body that could set this could repaint the map from one account, which
    // is exactly the hole the threshold closes.
    expect(price?.corroborations).toBe(1);
  });

  it("states the count on the read path too, so a reload agrees with the tap", async () => {
    const venueId = await realVenueId(5);
    await submitAs("seven_a", { venueId, drinkCategory: "beer", priceGbp: 4.2 });
    await submitAs("seven_b", { venueId, drinkCategory: "beer", priceGbp: 4.2 });

    const data = (await (await GET(get(`?venueId=${venueId}`))).json()) as {
      prices: Array<{ corroborations?: number }>;
    };
    expect(data.prices[0]?.corroborations).toBe(2);
  });

  it("keeps the corroborated figure when a third contributor disagrees", async () => {
    // Contributors A and B agree on £4.20; C logs a fresh £9.00.
    const venueId = await realVenueId(6);
    await submitAs("nine_a", { venueId, drinkCategory: "beer", priceGbp: 4.2 });
    await submitAs("nine_b", { venueId, drinkCategory: "beer", priceGbp: 4.2 });
    const cPrice = await priceOf(
      await submitAs("nine_c", { venueId, drinkCategory: "beer", priceGbp: 9 }),
    );

    // C's receipt figure is their own £9.00 at one voice - but the candidate
    // that decides the map is still the corroborated £4.20, so a lone
    // disagreement can neither repaint the map nor un-paint it.
    expect(cPrice?.priceGbp).toBe(9);
    expect(cPrice?.corroborations).toBe(1);
    expect(cPrice?.mapCandidate?.priceGbp).toBe(4.2);
    expect(cPrice?.mapCandidate?.corroborations).toBe(2);

    // The read path agrees: sheet row freshest-wins, candidate best-backed.
    const data = (await (await GET(get(`?venueId=${venueId}`))).json()) as {
      prices: Array<{
        priceGbp: number;
        corroborations?: number;
        mapCandidate?: { priceGbp: number; corroborations: number };
      }>;
    };
    expect(data.prices[0]?.priceGbp).toBe(9);
    expect(data.prices[0]?.corroborations).toBe(1);
    expect(data.prices[0]?.mapCandidate?.priceGbp).toBe(4.2);
    expect(data.prices[0]?.mapCandidate?.corroborations).toBe(2);
  });

  it("carries the corroborated candidate through a lost read-back race", async () => {
    // A rival contributor's £9.00 became the freshest row between this
    // write and the read-back. The fallback must still answer the submitter's
    // OWN figure at one cautious voice - never the rival's price - but the
    // corroborated candidate rides along so this client's map does not
    // transiently un-paint.
    const venueId = await realVenueId(7);
    readBackState.override = [
      {
        venueId,
        drinkCategory: "beer",
        priceGbp: 9,
        submittedAt: 5_000,
        source: "community",
        corroborations: 1,
        mapCandidate: { priceGbp: 4.2, submittedAt: 4_000, corroborations: 2 },
      },
    ];
    const price = await priceOf(
      await submitAs("twelve_a", { venueId, drinkCategory: "beer", priceGbp: 4.5 }),
    );
    expect(price?.priceGbp).toBe(4.5);
    expect(price?.corroborations).toBe(1);
    expect(price?.mapCandidate).toEqual({
      priceGbp: 4.2,
      submittedAt: 4_000,
      corroborations: 2,
    });
  });

  it("invents no candidate when the read-back race ends in a degraded read", async () => {
    const venueId = await realVenueId(8);
    readBackState.override = [];
    const price = await priceOf(
      await submitAs("thirteen_a", { venueId, drinkCategory: "beer", priceGbp: 4.5 }),
    );
    // Absent stays absent: the submitter's own figure at one voice, and no
    // fabricated map candidate a degraded read cannot vouch for.
    expect(price?.priceGbp).toBe(4.5);
    expect(price?.corroborations).toBe(1);
    expect(price?.mapCandidate).toBeUndefined();
  });
});

describe("POST /api/price-submit report", () => {
  function reportAs(ip: string, body: unknown): Request {
    return new Request("http://localhost/api/price-submit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });
  }

  async function logOne(ip: string): Promise<string> {
    const res = await POST(
      reportAs(ip, { venueId: "venue-xjf3n0", drinkCategory: "beer", priceGbp: 4.2 }),
    );
    expect(res.status).toBe(201);
    const id = (await res.json()).price?.id as string | undefined;
    expect(id).toBeTruthy();
    return id!;
  }

  it("flags an observation without hiding it", async () => {
    const id = await logOne("20.0.0.1");
    const res = await POST(reportAs("20.0.0.2", { action: "report", id, reason: "way off" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // A flag is not a takedown - only a moderator hides (F10).
    expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(1);
  });

  it("404s an id it does not know and 400s a missing one", async () => {
    expect((await POST(reportAs("20.0.0.3", { action: "report", id: "nope" }))).status).toBe(404);
    expect((await POST(reportAs("20.0.0.4", { action: "report" }))).status).toBe(400);
  });

  it("rate-limits a second report of the same row by the same device", async () => {
    const id = await logOne("20.0.0.5");
    expect((await POST(reportAs("20.0.0.6", { action: "report", id }))).status).toBe(200);
    expect((await POST(reportAs("20.0.0.6", { action: "report", id }))).status).toBe(429);
  });

  it("never reads the report branch as a price submission", async () => {
    const id = await logOne("20.0.0.7");
    // No venueId, no price, no category: a report body that fell through to the
    // submit path would 400 on the validator instead of landing as a flag.
    const res = await POST(reportAs("20.0.0.8", { action: "report", id }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
