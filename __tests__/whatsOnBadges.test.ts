import { describe, expect, it } from "vitest";

import type { WhatsOnKind, WhatsOnRow } from "@/lib/whatsOn";
import {
  checkedLabel,
  filterLaneRows,
  formatWhatsOnTime,
  laneCardsFromRows,
  laneKindFacets,
  laneTimeLabel,
  listingUrgency,
  summariseWhatsOnByVenue,
  WHATS_ON_KIND_META,
} from "@/lib/whatsOnBadges";

function row(overrides: Partial<WhatsOnRow> & { kind: WhatsOnKind }): WhatsOnRow {
  return {
    id: `row-${Math.random().toString(36).slice(2)}`,
    placeName: "The Test Arms",
    // 2026-07-12 20:00 BST → 19:00Z
    startsAt: "2026-07-12T19:00:00.000Z",
    title: `${overrides.kind} night`,
    source: { label: "Organiser", url: "https://example.com/e" },
    observedAt: "2026-07-12T09:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

describe("summariseWhatsOnByVenue (badge join)", () => {
  it("joins on venueId only and drops rows without one", () => {
    const rows = [
      row({ kind: "quiz", venueId: "v1" }),
      row({ kind: "sport", venueId: "v1" }),
      row({ kind: "music" }), // no venueId → dropped from badge join
    ];
    const map = summariseWhatsOnByVenue(rows);
    expect(map.size).toBe(1);
    expect(map.has("v1")).toBe(true);
    expect(map.get("v1")?.count).toBe(2);
  });

  it("picks the hero kind by priority (quiz > sport > deal > music)", () => {
    const map = summariseWhatsOnByVenue([
      row({ kind: "music", venueId: "v1" }),
      row({ kind: "sport", venueId: "v1" }),
      row({ kind: "quiz", venueId: "v1" }),
    ]);
    const summary = map.get("v1");
    expect(summary?.heroKind).toBe("quiz");
    expect(summary?.timed).toBe(true); // quiz is timed
    expect(summary?.kinds).toEqual(["quiz", "sport", "music"]);
  });

  it("marks an untimed hero (sport-only) as not timed", () => {
    const map = summariseWhatsOnByVenue([row({ kind: "sport", venueId: "v2" })]);
    expect(map.get("v2")?.heroKind).toBe("sport");
    expect(map.get("v2")?.timed).toBe(false);
  });
});

describe("lane filtering + facets", () => {
  const rows = [
    row({ kind: "quiz", venueId: "v1" }),
    row({ kind: "quiz", venueId: "v2" }),
    row({ kind: "sport", venueId: "v3" }),
  ];

  it("filterLaneRows returns all when no kind, and matches by kind", () => {
    expect(filterLaneRows(rows, null)).toHaveLength(3);
    expect(filterLaneRows(rows, "quiz")).toHaveLength(2);
    expect(filterLaneRows(rows, "sport")).toHaveLength(1);
    expect(filterLaneRows(rows, "deal")).toHaveLength(0);
  });

  it("laneKindFacets counts present kinds in hero-priority order", () => {
    const facets = laneKindFacets(rows);
    expect(facets.map((f) => f.kind)).toEqual(["quiz", "sport"]);
    expect(facets[0]).toMatchObject({ kind: "quiz", count: 2 });
  });
});

describe("laneCardsFromRows", () => {
  it("caps at the limit and preserves order", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ kind: "quiz", venueId: `v${i}`, title: `Quiz ${i}` }),
    );
    const cards = laneCardsFromRows(rows, { limit: 3 });
    expect(cards).toHaveLength(3);
    expect(cards[0].title).toBe("Quiz 0");
  });

  it("carries venueId + price and a London time for timed kinds", () => {
    const [card] = laneCardsFromRows([
      row({ kind: "quiz", venueId: "v1", priceGbp: 2 }),
    ]);
    expect(card.venueId).toBe("v1");
    expect(card.priceGbp).toBe(2);
    expect(card.timeLabel).toBe("8:00 pm"); // 19:00Z = 20:00 BST
  });

  it("leaves sport untimed (badge label instead of a clock)", () => {
    const [card] = laneCardsFromRows([row({ kind: "sport", venueId: "v1" })]);
    expect(card.timeLabel).toBeNull();
    expect(card.badgeLabel).toBe("Screens live sport");
  });

  it("adds a haversine walk label when near + venue coords are present", () => {
    const [card] = laneCardsFromRows(
      [row({ kind: "quiz", venueId: "v1", lat: 51.515, lng: -0.09 })],
      { near: { lat: 51.515, lng: -0.092 } },
    );
    expect(card.walkLabel).toMatch(/^~\d+ min walk$/);
  });

  it("omits walk label without a near origin", () => {
    const [card] = laneCardsFromRows([
      row({ kind: "quiz", venueId: "v1", lat: 51.515, lng: -0.09 }),
    ]);
    expect(card.walkLabel).toBeUndefined();
  });
});

describe("time + provenance helpers", () => {
  it("formatWhatsOnTime renders London wall-clock, null on garbage", () => {
    expect(formatWhatsOnTime("2026-07-12T19:00:00.000Z")).toBe("8:00 pm");
    expect(formatWhatsOnTime("not-a-date")).toBeNull();
    expect(formatWhatsOnTime(undefined)).toBeNull();
  });

  it("laneTimeLabel honours per-kind timed flag", () => {
    expect(laneTimeLabel(row({ kind: "quiz" }))).toBe("8:00 pm");
    expect(laneTimeLabel(row({ kind: "sport" }))).toBeNull();
  });

  it("checkedLabel formats or reports unknown", () => {
    expect(checkedLabel("2026-07-12T09:00:00.000Z")).toBe("Checked 12 Jul");
    expect(checkedLabel(null)).toBe("No date on this yet");
    expect(checkedLabel("nope")).toBe("No date on this yet");
  });

  it("checkedLabel uses the LONDON calendar day (23:xx UTC in BST rolls forward)", () => {
    // 23:30 UTC on 12 Jul is 00:30 London (BST) on 13 Jul — the label must
    // agree with the London wall clock formatWhatsOnTime renders in.
    expect(checkedLabel("2026-07-12T23:30:00.000Z")).toBe("Checked 13 Jul");
    // And just before the boundary it stays on the 12th.
    expect(checkedLabel("2026-07-12T22:30:00.000Z")).toBe("Checked 12 Jul");
  });

  it("kind meta matches owner decision 4 (quiz timed, sport untimed)", () => {
    expect(WHATS_ON_KIND_META.quiz.timed).toBe(true);
    expect(WHATS_ON_KIND_META.sport.timed).toBe(false);
    expect(WHATS_ON_KIND_META.sport.badgeLabel).toBe("Screens live sport");
  });
});

describe("listingUrgency", () => {
  const now = new Date("2026-07-12T18:35:00.000Z"); // 19:35 BST

  it("returns live when the listing has started and not ended", () => {
    expect(listingUrgency(row({ kind: "deal", startsAt: "2026-07-12T18:00:00.000Z" }), now)).toEqual({
      tier: "live",
      label: "Happening now",
    });
  });

  it("returns soon with minute countdown inside the soon window", () => {
    expect(listingUrgency(row({ kind: "quiz", startsAt: "2026-07-12T19:00:00.000Z" }), now)).toEqual({
      tier: "soon",
      label: "Starts in 25 min",
    });
    expect(listingUrgency(row({ kind: "quiz", startsAt: "2026-07-12T18:35:30.000Z" }), now)).toEqual({
      tier: "soon",
      label: "Starts in 1 min",
    });
  });

  it("returns later with a London wall clock beyond the soon window", () => {
    expect(listingUrgency(row({ kind: "music", startsAt: "2026-07-12T21:00:00.000Z" }), now)).toEqual({
      tier: "later",
      label: "10:00 pm",
    });
  });

  it("returns null for untimed kinds, ended listings, or bad starts", () => {
    expect(listingUrgency(row({ kind: "sport" }), now)).toBeNull();
    expect(
      listingUrgency(
        row({ kind: "deal", startsAt: "2026-07-12T17:00:00.000Z", endsAt: "2026-07-12T18:00:00.000Z" }),
        now,
      ),
    ).toBeNull();
    expect(listingUrgency(row({ kind: "deal", startsAt: "not-a-date" }), now)).toBeNull();
  });
});
