import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NightMoment, PublicNightStory } from "@/lib/nightMemory";
import type { PintDrop } from "@/lib/pintDropShared";

const state = vi.hoisted(() => ({
  source: null as { story: PublicNightStory; moments: NightMoment[] } | null,
  venueIndex: new Map<string, { id: string; name: string; borough: string; lat: number; lng: number }>(),
  dropsByVenue: new Map<string, PintDrop[]>(),
  profileByUserId: new Map<string, { displayName?: string; handle: string }>(),
  venueReads: 0,
  dropReads: [] as string[],
  activeDropReads: 0,
  peakDropReads: 0,
  profileReads: [] as string[],
}));

vi.mock("@/lib/nightMemoryStore", () => ({
  getPublishedRecapSource: vi.fn(async () => state.source),
}));

vi.mock("@/lib/venueIndex", () => ({
  getVenueIndex: vi.fn(async () => {
    state.venueReads += 1;
    return state.venueIndex;
  }),
}));

vi.mock("@/lib/pintDropsStore", () => ({
  pintDropsStore: () => ({
    listVisible: vi.fn(async (venueId: string) => {
      state.dropReads.push(venueId);
      state.activeDropReads += 1;
      state.peakDropReads = Math.max(state.peakDropReads, state.activeDropReads);
      const drops = state.dropsByVenue.get(venueId);
      await new Promise((resolve) => setTimeout(resolve, 0));
      state.activeDropReads -= 1;
      if (drops === undefined) throw new Error(`drop read failed for ${venueId}`);
      return drops;
    }),
  }),
}));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getByUserId: vi.fn(async (userId: string) => {
      state.profileReads.push(userId);
      return state.profileByUserId.get(userId) ?? null;
    }),
  }),
}));

import { recapCardStats } from "@/lib/recapCardStats.server";

const story: PublicNightStory = {
  id: "story-1",
  title: "A Bermondsey night",
  summary: "",
  status: "published",
  visibility: "public",
  legacyCrawlStoryId: null,
  publishedMomentIds: ["stop-1", "stop-2", "event-1", "pint-1", "pint-2", "pint-outside"],
  publishedAt: "2026-08-20T09:00:00.000Z",
  createdAt: "2026-08-19T20:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
};

function moment(overrides: Partial<NightMoment> & Pick<NightMoment, "id" | "ownerId" | "kind">): NightMoment {
  return {
    id: overrides.id,
    memoryId: "private-memory-id",
    ownerId: overrides.ownerId,
    kind: overrides.kind,
    caption: overrides.caption ?? "",
    pintDropId: overrides.pintDropId ?? null,
    venueId: overrides.venueId ?? null,
    mediaObjectKey: overrides.mediaObjectKey ?? null,
    occurredAt: overrides.occurredAt ?? "2026-08-19T20:00:00.000Z",
    visibility: "private",
    altText: null,
    altTextConfirmedAt: null,
    createdAt: "2026-08-19T20:00:00.000Z",
  };
}

function drop(overrides: Partial<PintDrop> & Pick<PintDrop, "id" | "venueId">): PintDrop {
  return {
    handle: "public-contributor",
    drink: "Neck Oil",
    priceGbp: 4.2,
    passedDownNote: "",
    era: "now",
    provenance: "contributor",
    status: "visible",
    createdAt: "2026-08-19T21:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  state.source = {
    story,
    // This is the already-redacted public set. The private memory id is
    // intentionally present only to prove the composer remains server-side;
    // no private contributor or consent read belongs in recapCardStats.
    moments: [
      moment({ id: "stop-1", ownerId: "user-sam", kind: "venue", venueId: "venue-a" }),
      moment({ id: "stop-2", ownerId: "user-priya", kind: "venue", venueId: "venue-b" }),
      // A non-route moment can name a venue, but it must not invent another
      // borough crossed by the route.
      moment({ id: "event-1", ownerId: "user-sam", kind: "event", venueId: "venue-c" }),
      moment({
        id: "pint-1",
        ownerId: "user-sam",
        kind: "pint_drop",
        venueId: "venue-a",
        pintDropId: "drop-a",
      }),
      moment({
        id: "pint-2",
        ownerId: "user-priya",
        kind: "pint_drop",
        venueId: "venue-b",
        pintDropId: "drop-b",
      }),
      moment({
        id: "pint-outside",
        ownerId: "user-sam",
        kind: "pint_drop",
        venueId: "venue-d",
        pintDropId: "drop-outside",
      }),
    ],
  };
  state.venueIndex = new Map([
    ["venue-a", { id: "venue-a", name: "The First", borough: "Southwark", lat: 51.49, lng: -0.08 }],
    ["venue-b", { id: "venue-b", name: "The Second", borough: "Lambeth", lat: 51.49, lng: -0.09 }],
    ["venue-c", { id: "venue-c", name: "The Event", borough: "Camden", lat: 51.54, lng: -0.14 }],
    ["venue-d", { id: "venue-d", name: "The Pint Only", borough: "Camden", lat: 51.54, lng: -0.14 }],
  ]);
  state.dropsByVenue = new Map([
    ["venue-a", [drop({ id: "drop-a", venueId: "venue-a", priceGbp: 4.2 })]],
    ["venue-b", [drop({ id: "drop-b", venueId: "venue-b", priceGbp: 5.1 })]],
    ["venue-d", [drop({ id: "drop-outside", venueId: "venue-d", priceGbp: 3.8 })]],
  ]);
  state.profileByUserId = new Map([
    ["user-sam", { displayName: "Sam", handle: "sam" }],
    ["user-priya", { displayName: "Priya", handle: "priya" }],
    // A contributor redacted from public moments must not be read for crew.
    ["departed-user", { displayName: "Departed", handle: "departed" }],
  ]);
  state.venueReads = 0;
  state.dropReads = [];
  state.activeDropReads = 0;
  state.peakDropReads = 0;
  state.profileReads = [];
});

describe("recapCardStats", () => {
  it("composes stats from the public source, public drops, and known boroughs without crew identity reads", async () => {
    const result = await recapCardStats("story-1");
    expect(result).toEqual({
      stopCount: 2,
      pintsLogged: 3,
      boroughsCrossed: 2,
      ending: null,
      cheapestPintGbp: 3.8,
      crew: [],
      nightDateIso: story.publishedAt,
    });
    expect(JSON.stringify(result)).not.toContain("private-memory-id");
    expect(state.venueReads).toBe(1);
    expect(state.dropReads.sort()).toEqual(["venue-a", "venue-b", "venue-d"]);
    expect(state.profileReads).toEqual([]);
  });

  it("keeps public stats when one pint-drop join fails and venue resolution is partial", async () => {
    state.dropsByVenue = new Map([["venue-a", [drop({ id: "drop-a", venueId: "venue-a", priceGbp: 4.2 })]]]);
    state.venueIndex.delete("venue-b");
    await expect(recapCardStats("story-1")).resolves.toMatchObject({
      stopCount: 2,
      pintsLogged: 3,
      boroughsCrossed: 1,
      cheapestPintGbp: null,
      crew: [],
    });
    expect(state.profileReads).toEqual([]);
  });

  it("caps Pint Drop venue enrichment and bounds in-flight public reads", async () => {
    const venueCount = 13;
    const manyVenues = Array.from({ length: venueCount }, (_, index) => `venue-${index}`);
    const manyMoments = manyVenues.flatMap((venueId, index) => [
      moment({ id: `stop-${index}`, ownerId: "user-sam", kind: "venue", venueId }),
      moment({ id: `pint-${index}`, ownerId: "user-sam", kind: "pint_drop", venueId, pintDropId: `drop-${index}` }),
    ]);
    state.source = {
      story: {
        ...story,
        publishedMomentIds: manyMoments.map((item) => item.id),
      },
      moments: manyMoments,
    };
    state.venueIndex = new Map(
      manyVenues.map((venueId, index) => [
        venueId,
        { id: venueId, name: `Venue ${index}`, borough: `Borough ${index}`, lat: 51.5, lng: -0.1 },
      ]),
    );
    state.dropsByVenue = new Map(
      manyVenues.map((venueId, index) => [venueId, [drop({ id: `drop-${index}`, venueId })]]),
    );

    const result = await recapCardStats("story-many");

    expect(result?.stopCount).toBe(venueCount);
    expect(result?.pintsLogged).toBe(venueCount);
    expect(result?.cheapestPintGbp).toBeNull();
    expect(state.dropReads.length).toBeLessThanOrEqual(12);
    expect(state.peakDropReads).toBeLessThanOrEqual(4);
    expect(state.profileReads).toEqual([]);
  });

  it("returns null without a public published source and performs no joins", async () => {
    state.source = null;
    await expect(recapCardStats("private-story")).resolves.toBeNull();
    expect(state.venueReads).toBe(0);
    expect(state.dropReads).toEqual([]);
    expect(state.profileReads).toEqual([]);
  });
});
