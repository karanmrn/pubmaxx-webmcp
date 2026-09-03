import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanAnchorMetadata, PlanStopDTO } from "@/lib/plan";
import { planRouteReady } from "@/lib/plan";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";

const ANCHOR_ONLY: PlanAnchorMetadata = { venueId: "venue-a", source: "near", outcome: "anchor-only" };

function createInput(stops: Array<{ venueId: string; venueName: string }>) {
  return { title: "Tonight", startTime: "2026-07-24T19:00:00.000Z", creatorName: "Host", stops };
}

function routeStops(): PlanStopDTO[] {
  return [
    { venueId: "venue-a", venueName: "Venue A", position: 0 },
    { venueId: "venue-b", venueName: "Venue B", position: 1 },
    { venueId: "venue-c", venueName: "Venue C", position: 2 },
  ];
}

async function createAnchorOnly() {
  const result = await memoryPlanStore.create(
    createInput([{ venueId: "venue-a", venueName: "Venue A" }]),
    { idempotencyKey: "op-lifecycle-1", anchor: ANCHOR_ONLY },
  );
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("grounded one-Stop Plan lifecycle", () => {
  beforeEach(() => __resetMemoryPlans());
  afterEach(() => __resetMemoryPlans());

  it("persists a one-Stop anchor-only draft that is never route-ready", async () => {
    const result = await createAnchorOnly();
    expect(result.plan.stops).toHaveLength(1);
    expect(result.plan.plan).toMatchObject({
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "anchor-only",
      routeReadyAt: null,
      status: "draft",
    });
    expect(planRouteReady(result.plan.plan, result.plan.stops.length)).toBe(false);
  });

  it("stamps route_ready_at at creation for a grounded three-Stop route", async () => {
    const result = await memoryPlanStore.create(
      createInput([
        { venueId: "venue-a", venueName: "Venue A" },
        { venueId: "venue-b", venueName: "Venue B" },
        { venueId: "venue-c", venueName: "Venue C" },
      ]),
      { idempotencyKey: "op-route-create", anchor: { venueId: "venue-a", source: "near", outcome: "route" } },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.plan.outcome).toBe("route");
    expect(result.plan.plan.routeReadyAt).toBe(result.plan.plan.createdAt);
    expect(planRouteReady(result.plan.plan, result.plan.stops.length)).toBe(true);
  });

  it("rejects anchor metadata inconsistent with the submitted Stops", async () => {
    const twoStops = await memoryPlanStore.create(
      createInput([{ venueId: "venue-a", venueName: "A" }, { venueId: "venue-b", venueName: "B" }]),
      { idempotencyKey: "op-bad-1", anchor: ANCHOR_ONLY },
    );
    expect(twoStops).toEqual({ ok: false, error: "invalid" });

    const wrongAnchor = await memoryPlanStore.create(
      createInput([{ venueId: "venue-x", venueName: "X" }]),
      { idempotencyKey: "op-bad-2", anchor: ANCHOR_ONLY },
    );
    expect(wrongAnchor).toEqual({ ok: false, error: "invalid" });
  });

  it("upgrades the same Plan identity one-to-three, keeping crew and date", async () => {
    const created = await createAnchorOnly();
    const planId = created.plan.plan.id;
    const startTime = created.plan.plan.startTime;
    const crewCount = created.plan.crew.length;

    const upgraded = await memoryPlanStore.update(planId, created.memberToken, {
      stops: routeStops(),
      expectedRouteRevision: 1,
      groundedUpgrade: true,
    });
    if (!upgraded.ok) throw new Error(upgraded.error);
    expect(upgraded.plan.plan.id).toBe(planId);
    expect(upgraded.plan.plan.startTime).toBe(startTime);
    expect(upgraded.plan.crew).toHaveLength(crewCount);
    expect(upgraded.plan.stops).toHaveLength(3);
    expect(upgraded.plan.stops[0].venueId).toBe("venue-a");
    expect(upgraded.plan.plan.outcome).toBe("route");
    expect(upgraded.plan.plan.routeReadyAt).toEqual(expect.any(String));
    expect(planRouteReady(upgraded.plan.plan, upgraded.plan.stops.length)).toBe(true);
  });

  it("refuses to upgrade an anchored draft without a verified grounded route", async () => {
    const created = await createAnchorOnly();
    const unverified = await memoryPlanStore.update(created.plan.plan.id, created.memberToken, {
      stops: routeStops(),
      expectedRouteRevision: 1,
    });
    expect(unverified).toEqual({ ok: false, error: "forbidden" });
    const stillDraft = await memoryPlanStore.get(created.plan.plan.id);
    expect(stillDraft?.plan.routeReadyAt).toBeNull();
  });

  it("stamps route_ready_at once — a later route edit never moves it", async () => {
    const created = await createAnchorOnly();
    const token = created.memberToken;
    const first = await memoryPlanStore.update(created.plan.plan.id, token, { stops: routeStops(), expectedRouteRevision: 1, groundedUpgrade: true });
    if (!first.ok) throw new Error(first.error);
    const readyAt = first.plan.plan.routeReadyAt;

    const second = await memoryPlanStore.update(created.plan.plan.id, token, {
      stops: [
        { venueId: "venue-a", venueName: "Venue A", position: 0 },
        { venueId: "venue-d", venueName: "Venue D", position: 1 },
        { venueId: "venue-e", venueName: "Venue E", position: 2 },
      ],
      expectedRouteRevision: 2,
      groundedUpgrade: true,
    });
    if (!second.ok) throw new Error(second.error);
    expect(second.plan.plan.routeReadyAt).toBe(readyAt);
  });

  it("keeps the anchor at Stop 1 — a route that moves it is forbidden", async () => {
    const created = await createAnchorOnly();
    const moved = await memoryPlanStore.update(created.plan.plan.id, created.memberToken, {
      stops: [
        { venueId: "venue-b", venueName: "Venue B", position: 0 },
        { venueId: "venue-a", venueName: "Venue A", position: 1 },
        { venueId: "venue-c", venueName: "Venue C", position: 2 },
      ],
      expectedRouteRevision: 1,
      groundedUpgrade: true,
    });
    expect(moved).toEqual({ ok: false, error: "forbidden" });
  });

  it("treats a duplicate upgrade at a stale revision as a conflict, not a second transition", async () => {
    const created = await createAnchorOnly();
    const first = await memoryPlanStore.update(created.plan.plan.id, created.memberToken, { stops: routeStops(), expectedRouteRevision: 1, groundedUpgrade: true });
    expect(first.ok).toBe(true);
    const duplicate = await memoryPlanStore.update(created.plan.plan.id, created.memberToken, { stops: routeStops(), expectedRouteRevision: 1, groundedUpgrade: true });
    expect(duplicate).toEqual({ ok: false, error: "conflict" });
  });

  it("replays an identical anchored create and conflicts on a changed anchor", async () => {
    const first = await createAnchorOnly();
    const replay = await memoryPlanStore.create(
      createInput([{ venueId: "venue-a", venueName: "Venue A" }]),
      { idempotencyKey: "op-lifecycle-1", anchor: ANCHOR_ONLY },
    );
    if (!replay.ok) throw new Error(replay.error);
    expect(replay.created).toBe(false);
    expect(replay.plan.plan.id).toBe(first.plan.plan.id);

    const changed = await memoryPlanStore.create(
      createInput([{ venueId: "venue-z", venueName: "Venue Z" }]),
      { idempotencyKey: "op-lifecycle-1", anchor: { venueId: "venue-z", source: "pal", outcome: "anchor-only" } },
    );
    expect(changed).toEqual({ ok: false, error: "conflict" });
  });

  it("leaves legacy manual Plans free of anchor lifecycle metadata", async () => {
    const legacy = await memoryPlanStore.create(
      createInput([
        { venueId: "venue-a", venueName: "Venue A" },
        { venueId: "venue-b", venueName: "Venue B" },
        { venueId: "venue-c", venueName: "Venue C" },
      ]),
      { idempotencyKey: "op-legacy-1" },
    );
    if (!legacy.ok) throw new Error(legacy.error);
    expect(legacy.plan.plan.outcome).toBeNull();
    expect(legacy.plan.plan.routeReadyAt).toBeNull();
    expect(legacy.plan.plan.anchorVenueId).toBeNull();
    expect(planRouteReady(legacy.plan.plan, legacy.plan.stops.length)).toBe(false);

    // A legacy route edit needs no grounded-upgrade flag and never invents
    // route-ready metadata.
    const edited = await memoryPlanStore.update(legacy.plan.plan.id, legacy.memberToken, {
      stops: [
        { venueId: "venue-b", venueName: "Venue B", position: 0 },
        { venueId: "venue-c", venueName: "Venue C", position: 1 },
        { venueId: "venue-d", venueName: "Venue D", position: 2 },
      ],
      expectedRouteRevision: 1,
    });
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.plan.plan.routeReadyAt).toBeNull();
    expect(edited.plan.plan.outcome).toBeNull();
  });

  it("lets a one-Stop draft complete after a host arrival", async () => {
    const created = await createAnchorOnly();
    const id = created.plan.plan.id;
    await memoryPlanStore.update(id, created.memberToken, { status: "ready" });
    const arrived = await memoryPlanStore.addAction(id, created.memberToken, { type: "arrived", stopPosition: 0, idempotencyKey: "arrive-key-1" });
    expect(arrived.ok).toBe(true);
    const completion = await memoryPlanStore.complete(id, created.memberToken, {
      expectedRouteRevision: 1,
      ending: "get_home",
      endingSelection: { kind: "get_home", optionId: "walk", evidenceSnapshot: { label: "Walk home", confidence: "high" } },
    });
    if (!completion.ok) throw new Error(completion.error);
    expect(completion.completion.routeSnapshot).toHaveLength(1);
    expect(completion.plan.plan.status).toBe("completed");
  });

  it("blocks a guest from swapping the anchor Stop", async () => {
    const created = await createAnchorOnly();
    const id = created.plan.plan.id;
    const upgraded = await memoryPlanStore.update(id, created.memberToken, { stops: routeStops(), expectedRouteRevision: 1, groundedUpgrade: true });
    expect(upgraded.ok).toBe(true);
    const guest = await memoryPlanStore.join(id, "Guest", { collaborationAuthorized: true, idempotencyKey: "join-key-1" });
    if (!guest.ok) throw new Error(guest.error);
    const swap = await memoryPlanStore.addAction(id, guest.memberToken, { type: "swapped", stopPosition: 0, idempotencyKey: "swap-key-1" });
    expect(swap).toEqual({ ok: false, error: "forbidden" });
  });
});
