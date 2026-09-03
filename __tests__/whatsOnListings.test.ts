import { describe, expect, it } from "vitest";

import { preferDurableWhatsOn } from "@/lib/whatsOnListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-08-24T20:00:00.000Z");

function row(over: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "event-1",
    placeName: "Jazz Cafe",
    kind: "event",
    startsAt: "2026-08-24T19:00:00.000Z",
    endsAt: "2026-08-24T22:00:00.000Z",
    title: "Live jazz",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
    sourceId: "tm-1",
    ...over,
  };
}

describe("preferDurableWhatsOn", () => {
  it("prefers a fresher durable row over the bundled twin", () => {
    const bundled = [row({ observedAt: "2026-08-22T04:38:00.000Z", title: "Stale jazz" })];
    const durable = [row({ observedAt: "2026-08-24T10:00:00.000Z", title: "Tonight jazz" })];
    const served = preferDurableWhatsOn(durable, bundled, NOW);
    expect(served).toHaveLength(1);
    expect(served[0].title).toBe("Tonight jazz");
  });

  it("prefers durable rows regardless of confidence or observed time", () => {
    const bundled = [
      row({
        confidence: "confirmed",
        observedAt: "2026-08-24T19:00:00.000Z",
        title: "Bundled confirmation",
      }),
    ];
    const durable = [
      row({
        confidence: "listed",
        observedAt: "2026-08-24T10:00:00.000Z",
        title: "Durable listing",
      }),
    ];
    expect(preferDurableWhatsOn(durable, bundled, NOW)[0].title).toBe("Durable listing");
  });

  it("merges durable and bundled rows when source labels differ only by whitespace", () => {
    const bundled = [
      row({
        source: { label: " Ticketmaster ", url: "https://www.ticketmaster.co.uk/event/1" },
        title: "Bundled title",
      }),
    ];
    const durable = [row({ title: "Durable title" })];
    const served = preferDurableWhatsOn(durable, bundled, NOW);
    expect(served).toHaveLength(1);
    expect(served[0].title).toBe("Durable title");
  });

  it("fills only a missing durable venueId from its bundled source twin", () => {
    const bundled = [
      row({ venueId: "venue-confirmed", confidence: "confirmed", title: "Bundled title" }),
    ];
    const durable = [row({ title: "Durable title" })];
    const served = preferDurableWhatsOn(durable, bundled, NOW);
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ title: "Durable title", venueId: "venue-confirmed" });
  });

  it("falls back to bundled rows when the durable set is empty", () => {
    const bundled = [row({ id: "quiz-1", kind: "quiz", title: "Pub quiz" })];
    const served = preferDurableWhatsOn([], bundled, NOW);
    expect(served.map((item) => item.id)).toEqual(["quiz-1"]);
  });

  it("never serves an expired durable row, even when bundled is empty", () => {
    const expired = row({
      id: "past-gig",
      startsAt: "2026-08-22T19:00:00.000Z",
      endsAt: "2026-08-22T22:00:00.000Z",
    });
    expect(preferDurableWhatsOn([expired], [], NOW)).toEqual([]);
  });

  it("keeps a live durable event beside a bundled quiz", () => {
    const bundled = [row({ id: "quiz-1", kind: "quiz", sourceId: "q1", title: "Quiz" })];
    const durable = [row({ id: "event-2", sourceId: "tm-2", title: "Comedy" })];
    const served = preferDurableWhatsOn(durable, bundled, NOW);
    expect(served.map((item) => item.id).sort()).toEqual(["event-2", "quiz-1"]);
  });

  it("does not serve fenced Skiddle rows", () => {
    const skiddle = row({ source: { label: "Skiddle", url: "https://www.skiddle.com/" } });
    expect(preferDurableWhatsOn([skiddle], [], NOW)).toEqual([]);
  });
});
