import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The complaint side of the community price path: a reader can FLAG an
// observation, a moderator can HIDE it, and a hidden observation leaves every
// public read at once - the sheet row, the corroboration count that decides
// trust, and the map candidate that decides whether a pin moves.
//
// Two seams are mocked so this is deterministic under a PRODUCTION build too
// (Vercel CI presets NODE_ENV=production, and Vite bakes process.env.NODE_ENV at
// transform time, so a runtime stub of it is a silent no-op) - the same shape
// adminCommentsRoute.test.ts documents:
//   • @/lib/supabase isSupabaseConfigured() === false pins the in-memory store.
//   • @/lib/adminAuth isModerator() - the REAL gate opens on a NODE_ENV read
//     when ADMIN_TOKEN is unset, which a prod build would deny. Only that
//     branch is replaced, by a controllable flag; the token compare is kept so
//     the "wrong token → 403" case still exercises real auth.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const { devGate } = vi.hoisted(() => ({ devGate: { open: true } }));
vi.mock("@/lib/adminAuth", () => ({
  isModerator: (request: Request): boolean => {
    const expected = process.env.ADMIN_TOKEN;
    const provided = request.headers.get("x-admin-token") ?? undefined;
    if (!expected) return devGate.open;
    if (!provided) return false;
    return provided === expected;
  },
}));

import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/community-prices/route";
import {
  __resetCommunityPrices,
  listCommunityPricesForReview,
  moderateCommunityPrice,
  readCommunityPrices,
  readCommunityVenueSignals,
  reportCommunityPrice,
  submitCommunityPrice,
  submitCommunityVenueSignal,
} from "@/lib/communityPriceStore";
import * as communityPriceStoreModule from "@/lib/communityPriceStore";
import * as priceTrustImpactModule from "@/lib/priceTrustImpact.server";
import {
  __resetMemoryPriceTrustEvents,
  priceTrustEventStore,
} from "@/lib/priceTrustEventStore";

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const ADMIN_URL = "http://localhost/api/admin/community-prices";

function adminPost(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return adminPOST(
    new Request(ADMIN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify(body),
    }),
  );
}

/** Log one observation and return the id the moderator would act on. */
async function logPrice(
  venueId: string,
  priceGbp: number,
  at: number,
  actor?: string,
): Promise<string> {
  const { price } = await submitCommunityPrice(
    { venueId, drinkCategory: "beer", priceGbp, ...(actor ? { actor } : {}) },
    at,
  );
  expect(price?.id).toBeTruthy();
  return price!.id!;
}

describe("community price moderation (memory backend)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ADMIN_TOKEN;
    devGate.open = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetCommunityPrices();
    __resetMemoryPriceTrustEvents();
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  afterAll(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  });

  it("hides an observation from the public read, and restores it", async () => {
    const id = await logPrice("v1", 4.2, 1_000);
    expect(await readCommunityPrices("v1", 1_000)).toHaveLength(1);

    expect(await moderateCommunityPrice(id, true, "landlord says never")).toBe(true);
    expect(await readCommunityPrices("v1", 1_000)).toEqual([]);

    // Hide, never delete: the row survived and comes back intact.
    expect(await moderateCommunityPrice(id, false)).toBe(true);
    const restored = await readCommunityPrices("v1", 1_000);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.priceGbp).toBe(4.2);
  });

  it("uncovers the next-freshest price when the freshest one is hidden", async () => {
    await logPrice("v1", 4.2, 1_000, "a");
    const newer = await logPrice("v1", 9.99, 2_000, "b");

    expect((await readCommunityPrices("v1", 2_000))[0]?.priceGbp).toBe(9.99);
    await moderateCommunityPrice(newer, true);
    // Not "no price" - the honest older observation is still on record.
    expect((await readCommunityPrices("v1", 2_000))[0]?.priceGbp).toBe(4.2);
  });

  it("stops a hidden row corroborating a figure or driving the map", async () => {
    await logPrice("v1", 4.2, 1_000, "a");
    const second = await logPrice("v1", 4.2, 2_000, "b");

    const corroborated = await readCommunityPrices("v1", 2_000);
    expect(corroborated[0]?.corroborations).toBe(2);
    expect(corroborated[0]?.mapCandidate?.corroborations).toBe(2);

    // Hiding one voice must take its vote with it, not just its row - otherwise
    // a moderated-away submission keeps a pin painted.
    await moderateCommunityPrice(second, true);
    const after = await readCommunityPrices("v1", 2_000);
    expect(after[0]?.corroborations).toBe(1);
    expect(after[0]?.mapCandidate?.corroborations).toBe(1);
  });

  it("refuses to moderate an id it does not know", async () => {
    expect(await moderateCommunityPrice("no-such-id", true)).toBe(false);
    expect(await moderateCommunityPrice("", true)).toBe(false);
  });

  it("records a report without hiding anything", async () => {
    const id = await logPrice("v1", 4.2, 1_000);
    expect(await reportCommunityPrice(id, "way off", "actor-1")).toBe(true);

    // A flag is evidence for a human, never a takedown: the price is still on
    // the sheet, which is the whole difference from the Pint Drop path.
    expect(await readCommunityPrices("v1", 1_000)).toHaveLength(1);

    const queue = await listCommunityPricesForReview();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id,
      kind: "price",
      reportCount: 1,
      hidden: false,
      reportReason: "way off",
    });

  });

  it("counts one report per actor, so a single reader cannot inflate the queue", async () => {
    const id = await logPrice("v1", 4.2, 1_000);
    await reportCommunityPrice(id, "wrong", "actor-1");
    await reportCommunityPrice(id, "still wrong", "actor-1");
    expect((await listCommunityPricesForReview())[0]?.reportCount).toBe(1);

    await reportCommunityPrice(id, "agreed", "actor-2");
    expect((await listCommunityPricesForReview())[0]?.reportCount).toBe(2);
  });

  it("never exposes the submitter's actor token in the moderation queue", async () => {
    const id = await logPrice("v1", 4.2, 1_000, "secret-actor-token");
    await reportCommunityPrice(id, "wrong", "actor-1");
    expect(JSON.stringify(await listCommunityPricesForReview())).not.toContain(
      "secret-actor-token",
    );
  });

  it("returns unreported, visible prices to nobody's queue", async () => {
    await logPrice("v1", 4.2, 1_000);
    expect(await listCommunityPricesForReview()).toEqual([]);
  });

  describe("POST /api/admin/community-prices", () => {
    it("hides a price for a moderator and 404s an unknown id", async () => {
      const id = await logPrice("v1", 4.2, 1_000);

      const res = await adminPost({ action: "hide", id, note: "duplicate" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await readCommunityPrices("v1", 1_000)).toEqual([]);

      expect((await adminPost({ action: "hide", id: "nope" })).status).toBe(404);
    });

    it("restores a hidden price", async () => {
      const id = await logPrice("v1", 4.2, 1_000);
      await adminPost({ action: "hide", id });
      expect((await adminPost({ action: "restore", id })).status).toBe(200);
      expect(await readCommunityPrices("v1", 1_000)).toHaveLength(1);
    });

    it("reconciles the current visible state without changing moderation", async () => {
      const id = await logPrice("v1", 4.2, 1_000);
      const moderate = vi.spyOn(
        communityPriceStoreModule,
        "moderateCommunityPriceWithState",
      );

      const response = await adminPost({ action: "reconcile", id });

      expect(response.status).toBe(200);
      expect(moderate).not.toHaveBeenCalled();
      expect(await readCommunityPrices("v1", 1_000)).toHaveLength(1);
    });

    it("reconciles the current hidden state without changing moderation", async () => {
      const id = await logPrice("v1", 4.2, 1_000);
      expect(await moderateCommunityPrice(id, true)).toBe(true);
      const moderate = vi.spyOn(
        communityPriceStoreModule,
        "moderateCommunityPriceWithState",
      );

      const response = await adminPost({ action: "reconcile", id });

      expect(response.status).toBe(200);
      expect(moderate).not.toHaveBeenCalled();
      expect(await readCommunityPrices("v1", 1_000)).toEqual([]);
    });

    it("reports missing and degraded reconciliation reads honestly", async () => {
      const moderate = vi.spyOn(
        communityPriceStoreModule,
        "moderateCommunityPriceWithState",
      );
      const find = vi.spyOn(
        communityPriceStoreModule,
        "findCommunityPriceObservation",
      );
      find.mockResolvedValueOnce({ observation: null, degraded: false });

      const missing = await adminPost({ action: "reconcile", id: "missing" });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ code: "NOT_FOUND" });

      find.mockResolvedValueOnce({ observation: null, degraded: true });
      const degraded = await adminPost({ action: "reconcile", id: "price-1" });
      expect(degraded.status).toBe(503);
      expect(await degraded.json()).toMatchObject({ code: "UNAVAILABLE" });
      expect(moderate).not.toHaveBeenCalled();
    });

    it("delegates retry to one bounded reconciliation operation without pre-reading state", async () => {
      const find = vi
        .spyOn(communityPriceStoreModule, "findCommunityPriceObservation")
        .mockRejectedValue(new Error("route must not pre-read observation state"));
      const reconcile = vi
        .spyOn(
          priceTrustImpactModule as typeof priceTrustImpactModule & {
            reconcilePriceTrustForObservation: (
              observationId: string,
            ) => Promise<{ status: "synced" | "not-found" | "unavailable" }>;
          },
          "reconcilePriceTrustForObservation",
        )
        .mockResolvedValue({ status: "synced" });

      const response = await adminPost({ action: "reconcile", id: "price-1" });

      expect(response.status).toBe(200);
      expect(reconcile).toHaveBeenCalledWith("price-1");
      expect(find).not.toHaveBeenCalled();
    });

    it("returns retryable unavailable when durable moderation cannot decide", async () => {
      const spy = vi
        .spyOn(communityPriceStoreModule, "moderateCommunityPriceWithState")
        .mockResolvedValue({ status: "unavailable", changed: false });
      const res = await adminPost({ action: "hide", id: "price-1" });
      expect(res.status).toBe(503);
      expect((await res.json()) as { code: string }).toMatchObject({
        code: "UNAVAILABLE",
      });
      spy.mockRestore();
    });

    it("retries trust-credit reconciliation after the price is already hidden", async () => {
      const id = await logPrice("v1", 4.2, 1_000, "profile:one");
      const store = priceTrustEventStore();
      await store.recordUnlock({
        fingerprint: "initial-cluster",
        venueId: "v1",
        category: "beer",
        observationIds: [id],
        userIds: ["user-one"],
        now: 1_000,
      });
      const originalRecordUnlock = store.recordUnlock.bind(store);
      vi.spyOn(store, "recordUnlock")
        .mockResolvedValueOnce({ event: null, created: false, failed: true })
        .mockImplementation(originalRecordUnlock);

      const first = await adminPost({ action: "hide", id });
      expect(first.status).toBe(503);
      expect(await first.json()).toEqual({
        error: "Community observation was hidden, but its trust credit could not be updated. Try again.",
        code: "TRUST_RECONCILIATION_UNAVAILABLE",
        retryable: true,
      });
      expect(await readCommunityPrices("v1", 1_000)).toEqual([]);
      expect((await store.readVisibleImpact("user-one")).lifetimeTrustUnlocks).toBe(1);

      expect((await adminPost({ action: "hide", id })).status).toBe(200);
      expect((await store.readVisibleImpact("user-one")).lifetimeTrustUnlocks).toBe(0);
      const reversalId = (await store.latestReversalCovering(id)).event?.id;
      expect(reversalId).toBeTruthy();
      expect((await adminPost({ action: "hide", id })).status).toBe(200);
      expect((await store.readVisibleImpact("user-one")).lifetimeTrustUnlocks).toBe(0);
      expect((await store.latestReversalCovering(id)).event?.id).toBe(reversalId);
    });

    it("rejects an unknown action and a missing id", async () => {
      const id = await logPrice("v1", 4.2, 1_000);
      expect((await adminPost({ action: "delete", id })).status).toBe(400);
      expect((await adminPost({ action: "hide" })).status).toBe(400);
    });

    it("refuses a non-moderator", async () => {
      const id = await logPrice("v1", 4.2, 1_000);
      process.env.ADMIN_TOKEN = "s3cret";

      expect((await adminPost({ action: "hide", id })).status).toBe(403);
      expect(
        (await adminPost({ action: "hide", id }, { "x-admin-token": "wrong" })).status,
      ).toBe(403);
      expect((await adminGET(new Request(ADMIN_URL))).status).toBe(403);

      // The price is untouched by every refused attempt.
      expect(await readCommunityPrices("v1", 1_000)).toHaveLength(1);

      const allowed = await adminPost(
        { action: "hide", id },
        { "x-admin-token": "s3cret" },
      );
      expect(allowed.status).toBe(200);
    });

    it("lists the queue for a moderator", async () => {
      const id = await logPrice("v1", 4.2, 1_000);
      await reportCommunityPrice(id, "wrong", "actor-1");

      const res = await adminGET(new Request(ADMIN_URL));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { prices: Array<{ id: string }> };
      expect(body.prices.map((row) => row.id)).toEqual([id]);
    });
  });
});

// Venue signals share this table, this queue and this hide/restore action -
// there is no second console. Character and step-free claims are the most
// reputation-sensitive thing a stranger can write about a pub, so a wrong one
// must have the same way down a wrong figure has.
describe("community venue signal moderation (memory backend)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ADMIN_TOKEN;
    devGate.open = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetCommunityPrices();
  });

  async function logSignal(
    venueId: string,
    signalValue: "step-free" | "steps",
    at: number,
    actor?: string,
  ): Promise<string> {
    const { signal } = await submitCommunityVenueSignal(
      {
        venueId,
        signalKey: "step-free-venue",
        signalValue,
        ...(actor ? { actor } : {}),
      },
      at,
    );
    expect(signal?.id).toBeTruthy();
    return signal!.id!;
  }

  it("publishes an id a reader can flag", async () => {
    const id = await logSignal("v1", "step-free", 1_000, "device-a");
    expect(await reportCommunityPrice(id, "not true", "actor-1")).toBe(true);

    // A flag is evidence for a human, never a takedown.
    expect(await readCommunityVenueSignals("v1", 1_000)).toHaveLength(1);
    const queue = await listCommunityPricesForReview();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id,
      kind: "signal",
      signalKey: "step-free-venue",
      signalValue: "step-free",
      reportCount: 1,
      hidden: false,
      reportReason: "not true",
    });
  });

  it("never exposes the contributor's actor token in the queue", async () => {
    const id = await logSignal("v1", "steps", 1_000, "secret-actor-token");
    await reportCommunityPrice(id, "wrong", "actor-1");
    expect(JSON.stringify(await listCommunityPricesForReview())).not.toContain(
      "secret-actor-token",
    );
  });

  it("removes a hidden signal from the sheet and from corroboration together", async () => {
    await logSignal("v1", "step-free", 1_000, "device-a");
    const second = await logSignal("v1", "step-free", 2_000, "device-b");

    const corroborated = await readCommunityVenueSignals("v1", 2_000);
    expect(corroborated[0]?.corroborations).toBe(2);
    expect(corroborated[0]?.establishedCandidate?.corroborations).toBe(2);

    expect(await moderateCommunityPrice(second, true, "wrong pub")).toBe(true);
    const after = await readCommunityVenueSignals("v1", 2_000);
    // Not "no report": the remaining honest observation stands, on its own.
    expect(after).toHaveLength(1);
    expect(after[0]?.corroborations).toBe(1);
    expect(after[0]?.establishedCandidate?.corroborations).toBe(1);

    expect(await moderateCommunityPrice(second, false)).toBe(true);
    expect(
      (await readCommunityVenueSignals("v1", 2_000))[0]?.corroborations,
    ).toBe(2);
  });

  it("keeps a hidden signal hidden when the same device answers again", async () => {
    const id = await logSignal("v9", "step-free", 1_000, "device-a");
    await moderateCommunityPrice(id, true, "abuse");
    expect(await readCommunityVenueSignals("v9", 1_000)).toEqual([]);

    await logSignal("v9", "steps", 2_000, "device-a");
    expect(await readCommunityVenueSignals("v9", 2_000)).toEqual([]);
  });

  it("hides a signal through the existing admin route", async () => {
    const id = await logSignal("v1", "step-free", 1_000, "device-a");
    expect((await adminPost({ action: "hide", id })).status).toBe(200);
    expect(await readCommunityVenueSignals("v1", 1_000)).toEqual([]);

    expect((await adminPost({ action: "restore", id })).status).toBe(200);
    expect(await readCommunityVenueSignals("v1", 1_000)).toHaveLength(1);
  });

  it("does not run price trust reconciliation for a venue signal", async () => {
    const id = await logSignal("v1", "step-free", 1_000, "device-a");
    const sync = vi
      .spyOn(priceTrustImpactModule, "syncTrustAfterPriceHidden")
      .mockResolvedValue({ status: "unavailable" });

    expect((await adminPost({ action: "hide", id })).status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
    expect(await readCommunityVenueSignals("v1", 1_000)).toEqual([]);
  });
});

describe("moderation survives a submitter's own correction (memory backend)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterEach(() => __resetCommunityPrices());

  it("keeps a hidden observation hidden when the same device logs again", async () => {
    const id = await logPrice("v9", 4.2, 1_000, "device-a");
    await moderateCommunityPrice(id, true, "abuse");
    expect(await readCommunityPrices("v9", 1_000)).toEqual([]);

    // The durable backend's upsert touches only the price columns, so hidden_at
    // survives there; the memory backend must not be the loophole.
    await submitCommunityPrice(
      { venueId: "v9", drinkCategory: "beer", priceGbp: 1.5, actor: "device-a" },
      2_000,
    );
    expect(await readCommunityPrices("v9", 2_000)).toEqual([]);
  });
});
