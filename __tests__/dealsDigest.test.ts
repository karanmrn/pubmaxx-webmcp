import { describe, expect, it } from "vitest";

import {
  capBySource,
  dealDigestKey,
  dealDigestNote,
  digestSectionPicks,
  groupIdenticalDeals,
} from "@/lib/dealsDigest";
import type { WhatsOnRow } from "@/lib/whatsOn";

// A well-formed deal row; override any field per case. Distinct ids by default so
// the stable tiebreaks are observable.
let seq = 0;
function makeRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    placeName: "The Test Arms",
    kind: "deal",
    startsAt: "2026-07-18T18:00:00+01:00",
    title: "Pizza Club",
    source: { label: "Wetherspoon", url: "https://www.jdwetherspoon.com/pubs/all-pubs" },
    observedAt: "2026-07-18T06:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

describe("dealDigestKey", () => {
  it("collides identical listings across venues (case/whitespace/Unicode folded)", () => {
    const a = makeRow({ placeName: "The Moon", title: "Pizza Club" });
    const b = makeRow({ placeName: "The Sun", title: "  ＰＩＺＺＡ   club " });
    expect(dealDigestKey(a)).toBe(dealDigestKey(b));
  });

  it("keeps punctuation and wording distinct (no fuzzy matching)", () => {
    const a = makeRow({ title: "Pizza Club" });
    const b = makeRow({ title: "Pizza Club!" });
    expect(dealDigestKey(a)).not.toBe(dealDigestKey(b));
  });

  it("separates a same-name listing from a different source", () => {
    const a = makeRow({ title: "Curry Night", source: { label: "Wetherspoon", url: "https://x.example/a" } });
    const b = makeRow({ title: "Curry Night", source: { label: "Greene King", url: "https://x.example/b" } });
    expect(dealDigestKey(a)).not.toBe(dealDigestKey(b));
  });

  it("never merges two kinds that happen to share a title and source", () => {
    const deal = makeRow({ kind: "deal", title: "Games Night" });
    const quiz = makeRow({ kind: "quiz", title: "Games Night" });
    expect(dealDigestKey(deal)).not.toBe(dealDigestKey(quiz));
  });
});

describe("groupIdenticalDeals", () => {
  it("folds five identical chain cards into ONE entry with the real venue count", () => {
    // The live-taste P0: five identical Pizza Club Wetherspoon cards.
    const rows = ["The Moon", "The Sun", "The Coronet", "The Broadway", "The Angel"].map((placeName) =>
      makeRow({ placeName, venueId: placeName.toLowerCase().replace(/\s+/g, "-") }),
    );
    const digests = groupIdenticalDeals(rows);
    expect(digests).toHaveLength(1);
    expect(digests[0].venueCount).toBe(5);
    expect(digests[0].members).toHaveLength(5);
  });

  it("counts DISTINCT venues, not rows: a duplicate venue is not double counted", () => {
    const rows = [
      makeRow({ venueId: "the-moon" }),
      makeRow({ venueId: "the-moon" }), // same venue twice
      makeRow({ venueId: "the-sun" }),
    ];
    expect(groupIdenticalDeals(rows)[0].venueCount).toBe(2);
  });

  it("keys venues by placeName when a venueId is absent", () => {
    const rows = [
      makeRow({ placeName: "The Moon" }),
      makeRow({ placeName: "the moon" }), // same venue by name, different case
      makeRow({ placeName: "The Sun" }),
    ];
    expect(groupIdenticalDeals(rows)[0].venueCount).toBe(2);
  });

  it("orders members soonest-first and picks the soonest as display when no near point", () => {
    const rows = [
      makeRow({ id: "late", placeName: "Late Pub", startsAt: "2026-07-18T21:00:00+01:00" }),
      makeRow({ id: "early", placeName: "Early Pub", startsAt: "2026-07-18T18:00:00+01:00" }),
    ];
    const digest = groupIdenticalDeals(rows)[0];
    expect(digest.members.map((r) => r.id)).toEqual(["early", "late"]);
    expect(digest.display.id).toBe("early");
    expect(digest.nearestVenueName).toBe("Early Pub");
  });

  it("picks the geographically nearest venue as display when a near point is given", () => {
    // near = Piccadilly. The Piccadilly Hall sits on top of it; the others are far.
    const near = { lat: 51.51, lng: -0.135 };
    const rows = [
      makeRow({ id: "far", placeName: "The Far Arms", lat: 51.55, lng: -0.05, startsAt: "2026-07-18T18:00:00+01:00" }),
      makeRow({ id: "near", placeName: "The Piccadilly Hall", lat: 51.5101, lng: -0.1349, startsAt: "2026-07-18T21:00:00+01:00" }),
    ];
    const digest = groupIdenticalDeals(rows, { near })[0];
    // Nearest wins the display even though it starts later.
    expect(digest.display.id).toBe("near");
    expect(digest.nearestVenueName).toBe("The Piccadilly Hall");
    expect(digest.venueCount).toBe(2);
  });

  it("reports the strongest confidence anywhere in the group", () => {
    const rows = [
      makeRow({ placeName: "A", confidence: "derived" }),
      makeRow({ placeName: "B", confidence: "confirmed" }),
      makeRow({ placeName: "C", confidence: "listed" }),
    ];
    expect(groupIdenticalDeals(rows)[0].topConfidence).toBe("confirmed");
  });

  it("keeps genuinely different deals in separate groups", () => {
    const rows = [
      makeRow({ title: "Pizza Club", placeName: "A" }),
      makeRow({ title: "Curry Club", placeName: "B" }),
    ];
    expect(groupIdenticalDeals(rows)).toHaveLength(2);
  });

  it("returns an empty list for empty input and never mutates the input", () => {
    expect(groupIdenticalDeals([])).toEqual([]);
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b", placeName: "B" })];
    const before = rows.map((r) => r.id);
    groupIdenticalDeals(rows, { near: { lat: 51.5, lng: -0.1 } });
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("drops malformed rows (empty title or place name) rather than throwing", () => {
    const rows = [
      makeRow({ placeName: "Good", title: "Pizza Club" }),
      makeRow({ placeName: "  ", title: "Pizza Club" }), // blank place
      makeRow({ placeName: "Bad", title: "   " }), // blank title
    ];
    const digests = groupIdenticalDeals(rows);
    expect(digests).toHaveLength(1);
    expect(digests[0].venueCount).toBe(1);
    expect(digests[0].display.placeName).toBe("Good");
  });
});

describe("capBySource (diversity cap)", () => {
  it("keeps at most one group per source in the primary band, overflow ranked lower", () => {
    // Two Wetherspoon deals + one Greene King deal. Cap keeps 1 Spoons + 1 GK up
    // top; the second Spoons deal is demoted to the tail, not dropped.
    const rows = [
      makeRow({ title: "Pizza Club", placeName: "A", source: { label: "Wetherspoon", url: "https://x.example/1" } }),
      makeRow({ title: "Curry Club", placeName: "B", source: { label: "Wetherspoon", url: "https://x.example/2" } }),
      makeRow({ title: "Steak Night", placeName: "C", source: { label: "Greene King", url: "https://x.example/3" } }),
    ];
    const capped = capBySource(groupIdenticalDeals(rows), null);
    const sources = capped.map((d) => d.sourceLabel);
    // First two are distinct sources; the duplicate Wetherspoon sits last.
    expect(sources.slice(0, 2).sort()).toEqual(["Greene King", "Wetherspoon"]);
    expect(sources[2]).toBe("Wetherspoon");
    expect(capped).toHaveLength(3); // nothing dropped
  });

  it("ranks groups by strongest confidence, then soonest start", () => {
    const rows = [
      makeRow({ title: "Listed early", placeName: "A", source: { label: "S1", url: "https://x.example/1" }, confidence: "listed", startsAt: "2026-07-18T18:00:00+01:00" }),
      makeRow({ title: "Confirmed late", placeName: "B", source: { label: "S2", url: "https://x.example/2" }, confidence: "confirmed", startsAt: "2026-07-18T21:00:00+01:00" }),
      makeRow({ title: "Derived earliest", placeName: "C", source: { label: "S3", url: "https://x.example/3" }, confidence: "derived", startsAt: "2026-07-18T17:00:00+01:00" }),
    ];
    const capped = capBySource(groupIdenticalDeals(rows), null);
    expect(capped.map((d) => d.display.title)).toEqual([
      "Confirmed late",
      "Listed early",
      "Derived earliest",
    ]);
  });
});

describe("digestSectionPicks (whole pipeline)", () => {
  it("collapses the five identical cards to one pick carrying the real count", () => {
    const rows = ["The Moon", "The Sun", "The Coronet", "The Broadway", "The Angel"].map((placeName) =>
      makeRow({ placeName, venueId: placeName.toLowerCase().replace(/\s+/g, "-") }),
    );
    const picks = digestSectionPicks(rows, { limit: 3 });
    expect(picks).toHaveLength(1);
    expect(picks[0].digest).toEqual({ venueCount: 5, nearestVenueName: "The Moon" });
  });

  it("omits digest data for a single-venue pick", () => {
    const picks = digestSectionPicks([makeRow({ placeName: "The Only One" })], { limit: 3 });
    expect(picks).toHaveLength(1);
    expect(picks[0].digest).toBeUndefined();
  });

  it("caps the section at the limit after grouping and diversity capping", () => {
    const rows = [
      makeRow({ title: "Pizza Club", placeName: "A", source: { label: "S1", url: "https://x.example/1" } }),
      makeRow({ title: "Quiz", placeName: "B", kind: "quiz", source: { label: "S2", url: "https://x.example/2" } }),
      makeRow({ title: "Live set", placeName: "C", kind: "music", source: { label: "S3", url: "https://x.example/3" } }),
      makeRow({ title: "Late food", placeName: "D", source: { label: "S4", url: "https://x.example/4" } }),
    ];
    expect(digestSectionPicks(rows, { limit: 2 })).toHaveLength(2);
  });

  it("honours limit edge cases like the existing picks ranker", () => {
    const rows = [
      makeRow({ title: "One", placeName: "A", source: { label: "S1", url: "https://x.example/1" } }),
      makeRow({ title: "Two", placeName: "B", source: { label: "S2", url: "https://x.example/2" } }),
    ];
    expect(digestSectionPicks(rows, { limit: Number.POSITIVE_INFINITY })).toHaveLength(2);
    expect(digestSectionPicks(rows, { limit: 0 })).toEqual([]);
    expect(digestSectionPicks(rows, { limit: Number.NaN })).toEqual([]);
    expect(digestSectionPicks(rows, { limit: -3 })).toEqual([]);
    expect(digestSectionPicks(rows)).toHaveLength(2); // default limit 3
  });

  it("returns an empty list for an empty night", () => {
    expect(digestSectionPicks([], { limit: 3 })).toEqual([]);
  });
});

describe("dealDigestNote", () => {
  it("discloses the real venue count for a multi-venue group", () => {
    expect(dealDigestNote(12)).toBe("Same deal at 12 pubs");
    expect(dealDigestNote(2)).toBe("Same deal at 2 pubs");
  });

  it("says nothing for a single venue or a nonsense count", () => {
    expect(dealDigestNote(1)).toBeNull();
    expect(dealDigestNote(0)).toBeNull();
    expect(dealDigestNote(Number.NaN)).toBeNull();
  });

  it("carries no em dash or banned marketing register", () => {
    const note = dealDigestNote(9) ?? "";
    expect(note.includes("—")).toBe(false);
    expect(note.includes("!")).toBe(false);
  });
});
