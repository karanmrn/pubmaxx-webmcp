// The London locality filter admits a coordless row only when its London
// provenance is recorded. Durable-store rows are fresh objects, not the
// bundled-parsed ones the WeakSet already holds, so the durable baseline must
// be marked London-verified or a venue-resolved recurring row without
// coordinates silently vanishes from /tonight.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadWhatsOn } from "@/lib/whatsOnStore";

const durable = vi.hoisted(() => ({
  load: vi.fn(),
}));

const durableRows = [
  {
    id: "quiz-qo-pub-quiz-white-hart-whitechapel-thursdays",
    venueId: "venue-5cqxbo",
    placeName: "White Hart, Whitechapel",
    kind: "quiz",
    startsAt: "2026-08-27T20:00:00+01:00",
    title: "Pub quiz - Thursdays 8pm",
    source: {
      label: "Question One",
      url: "https://questionone.com/venues/pub-quiz-white-hart-whitechapel-thursdays/",
    },
    observedAt: "2026-08-27T11:07:30.691Z",
    confidence: "listed",
  },
];

vi.mock("@/lib/whatsOnListings.server", () => ({
  loadServedWhatsOnListingsWithFreshness: durable.load,
}));

beforeEach(() => {
  durable.load.mockReset();
  durable.load.mockResolvedValue({
    rows: durableRows,
    providerObservedAt: "2026-08-27T11:07:30.691Z",
    readStatus: "ready",
  });
});

describe("durable London What's-On locality", () => {
  it("keeps a venue-resolved row from the London durable store without coordinates", async () => {
    const result = await loadWhatsOn(
      { window: "tonight" },
      {
        now: Date.parse("2026-08-27T12:00:00.000Z"),
        fetchLive: async () => [],
      },
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        id: "quiz-qo-pub-quiz-white-hart-whitechapel-thursdays",
        venueId: "venue-5cqxbo",
      }),
    ]);
  });

  it("drops a coordless unresolved durable row without London locality evidence", async () => {
    durable.load.mockResolvedValueOnce({
      rows: [
        {
          ...durableRows[0],
          id: "unresolved-provider-row",
          venueId: undefined,
          placeName: "Unresolved provider venue",
        },
      ],
      providerObservedAt: "2026-08-27T11:07:30.691Z",
      readStatus: "ready",
    });

    const result = await loadWhatsOn(
      { window: "tonight" },
      {
        now: Date.parse("2026-08-27T12:00:00.000Z"),
        fetchLive: async () => [],
      },
    );

    expect(result.rows).toEqual([]);
  });

  it("marks the bundled fallback degraded when the durable loader throws", async () => {
    durable.load.mockRejectedValueOnce(new Error("durable read failed"));

    const result = await loadWhatsOn(
      { window: "tonight" },
      {
        now: Date.parse("2026-08-27T12:00:00.000Z"),
        fetchLive: async () => [],
      },
    );

    expect(result.readStatus).toBe("degraded");
    expect(result.revalidation).toEqual({
      status: "unmeasured",
      reason: "baseline-read-failed",
    });
  });
});
