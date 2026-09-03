import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  firstQualifyingCluster,
  reversalFingerprint,
  trustEventFingerprint,
  type TrustObservation,
} from "@/lib/priceTrustEvents";
import {
  __resetMemoryPriceTrustEvents,
  memoryPriceTrustEventStore,
  priceTrustEventStore,
} from "@/lib/priceTrustEventStore";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => {
    throw new Error(
      "Could not find the table 'public.price_trust_events' in the schema cache",
    );
  },
}));

const NOW = Date.parse("2026-08-16T18:00:00.000Z");
const USER_A = "00000000-0000-4000-8000-0000000000aa";
const USER_B = "00000000-0000-4000-8000-0000000000bb";
const USER_C = "00000000-0000-4000-8000-0000000000cc";

function rows(): TrustObservation[] {
  return [
    {
      id: "obs-a",
      venueId: "venue-one",
      drinkCategory: "beer",
      priceGbp: 4.2,
      submittedAt: NOW - 3_000,
      actor: "profile:aaa",
    },
    {
      id: "obs-b",
      venueId: "venue-one",
      drinkCategory: "beer",
      priceGbp: 4.2,
      submittedAt: NOW - 2_000,
      actor: "profile:bbb",
    },
  ];
}

beforeEach(() => {
  __resetMemoryPriceTrustEvents();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("priceTrustEventStore", () => {
  it("does not acknowledge a newer pending pair with an older queue version", async () => {
    const queue = priceTrustEventStore();
    const first = await queue.enqueueReconciliation("venue-one", "beer", NOW);
    expect(first).toEqual({
      task: {
        venueId: "venue-one",
        category: "beer",
        version: 1,
        enqueuedAt: new Date(NOW).toISOString(),
      },
    });

    const newer = await queue.enqueueReconciliation("venue-one", "beer", NOW + 1);
    expect(newer).toEqual({
      task: {
        venueId: "venue-one",
        category: "beer",
        version: 2,
        enqueuedAt: new Date(NOW + 1).toISOString(),
      },
    });
    expect(first.task).not.toBeNull();
    expect(newer.task).not.toBeNull();

    expect(await queue.ackReconciliation(first.task!)).toEqual({
      acknowledged: false,
    });
    expect(await queue.listPendingReconciliations(10)).toEqual({
      tasks: [newer.task],
      degraded: false,
    });

    expect(await queue.ackReconciliation(newer.task!)).toEqual({
      acknowledged: true,
    });
    expect(await queue.listPendingReconciliations(10)).toEqual({
      tasks: [],
      degraded: false,
    });

    const recreated = await queue.enqueueReconciliation(
      "venue-one",
      "beer",
      NOW + 2,
    );
    expect(recreated.task?.version).toBe(3);
    expect(await queue.ackReconciliation(newer.task!)).toEqual({
      acknowledged: false,
    });
    expect((await queue.listPendingReconciliations(10)).tasks).toEqual([
      recreated.task,
    ]);
  });

  it("credits every independent contributor in the first cluster once", async () => {
    const cluster = firstQualifyingCluster(rows(), NOW);
    expect(cluster).not.toBeNull();
    const fingerprint = trustEventFingerprint(
      "venue-one",
      "beer",
      cluster!.observationIds,
    );
    const first = await priceTrustEventStore().recordUnlock({
      fingerprint,
      venueId: "venue-one",
      category: "beer",
      observationIds: cluster!.observationIds,
      userIds: [USER_A, USER_B],
      now: NOW,
    });
    expect(first.created).toBe(true);
    expect(first.event?.evidenceFingerprint).toBe(fingerprint);

    const again = await priceTrustEventStore().recordUnlock({
      fingerprint,
      venueId: "venue-one",
      category: "beer",
      observationIds: cluster!.observationIds,
      userIds: [USER_A, USER_B, USER_C],
      now: NOW + 1,
    });
    expect(again.created).toBe(false);
    expect(again.event?.id).toBe(first.event?.id);

    const a = await priceTrustEventStore().readVisibleImpact(USER_A);
    const b = await priceTrustEventStore().readVisibleImpact(USER_B);
    const c = await priceTrustEventStore().readVisibleImpact(USER_C);
    expect(a.lifetimeTrustUnlocks).toBe(1);
    expect(b.lifetimeTrustUnlocks).toBe(1);
    expect(c.lifetimeTrustUnlocks).toBe(1);
  });

  it("treats a double-submit race as one event", async () => {
    const cluster = firstQualifyingCluster(rows(), NOW)!;
    const fingerprint = trustEventFingerprint(
      "venue-one",
      "beer",
      cluster.observationIds,
    );
    const input = {
      fingerprint,
      venueId: "venue-one" as const,
      category: "beer" as const,
      observationIds: cluster.observationIds,
      userIds: [USER_A, USER_B],
      now: NOW,
    };
    const [left, right] = await Promise.all([
      priceTrustEventStore().recordUnlock(input),
      priceTrustEventStore().recordUnlock(input),
    ]);
    expect(left.event?.id).toBe(right.event?.id);
    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    const live = await priceTrustEventStore().liveEventsFor("venue-one", "beer");
    expect(live.events).toHaveLength(1);
    expect((await priceTrustEventStore().readVisibleImpact(USER_A)).lifetimeTrustUnlocks).toBe(
      1,
    );
  });

  it("reverses visible credit and can replace with the remaining cluster", async () => {
    const firstCluster = firstQualifyingCluster(rows(), NOW)!;
    const firstFingerprint = trustEventFingerprint(
      "venue-one",
      "beer",
      firstCluster.observationIds,
    );
    const original = await priceTrustEventStore().recordUnlock({
      fingerprint: firstFingerprint,
      venueId: "venue-one",
      category: "beer",
      observationIds: firstCluster.observationIds,
      userIds: [USER_A, USER_B],
      now: NOW,
    });
    expect(original.event).not.toBeNull();

    const covering = await priceTrustEventStore().liveEventsCovering("obs-a");
    expect(covering.events.map((event) => event.id)).toEqual([original.event!.id]);

    await priceTrustEventStore().recordUnlock({
      fingerprint: reversalFingerprint(firstFingerprint),
      venueId: "venue-one",
      category: "beer",
      observationIds: [],
      userIds: [],
      reversalOf: original.event!.id,
      now: NOW + 1,
    });

    expect((await priceTrustEventStore().readVisibleImpact(USER_A)).lifetimeTrustUnlocks).toBe(
      0,
    );
    expect((await priceTrustEventStore().liveEventsFor("venue-one", "beer")).events).toEqual(
      [],
    );

    const replacementRows: TrustObservation[] = [
      {
        id: "obs-b",
        venueId: "venue-one",
        drinkCategory: "beer",
        priceGbp: 4.2,
        submittedAt: NOW - 2_000,
        actor: "profile:bbb",
      },
      {
        id: "obs-c",
        venueId: "venue-one",
        drinkCategory: "beer",
        priceGbp: 4.2,
        submittedAt: NOW - 500,
        actor: "profile:ccc",
      },
    ];
    const replacement = firstQualifyingCluster(replacementRows, NOW)!;
    const replacementFingerprint = trustEventFingerprint(
      "venue-one",
      "beer",
      replacement.observationIds,
    );
    expect(replacementFingerprint).not.toBe(firstFingerprint);
    await priceTrustEventStore().recordUnlock({
      fingerprint: replacementFingerprint,
      venueId: "venue-one",
      category: "beer",
      observationIds: replacement.observationIds,
      userIds: [USER_B, USER_C],
      now: NOW + 2,
    });

    expect((await priceTrustEventStore().readVisibleImpact(USER_A)).lifetimeTrustUnlocks).toBe(
      0,
    );
    expect((await priceTrustEventStore().readVisibleImpact(USER_B)).lifetimeTrustUnlocks).toBe(
      1,
    );
    expect((await priceTrustEventStore().readVisibleImpact(USER_C)).lifetimeTrustUnlocks).toBe(
      1,
    );
    expect((await priceTrustEventStore().liveEventsFor("venue-one", "beer")).events).toHaveLength(
      1,
    );
  });

  it("finds the terminal reversal through a repeated cycle with equal timestamps", async () => {
    const original = await memoryPriceTrustEventStore.recordUnlock({
      fingerprint: "unlock-one",
      venueId: "venue-one",
      category: "beer",
      observationIds: ["obs-a", "obs-b"],
      userIds: [USER_A, USER_B],
      now: NOW,
    });
    const firstReversal = await memoryPriceTrustEventStore.recordUnlock({
      fingerprint: "reverse-one",
      venueId: "venue-one",
      category: "beer",
      observationIds: [],
      userIds: [],
      reversalOf: original.event!.id,
      now: NOW,
    });
    const restored = await memoryPriceTrustEventStore.recordUnlock({
      fingerprint: `restored:unlock-one:${firstReversal.event!.id}`,
      venueId: "venue-one",
      category: "beer",
      observationIds: ["obs-a", "obs-b"],
      userIds: [USER_A, USER_B],
      now: NOW,
    });
    const secondReversal = await memoryPriceTrustEventStore.recordUnlock({
      fingerprint: "reverse-two",
      venueId: "venue-one",
      category: "beer",
      observationIds: [],
      userIds: [],
      reversalOf: restored.event!.id,
      now: NOW,
    });

    await expect(
      memoryPriceTrustEventStore.latestReversalCovering("obs-a"),
    ).resolves.toEqual({ event: secondReversal.event, degraded: false });
    await expect(
      memoryPriceTrustEventStore.terminalReversalFor(original.event!),
    ).resolves.toEqual({ event: secondReversal.event, degraded: false });
  });
});
