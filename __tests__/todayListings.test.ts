import { describe, expect, it, vi } from "vitest";

import * as loadOut from "@/lib/out/loadOut";
import * as whatsOnStore from "@/lib/whatsOnStore";
import {
  loadTodayOutAnswer,
  loadTodayWhatsOnAnswer,
  mergeTodayListingRows,
  todayPicksReadStatus,
  whatsOnStatusForTonightListings,
} from "@/lib/todayListings.server";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = new Date("2026-08-16T21:00:00.000Z").getTime();
const NOW_ISO = new Date(NOW).toISOString();

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "title">): WhatsOnRow {
  return {
    placeName: "Shoreditch",
    kind: "event",
    startsAt: "2026-08-16T20:30:00.000Z",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: NOW_ISO,
    confidence: "listed",
    ...partial,
  };
}

describe("today listings spine", () => {
  it("maps a degraded whats-on read to error for the Tonight merge", () => {
    expect(whatsOnStatusForTonightListings("degraded", 0)).toBe("error");
    expect(whatsOnStatusForTonightListings("ready", 0)).toBe("empty");
    expect(whatsOnStatusForTonightListings("ready", 2)).toBe("ready");
  });

  it("does not promote unmatched Out rows when bundled whats-on is empty", () => {
    const merged = mergeTodayListingRows(
      [],
      {
        body: { status: "ready", events: [row({ id: "out-1", title: "Live gig" })] },
        failed: false,
        pending: false,
      },
      NOW,
    );
    expect(merged).toEqual([]);
  });

  it("keeps matched Out rows as a fallback when the whats-on read failed", () => {
    const merged = mergeTodayListingRows(
      [],
      {
        body: {
          status: "ready",
          events: [
            row({
              id: "out-fallback",
              title: "Live gig",
              venueId: "venue-the-dove",
            }),
          ],
        },
        failed: false,
        pending: false,
      },
      NOW,
      "error",
    );
    expect(merged.map((r) => r.id)).toEqual(["out-fallback"]);
  });

  it("keeps Today What's-On rows without venue ids", () => {
    const merged = mergeTodayListingRows(
      [row({ id: "whats-on-without-venue", title: "Pub quiz" })],
      { body: null, failed: true, pending: false },
      NOW,
      "ready",
    );

    expect(merged.map((r) => r.id)).toEqual(["whats-on-without-venue"]);
  });

  it("answers ready when an empty whats-on read answered cleanly", () => {
    const status = todayPicksReadStatus(
      "ready",
      0,
      {
        body: { status: "ready", events: [row({ id: "out-1", title: "Live gig" })] },
        failed: false,
        pending: false,
      },
      NOW,
    );
    expect(status).toBe("ready");
  });

  it("answers degraded when both lanes fail", () => {
    const status = todayPicksReadStatus(
      "degraded",
      0,
      { body: null, failed: true, pending: false },
      NOW,
    );
    expect(status).toBe("degraded");
  });

  it("loads What's-On with the live spine, not baseline-only", async () => {
    const loadWhatsOn = vi.spyOn(whatsOnStore, "loadWhatsOn").mockResolvedValue({
      rows: [],
      readStatus: "ready",
      servedAt: NOW_ISO,
      revalidation: { status: "measured" },
      sourceObservedAt: null,
      sourceFreshnessKind: "unknown",
      kindObservedAt: {},
      localityBasis: "london-default",
      asOf: null,
    });

    await loadTodayWhatsOnAnswer(NOW);

    expect(loadWhatsOn).toHaveBeenCalledWith({ window: "tonight" }, { now: NOW });
    expect(loadWhatsOn.mock.calls[0]?.[1]?.fetchLive).toBeUndefined();

    loadWhatsOn.mockRestore();
  });

  it("loads Out with the same tonight API day as /tonight", async () => {
    const buildOut = vi.spyOn(loadOut, "buildOutResponse").mockResolvedValue({
      status: "ready",
      events: [],
      openPlans: [],
      attribution: [],
      providers: [],
      observedAt: {},
      listingsStatus: "ready",
      venueMatch: "ready",
    });

    await loadTodayOutAnswer(NOW);

    expect(buildOut).toHaveBeenCalledWith(
      { city: "london", day: "today" },
      { now: NOW },
    );

    buildOut.mockRestore();
  });
});
