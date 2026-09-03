import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => {
    throw new Error(
      "Could not find the table 'public.price_trust_events' in the schema cache",
    );
  },
}));

import {
  __resetCommunityPrices,
  findCommunityPriceObservation,
  moderateCommunityPrice,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";
import {
  __resetMemoryIdentityHandles,
} from "@/lib/identityHandleStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import {
  __resetMemoryProfiles,
} from "@/lib/profileStore";
import { __resetMemoryPriceTrustEvents, priceTrustEventStore } from "@/lib/priceTrustEventStore";
import {
  drainPendingPriceTrustReconciliations,
  readPriceTrustImpact,
  reconcilePriceTrustForObservation,
  syncTrustAfterPriceHidden,
  syncTrustAfterPriceRestored,
  syncTrustAfterPriceWrite,
} from "@/lib/priceTrustImpact.server";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");
const VENUE = "venue-one";
const USER_A = "00000000-0000-4000-8000-0000000000aa";
const USER_B = "00000000-0000-4000-8000-0000000000bb";
const USER_C = "00000000-0000-4000-8000-0000000000cc";

async function onboard(userId: string, handle: string): Promise<string> {
  const result = await memoryPrivateIdentityStore.completeOnboarding({
    userId,
    handle,
    dateOfBirth: "1990-01-01",
  });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("onboarding failed");
  return result.profileId;
}

async function logPrice(
  handle: string,
  profileId: string,
  priceGbp: number,
  at: number,
): Promise<string> {
  const { price } = await submitCommunityPrice(
    {
      venueId: VENUE,
      drinkCategory: "beer",
      priceGbp,
      actor: `profile:${profileId}`,
      contributorHandle: handle,
    },
    at,
  );
  expect(price?.id).toBeTruthy();
  return price!.id!;
}

beforeEach(() => {
  __resetCommunityPrices();
  __resetMemoryPriceTrustEvents();
  __resetMemoryProfiles();
  __resetMemoryPrivateIdentities();
  __resetMemoryIdentityHandles();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncTrustAfterPriceWrite", () => {
  it("keeps a failed first-cluster event pending until a later drain credits its original contributors once", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);

    const store = priceTrustEventStore();
    const write = vi
      .spyOn(store, "recordUnlock")
      .mockResolvedValueOnce({ event: null, created: false, failed: true });

    expect(await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000)).toEqual({
      status: "unavailable",
    });

    expect((await store.liveEventsFor(VENUE, "beer")).events).toEqual([]);
    expect((await store.listPendingReconciliations(20)).tasks).toHaveLength(1);

    write.mockRestore();
    await drainPendingPriceTrustReconciliations(20, NOW - 1_000);
    await drainPendingPriceTrustReconciliations(20, NOW);

    expect((await store.liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
  });

  it("repairs a live event's missing credit from its stored observation ids without a duplicate event", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);

    const store = priceTrustEventStore();
    const ensureCredits = vi
      .spyOn(store, "ensureCredits")
      .mockResolvedValueOnce({ failed: true });
    expect(await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000)).toEqual({
      status: "unavailable",
    });
    expect((await store.liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 0,
    });
    ensureCredits.mockRestore();

    await drainPendingPriceTrustReconciliations(20, NOW - 1_000);
    await drainPendingPriceTrustReconciliations(20, NOW);

    expect((await store.liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
  });

  it("credits every independent contributor in the first cluster once", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const profileC = await onboard(USER_C, "cara_pint");

    await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 3_000);
    expect(await readPriceTrustImpact(USER_A)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });

    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);

    const a = await readPriceTrustImpact(USER_A);
    const b = await readPriceTrustImpact(USER_B);
    expect(a).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect(b).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });

    await logPrice("cara_pint", profileC, 4.3, NOW - 100);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 100);
    expect(await readPriceTrustImpact(USER_C)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
    expect((await priceTrustEventStore().liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
  });

  it("does not treat a later agreeing report as a second unlock", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 1_000);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
    expect((await priceTrustEventStore().liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
  });

  it("does not acknowledge a reused qualifying cluster while its prior event remains reversed", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);

    const store = priceTrustEventStore();
    const original = (await store.liveEventsFor(VENUE, "beer")).events[0];
    expect(original).toBeTruthy();
    const reversal = await store.recordUnlock({
      fingerprint: `manual-reversal:${original.evidenceFingerprint}`,
      venueId: VENUE,
      category: "beer",
      observationIds: [],
      userIds: [],
      reversalOf: original.id,
      now: NOW - 1_000,
    });
    expect((await store.liveEventsFor(VENUE, "beer")).events).toEqual([]);

    expect(await syncTrustAfterPriceWrite(VENUE, "beer", NOW)).toEqual({
      status: "synced",
    });

    const live = await store.liveEventsFor(VENUE, "beer");
    expect(live.events).toHaveLength(1);
    expect(live.events[0]?.id).not.toBe(original.id);
    expect(live.events[0]?.evidenceFingerprint).toBe(
      `restored:${original.evidenceFingerprint}:${reversal.event?.id}`,
    );
    expect((await store.listPendingReconciliations(20)).tasks).toEqual([]);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
  });
});

describe("drainPendingPriceTrustReconciliations", () => {
  it("rotates unavailable pairs behind newer work without dropping them", async () => {
    const store = priceTrustEventStore();
    const originalLiveEventsFor = store.liveEventsFor.bind(store);
    vi.spyOn(store, "liveEventsFor").mockImplementation(
      async (venueId, category) =>
        venueId.startsWith("poison-")
          ? { events: [], degraded: true }
          : originalLiveEventsFor(venueId, category),
    );

    for (let index = 0; index < 20; index += 1) {
      const queued = await store.enqueueReconciliation(
        `poison-${String(index).padStart(2, "0")}`,
        "beer",
        NOW + index,
      );
      expect(queued.failed).not.toBe(true);
    }
    const healthy = await store.enqueueReconciliation(
      "healthy-newer-pair",
      "beer",
      NOW + 20,
    );
    expect(healthy.failed).not.toBe(true);

    await drainPendingPriceTrustReconciliations(20, NOW + 100);
    await drainPendingPriceTrustReconciliations(20, NOW + 200);

    const pending = (await store.listPendingReconciliations(100)).tasks;
    expect(pending).toHaveLength(20);
    expect(pending.some((task) => task.venueId === "healthy-newer-pair")).toBe(false);
    expect(pending.every((task) => task.venueId.startsWith("poison-"))).toBe(true);
  });
});

describe("syncTrustAfterPriceHidden", () => {
  it("restores contribution trust after a hidden observation is restored", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const hiddenId = await logPrice("alice_pint", profileA, 4.2, NOW - 2_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 1_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 1_000);

    expect(await moderateCommunityPrice(hiddenId, true, "menu mismatch")).toBe(true);
    expect(await syncTrustAfterPriceHidden(hiddenId, NOW)).toEqual({
      status: "synced",
    });
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });

    expect(await moderateCommunityPrice(hiddenId, false)).toBe(true);
    await syncTrustAfterPriceRestored(hiddenId, NOW + 1);

    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    await Promise.all([
      syncTrustAfterPriceRestored(hiddenId, NOW + 1),
      syncTrustAfterPriceRestored(hiddenId, NOW + 1),
    ]);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });

    expect(await moderateCommunityPrice(hiddenId, true, "second hide")).toBe(true);
    await syncTrustAfterPriceHidden(hiddenId, NOW + 2);
    expect(await moderateCommunityPrice(hiddenId, false)).toBe(true);
    await syncTrustAfterPriceRestored(hiddenId, NOW + 3);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
  });

  it("lets final visible state win when hide sync finishes after restore", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const hiddenId = await logPrice("alice_pint", profileA, 4.2, NOW - 2_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 1_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 1_000);

    expect(await moderateCommunityPrice(hiddenId, true)).toBe(true);
    const lateHide = syncTrustAfterPriceHidden(hiddenId, NOW);
    expect(await moderateCommunityPrice(hiddenId, false)).toBe(true);
    await lateHide;
    await syncTrustAfterPriceRestored(hiddenId, NOW + 1);

    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
  });

  it("keeps trust hidden when hide lands before the restored unlock write", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const hiddenId = await logPrice("alice_pint", profileA, 4.2, NOW - 2_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 1_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 1_000);

    expect(await moderateCommunityPrice(hiddenId, true)).toBe(true);
    await syncTrustAfterPriceHidden(hiddenId, NOW);
    expect(await moderateCommunityPrice(hiddenId, false)).toBe(true);

    const store = priceTrustEventStore();
    const originalRecordUnlock = store.recordUnlock.bind(store);
    vi.spyOn(store, "recordUnlock").mockImplementation(async (input) => {
      if (input.fingerprint.startsWith("restored:")) {
        expect(await moderateCommunityPrice(hiddenId, true)).toBe(true);
        await syncTrustAfterPriceHidden(hiddenId, NOW + 1);
      }
      return originalRecordUnlock(input);
    });

    await syncTrustAfterPriceRestored(hiddenId, NOW + 1);

    expect((await findCommunityPriceObservation(hiddenId)).observation?.hidden).toBe(true);
    expect((await priceTrustEventStore().liveEventsFor(VENUE, "beer")).events).toEqual([]);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });
  });

  it("writes a reversal, revokes visible credit, and replaces when remaining evidence still qualifies", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const profileC = await onboard(USER_C, "cara_pint");
    const hiddenId = await logPrice("alice_pint", profileA, 4.2, NOW - 4_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 3_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 3_000);
    await logPrice("cara_pint", profileC, 4.2, NOW - 500);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 500);

    const { observation } = await findCommunityPriceObservation(hiddenId);
    expect(observation?.id).toBe(hiddenId);

    const { moderateCommunityPrice } = await import("@/lib/communityPriceStore");
    expect(await moderateCommunityPrice(hiddenId, true, "menu mismatch")).toBe(true);
    await syncTrustAfterPriceHidden(hiddenId, NOW);

    expect(await readPriceTrustImpact(USER_A)).toEqual({
      status: "ready",
      observationsLogged: 0,
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact(USER_B)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact(USER_C)).toEqual({
      status: "ready",
      observationsLogged: 1,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
    expect((await priceTrustEventStore().liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
  });

  it("names the trust event whose reversal write failed instead of moving on", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const profileC = await onboard(USER_C, "cara_pint");
    const hiddenId = await logPrice("alice_pint", profileA, 4.2, NOW - 4_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 3_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 3_000);
    await logPrice("cara_pint", profileC, 4.2, NOW - 500);

    const covering = await priceTrustEventStore().liveEventsCovering(hiddenId);
    expect(covering.events).toHaveLength(1);
    const standingEventId = covering.events[0].id;

    const store = priceTrustEventStore();
    const recordUnlock = vi
      .spyOn(store, "recordUnlock")
      .mockResolvedValue({ event: null, created: false, failed: true as const });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { moderateCommunityPrice } = await import("@/lib/communityPriceStore");
    expect(await moderateCommunityPrice(hiddenId, true, "menu mismatch")).toBe(true);
    expect(await syncTrustAfterPriceHidden(hiddenId, NOW)).toEqual({
      status: "unavailable",
    });

    expect(recordUnlock).toHaveBeenCalledTimes(1);
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes(standingEventId)),
    ).toBe(true);
  });

  it("reports an unavailable replacement and repairs it on retry", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const profileC = await onboard(USER_C, "cara_pint");
    const hiddenId = await logPrice("alice_pint", profileA, 4.2, NOW - 4_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 3_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 3_000);
    await logPrice("cara_pint", profileC, 4.2, NOW - 500);

    const store = priceTrustEventStore();
    const originalRecordUnlock = store.recordUnlock.bind(store);
    let replacementFailed = false;
    vi.spyOn(store, "recordUnlock").mockImplementation(async (input) => {
      if (!input.reversalOf && !replacementFailed) {
        replacementFailed = true;
        return { event: null, created: false, failed: true };
      }
      return originalRecordUnlock(input);
    });

    expect(await moderateCommunityPrice(hiddenId, true, "menu mismatch")).toBe(true);
    expect(await syncTrustAfterPriceHidden(hiddenId, NOW)).toEqual({
      status: "unavailable",
    });
    expect((await store.liveEventsFor(VENUE, "beer")).events).toEqual([]);
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({
      lifetimeTrustUnlocks: 0,
    });

    expect(await syncTrustAfterPriceHidden(hiddenId, NOW + 1)).toEqual({
      status: "synced",
    });
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
    expect(await readPriceTrustImpact(USER_C)).toMatchObject({
      lifetimeTrustUnlocks: 1,
    });
  });
});

describe("reconcilePriceTrustForObservation", () => {
  it("creates a missing visible unlock, repairs credits, and acknowledges its pair task", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);

    const store = priceTrustEventStore();
    const recordUnlock = vi
      .spyOn(store, "recordUnlock")
      .mockResolvedValueOnce({ event: null, created: false, failed: true });
    expect(await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000)).toEqual({
      status: "unavailable",
    });
    expect((await store.liveEventsFor(VENUE, "beer")).events).toEqual([]);
    expect((await store.listPendingReconciliations(20)).tasks).toHaveLength(1);
    recordUnlock.mockRestore();

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "synced",
    });

    expect((await store.liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
    expect((await store.listPendingReconciliations(20)).tasks).toEqual([]);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({ lifetimeTrustUnlocks: 1 });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({ lifetimeTrustUnlocks: 1 });
  });

  it("repairs missing credits on an existing visible event and acknowledges its pair task", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);

    const store = priceTrustEventStore();
    const ensureCredits = vi
      .spyOn(store, "ensureCredits")
      .mockResolvedValueOnce({ failed: true });
    expect(await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000)).toEqual({
      status: "unavailable",
    });
    expect((await store.liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
    expect((await store.listPendingReconciliations(20)).tasks).toHaveLength(1);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({ lifetimeTrustUnlocks: 0 });
    ensureCredits.mockRestore();

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "synced",
    });

    expect((await store.liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
    expect((await store.listPendingReconciliations(20)).tasks).toEqual([]);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({ lifetimeTrustUnlocks: 1 });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({ lifetimeTrustUnlocks: 1 });
  });

  it("converges to hidden when moderation lands during visible reconciliation", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);

    const store = priceTrustEventStore();
    const originalRecordUnlock = store.recordUnlock.bind(store);
    let hidden = false;
    vi.spyOn(store, "recordUnlock").mockImplementation(async (input) => {
      if (!input.reversalOf && !hidden) {
        hidden = true;
        expect(await moderateCommunityPrice(observationId, true)).toBe(true);
      }
      return originalRecordUnlock(input);
    });

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "synced",
    });

    expect((await findCommunityPriceObservation(observationId)).observation?.hidden).toBe(true);
    expect((await store.liveEventsFor(VENUE, "beer")).events).toEqual([]);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({ lifetimeTrustUnlocks: 0 });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({ lifetimeTrustUnlocks: 0 });
  });

  it("converges to visible when restoration lands during hidden reconciliation", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);
    expect(await moderateCommunityPrice(observationId, true)).toBe(true);

    const store = priceTrustEventStore();
    const originalRecordUnlock = store.recordUnlock.bind(store);
    let restored = false;
    vi.spyOn(store, "recordUnlock").mockImplementation(async (input) => {
      if (input.reversalOf && !restored) {
        restored = true;
        expect(await moderateCommunityPrice(observationId, false)).toBe(true);
      }
      return originalRecordUnlock(input);
    });

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "synced",
    });

    expect((await findCommunityPriceObservation(observationId)).observation?.hidden).toBe(false);
    expect((await store.liveEventsFor(VENUE, "beer")).events).toHaveLength(1);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({ lifetimeTrustUnlocks: 1 });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({ lifetimeTrustUnlocks: 1 });
  });

  it("acknowledges a pending pair task after hidden reconciliation reverses its trust", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);

    const store = priceTrustEventStore();
    const ensureCredits = vi
      .spyOn(store, "ensureCredits")
      .mockResolvedValueOnce({ failed: true });
    expect(await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000)).toEqual({
      status: "unavailable",
    });
    expect((await store.listPendingReconciliations(20)).tasks).toHaveLength(1);
    ensureCredits.mockRestore();
    expect(await moderateCommunityPrice(observationId, true)).toBe(true);

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "synced",
    });

    expect((await store.liveEventsFor(VENUE, "beer")).events).toEqual([]);
    expect((await store.listPendingReconciliations(20)).tasks).toEqual([]);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({ lifetimeTrustUnlocks: 0 });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({ lifetimeTrustUnlocks: 0 });
  });

  it("detects a hidden-visible-hidden ABA revision before reporting synced", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);
    expect(await moderateCommunityPrice(observationId, true)).toBe(true);
    const initial = (await findCommunityPriceObservation(observationId)).observation;
    expect(initial?.hidden).toBe(true);

    const store = priceTrustEventStore();
    const originalEnqueue = store.enqueueReconciliation.bind(store);
    const originalRecordUnlock = store.recordUnlock.bind(store);
    let restored = false;
    let hiddenAgain = false;
    vi.spyOn(store, "enqueueReconciliation").mockImplementation(async (...args) => {
      if (!restored) {
        restored = true;
        expect(await moderateCommunityPrice(observationId, false)).toBe(true);
      }
      return originalEnqueue(...args);
    });
    vi.spyOn(store, "recordUnlock").mockImplementation(async (input) => {
      if (!input.reversalOf && restored && !hiddenAgain) {
        hiddenAgain = true;
        expect(await moderateCommunityPrice(observationId, true)).toBe(true);
      }
      return originalRecordUnlock(input);
    });

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "synced",
    });

    const final = (await findCommunityPriceObservation(observationId)).observation;
    expect(final?.hidden).toBe(true);
    expect((await store.liveEventsCovering(observationId)).events).toEqual([]);
    expect(await readPriceTrustImpact(USER_A)).toMatchObject({
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });
    expect(await readPriceTrustImpact(USER_B)).toMatchObject({
      pricesTrustedNow: 0,
      lifetimeTrustUnlocks: 0,
    });
    expect((await store.listPendingReconciliations(20)).tasks).toEqual([]);
  });

  it("keeps final-attempt hidden-visible-hidden ABA queued instead of acknowledging transient trust", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);
    expect(await moderateCommunityPrice(observationId, true)).toBe(true);

    const store = priceTrustEventStore();
    const originalEnqueue = store.enqueueReconciliation.bind(store);
    const originalRecordUnlock = store.recordUnlock.bind(store);
    let abaCycles = 0;
    vi.spyOn(store, "enqueueReconciliation").mockImplementation(async (...args) => {
      const current = (await findCommunityPriceObservation(observationId)).observation;
      if (current?.hidden) {
        expect(await moderateCommunityPrice(observationId, false)).toBe(true);
      }
      return originalEnqueue(...args);
    });
    vi.spyOn(store, "recordUnlock").mockImplementation(async (input) => {
      const current = (await findCommunityPriceObservation(observationId)).observation;
      if (!input.reversalOf && current && !current.hidden) {
        expect(await moderateCommunityPrice(observationId, true)).toBe(true);
        abaCycles += 1;
      }
      return originalRecordUnlock(input);
    });

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "unavailable",
    });

    expect(abaCycles).toBe(3);
    expect((await findCommunityPriceObservation(observationId)).observation?.hidden).toBe(true);
    expect((await store.listPendingReconciliations(20)).tasks).toHaveLength(1);
  });

  it("keeps final-attempt visible-hidden-visible ABA queued when current trust is missing", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);

    const store = priceTrustEventStore();
    const originalEnqueue = store.enqueueReconciliation.bind(store);
    const originalLiveEventsFor = store.liveEventsFor.bind(store);
    let abaCycles = 0;
    vi.spyOn(store, "enqueueReconciliation").mockImplementation(async (...args) => {
      const current = (await findCommunityPriceObservation(observationId)).observation;
      if (current && !current.hidden) {
        expect(await moderateCommunityPrice(observationId, true)).toBe(true);
      }
      return originalEnqueue(...args);
    });
    vi.spyOn(store, "liveEventsFor").mockImplementation(async (...args) => {
      const current = (await findCommunityPriceObservation(observationId)).observation;
      if (current?.hidden) {
        expect(await moderateCommunityPrice(observationId, false)).toBe(true);
        abaCycles += 1;
      }
      return originalLiveEventsFor(...args);
    });

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "unavailable",
    });

    expect(abaCycles).toBe(3);
    expect((await findCommunityPriceObservation(observationId)).observation?.hidden).toBe(false);
    expect((await store.liveEventsFor(VENUE, "beer")).events).toEqual([]);
    expect((await store.listPendingReconciliations(20)).tasks).toHaveLength(1);
  });

  it("returns unavailable when repeated visibility handoffs exhaust one shared budget", async () => {
    const profileA = await onboard(USER_A, "alice_pint");
    const profileB = await onboard(USER_B, "bob_pint");
    const observationId = await logPrice("alice_pint", profileA, 4.2, NOW - 3_000);
    await logPrice("bob_pint", profileB, 4.2, NOW - 2_000);
    await syncTrustAfterPriceWrite(VENUE, "beer", NOW - 2_000);
    expect(await moderateCommunityPrice(observationId, true)).toBe(true);

    const store = priceTrustEventStore();
    const originalRecordUnlock = store.recordUnlock.bind(store);
    let handoffs = 0;
    vi.spyOn(store, "recordUnlock").mockImplementation(async (input) => {
      if (handoffs < 3) {
        const nextHidden = !input.reversalOf;
        const current = (await findCommunityPriceObservation(observationId)).observation;
        if (current?.hidden !== nextHidden) {
          expect(await moderateCommunityPrice(observationId, nextHidden)).toBe(true);
          handoffs += 1;
        }
      }
      return originalRecordUnlock(input);
    });

    expect(await reconcilePriceTrustForObservation(observationId, NOW)).toEqual({
      status: "unavailable",
    });
    expect(handoffs).toBeLessThanOrEqual(3);
  });
});

describe("readPriceTrustImpact", () => {
  it("does not answer zeros when a store read is degraded", async () => {
    await onboard(USER_A, "alice_pint");
    vi.spyOn(priceTrustEventStore(), "readVisibleImpact").mockResolvedValue({
      lifetimeTrustUnlocks: 0,
      eventIds: [],
      events: [],
      degraded: true,
    });
    expect(await readPriceTrustImpact(USER_A)).toEqual({ status: "degraded" });
  });
});
