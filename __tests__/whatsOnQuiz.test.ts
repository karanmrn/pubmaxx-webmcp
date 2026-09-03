import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildQuestionOneRows,
  extractPostcode,
  isGreaterLondonLatLng,
  isGreaterLondonPostcode,
  isKnownLondonAreaName,
  isWeeklyCadence,
  nextWeeklyOccurrence,
  parseQuestionOneNextPage,
  parseQuestionOneVenueDetail,
  parseQuestionOneVenuesPage,
  parseSpeedQuizzingFindEvents,
  placeNameFromQuestionOneTitle,
} from "../scripts/whatson/quizParsers.mjs";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", "whats_on", name), "utf8");

// Real excerpts fetched 2026-07-11 (see the comment at the top of each file).
const LISTING = fixture("question-one-venues-page.html");
const DETAIL = fixture("question-one-venue-detail.html");
const SQ_FIND = fixture("speedquizzing-find.html");

describe("parseQuestionOneVenuesPage", () => {
  it("extracts every media-card with its weekly slot", () => {
    const cards = parseQuestionOneVenuesPage(LISTING);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toEqual({
      url: "https://questionone.com/venues/sporting-page-sundays-7-30pm/",
      title: "Sporting Page, Chelsea",
      day: "Sunday",
      time: "19:30",
    });
    // HTML entities in titles are decoded (&#8211; -> –).
    expect(cards[1].title).toBe("PUB QUIZ – The Britannia, Poole – Every Other Sunday");
  });

  it("follows the archive's rel=next pagination link", () => {
    expect(parseQuestionOneNextPage(LISTING)).toBe("https://questionone.com/venues/page/2/");
    expect(parseQuestionOneNextPage("<html></html>")).toBeNull();
  });

  it("returns [] for pages without cards", () => {
    expect(parseQuestionOneVenuesPage("<html><body></body></html>")).toEqual([]);
  });
});

describe("parseQuestionOneVenueDetail", () => {
  it("reads slot, entry fee and address off the icon field blocks", () => {
    expect(parseQuestionOneVenueDetail(DETAIL)).toEqual({
      day: "Sunday",
      time: "19:30",
      feeGbp: 2,
      feeRaw: "£2",
      address: "25 Roupell Street, England SE1 8TB, United Kingdom",
      postcode: "SE1 8TB",
    });
  });

  it("keeps unknown fields null instead of inventing them", () => {
    const empty = parseQuestionOneVenueDetail("<html></html>");
    expect(empty).toEqual({
      day: null, time: null, feeGbp: null, feeRaw: null, address: null, postcode: null,
    });
  });
});

describe("Greater London filter", () => {
  it("extracts full UK postcodes from address text", () => {
    expect(extractPostcode("25 Roupell Street, England SE1 8TB, United Kingdom")).toBe("SE1 8TB");
    expect(extractPostcode("1 High Street, Cambridge England CB24 9LG")).toBe("CB24 9LG");
    expect(extractPostcode("no postcode here")).toBeNull();
  });

  it("accepts inner-London postcode areas outright", () => {
    for (const pc of ["SE1 8TB", "E8 2NP", "EC1M 6BN", "WC1N 1LB", "SW10 0BH"])
      expect(isGreaterLondonPostcode(pc), pc).toBe(true);
  });

  it("uses the curated outward-code table for boundary areas", () => {
    expect(isGreaterLondonPostcode("TW1 3AB")).toBe(true); // Twickenham (LB Richmond)
    expect(isGreaterLondonPostcode("HA9 0WS")).toBe(true); // Wembley (LB Brent)
    expect(isGreaterLondonPostcode("RM14 1AB")).toBe(true); // Upminster (LB Havering)
    expect(isGreaterLondonPostcode("IG10 4BE")).toBe(false); // Loughton = Essex
    expect(isGreaterLondonPostcode("KT19 8AG")).toBe(false); // Epsom = Surrey
    expect(isGreaterLondonPostcode("WD17 1AA")).toBe(false); // Watford = Herts
    expect(isGreaterLondonPostcode("CB24 9LG")).toBe(false); // Histon = Cambs
  });

  it("area-name fallback only matches the explicit district allowlist", () => {
    expect(isKnownLondonAreaName("Grapes, Limehouse")).toBe(true);
    expect(isKnownLondonAreaName("White Swan, Pimlico")).toBe(true);
    expect(isKnownLondonAreaName("The Queen Victoria, Epping")).toBe(false); // Essex
    expect(isKnownLondonAreaName("Sonder Bar")).toBe(false); // no area part at all
  });

  it("bounding box covers London and excludes elsewhere", () => {
    expect(isGreaterLondonLatLng(51.5074, -0.1278)).toBe(true); // central London
    expect(isGreaterLondonLatLng(53.4808, -2.2426)).toBe(false); // Manchester
    expect(isGreaterLondonLatLng(Number.NaN, 0)).toBe(false);
  });
});

describe("nextWeeklyOccurrence (Europe/London)", () => {
  it("returns the next slot after the observation, with BST offset", () => {
    // Observed Saturday 2026-07-11 15:00 UTC; next Tuesday 19:30 London.
    expect(nextWeeklyOccurrence("Tuesday", "19:30", "2026-07-11T15:00:00Z"))
      .toBe("2026-07-14T19:30:00+01:00");
  });

  it("rolls to next week when the slot already passed today", () => {
    // 2026-07-14 is a Tuesday; observing at 20:00 London (19:00Z) is after 19:30.
    expect(nextWeeklyOccurrence("Tuesday", "19:30", "2026-07-14T19:00:00Z"))
      .toBe("2026-07-21T19:30:00+01:00");
    // ...but observing at 19:00 London still hits the same evening.
    expect(nextWeeklyOccurrence("Tuesday", "19:30", "2026-07-14T17:00:00Z"))
      .toBe("2026-07-14T19:30:00+01:00");
  });

  it("is DST-aware: GMT offset after the October clock change", () => {
    // Clocks fall back Sunday 2026-10-25; a quiz that evening is +00:00.
    expect(nextWeeklyOccurrence("Sunday", "19:30", "2026-10-24T12:00:00Z"))
      .toBe("2026-10-25T19:30:00+00:00");
    expect(nextWeeklyOccurrence("Sunday", "19:30", "2026-10-25T20:00:00Z"))
      .toBe("2026-11-01T19:30:00+00:00");
  });

  it("rejects malformed input instead of guessing", () => {
    expect(nextWeeklyOccurrence("Funday", "19:30", "2026-07-11T15:00:00Z")).toBeNull();
    expect(nextWeeklyOccurrence("Tuesday", "25:99", "2026-07-11T15:00:00Z")).toBeNull();
    expect(nextWeeklyOccurrence("Tuesday", "19:30", "not a date")).toBeNull();
  });
});

describe("cadence + title helpers", () => {
  it("treats monthly / every-other listings as non-weekly", () => {
    expect(isWeeklyCadence("PUB QUIZ – Royal Oak, Twickenham – Every Thursday")).toBe(true);
    expect(isWeeklyCadence("PUB QUIZ – The Britannia, Poole – Every Other Sunday")).toBe(false);
    expect(isWeeklyCadence("PUB QUIZ – Unity Place, Milton Keynes – Monthly")).toBe(false);
    expect(isWeeklyCadence("PUB QUIZ – Beaconsfield Tap – First Wednesday of the Month")).toBe(false);
  });

  it("strips the PUB QUIZ prefix and cadence suffix from titles", () => {
    expect(placeNameFromQuestionOneTitle("PUB QUIZ – King’s Arms, Waterloo – Every Sunday"))
      .toBe("King’s Arms, Waterloo");
    expect(placeNameFromQuestionOneTitle("Sporting Page, Chelsea")).toBe("Sporting Page, Chelsea");
    expect(placeNameFromQuestionOneTitle("PUB QUIZ – White Hart, Whitechapel – Thursdays"))
      .toBe("White Hart, Whitechapel");
  });
});

describe("buildQuestionOneRows", () => {
  const observedAt = "2026-07-11T20:30:00.000Z";

  it("emits contract rows for weekly London cards and counts the rest", () => {
    const cards = parseQuestionOneVenuesPage(LISTING);
    const detailsByUrl = new Map([
      // Real detail fixture belongs to King's Arms; reused here to give the
      // Chelsea card a fee + London postcode without a second fixture file.
      [cards[0].url, parseQuestionOneVenueDetail(DETAIL)],
    ]);
    const { rows, dropped } = buildQuestionOneRows({ cards, detailsByUrl, observedAt });

    // Card 2 is "Every Other Sunday" (non-weekly), card 3 (Twickenham) has no
    // detail postcode and "Twickenham" is allowlisted -> kept via area name.
    expect(dropped).toEqual({ nonWeekly: 1, notLondon: 0, noSlot: 0 });
    expect(rows).toHaveLength(2);

    const row = rows[0];
    expect(row).toEqual({
      id: "quiz-qo-sporting-page-sundays-7-30pm",
      venueId: null,
      placeName: "Sporting Page, Chelsea",
      kind: "quiz",
      startsAt: "2026-07-12T19:30:00+01:00", // next Sunday after observedAt
      title: "Pub quiz — Sundays 7:30pm",
      detail: "Weekly pub quiz — every Sunday 19:30 · entry £2 · SE1 8TB · run by Question One",
      priceGbp: 2,
      source: { label: "Question One", url: cards[0].url },
      observedAt,
      confidence: "listed",
    });
  });

  it("omits priceGbp when the venue page lists no fee", () => {
    const cards = parseQuestionOneVenuesPage(LISTING);
    const { rows } = buildQuestionOneRows({ cards, detailsByUrl: new Map(), observedAt });
    const twickenham = rows.find((r) => r.placeName.includes("Twickenham"));
    expect(twickenham).toBeDefined();
    expect(twickenham).not.toHaveProperty("priceGbp");
    expect(twickenham?.detail).toContain("Weekly pub quiz — every Thursday 19:30");
  });

  it("every emitted row carries source + observedAt provenance", () => {
    const cards = parseQuestionOneVenuesPage(LISTING);
    const { rows } = buildQuestionOneRows({ cards, detailsByUrl: new Map(), observedAt });
    for (const row of rows) {
      expect(row.source.label).toBe("Question One");
      expect(row.source.url).toMatch(/^https:\/\/questionone\.com\/venues\//);
      expect(row.observedAt).toBe(observedAt);
      expect(row.confidence).toBe("listed");
      expect(new Date(row.startsAt).getTime()).toBeGreaterThan(new Date(observedAt).getTime());
    }
  });
});

describe("parseSpeedQuizzingFindEvents", () => {
  it("parses the inline events array (coverage only — no venue names)", () => {
    const events = parseSpeedQuizzingFindEvents(SQ_FIND);
    expect(events).toHaveLength(8);
    const london = events.filter((e) => isGreaterLondonLatLng(e.lat, e.lng));
    expect(london).toHaveLength(5);
    for (const e of events) {
      expect(e.eventId).toMatch(/^\d+$/);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("returns [] when the events block is missing", () => {
    expect(parseSpeedQuizzingFindEvents("<html></html>")).toEqual([]);
  });
});
