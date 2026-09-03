import { describe, it, expect, vi } from "vitest";
import {
  coveringObservedAt,
  isValidWhatsOnRow,
  isWhatsOnKind,
  parseKindObservedAt,
  parseWhatsOnRows,
  dedupeKey,
  dedupeRows,
  londonServiceDayBounds,
  isOnTonight,
  tonightServiceWindow,
  filterTonight,
  rowEffectiveEnd,
  isPastDated,
  filterNotPast,
  filterByKind,
  matchVenueId,
  normaliseEventTitle,
  normaliseSourceLabel,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import { mapThingsToDoToRows, THINGS_TO_DO_KIND_MAP } from "@/lib/whatsOnCitymcp";
import type { ThingsToDoResult, ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { laneTimeLabel, listingUrgency } from "@/lib/whatsOnBadges";

const NOW = Date.parse("2026-07-11T20:00:00.000Z");

function makeRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "quiz-1",
    placeName: "The Test Arms",
    kind: "quiz",
    startsAt: "2026-07-11T19:30:00+01:00",
    title: "Pub quiz — Fridays 7:30pm",
    source: { label: "Question One", url: "https://questionone.com/venues/test-arms/" },
    observedAt: "2026-07-11T18:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

describe("isWhatsOnKind", () => {
  it("recognises the five kinds including event and rejects others", () => {
    expect(isWhatsOnKind("sport")).toBe(true);
    expect(isWhatsOnKind("quiz")).toBe(true);
    expect(isWhatsOnKind("deal")).toBe(true);
    expect(isWhatsOnKind("music")).toBe(true);
    expect(isWhatsOnKind("event")).toBe(true);
    expect(isWhatsOnKind("gig")).toBe(false);
    expect(isWhatsOnKind(null)).toBe(false);
  });
});

describe("isValidWhatsOnRow", () => {
  it("accepts a well-formed row (and null optionals)", () => {
    expect(isValidWhatsOnRow(makeRow(), NOW)).toBe(true);
    expect(isValidWhatsOnRow({ ...makeRow(), venueId: null, lat: null, lng: null }, NOW)).toBe(true);
    expect(isValidWhatsOnRow(makeRow({ priceGbp: 0 }), NOW)).toBe(true);
  });

  it("rejects non-objects and missing required fields", () => {
    expect(isValidWhatsOnRow(null, NOW)).toBe(false);
    expect(isValidWhatsOnRow("nope", NOW)).toBe(false);
    expect(isValidWhatsOnRow({}, NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ id: "" }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ placeName: "" }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ title: "" }), NOW)).toBe(false);
  });

  it("rejects a bad kind, confidence, or startsAt", () => {
    expect(isValidWhatsOnRow({ ...makeRow(), kind: "gig" }, NOW)).toBe(false);
    expect(isValidWhatsOnRow({ ...makeRow(), confidence: "guessed" }, NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ startsAt: "someday" }), NOW)).toBe(false);
  });

  it("requires provenance ({label, absolute-http url}); no licence field needed", () => {
    expect(isValidWhatsOnRow({ ...makeRow(), source: null }, NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ source: { label: "", url: "https://x.com" } }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ source: { label: "X", url: "not-a-url" } }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ source: { label: "X", url: "ftp://x.com" } }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ source: { label: "X", url: "https://x.com" } }), NOW)).toBe(true);
  });

  it("keeps provenance on an event row and accepts optional imageUrl, sourceId, and area", () => {
    const eventRow = makeRow({
      kind: "event",
      title: "Stand-up at the back room",
      imageUrl: "https://img.example/event.jpg",
      sourceId: "tm-99",
      area: "camden",
    });
    expect(isValidWhatsOnRow(eventRow, NOW)).toBe(true);
    const parsed = parseWhatsOnRows([eventRow], NOW);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      kind: "event",
      source: eventRow.source,
      imageUrl: "https://img.example/event.jpg",
      sourceId: "tm-99",
      area: "camden",
    });
    expect(parsed[0].source.url).toMatch(/^https:\/\//);
    expect(parsed[0].observedAt).toBe(eventRow.observedAt);
  });

  it("rejects an event row that drops provenance", () => {
    expect(
      isValidWhatsOnRow(
        makeRow({ kind: "event", source: { label: "Ticketmaster", url: "not-a-url" } }),
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects a missing/invalid/future observedAt", () => {
    expect(isValidWhatsOnRow(makeRow({ observedAt: "" }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ observedAt: "yesterday" }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ observedAt: "2026-07-11T20:00:01.000Z" }), NOW)).toBe(false);
  });

  it("rejects a negative price and bad optional coords", () => {
    expect(isValidWhatsOnRow(makeRow({ priceGbp: -1 }), NOW)).toBe(false);
    expect(isValidWhatsOnRow({ ...makeRow(), lat: "51.5" }, NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ endsAt: "nope" }), NOW)).toBe(false);
  });
});

describe("parseWhatsOnRows + dedupe", () => {
  it("accepts a bare array and a { rows } envelope, dropping bad rows", () => {
    expect(parseWhatsOnRows([makeRow(), { junk: true }], NOW)).toHaveLength(1);
    expect(parseWhatsOnRows({ rows: [makeRow()] }, NOW)).toHaveLength(1);
    expect(parseWhatsOnRows(null, NOW)).toEqual([]);
    expect(parseWhatsOnRows(42, NOW)).toEqual([]);
  });

  it("dedupes by (place, kind, startsAt), keeping the freshest observedAt", () => {
    const parsed = parseWhatsOnRows(
      [
        makeRow({ id: "old", observedAt: "2026-07-10T00:00:00.000Z", title: "old" }),
        makeRow({ id: "new", observedAt: "2026-07-11T00:00:00.000Z", title: "new" }),
      ],
      NOW,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("new");
  });

  it("keys off venueId when present, else lowercased placeName", () => {
    expect(dedupeKey(makeRow({ venueId: "venue-abc" }))).toContain("venue-abc");
    expect(dedupeKey(makeRow())).toContain("the test arms");
  });

  it("treats different kinds at the same place/time as independent", () => {
    const parsed = dedupeRows([makeRow({ kind: "quiz" }), makeRow({ kind: "music", id: "m" })]);
    expect(parsed).toHaveLength(2);
  });

  it("keeps distinct untimed listings with the same listed time", () => {
    const shared = {
      startsAt: undefined,
      timeEvidence: "8pm",
      listedWindow: "tonight" as const,
    };
    const rows = dedupeRows([
      makeRow({
        ...shared,
        id: "jazz",
        title: "Jazz night",
        source: { label: "Venue diary", url: "https://venue.example/jazz" },
      }),
      makeRow({
        ...shared,
        id: "comedy",
        title: "Comedy night",
        source: { label: "Comedy guide", url: "https://guide.example/comedy" },
      }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["jazz", "comedy"]);
  });
});

describe("London tonight windowing (04:00 service-day rollback)", () => {
  it("computes a [16:00, next-04:00) evening window in BST", () => {
    const { start, end } = londonServiceDayBounds(Date.parse("2026-07-11T20:00:00.000Z"));
    // BST (+01:00): 16:00 London = 15:00Z; next 04:00 London = 03:00Z next day.
    expect(start).toBe("2026-07-11T15:00:00.000Z");
    expect(end).toBe("2026-07-12T03:00:00.000Z");
  });

  it("rolls back to the previous evening before 04:00 London", () => {
    const { start, end } = londonServiceDayBounds(Date.parse("2026-07-12T01:30:00.000Z"));
    expect(start).toBe("2026-07-11T15:00:00.000Z");
    expect(end).toBe("2026-07-12T03:00:00.000Z");
  });

  it("changes service day exactly at 04:00 London", () => {
    const before = londonServiceDayBounds(Date.parse("2026-07-12T02:59:59.000Z"));
    expect(before.start).toBe("2026-07-11T15:00:00.000Z");
    const boundary = londonServiceDayBounds(Date.parse("2026-07-12T03:00:00.000Z"));
    expect(boundary.start).toBe("2026-07-12T15:00:00.000Z");
  });

  it("resolves spring-forward boundaries independently (11-hour window)", () => {
    const bounds = londonServiceDayBounds(Date.parse("2026-03-28T20:00:00.000Z"));
    expect(bounds).toEqual({
      start: "2026-03-28T16:00:00.000Z",
      end: "2026-03-29T03:00:00.000Z",
    });
    expect(Date.parse(bounds.end) - Date.parse(bounds.start)).toBe(11 * 60 * 60 * 1000);
  });

  it("resolves autumn-repeat boundaries independently (13-hour window)", () => {
    const bounds = londonServiceDayBounds(Date.parse("2026-10-24T20:00:00.000Z"));
    expect(bounds).toEqual({
      start: "2026-10-24T15:00:00.000Z",
      end: "2026-10-25T04:00:00.000Z",
    });
    expect(Date.parse(bounds.end) - Date.parse(bounds.start)).toBe(13 * 60 * 60 * 1000);
  });

  it("isOnTonight / filterTonight select rows inside the window", () => {
    const now = Date.parse("2026-07-11T20:00:00.000Z");
    const inside = makeRow({ id: "in", startsAt: "2026-07-11T19:30:00+01:00" });
    const before = makeRow({ id: "before", startsAt: "2026-07-11T10:00:00+01:00" });
    const after = makeRow({ id: "after", startsAt: "2026-07-12T09:00:00+01:00" });
    expect(isOnTonight(inside, now)).toBe(true);
    expect(isOnTonight(before, now)).toBe(false);
    expect(isOnTonight(after, now)).toBe(false);
    expect(filterTonight([inside, before, after], now).map((r) => r.id)).toEqual(["in"]);
  });

  // Regression (#397): an all-day row whose clock start is before the 16:00
  // window open but whose endsAt runs into the evening (the Wetherspoon food
  // deals, 11:30 -> 23:00) must count as "on tonight". Start-containment used to
  // drop all 384 of them on every night; interval-overlap keeps them.
  it("includes an all-day deal that starts before 16:00 but runs into the evening", () => {
    const now = Date.parse("2026-07-11T21:45:00.000Z"); // 22:45 London (BST)
    const allDayDeal = makeRow({
      id: "deal-allday",
      kind: "deal",
      startsAt: "2026-07-11T11:30:00+01:00",
      endsAt: "2026-07-11T23:00:00+01:00",
    });
    expect(isOnTonight(allDayDeal, now)).toBe(true);
  });

  // The overlap change must NOT widen point rows (no endsAt): a lunchtime-only
  // occurrence still ends before the window opens and stays excluded.
  it("still excludes a daytime row that has finished before the window opens", () => {
    const now = Date.parse("2026-07-11T21:45:00.000Z");
    const lunchtimeOnly = makeRow({
      id: "deal-lunch",
      kind: "deal",
      startsAt: "2026-07-11T11:30:00+01:00",
      endsAt: "2026-07-11T14:00:00+01:00",
    });
    const pointBeforeWindow = makeRow({ id: "point-before", startsAt: "2026-07-11T12:00:00+01:00" });
    expect(isOnTonight(lunchtimeOnly, now)).toBe(false);
    expect(isOnTonight(pointBeforeWindow, now)).toBe(false);
  });

  // The window depends only on `now`, so reading the London clock is a cost per
  // FILTER and never a cost per row. It used to be per row, and each reading
  // built a fresh Intl.DateTimeFormat, so /today's server render grew with the
  // listings dataset - about 600ms of it by the time the deals feed reached 480
  // rows. Count readings rather than time them: the clock is the only thing
  // here that can scale with the row count, and a timing assertion on a shared
  // CI box is a coin toss.
  it("reads the London clock once per filter, not once per row", () => {
    const now = Date.parse("2026-07-11T20:00:00.000Z");
    const rows = Array.from({ length: 500 }, (_, index) =>
      makeRow({ id: `row-${index}`, startsAt: "2026-07-11T19:30:00+01:00" }),
    );
    const readClock = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    try {
      filterTonight(rows.slice(0, 5), now);
      const few = readClock.mock.calls.length;
      readClock.mockClear();
      filterTonight(rows, now);
      const many = readClock.mock.calls.length;
      expect(many).toBe(few);
      // A handful resolves the window's two ends and their offsets. A hundred
      // times that many is the per-row reading coming back.
      expect(many).toBeLessThanOrEqual(8);
    } finally {
      readClock.mockRestore();
    }
  });

  it("gives the same answer whether the window is handed in or resolved here", () => {
    const now = Date.parse("2026-07-11T20:00:00.000Z");
    const tonight = tonightServiceWindow(now);
    for (const row of [
      makeRow({ id: "in", startsAt: "2026-07-11T19:30:00+01:00" }),
      makeRow({ id: "before", startsAt: "2026-07-11T10:00:00+01:00" }),
      makeRow({ id: "after", startsAt: "2026-07-12T09:00:00+01:00" }),
      makeRow({ id: "no-start", startsAt: undefined, listedWindow: "tonight" }),
    ]) {
      expect(isOnTonight(row, now, tonight)).toBe(isOnTonight(row, now));
    }
  });
});

// Freshness guard (#408): a past-dated row (its interval already ended) must
// never be served. All fixed dates, no real clock — hermetic. NOW below is a
// fixed instant, chosen so the sport-fixtures seed's own dates exercise it.
describe("past-dated freshness guard (isPastDated / filterNotPast)", () => {
  const NOW_GUARD = Date.parse("2026-07-18T22:00:00.000Z"); // the #408 refresh instant

  it("rowEffectiveEnd is endsAt when present, else startsAt + kind-aware grace", () => {
    // Point row (quiz, no endsAt): effective end is startsAt + the quiz grace
    // (3h, #417), no longer the bare startsAt, so an in-progress quiz stays live.
    expect(rowEffectiveEnd(makeRow({ startsAt: "2026-07-18T19:30:00+01:00" }))).toBe(
      Date.parse("2026-07-18T19:30:00+01:00") + 3 * 60 * 60 * 1000,
    );
    // Interval row: exact endsAt, untouched by grace.
    expect(
      rowEffectiveEnd(makeRow({ startsAt: "2026-07-18T11:30:00+01:00", endsAt: "2026-07-18T23:00:00+01:00" })),
    ).toBe(Date.parse("2026-07-18T23:00:00+01:00"));
  });

  it("treats a played sport fixture (point row, kickoff in the past) as past-dated", () => {
    // The old, unrefreshed seed: a World Cup semi-final already kicked off on
    // 2026-07-14. It is a point row (no endsAt), so its start is its end.
    const playedFixture = makeRow({
      id: "sport-old",
      kind: "sport",
      startsAt: "2026-07-14T20:00:00+01:00",
      confidence: "derived",
    });
    expect(isPastDated(playedFixture, NOW_GUARD)).toBe(true);
    expect(filterNotPast([playedFixture], NOW_GUARD)).toEqual([]);
  });

  it("keeps an upcoming fixture (kickoff after now)", () => {
    // The refreshed seed: the World Cup Final kicks off 2026-07-19, still ahead
    // of NOW_GUARD.
    const upcoming = makeRow({
      id: "sport-final",
      kind: "sport",
      startsAt: "2026-07-19T20:00:00+01:00",
      confidence: "derived",
    });
    expect(isPastDated(upcoming, NOW_GUARD)).toBe(false);
    expect(filterNotPast([upcoming], NOW_GUARD).map((r) => r.id)).toEqual(["sport-final"]);
  });

  it("keeps an interval row that started before now but is still running (endsAt in the future)", () => {
    const allDayDeal = makeRow({
      id: "deal-live",
      kind: "deal",
      startsAt: "2026-07-18T11:30:00+01:00",
      endsAt: "2026-07-19T00:00:00+01:00", // 23:00Z on the 18th, after NOW_GUARD (22:00Z)
    });
    expect(isPastDated(allDayDeal, NOW_GUARD)).toBe(false);
  });

  it("drops an interval row whose endsAt has already passed", () => {
    const finishedDeal = makeRow({
      id: "deal-over",
      kind: "deal",
      startsAt: "2026-07-18T11:30:00+01:00",
      endsAt: "2026-07-18T14:00:00+01:00", // 13:00Z, before NOW_GUARD (22:00Z)
    });
    expect(isPastDated(finishedDeal, NOW_GUARD)).toBe(true);
    expect(filterNotPast([finishedDeal], NOW_GUARD)).toEqual([]);
  });

  it("drops an interval at the exact endsAt boundary", () => {
    const boundary = makeRow({
      id: "deal-boundary",
      kind: "deal",
      startsAt: "2026-07-18T18:00:00.000Z",
      endsAt: new Date(NOW_GUARD).toISOString(),
    });
    expect(isPastDated(boundary, NOW_GUARD)).toBe(true);
    expect(filterNotPast([boundary], NOW_GUARD)).toEqual([]);
  });

  it("filterNotPast partitions a mixed set, preserving order of the survivors", () => {
    const rows = [
      makeRow({ id: "past-point", startsAt: "2026-07-14T20:00:00+01:00" }),
      makeRow({ id: "future-point", startsAt: "2026-07-19T20:00:00+01:00" }),
      makeRow({
        id: "running",
        kind: "deal",
        startsAt: "2026-07-18T11:30:00+01:00",
        endsAt: "2026-07-19T00:00:00+01:00",
      }),
    ];
    expect(filterNotPast(rows, NOW_GUARD).map((r) => r.id)).toEqual(["future-point", "running"]);
  });
});

// #417: a point row (no endsAt) is no longer a zero-width instant at startsAt.
// It carries a kind-aware effective duration, so an in-progress quiz or match is
// still served until that duration elapses, then goes past. Fixed offsets from a
// fixed start, no real clock.
describe("point-row kind-aware effective duration (#417)", () => {
  const HOUR = 60 * 60 * 1000;

  it("keeps an in-progress quiz at start+2h59 and drops it at start+3h01 (3h grace)", () => {
    const startsAt = "2026-07-18T19:30:00+01:00"; // 18:30:00Z
    const quiz = makeRow({ id: "quiz-live", kind: "quiz", startsAt });
    const start = Date.parse(startsAt);
    const stillOn = start + 2 * HOUR + 59 * 60 * 1000; // start + 2h59
    const over = start + 3 * HOUR + 60 * 1000; // start + 3h01
    expect(isPastDated(quiz, stillOn)).toBe(false);
    expect(filterNotPast([quiz], stillOn).map((r) => r.id)).toEqual(["quiz-live"]);
    expect(isPastDated(quiz, over)).toBe(true);
    expect(filterNotPast([quiz], over)).toEqual([]);
  });

  it("keeps a sport fixture during the match and drops it after (2.5h grace)", () => {
    const startsAt = "2026-07-19T20:00:00+01:00"; // 19:00:00Z kickoff
    const fixture = makeRow({ id: "sport-live", kind: "sport", startsAt, confidence: "derived" });
    const start = Date.parse(startsAt);
    const during = start + 2 * HOUR + 29 * 60 * 1000; // start + 2h29, inside 2.5h
    const after = start + 2 * HOUR + 31 * 60 * 1000; // start + 2h31, past 2.5h
    expect(isPastDated(fixture, during)).toBe(false);
    expect(filterNotPast([fixture], during).map((r) => r.id)).toEqual(["sport-live"]);
    expect(isPastDated(fixture, after)).toBe(true);
    expect(filterNotPast([fixture], after)).toEqual([]);
  });

  it("gives quiz/music 3h, sport 2.5h, and no grace to a deal reaching here as a point", () => {
    const startsAt = "2026-07-18T19:00:00+01:00";
    const start = Date.parse(startsAt);
    expect(rowEffectiveEnd(makeRow({ kind: "quiz", startsAt }))).toBe(start + 3 * HOUR);
    expect(rowEffectiveEnd(makeRow({ kind: "music", startsAt }))).toBe(start + 3 * HOUR);
    expect(rowEffectiveEnd(makeRow({ kind: "sport", startsAt }))).toBe(start + 2.5 * HOUR);
    // A deal without endsAt (deals normally carry one) gets no invented grace.
    expect(rowEffectiveEnd(makeRow({ kind: "deal", startsAt }))).toBe(start);
  });

  it("isOnTonight uses the same effective interval as the past-dated guard", () => {
    // Window for this NOW is [16:00, next 04:00) London. A quiz starting 15:30,
    // before the window opens, is still running into the evening under its 3h
    // grace, so it now correctly counts as on tonight (the reading the guard uses
    // too). A quiz that finishes (start + grace) before 16:00 does not.
    const now = Date.parse("2026-07-11T20:00:00.000Z");
    const quizBeforeOpen = makeRow({ id: "quiz-1530", kind: "quiz", startsAt: "2026-07-11T15:30:00+01:00" });
    const quizFinishedBeforeOpen = makeRow({ id: "quiz-1230", kind: "quiz", startsAt: "2026-07-11T12:30:00+01:00" });
    expect(isOnTonight(quizBeforeOpen, now)).toBe(true);
    expect(isOnTonight(quizFinishedBeforeOpen, now)).toBe(false);
  });
});

describe("filterByKind + matchVenueId", () => {
  it("filters by kind", () => {
    const rows = [makeRow({ kind: "quiz" }), makeRow({ id: "d", kind: "deal" })];
    expect(filterByKind(rows, "deal").map((r) => r.id)).toEqual(["d"]);
  });

  it("resolves a venueId only when absent", () => {
    const resolver = (name: string) => (name === "The Test Arms" ? "venue-xyz" : undefined);
    expect(matchVenueId(makeRow(), resolver).venueId).toBe("venue-xyz");
    expect(matchVenueId(makeRow({ venueId: "already" }), resolver).venueId).toBe("already");
    expect(matchVenueId(makeRow({ placeName: "Unknown" }), resolver).venueId).toBeUndefined();
  });
});

describe("mapThingsToDoToRows", () => {
  function result(opps: ThingsToDoOpportunity[]): ThingsToDoResult {
    return { window: "tonight", opportunities: opps };
  }

  it("keeps listed time evidence without inventing an exact start or urgency", () => {
    expect(THINGS_TO_DO_KIND_MAP).toMatchObject({ gig: "music", nightlife: "music", food_drink: "deal" });
    const rows = mapThingsToDoToRows(
      result([
        {
          title: "Jazz night",
          kind: "gig",
          timeEvidence: "Tuesdays 6:00pm-9:45pm",
          place: { name: "Blue Post", location: { lat: 51.52, lng: -0.08 } },
          source: { label: "Time Out", url: "https://timeout.com/x" },
        },
        {
          title: "£3 pints",
          kind: "food_drink",
          place: { name: "The Deal Arms" },
          source: { label: "Time Out", url: "https://timeout.com/y" },
        },
      ]),
      { now: NOW },
    );
    expect(rows.map((r) => r.kind).sort()).toEqual(["deal", "music"]);
    const music = rows.find((r) => r.kind === "music")!;
    expect(music.confidence).toBe("listed");
    expect(music.startsAt).toBeUndefined();
    expect(music.timeEvidence).toBe("Tuesdays 6:00pm-9:45pm");
    expect(laneTimeLabel(music)).toBe("Tuesdays 6:00pm-9:45pm");
    expect(
      listingUrgency(music, new Date("2026-07-11T14:23:00.000Z")),
    ).toBeNull();
    expect(music.lat).toBe(51.52);
    expect(music.detail).toContain("Listed time: Tuesdays 6:00pm-9:45pm");
  });

  it("uses a valid provider asOf for live-row observedAt", () => {
    const rows = mapThingsToDoToRows(
      {
        ...result([
          {
            title: "Provider-timed gig",
            kind: "gig",
            place: { name: "Venue" },
            source: { label: "T", url: "https://t.com" },
          },
        ]),
        asOf: "2026-07-11T18:30:00.000Z",
      },
      { now: NOW },
    );
    expect(rows[0].observedAt).toBe("2026-07-11T18:30:00.000Z");
  });

  it("drops non-mapping kinds, missing place names, and non-http sources", () => {
    const rows = mapThingsToDoToRows(
      result([
        { title: "Exhibition", kind: "exhibition", place: { name: "Tate" }, source: { label: "T", url: "https://t.com" } },
        { title: "No place", kind: "gig", source: { label: "T", url: "https://t.com" } },
        { title: "No url", kind: "gig", place: { name: "X" }, source: { label: "T" } },
        { title: "Bad url", kind: "gig", place: { name: "X" }, source: { label: "T", url: "ftp://t.com" } },
      ]),
      { now: NOW },
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps each opportunity's exact start with duplicate titles", () => {
    const rows = mapThingsToDoToRows(
      result([
        {
          title: "Timed gig",
          kind: "gig",
          startsAt: "2026-07-11T20:00:00+01:00",
          place: { name: "Venue A" },
          source: { label: "T", url: "https://t.com/a" },
        },
        {
          title: "Timed gig",
          kind: "gig",
          startsAt: "2026-07-11T22:00:00+01:00",
          place: { name: "Venue B" },
          source: { label: "T", url: "https://t.com/b" },
        },
      ]),
      { now: NOW },
    );
    expect(rows.map((row) => [row.placeName, row.startsAt])).toEqual([
      ["Venue A", "2026-07-11T20:00:00+01:00"],
      ["Venue B", "2026-07-11T22:00:00+01:00"],
    ]);
  });
});

describe("normaliseEventTitle", () => {
  const EM = String.fromCharCode(0x2014); // em dash
  const EN = String.fromCharCode(0x2013); // en dash

  it("folds an em dash in an event title to a plain spaced hyphen", () => {
    expect(normaliseEventTitle(`Skehan's ${EM} Live Music`)).toBe(
      "Skehan's - Live Music",
    );
  });

  it("folds an en dash too, and normalises spacing around it", () => {
    expect(normaliseEventTitle(`Quiz${EN}Every Sunday`)).toBe("Quiz - Every Sunday");
    expect(normaliseEventTitle(`Deal   ${EM}   Tuesdays`)).toBe("Deal - Tuesdays");
  });

  it("leaves a plain-hyphen title untouched", () => {
    expect(normaliseEventTitle("Open mic - Thursdays")).toBe("Open mic - Thursdays");
  });

  it("no typographic dash survives a title through parseWhatsOnRows", () => {
    const rows = parseWhatsOnRows(
      [makeRow({ title: `Live Music ${EM} Fridays ${EN} 8pm` })],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).not.toMatch(/[\u2013\u2014]/);
    expect(rows[0].title).toBe("Live Music - Fridays - 8pm");
  });

  it("no typographic dash survives a CityMCP row through mapThingsToDoToRows", () => {
    const result: ThingsToDoResult = {
      window: "tonight",
      opportunities: [
        {
          title: `Jazz ${EM} Late`,
          kind: "gig",
          place: { name: "The Blue Post", location: { lat: 51.5, lng: -0.1 } },
          source: { label: "Skiddle", url: "https://skiddle.com/e/1" },
        } as unknown as ThingsToDoOpportunity,
      ],
    };
    const rows = mapThingsToDoToRows(result, {
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).not.toMatch(/[\u2013\u2014]/);
    expect(rows[0].title).toBe("Jazz - Late");
  });
});

describe("normaliseSourceLabel", () => {
  const EM = String.fromCharCode(0x2014); // em dash
  const EN = String.fromCharCode(0x2013); // en dash

  it("folds a typographic dash in a source label to a plain spaced hyphen", () => {
    expect(normaliseSourceLabel(`Skehan's ${EM} Live Music`)).toBe("Skehan's - Live Music");
    expect(normaliseSourceLabel(`Skiddle ${EN} Gigs`)).toBe("Skiddle - Gigs");
  });

  it("leaves a plain source label untouched", () => {
    expect(normaliseSourceLabel("Question One")).toBe("Question One");
  });

  it("no typographic dash survives a source label through parseWhatsOnRows", () => {
    const rows = parseWhatsOnRows(
      [makeRow({ source: { label: `Skehan's ${EM} Live Music`, url: "https://skehans.com/e" } })],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source.label).not.toMatch(/[\u2013\u2014]/);
    expect(rows[0].source.label).toBe("Skehan's - Live Music");
  });

  it("no typographic dash survives a source label through mapThingsToDoToRows", () => {
    const result: ThingsToDoResult = {
      window: "tonight",
      opportunities: [
        {
          title: "Jazz Night",
          kind: "gig",
          place: { name: "The Blue Post", location: { lat: 51.5, lng: -0.1 } },
          source: { label: `Skehan's ${EM} Live Music`, url: "https://skiddle.com/e/1" },
        } as unknown as ThingsToDoOpportunity,
      ],
    };
    const rows = mapThingsToDoToRows(result, {
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source.label).not.toMatch(/[\u2013\u2014]/);
    expect(rows[0].source.label).toBe("Skehan's - Live Music");
  });
});


// A date printed beside a listing is a claim that somebody looked at THAT
// listing. Two rules, deliberately opposite, and both live here so they cannot
// drift apart: a page-level stamp reports the freshest evidence it has, and one
// line covering several kinds reports the oldest of the kinds it covers.
describe("per-kind confirmation times", () => {
  it("keeps only kinds we know and times we can parse", () => {
    expect(
      parseKindObservedAt({
        deal: "2026-08-10T08:43:37.191Z",
        music: "2026-07-18T21:25:03.316Z",
        quiz: "not-a-time",
        nonsense: "2026-08-10T08:43:37.191Z",
        sport: 17,
      }),
    ).toEqual({
      deal: "2026-08-10T08:43:37.191Z",
      music: "2026-07-18T21:25:03.316Z",
    });
    expect(parseKindObservedAt(null)).toEqual({});
    expect(parseKindObservedAt("nope")).toEqual({});
  });

  it("dates a covering line by its OLDEST kind, and refuses one it cannot date", () => {
    const observed = {
      deal: "2026-08-10T08:43:37.191Z",
      quiz: "2026-07-18T21:20:05.134Z",
    };
    // A row of chips reading "quiz and deal tonight" under one check is only as
    // good as the quiz behind it.
    expect(coveringObservedAt(observed, ["deal", "quiz"])).toBe("2026-07-18T21:20:05.134Z");
    expect(coveringObservedAt(observed, ["deal"])).toBe("2026-08-10T08:43:37.191Z");
    // Dropping the undatable kind would date the rest of the row as if it spoke
    // for all of them, so the whole line goes undated instead.
    expect(coveringObservedAt(observed, ["deal", "music"])).toBeNull();
    expect(coveringObservedAt(observed, [])).toBeNull();
  });
});
