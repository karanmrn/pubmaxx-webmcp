// The durable What's-On store holds only the bounded London refresh's rows.
// Out's baseline may read it for London alone - London listings under another
// city's query is worse than saying nothing - and a durable read that failed
// must report degraded instead of serving the bundled fallback as "ready".
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const durable = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("@/lib/whatsOnListings.server", () => ({
  loadServedWhatsOnListingsWithFreshness: durable.load,
}));

import { buildOutResponse, loadServedOutEvents } from "@/lib/out/loadOut";
import { buildOutVenueMatchIndex } from "@/lib/out/venueMatch";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-08-27T18:45:00.000Z");

function row(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "tm-white-hart-jazz",
    placeName: "White Hart, Whitechapel",
    kind: "event",
    startsAt: "2026-08-27T20:00:00+01:00",
    endsAt: "2026-08-27T23:00:00+01:00",
    title: "Live jazz",
    source: { label: "Ticketmaster", url: "https://example.com/jazz" },
    observedAt: "2026-08-27T11:07:30.691Z",
    confidence: "listed",
    venueId: "venue-5cqxbo",
    ...overrides,
  };
}

const venueIndex = buildOutVenueMatchIndex([
  {
    id: "venue-5cqxbo",
    name: "The White Hart",
    borough: "Tower Hamlets",
    lat: 51.5202,
    lng: -0.0562,
  },
]);

const noLiveLane = [
  {
    name: "ticketmaster",
    isConfigured: () => false,
    fetchTonight: async () => [],
  },
];

beforeEach(() => {
  durable.load.mockReset();
});

describe("Out durable listings", () => {
  it("asks the durable store for London events only", async () => {
    durable.load.mockResolvedValueOnce({
      rows: [row()],
      providerObservedAt: "2026-08-27T11:07:30.691Z",
      readStatus: "ready",
    });

    const served = await loadServedOutEvents("london", NOW);

    expect(served.rows.map((item) => item.id)).toEqual(["tm-white-hart-jazz"]);
    expect(served.readStatus).toBe("ready");
    expect(durable.load).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "event" }),
    );
  });

  it("keeps a failed durable read degraded while serving bundled fallback", async () => {
    durable.load.mockResolvedValueOnce({
      rows: [row()],
      providerObservedAt: null,
      readStatus: "degraded",
    });

    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: NOW,
        liveProviders: noLiveLane,
        loadVenueMatchIndex: async () => venueIndex,
      },
    );

    expect(body.listingsStatus).toBe("degraded");
    expect(body.events).toHaveLength(1);
  });

  it("keeps a failed empty durable read degraded instead of not configured", async () => {
    durable.load.mockResolvedValueOnce({
      rows: [],
      providerObservedAt: null,
      readStatus: "degraded",
    });

    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: NOW,
        liveProviders: noLiveLane,
        loadVenueMatchIndex: async () => venueIndex,
      },
    );

    expect(body.listingsStatus).toBe("degraded");
    expect(body.events).toEqual([]);
  });

  it("never reads London durable rows for another city", async () => {
    const served = await loadServedOutEvents("bristol", NOW);

    expect(served.readStatus).toBe("ready");
    expect(durable.load).not.toHaveBeenCalled();
  });
});
