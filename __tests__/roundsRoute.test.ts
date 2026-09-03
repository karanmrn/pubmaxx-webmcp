import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for the Round routes. Backend selection is the
// roundsStore() seam (Supabase when configured, memory otherwise). We pin the
// in-memory store deterministically by mocking isSupabaseConfigured() === false
// at the @/lib/supabase seam — NOT by stubbing NODE_ENV, which Vite bakes at
// transform time (a runtime stub is a silent no-op under a production build;
// see profileOwnershipRoute.test.ts / pintDrops.test.ts for the house pattern).
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
const venueLookupState = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => {
    const canonicalId = id === "legacy-venue-1" ? "venue-1" : id;
    if (venueLookupState.unavailable) {
      return { status: "unavailable" as const, canonicalId };
    }
    if (canonicalId === "venue-1") {
      return {
        status: "found" as const,
        canonicalId,
        venue: {
          id: canonicalId,
          name: "The Ship",
          borough: "London",
          lat: 51.5,
          lng: -0.1,
        },
      };
    }
    if (canonicalId === "bar-1") {
      return {
        status: "found" as const,
        canonicalId,
        venue: {
          id: canonicalId,
          name: "The Cocktail Bar",
          borough: "London",
          lat: 51.5,
          lng: -0.1,
          kind: "bar" as const,
        },
      };
    }
    // A curated heritage pub that carries a seeded demo menu (lib/drinkSeeds).
    if (canonicalId === "venue-16pnwmm") {
      return {
        status: "found" as const,
        canonicalId,
        venue: {
          id: canonicalId,
          name: "Prospect of Whitby",
          borough: "Tower Hamlets",
          lat: 51.5,
          lng: -0.06,
        },
      };
    }
    return { status: "unknown" as const, canonicalId };
  },
  getVenueIndex: async () =>
    new Map([
      [
        "venue-1",
        {
          id: "venue-1",
          name: "The Ship",
          borough: "London",
          lat: 51.5,
          lng: -0.1,
        },
      ],
      [
        "bar-1",
        {
          id: "bar-1",
          name: "The Cocktail Bar",
          borough: "London",
          lat: 51.5,
          lng: -0.1,
          kind: "bar",
        },
      ],
      [
        "venue-16pnwmm",
        {
          id: "venue-16pnwmm",
          name: "Prospect of Whitby",
          borough: "Tower Hamlets",
          lat: 51.5,
          lng: -0.06,
        },
      ],
    ]),
}));

// The degraded-limiter case scripts the price budget's verdict at its seam;
// lib/roundPriceBudget's own outage behaviour is pinned in its unit test.
const { budgetOverride } = vi.hoisted(() => ({
  budgetOverride: {
    fn: null as
      | null
      | ((...args: unknown[]) => Promise<{
          allowed: boolean;
          mode: "durable" | "degraded" | "memory" | "rejected";
        }>),
  },
}));
vi.mock("@/lib/roundPriceBudget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/roundPriceBudget")>();
  return {
    ...actual,
    chargeRoundPriceLines: (
      ...args: Parameters<typeof actual.chargeRoundPriceLines>
    ) =>
      budgetOverride.fn
        ? budgetOverride.fn(...args)
        : actual.chargeRoundPriceLines(...args),
  };
});

const priceWriteState = vi.hoisted(() => ({
  failuresRemaining: 0,
  beforeWrite: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return {
    ...actual,
    submitCommunityPrice: async (
      ...args: Parameters<typeof actual.submitCommunityPrice>
    ) => {
      if (priceWriteState.failuresRemaining > 0) {
        priceWriteState.failuresRemaining -= 1;
        return { price: null, failed: true as const };
      }
      if (priceWriteState.beforeWrite) {
        const beforeWrite = priceWriteState.beforeWrite;
        priceWriteState.beforeWrite = null;
        await beforeWrite();
      }
      return actual.submitCommunityPrice(...args);
    },
  };
});

const authState = vi.hoisted(() => ({
  userId: null as string | null,
  verificationUnavailable: false,
}));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
    verifyCallerAuth: async () =>
      authState.verificationUnavailable
        ? { status: "unavailable" as const }
        : authState.userId
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

// The store-outage (503) cases script a write failure at the store seam. Keep the
// real module (memory store, validation, __resetMemoryRounds); a per-test hook can
// override create()/join() to return the store-failure variant. When null (the
// default), each delegates to the real memory store so every other case is
// unchanged.
const {
  createOverride,
  joinOverride,
  recordSpendOverride,
  transitionOverride,
} = vi.hoisted(() => ({
  createOverride: { fn: null as null | ((...args: unknown[]) => Promise<unknown>) },
  joinOverride: { fn: null as null | ((...args: unknown[]) => Promise<unknown>) },
  recordSpendOverride: { fn: null as null | ((...args: unknown[]) => Promise<unknown>) },
  transitionOverride: { failCompleted: false },
}));
vi.mock("@/lib/roundsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/roundsStore")>();
  return {
    ...actual,
    roundsStore: () => {
      const store = actual.roundsStore();
      return {
        ...store,
        create: (...args: Parameters<typeof store.create>) =>
          createOverride.fn ? createOverride.fn(...args) : store.create(...args),
        join: (...args: Parameters<typeof store.join>) =>
          joinOverride.fn ? joinOverride.fn(...args) : store.join(...args),
        recordSpend: (...args: Parameters<typeof store.recordSpend>) =>
          recordSpendOverride.fn
            ? recordSpendOverride.fn(...args)
            : store.recordSpend(...args),
        transitionSpendPromotions: (
          ...args: Parameters<typeof store.transitionSpendPromotions>
        ) =>
          transitionOverride.failCompleted &&
          args[3].some(({ status }) => status === "promoted")
            ? Promise.resolve({ ok: false as const, error: "error" as const })
            : store.transitionSpendPromotions(...args),
      };
    },
  };
});

import { POST as CREATE } from "@/app/api/rounds/route";
import { GET, POST } from "@/app/api/rounds/[code]/route";
import { __resetMemoryRounds } from "@/lib/roundsStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";
import type { RoundState } from "@/lib/rounds";
import {
  __resetCommunityPrices,
  memoryCommunityPriceStore,
  readCommunityPrices,
} from "@/lib/communityPriceStore";
import { mergeCommunityPriceSignals } from "@/components/map/communityPriceSignals";
import {
  __resetMemoryIdentityHandles,
  memoryIdentityHandleStore,
} from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";

const CREATE_URL = "http://localhost/api/rounds";

function create(body: unknown): Promise<Response> {
  return CREATE(new Request(CREATE_URL, { method: "POST", body: JSON.stringify(body) }));
}

function ctx(code: string) {
  return { params: Promise.resolve({ code }) };
}

function get(code: string, headers?: Record<string, string>): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/rounds/${code}`, { headers }),
    ctx(code),
  );
}

function action(
  code: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/rounds/${code}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    }),
    ctx(code),
  );
}

async function newRound(handle = "ken"): Promise<RoundState> {
  const res = await create({ handle });
  return (await res.json()) as RoundState;
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

beforeEach(() => {
  __resetMemoryRounds();
  __resetMemoryIdentityHandles();
  __resetMemoryProfiles();
  __resetMemoryPrivateIdentities();
  authState.userId = null;
  authState.verificationUnavailable = false;
  // Clear the shared in-memory rate-limit window so per-handle create/action
  // budgets don't leak across cases (the limiter keys on handle + hashed IP).
  __resetPintDrops();
  // Default: store methods delegate to the real memory store (see the mock above).
  createOverride.fn = null;
  joinOverride.fn = null;
  recordSpendOverride.fn = null;
  transitionOverride.failCompleted = false;
  budgetOverride.fn = null;
  priceWriteState.failuresRemaining = 0;
  priceWriteState.beforeWrite = null;
  venueLookupState.unavailable = false;
  __resetCommunityPrices();
});

describe("POST /api/rounds — create", () => {
  it("creates a Round with the creator as first member (201)", async () => {
    const res = await create({ handle: "ken", title: "Big night" });
    expect(res.status).toBe(201);
    const state = (await res.json()) as RoundState;
    expect(state.round.title).toBe("Big night");
    expect(state.members.map((m) => m.handle)).toEqual(["ken"]);
  });

  it("rejects a create with no handle (400)", async () => {
    const res = await create({ title: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed body (400)", async () => {
    const res = await CREATE(new Request(CREATE_URL, { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("503s when the durable store fails to write the Round (degraded dependency, not a bug)", async () => {
    // A store-write failure ("error") is a degraded dependency, so the route
    // must fail soft with 503 (the house contract every other write route uses
    // — see pint-drops) rather than 500, which reads as an application bug.
    createOverride.fn = async () => ({ ok: false, error: "error" as const });
    const res = await create({ handle: "ken", title: "Big night" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Could not start the Round.", code: "UNAVAILABLE", retryable: true });
  });
});

describe("GET /api/rounds/[code]", () => {
  it("returns live state for a real code", async () => {
    const { round } = await newRound("ken");
    const res = await get(round.code);
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.round.code).toBe(round.code);
  });

  it("404s an invalid code without hitting the store", async () => {
    const res = await get("nope");
    expect(res.status).toBe(404);
  });

  it("404s an unknown but well-formed code", async () => {
    const res = await get("ZZZZZZ");
    expect(res.status).toBe(404);
  });

  it("rate-limits valid rounds reads per hashed client IP", async () => {
    const { round } = await newRound("ken");
    const responses: Response[] = [];
    for (let i = 0; i < 121; i++) {
      responses.push(
        await GET(
          new Request(`http://localhost/api/rounds/${round.code}`, {
            headers: { "x-forwarded-for": "198.51.100.30" },
          }),
          ctx(round.code),
        ),
      );
    }

    expect(responses.slice(0, 120).every((res) => res.status === 200)).toBe(true);
    expect(responses[120].status).toBe(429);
    expect(await responses[120].json()).toEqual({ error: "Too many requests, slow down.", code: "RATE_LIMITED", retryable: true });
  });
});

describe("POST /api/rounds/[code] — actions", () => {
  it("join adds a member (200)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, { action: "join", handle: "ale" });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.members.map((m) => m.handle).sort()).toEqual(["ale", "ken"]);
  });

  it("rejects an action with no handle (400)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, { action: "join" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown action (400)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, { action: "explode", handle: "ken" });
    expect(res.status).toBe(400);
  });

  it("addStop by a member appends the stop (200)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
      venueName: "Spoofed name",
    });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.stops).toHaveLength(1);
    expect(state.stops[0]?.venueName).toBe("The Ship");
  });

  it("rejects a non-pub Round stop (400)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "bar-1",
      venueName: "The Cocktail Bar",
    });
    expect(res.status).toBe(400);
  });

  it("canonicalizes a legacy pub id and stores the canonical name", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "legacy-venue-1",
      venueName: "Stale cached name",
    });

    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.stops[0]).toMatchObject({
      venueId: "venue-1",
      venueName: "The Ship",
    });
  });

  it("answers 503 when the requested venue city pack is unavailable", async () => {
    venueLookupState.unavailable = true;
    const { round } = await newRound("ken");
    const res = await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Venue list is unavailable right now, try again shortly.",
      code: "UNAVAILABLE",
      retryable: true,
    });
  });

  it("addStop by a non-member is forbidden (403)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, {
      action: "addStop",
      handle: "stranger",
      venueId: "venue-1",
      venueName: "The Ship",
    });
    expect(res.status).toBe(403);
  });

  it("close by a non-creator is forbidden (403)", async () => {
    const { round } = await newRound("ken");
    await action(round.code, { action: "join", handle: "ale" });
    const res = await action(round.code, { action: "close", handle: "ale" });
    expect(res.status).toBe(403);
  });

  it("records a canonical plain total without creating a per-drink community price", async () => {
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    const res = await action(round.code, {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "legacy-venue-1",
      venueName: "Spoofed Ship",
      clientRef: "spend-plain-1",
      totalGbp: "26.80",
    });

    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.spends[0]).toMatchObject({
      payerHandle: "ken",
      recordedByHandle: "ken",
      venueId: "venue-1",
      venueName: "The Ship",
      totalPence: 2680,
      items: [],
    });
    expect(await readCommunityPrices("venue-1")).toEqual([]);
  });

  it("keeps an anonymous itemised Round in the diary and out of community prices", async () => {
    budgetOverride.fn = async () => ({ allowed: false, mode: "degraded" as const });
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    const res = await action(
      round.code,
      {
        action: "recordSpend",
        handle: "ken",
        payerHandle: "ken",
        venueId: "venue-1",
        clientRef: "spend-items-1",
        items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
      },
      { "x-forwarded-for": "198.51.100.41" },
    );

    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.spends[0]).toMatchObject({
      venueId: "venue-1",
      recordedByHandle: "ken",
      items: [
        {
          drinkName: "Guinness",
          drinkCategory: "beer",
          pricePence: 620,
          source: "round",
          promotionStatus: "diary_only",
        },
      ],
    });
    expect(await readCommunityPrices("venue-1")).toEqual([]);
  });

  it("never promotes an anonymous diary line after later sign-in", async () => {
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const body = {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "spend-anonymous-1",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
    };

    expect((await action(round.code, body)).status).toBe(200);
    await authorizeContributor("user-ken", "ken");
    expect((await action(round.code, body)).status).toBe(403);
    expect(await readCommunityPrices("venue-1")).toEqual([]);
  });

  it("rejects an expired bearer before keeping a promotable line", async () => {
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    const response = await action(
      round.code,
      {
        action: "recordSpend",
        handle: "ken",
        payerHandle: "ken",
        venueId: "venue-1",
        clientRef: "spend-expired-1",
        items: [
          { drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 },
        ],
      },
      { authorization: "Bearer expired" },
    );

    expect(response.status).toBe(401);
    expect(((await (await get(round.code)).json()) as RoundState).spends).toEqual(
      [],
    );
  });

  it("returns retryable 503 without writing when auth verification is unavailable", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    authState.verificationUnavailable = true;

    const response = await action(
      round.code,
      {
        action: "recordSpend",
        handle: "ken",
        payerHandle: "ken",
        venueId: "venue-1",
        clientRef: "spend-auth-outage-1",
        items: [
          { drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 },
        ],
      },
      { authorization: "Bearer valid" },
    );

    expect(response.status).toBe(503);
    const responseBody = await response.json();
    expect(((await (await get(round.code)).json()) as RoundState).spends).toEqual(
      [],
    );
    expect(responseBody).toEqual({
      code: "AUTH_VERIFICATION_UNAVAILABLE",
      error: "Sign-in verification is unavailable right now. Try again.",
      retryable: true,
    });
  });

  it("keeps an incompletely onboarded member's spend in the private diary", async () => {
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    await memoryProfileStore.createOwned("ken", "user-ken");
    authState.userId = "user-ken";

    const response = await action(
      round.code,
      {
        action: "recordSpend",
        handle: "ken",
        payerHandle: "ken",
        venueId: "venue-1",
        clientRef: "spend-onboarding-1",
        items: [
          { drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 },
        ],
      },
      { authorization: "Bearer valid" },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: "onboarding_required",
    });
    const state = (await (await get(round.code)).json()) as RoundState;
    expect(state.spends).toMatchObject([
      {
        clientRef: "spend-onboarding-1",
        items: [
          {
            drinkName: "Guinness",
            promotionStatus: "diary_only",
          },
        ],
      },
    ]);
    expect(await readCommunityPrices("venue-1")).toEqual([]);
  });

  it("attributes an account's itemised Round price to its public handle", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    const res = await action(round.code, {
      action: "recordSpend",
      handle: "spoofed",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "spend-account-1",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
    });

    expect(res.status).toBe(200);
    const rows = await readCommunityPrices("venue-1");
    expect(rows).toHaveLength(1);
    expect(
      ((await res.clone().json()) as RoundState).spends[0]?.items[0],
    ).toMatchObject({ promotionStatus: "promoted" });
    expect(rows[0]).toMatchObject({
      venueId: "venue-1",
      drinkCategory: "beer",
      priceGbp: 6.2,
      source: "community",
      corroborations: 1,
    });
    expect(
      (await memoryCommunityPriceStore.listLeaderboardContributions()).records,
    ).toMatchObject([
      {
        handle: "ken",
        lane: "price",
        visible: true,
      },
    ]);

    const baseline = new Map([
      [
        "venue-1",
        {
          hasPintDrops: false,
          latestContributorPrice: null,
        },
      ],
    ]);
    const merged = mergeCommunityPriceSignals(
      baseline,
      new Map([["venue-1", rows[0]]]),
      rows[0].submittedAt,
    );
    expect(merged).toBe(baseline);
    expect(merged.get("venue-1")?.latestContributorPrice).toBeNull();
  });

  it("persists failed promotion and retries it without duplicating the diary", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const body = {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "spend-retry-1",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
    };

    priceWriteState.failuresRemaining = 1;
    const failed = await action(round.code, body);
    expect(failed.status).toBe(503);
    const held = (await (await get(round.code)).json()) as RoundState;
    expect(held.spends).toHaveLength(1);
    expect(held.spends[0]?.items[0]?.promotionStatus).toBe("ready");

    const retried = await action(round.code, body);
    expect(retried.status).toBe(200);
    const state = (await retried.json()) as RoundState;
    expect(state.spends).toHaveLength(1);
    expect(state.spends[0]?.items[0]?.promotionStatus).toBe("promoted");
    expect(await readCommunityPrices("venue-1")).toHaveLength(1);
  });

  it("keeps Round membership and pending promotion through a handle rename", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const body = {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "spend-rename-1",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
    };

    priceWriteState.failuresRemaining = 1;
    expect((await action(round.code, body)).status).toBe(503);
    expect(
      await memoryIdentityHandleStore.rename("user-ken", "new_ken"),
    ).toMatchObject({ ok: true, previousHandle: "ken", handle: "new_ken" });

    const viewed = (await (
      await get(round.code, { authorization: "Bearer current" })
    ).json()) as RoundState & { viewerMemberHandle?: string };
    expect(viewed.viewerMemberHandle).toBe("ken");

    const retried = await action(round.code, {
      ...body,
      handle: "new_ken",
    });
    expect(retried.status).toBe(200);
    const state = (await retried.json()) as RoundState & {
      viewerMemberHandle?: string;
    };
    expect(state.viewerMemberHandle).toBe("ken");
    expect(state.spends).toHaveLength(1);
    expect(state.spends[0]?.items[0]?.promotionStatus).toBe("promoted");
    expect(
      (await memoryCommunityPriceStore.listLeaderboardContributions()).records,
    ).toMatchObject([{ handle: "new_ken" }]);
  });

  it("lets only the latest same-key Round line own the community price", async () => {
    const budgetCalls: unknown[][] = [];
    budgetOverride.fn = async (...args) => {
      budgetCalls.push(args);
      return { allowed: true, mode: "memory" as const };
    };
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    expect(
      (
        await action(round.code, {
          action: "recordSpend",
          handle: "ken",
          payerHandle: "ken",
          venueId: "venue-1",
          clientRef: "same-key-1",
          items: [
            {
              drinkName: "First Guinness",
              drinkCategory: "beer",
              priceGbp: 6.1,
            },
          ],
        })
      ).status,
    ).toBe(200);
    const latest = await action(round.code, {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "same-key-2",
      items: [
        {
          drinkName: "Earlier Guinness",
          drinkCategory: "beer",
          priceGbp: 6.2,
        },
        {
          drinkName: "Latest Guinness",
          drinkCategory: "beer",
          priceGbp: 6.4,
        },
      ],
    });

    expect(latest.status).toBe(200);
    const state = (await latest.json()) as RoundState;
    expect(state.spends[0]?.items[0]?.promotionStatus).toBe("superseded");
    expect(state.spends[1]?.items.map((item) => item.promotionStatus)).toEqual([
      "superseded",
      "promoted",
    ]);
    expect(
      (budgetCalls.at(-1)?.[2] as unknown[] | undefined)?.length,
    ).toBe(1);
    expect(await readCommunityPrices("venue-1")).toMatchObject([
      { drinkCategory: "beer", priceGbp: 6.4 },
    ]);
  });

  it("keeps the promoted owner while its replacement is rate-limited or unavailable", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    expect(
      (
        await action(round.code, {
          action: "recordSpend",
          handle: "ken",
          payerHandle: "ken",
          venueId: "venue-1",
          clientRef: "current-owner",
          items: [
            {
              drinkName: "Current Guinness",
              drinkCategory: "beer",
              priceGbp: 6.1,
            },
          ],
        })
      ).status,
    ).toBe(200);
    const replacement = {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "failed-replacement",
      items: [
        {
          drinkName: "Replacement Guinness",
          drinkCategory: "beer",
          priceGbp: 6.4,
        },
      ],
    };

    budgetOverride.fn = async () => ({
      allowed: false,
      mode: "memory" as const,
    });
    expect((await action(round.code, replacement)).status).toBe(429);
    let held = (await (await get(round.code)).json()) as RoundState;
    expect(
      held.spends.map((spend) => spend.items[0]?.promotionStatus),
    ).toEqual(["promoted", "pending"]);
    expect(await readCommunityPrices("venue-1")).toMatchObject([
      { priceGbp: 6.1 },
    ]);

    budgetOverride.fn = null;
    priceWriteState.failuresRemaining = 1;
    expect((await action(round.code, replacement)).status).toBe(503);
    held = (await (await get(round.code)).json()) as RoundState;
    expect(
      held.spends.map((spend) => spend.items[0]?.promotionStatus),
    ).toEqual(["promoted", "ready"]);
    expect(await readCommunityPrices("venue-1")).toMatchObject([
      { priceGbp: 6.1 },
    ]);
  });

  it("rejects a ready source superseded while its price write is waiting", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const staleBody = {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "stale-ready-source",
      items: [
        {
          drinkName: "Earlier Guinness",
          drinkCategory: "beer",
          priceGbp: 6.1,
        },
      ],
    };

    priceWriteState.failuresRemaining = 1;
    expect((await action(round.code, staleBody)).status).toBe(503);

    let releaseWrite = (): void => {};
    let signalWriteStarted = (): void => {};
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    priceWriteState.beforeWrite = async () => {
      signalWriteStarted();
      await writeReleased;
    };

    const staleRetry = action(round.code, staleBody);
    await writeStarted;
    budgetOverride.fn = async () => ({
      allowed: false,
      mode: "memory" as const,
    });
    const newer = await action(round.code, {
      ...staleBody,
      clientRef: "newer-pending-source",
      items: [
        {
          drinkName: "Later Guinness",
          drinkCategory: "beer",
          priceGbp: 6.4,
        },
      ],
    });
    expect(newer.status).toBe(429);

    releaseWrite();
    expect((await staleRetry).status).toBe(503);
    const held = (await (await get(round.code)).json()) as RoundState;
    expect(
      held.spends.map((spend) => spend.items[0]?.promotionStatus),
    ).toEqual(["superseded", "pending"]);
    expect(await readCommunityPrices("venue-1")).toEqual([]);
  });

  it("treats concurrent replay of the same promoted source as success", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const body = {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "concurrent-source-replay",
      items: [
        {
          drinkName: "Guinness",
          drinkCategory: "beer",
          priceGbp: 6.2,
        },
      ],
    };

    priceWriteState.failuresRemaining = 1;
    expect((await action(round.code, body)).status).toBe(503);

    let releaseWrite = (): void => {};
    let signalWriteStarted = (): void => {};
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    priceWriteState.beforeWrite = async () => {
      signalWriteStarted();
      await writeReleased;
    };

    const firstReplay = action(round.code, body);
    await writeStarted;
    const secondReplay = await action(round.code, body);
    releaseWrite();

    expect(secondReplay.status).toBe(200);
    expect((await firstReplay).status).toBe(200);
    expect(await readCommunityPrices("venue-1")).toMatchObject([
      { priceGbp: 6.2 },
    ]);
    const state = (await (await get(round.code)).json()) as RoundState;
    expect(state.spends[0]?.items[0]?.promotionStatus).toBe("promoted");
  });

  it("persists promotion with the community-price ownership transaction", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    transitionOverride.failCompleted = true;

    const response = await action(round.code, {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "atomic-promotion",
      items: [
        {
          drinkName: "Guinness",
          drinkCategory: "beer",
          priceGbp: 6.4,
        },
      ],
    });

    expect(response.status).toBe(200);
    const state = (await response.json()) as RoundState;
    expect(state.spends[0]?.items[0]?.promotionStatus).toBe("promoted");
    expect(await readCommunityPrices("venue-1")).toMatchObject([
      { priceGbp: 6.4 },
    ]);
  });

  it("supersedes a promoted Round line when a later direct price owns its key", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    const promoted = await action(round.code, {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "round-before-direct",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
    });
    expect(promoted.status).toBe(200);
    const promotedState = (await promoted.json()) as RoundState;
    const roundSource = promotedState.spends[0]!;

    await memoryCommunityPriceStore.submit(
      {
        venueId: "venue-1",
        drinkCategory: "beer",
        priceGbp: 6.5,
        actor: "profile:mem-profile-ken",
        contributorHandle: "ken",
      },
      Date.parse(roundSource.recordedAt) + 1,
    );

    const state = (await (await get(round.code)).json()) as RoundState;
    expect(state.spends[0]?.items[0]?.promotionStatus).toBe("superseded");
  });

  it("does not promote an older ready line when a direct price already owns its key", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const body = {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "round-ready-before-direct",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
    };

    priceWriteState.failuresRemaining = 1;
    expect((await action(round.code, body)).status).toBe(503);
    const held = (await (await get(round.code)).json()) as RoundState;
    const readySource = held.spends[0]!;
    await memoryCommunityPriceStore.submit(
      {
        venueId: "venue-1",
        drinkCategory: "beer",
        priceGbp: 6.5,
        actor: "profile:mem-profile-ken",
        contributorHandle: "ken",
      },
      Date.parse(readySource.recordedAt) + 1,
    );

    const retried = await action(round.code, body);
    expect(retried.status).toBe(200);
    const state = (await retried.json()) as RoundState;
    expect(state.spends[0]?.items[0]?.promotionStatus).toBe("superseded");
    expect(await readCommunityPrices("venue-1")).toMatchObject([
      { priceGbp: 6.5 },
    ]);
  });

  it("never lets another account promote a saved pending line", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, { action: "join", handle: "molly" });
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const body = {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "spend-owned-1",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
    };
    priceWriteState.failuresRemaining = 1;
    expect((await action(round.code, body)).status).toBe(503);

    await authorizeContributor("user-molly", "molly");
    const other = await action(round.code, {
      ...body,
      handle: "molly",
      payerHandle: "molly",
    });
    expect(other.status).toBe(403);
    expect(await readCommunityPrices("venue-1")).toEqual([]);
  });

  it("keeps one account actor across Round requests from different addresses", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    for (const [clientRef, priceGbp, address] of [
      ["spend-address-1", 6.2, "198.51.100.71"],
      ["spend-address-2", 6.4, "198.51.100.72"],
    ] as const) {
      const res = await action(
        round.code,
        {
          action: "recordSpend",
          handle: "ken",
          payerHandle: "ken",
          venueId: "venue-1",
          clientRef,
          items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp }],
        },
        { "x-forwarded-for": address },
      );
      expect(res.status).toBe(200);
    }

    const rows = await readCommunityPrices("venue-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      priceGbp: 6.4,
      corroborations: 1,
    });
  });

  it("allows a signed-in account of any age to share a Round price", async () => {
    await authorizeContributor("user-young", "young_person", "2015-02-03");
    const { round } = await newRound("young_person");
    await action(round.code, {
      action: "addStop",
      handle: "young_person",
      venueId: "venue-1",
    });

    const res = await action(round.code, {
      action: "recordSpend",
      handle: "young_person",
      payerHandle: "young_person",
      venueId: "venue-1",
      clientRef: "spend-young-1",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as RoundState).spends).toHaveLength(1);
    expect(await readCommunityPrices("venue-1")).toHaveLength(1);
  });

  // Two drinkers at the same pub, so the pair of cases below can show that what
  // decides a line's fate is where its figure came from, not what it says.
  async function recordDrinks(
    drinker: { handle: string; ip: string; clientRef: string },
    items: unknown[],
  ): Promise<RoundState> {
    await authorizeContributor(`user-${drinker.handle}`, drinker.handle);
    const { round } = await newRound(drinker.handle);
    await action(round.code, {
      action: "addStop",
      handle: drinker.handle,
      venueId: "venue-16pnwmm",
    });
    const res = await action(
      round.code,
      {
        action: "recordSpend",
        handle: drinker.handle,
        payerHandle: drinker.handle,
        venueId: "venue-16pnwmm",
        clientRef: drinker.clientRef,
        items,
      },
      { "x-forwarded-for": drinker.ip },
    );
    expect(res.status).toBe(200);
    return (await res.json()) as RoundState;
  }

  const drinkers = [
    { handle: "ken", ip: "198.51.100.51", clientRef: "spend-seed-1" },
    { handle: "molly", ip: "198.51.100.52", clientRef: "spend-seed-2" },
  ];

  it("keeps a demo-menu line in the diary and out of the community store", async () => {
    // A figure lifted off the seeded demo menu (lib/drinkSeeds) is nobody's
    // observation, so two independent accounts echoing it must never corroborate
    // it, while a price each of them typed corroborates normally.
    for (const drinker of drinkers) {
      const state = await recordDrinks(drinker, [
        {
          drinkName: "House Malbec",
          drinkCategory: "wine",
          priceGbp: 7.5,
          priceSource: "demo",
        },
        { drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 },
      ]);
      // The refused line is kept and labelled, never silently dropped.
      expect(state.spends.at(-1)?.items).toMatchObject([
        { drinkName: "House Malbec", source: "demo" },
        { drinkName: "Guinness", source: "round" },
      ]);
    }

    const rows = await readCommunityPrices("venue-16pnwmm");
    expect(rows.map((row) => row.drinkCategory)).toEqual(["beer"]);
    expect(rows[0]).toMatchObject({ priceGbp: 6.2, corroborations: 2 });
  });

  it("logs a typed price that happens to match a demo figure", async () => {
    // The mirror case: the same £7.50 wine at the same pub, typed by the people
    // who drank it. Provenance is the gate, so a coincidence is still an
    // observation and corroborates.
    for (const drinker of drinkers) {
      const state = await recordDrinks(drinker, [
        { drinkName: "Malbec", drinkCategory: "wine", priceGbp: 7.5 },
      ]);
      expect(state.spends.at(-1)?.items).toMatchObject([
        { drinkName: "Malbec", source: "round" },
      ]);
    }

    const rows = await readCommunityPrices("venue-16pnwmm");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      drinkCategory: "wine",
      priceGbp: 7.5,
      corroborations: 2,
    });
  });

  // Drink lines for a spend, cheap enough to stay inside the round envelope.
  const priceLines = (count: number, from: number) =>
    Array.from({ length: count }, (_, index) => ({
      drinkName: `Pint ${from + index}`,
      drinkCategory: "beer",
      priceGbp: 6.2,
    }));

  it("charges the account price budget once per store key, and a replay nothing", async () => {
    const budgetCalls: unknown[][] = [];
    budgetOverride.fn = async (...args) => {
      budgetCalls.push(args);
      return { allowed: true, mode: "memory" as const };
    };
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const keep = (clientRef: string, count: number, from: number) =>
      action(
        round.code,
        {
          action: "recordSpend",
          handle: "ken",
          payerHandle: "ken",
          venueId: "venue-1",
          clientRef,
          items: priceLines(count, from),
        },
      );

    expect((await keep("budget-1", 10, 1)).status).toBe(200);
    expect((await keep("budget-1", 10, 1)).status).toBe(200);
    expect((await keep("budget-2", 10, 11)).status).toBe(200);
    expect(
      budgetCalls.map(
        (call) => (call[2] as unknown[] | undefined)?.length,
      ),
    ).toEqual([1, 1]);
  });

  it("answers a price-limiter outage as ours: 503, a retry hint, and no blame", async () => {
    budgetOverride.fn = async () => ({ allowed: false, mode: "degraded" as const });
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    const res = await action(
      round.code,
      {
        action: "recordSpend",
        handle: "ken",
        payerHandle: "ken",
        venueId: "venue-1",
        clientRef: "degraded-1",
        items: priceLines(2, 1),
      },
      { "x-forwarded-for": "198.51.100.63" },
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({
      error:
        "Your round is kept, but price sharing is unavailable. Try again shortly.",
      code: "UNAVAILABLE",
      retryable: true,
    });
    const held = (await (await get(round.code)).json()) as RoundState;
    expect(held.spends).toHaveLength(1);
    expect(
      held.spends[0]?.items.map((item) => item.promotionStatus),
    ).toEqual(["superseded", "pending"]);

    // The quick total needs no price budget, so the night is still recordable.
    const total = await action(
      round.code,
      {
        action: "recordSpend",
        handle: "ken",
        payerHandle: "ken",
        venueId: "venue-1",
        clientRef: "degraded-2",
        totalGbp: 26.8,
      },
      { "x-forwarded-for": "198.51.100.63" },
    );
    expect(total.status).toBe(200);
  });

  it("refuses more price lines in one turn than a Round may log", async () => {
    await authorizeContributor("user-ken", "ken");
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });

    const tooMany = await action(
      round.code,
      {
        action: "recordSpend",
        handle: "ken",
        payerHandle: "ken",
        venueId: "venue-1",
        clientRef: "ceiling-1",
        items: priceLines(11, 1),
      },
    );
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({
      error: "Log up to 10 drink prices in one round. Keep this one, then start another.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(((await (await get(round.code)).json()) as RoundState).spends).toEqual([]);

    // Demo lines are never submitted, so they cost nothing and do not count
    // towards the ceiling: ten observations plus five diary lines is fine.
    const withDemo = await action(
      round.code,
      {
        action: "recordSpend",
        handle: "ken",
        payerHandle: "ken",
        venueId: "venue-1",
        clientRef: "ceiling-2",
        items: [
          ...priceLines(10, 1),
          ...priceLines(5, 20).map((line) => ({ ...line, priceSource: "demo" })),
        ],
      },
    );
    expect(withDemo.status).toBe(200);
    expect(((await withDemo.json()) as RoundState).spends[0]?.items).toHaveLength(15);
  });

  it("rejects a payer who is not in the Round", async () => {
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const res = await action(round.code, {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "stranger",
      venueId: "venue-1",
      clientRef: "spend-outsider-1",
      totalGbp: 20,
    });
    expect(res.status).toBe(403);
  });

  it("rejects malformed spend money and items", async () => {
    const { round } = await newRound("ken");
    await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
    });
    const res = await action(round.code, {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "spend-bad-1",
      totalGbp: 0,
    });
    expect(res.status).toBe(400);
  });

  it("answers 503 when a spend cannot be stored", async () => {
    const { round } = await newRound("ken");
    recordSpendOverride.fn = async () => ({ ok: false, error: "error" as const });
    const res = await action(round.code, {
      action: "recordSpend",
      handle: "ken",
      payerHandle: "ken",
      venueId: "venue-1",
      clientRef: "spend-outage-1",
      totalGbp: 20,
    });
    expect(res.status).toBe(503);
  });

  it("503s when a store write fails on an action (degraded dependency, not a bug)", async () => {
    const { round } = await newRound("ken");
    // Force the store's join() to report a write failure — the route must map the
    // "error" write-error to 503 (fail-soft), matching every other write route,
    // not 500. The 4xx action outcomes (403/404/409/400) are unchanged.
    joinOverride.fn = async () => ({ ok: false, error: "error" as const });
    const res = await action(round.code, { action: "join", handle: "ale" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Couldn't save that. Try again.", code: "STORE_UNAVAILABLE", retryable: true });
  });

  it("close by the creator, then addStop is 409 (closed)", async () => {
    const { round } = await newRound("ken");
    const closeRes = await action(round.code, { action: "close", handle: "ken" });
    expect(closeRes.status).toBe(200);
    const res = await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
      venueName: "The Ship",
    });
    expect(res.status).toBe(409);
  });
});

describe("rounds auth ownership — linked handle wins over body handle", () => {
  it("joins as the auth-linked handle, ignoring a spoofed body handle", async () => {
    const { round } = await newRound("ken");
    await memoryProfileStore.createOwned("ale", "user-ale");
    authState.userId = "user-ale";

    const res = await action(round.code, { action: "join", handle: "mallory" });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.members.map((m) => m.handle).sort()).toEqual(["ale", "ken"]);
  });

  it("keeps the anonymous demo path when auth is absent", async () => {
    const { round } = await newRound("ken");
    authState.userId = null;
    const res = await action(round.code, { action: "join", handle: "demo" });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.members.map((m) => m.handle).sort()).toEqual(["demo", "ken"]);
  });
});
