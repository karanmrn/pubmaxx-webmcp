import { describe, expect, it } from "vitest";

import {
  CHEAPEST_NEAR_NO_ANCHOR,
  CROWD_READING_NOT_LIVE,
  FIND_DESK_NO_SEAT_DATA,
  OCCUPANCY_LEVELS,
  WORK_FRIENDLY_VENUE_KINDS,
  cheapestNearEmptyLine,
  cheapestNearHeadline,
  cheapestNearRowNote,
  CONCIERGE_TOOL_DEFINITIONS,
  findDeskEmptyLine,
  findDeskRowNote,
  isDeicticPlaceWord,
  isPlaceShapedWord,
  isWorkFriendlyVenueKind,
  occupancyReportOutcome,
  occupancyStoreState,
  parseOccupancyLevel,
  splitTonightRowsByNow,
  tonightNowLine,
  venueDrinkRowNote,
  venueDrinkRowReachesMap,
  venueDrinksAnswerLine,
  venueDrinksEmptyLine,
} from "@/lib/ask/conciergeTools";
import { askToolDefinitions } from "@/lib/ask/tools";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { WhatsOnRow } from "@/lib/whatsOn";

function row(overrides: Partial<WhatsOnRow>): WhatsOnRow {
  return {
    id: overrides.id ?? "r1",
    placeName: overrides.placeName ?? "The Lamb",
    kind: overrides.kind ?? "quiz",
    title: overrides.title ?? "Quiz night",
    source: overrides.source ?? { label: "Venue site", url: "https://example.com" },
    observedAt: overrides.observedAt ?? "2026-08-15T10:00:00.000Z",
    confidence: overrides.confidence ?? "listed",
    ...overrides,
  } as WhatsOnRow;
}

describe("cheapest_pint_near policy", () => {
  it("never offers a viewer-position parameter", () => {
    const definition = CONCIERGE_TOOL_DEFINITIONS.find(
      (tool) => tool.function.name === "cheapest_pint_near",
    );
    const properties = Object.keys(
      (definition?.function.parameters as { properties: Record<string, unknown> })
        .properties,
    );
    expect(properties).not.toContain("lat");
    expect(properties).not.toContain("lng");
    expect(properties).toEqual(["venueId", "venueName", "area", "limit"]);
  });

  it("names the anchor it actually used", () => {
    expect(
      cheapestNearHeadline(
        { kind: "venue", venueId: "v1", name: "The Lamb", area: "Camden" },
        "walkable",
      ),
    ).toBe("Cheapest listed pints near The Lamb");
    expect(
      cheapestNearHeadline(
        { kind: "venue", venueId: "v1", name: "The Lamb", area: "Camden" },
        "widened",
      ),
    ).toBe("Nearest listed pints to The Lamb");
    expect(cheapestNearHeadline({ kind: "area", area: "Camden" }, "walkable")).toBe(
      "Cheapest listed pints in Camden",
    );
  });

  it("separates an empty area from a read that failed", () => {
    const anchor = { kind: "area", area: "Camden" } as const;
    expect(cheapestNearEmptyLine(anchor, "ready")).toContain("No listed pint prices");
    const failed = cheapestNearEmptyLine(anchor, "unavailable");
    expect(failed).toContain("couldn't read");
    expect(failed).not.toContain("No listed pint prices");
  });

  it("asks for an anchor rather than guessing at one", () => {
    expect(CHEAPEST_NEAR_NO_ANCHOR).toContain("listed pub");
    expect(CHEAPEST_NEAR_NO_ANCHOR).not.toMatch(/location|your position/i);
  });

  it("refuses a word that only means where the reader is", () => {
    for (const word of [
      "me",
      "us",
      " Me ",
      "here",
      "round here",
      "mine",
      "my area",
      "my place",
      "where I am",
    ]) {
      expect(isDeicticPlaceWord(word)).toBe(true);
    }
    for (const word of ["Camden", "The Lamb", "Mile End", "Marylebone", ""]) {
      expect(isDeicticPlaceWord(word)).toBe(false);
    }
    expect(isDeicticPlaceWord(undefined)).toBe(false);
  });

  it("treats a London area or district word as a place, never a pub name", () => {
    for (const word of ["Angel", "Mayfair", "Clapham", "Camden", "Soho"]) {
      expect(isPlaceShapedWord(word)).toBe(true);
    }
    for (const word of ["The Lamb", "Ye Olde Swiss Cottage", ""]) {
      expect(isPlaceShapedWord(word)).toBe(false);
    }
  });

  it("carries the walk alone, never repeating the card's own place line", () => {
    // The card prints its area as the place line, so a note that named the
    // area again read "Camden Camden" on every cheapest-pint card.
    expect(cheapestNearRowNote({ walkMinutes: 7 })).toBe("7 min walk");
    expect(cheapestNearRowNote({ walkMinutes: null })).toBe("");
  });
});

describe("tonight_now policy", () => {
  it("splits rows on their own window", () => {
    const now = Date.parse("2026-08-15T20:30:00.000Z");
    const running = row({
      id: "running",
      startsAt: "2026-08-15T20:00:00.000Z",
      endsAt: "2026-08-15T22:00:00.000Z",
    });
    const upcoming = row({
      id: "upcoming",
      startsAt: "2026-08-15T21:30:00.000Z",
      endsAt: "2026-08-15T23:00:00.000Z",
    });
    const split = splitTonightRowsByNow([running, upcoming], now);
    expect(split.onNow.map((r) => r.id)).toEqual(["running"]);
    expect(split.later.map((r) => r.id)).toEqual(["upcoming"]);
  });

  it("treats a row with no start as DATE-ONLY, neither running nor still to start", () => {
    // The source published a day and no clock time, so putting it in either
    // timed bucket would claim something it withheld.
    const now = Date.parse("2026-08-15T20:30:00.000Z");
    const split = splitTonightRowsByNow([row({ id: "undated" })], now);
    expect(split.onNow).toHaveLength(0);
    expect(split.later).toHaveLength(0);
    expect(split.dateOnly.map((r) => r.id)).toEqual(["undated"]);
  });

  it("says the crowd reading is not live, without denying visit reports", () => {
    expect(CROWD_READING_NOT_LIVE).toBe(
      "No live crowd reading yet, so what people log is a visit report, dated the day they went.",
    );
    expect(CROWD_READING_NOT_LIVE).not.toMatch(/nobody can log/i);
  });

  it("ships the model the same crowd fact the answer carries", () => {
    const shipped = askToolDefinitions().find(
      (tool) => tool.function.name === "tonight_now",
    );
    expect(shipped).toBeDefined();
    const description = shipped?.function.description ?? "";
    expect(description).not.toMatch(/no crowd report exists/i);
    expect(description).toMatch(/no live crowd reading/i);
    expect(description).toMatch(/visit report/i);
  });

  it("separates a quiet city from a read that failed", () => {
    expect(tonightNowLine({ area: "Soho", onNow: 0, later: 0, read: "ready" })).toBe(
      "Nothing sourced in Soho for tonight.",
    );
    expect(
      tonightNowLine({ area: "Soho", onNow: 0, later: 0, read: "unavailable" }),
    ).toContain("couldn't read");
    expect(tonightNowLine({ area: null, onNow: 2, later: 3, read: "ready" })).toBe(
      "2 on right now, 3 still to start tonight.",
    );
    // A date-only listing is still to come, so the line may not say "nothing
    // else listed tonight" and then count more listings in the next breath.
    expect(
      tonightNowLine({ area: null, onNow: 2, later: 0, dateOnly: 1, read: "ready" }),
    ).toBe("2 on right now, nothing else with a stated start. 1 more listed tonight with no start time.");
    expect(
      tonightNowLine({ area: null, onNow: 0, later: 0, dateOnly: 2, read: "ready" }),
    ).toBe("2 listed tonight with no start time.");
  });
});

const DRINK_NOW = Date.parse("2026-08-15T20:30:00.000Z");
const DAY = 86_400_000;

function price(overrides: Partial<CommunityPrice> = {}): CommunityPrice {
  return {
    venueId: "v1",
    drinkCategory: "beer",
    priceGbp: 5.4,
    submittedAt: DRINK_NOW - DAY,
    source: "community",
    corroborations: 2,
    ...overrides,
  } as CommunityPrice;
}

describe("venue_drinks policy", () => {
  it("separates an unlogged pub from a read that failed", () => {
    expect(venueDrinksEmptyLine("The Lamb", "ready")).toContain("No drink prices logged");
    expect(venueDrinksEmptyLine("The Lamb", "unavailable")).toContain("couldn't read");
  });

  it("names a failed read even when a figure is still on record", () => {
    expect(
      venueDrinksAnswerLine({ venueName: "The Lamb", figures: 2, read: "ready" }),
    ).toBe("The Lamb: 2 drink figures on record.");
    const degraded = venueDrinksAnswerLine({
      venueName: "The Lamb",
      figures: 1,
      read: "unavailable",
    });
    expect(degraded).toContain("couldn't read what people have logged");
    expect(degraded).toContain("1 drink figure on record");
    expect(
      venueDrinksAnswerLine({ venueName: "The Lamb", figures: 0, read: "unavailable" }),
    ).toBe(venueDrinksEmptyLine("The Lamb", "unavailable"));
  });

  it("says how far a figure reaches, per row", () => {
    expect(
      venueDrinkRowNote({
        label: "Beer",
        day: "12 Aug",
        category: "beer",
        price: price({ priceGbp: 5.4, corroborations: 2 }),
        pintDropAt: null,
        now: DRINK_NOW,
      }),
    ).toContain("reaches the map");
    expect(
      venueDrinkRowNote({
        label: "Wine",
        day: "12 Aug",
        category: "wine",
        price: price({ drinkCategory: "wine", priceGbp: 8, corroborations: 1 }),
        pintDropAt: null,
        now: DRINK_NOW,
      }),
    ).toContain("stays on this pub's page");
  });

  it("promises no map reach to a category the map has no lens for", () => {
    const note = venueDrinkRowNote({
      label: "Other",
      day: "12 Aug",
      category: "other",
      price: price({ drinkCategory: "other", priceGbp: 5.4, corroborations: 2 }),
      pintDropAt: null,
      now: DRINK_NOW,
    });
    expect(note).toContain("two people agree");
    expect(note).not.toContain("map");
    expect(note).toContain("stays on this pub's page");
  });

  it("gives the map promise to the candidate figure, not the freshest row", () => {
    const fresherSmallerCluster = price({
      priceGbp: 9,
      corroborations: 2,
      submittedAt: DRINK_NOW - DAY,
      mapCandidate: {
        priceGbp: 4.2,
        corroborations: 3,
        submittedAt: DRINK_NOW - 4 * DAY,
      },
    });
    expect(
      venueDrinkRowReachesMap({
        category: "beer",
        price: fresherSmallerCluster,
        pintDropAt: null,
        now: DRINK_NOW,
      }),
    ).toBe(false);
    const note = venueDrinkRowNote({
      label: "Beer",
      day: "14 Aug",
      category: "beer",
      price: fresherSmallerCluster,
      pintDropAt: null,
      now: DRINK_NOW,
    });
    expect(note).toContain("two people agree");
    expect(note).not.toContain("reaches the map");

    const candidateRow = price({
      priceGbp: 4.2,
      corroborations: 3,
      submittedAt: DRINK_NOW - 4 * DAY,
      mapCandidate: {
        priceGbp: 4.2,
        corroborations: 3,
        submittedAt: DRINK_NOW - 4 * DAY,
      },
    });
    expect(
      venueDrinkRowReachesMap({
        category: "beer",
        price: candidateRow,
        pintDropAt: null,
        now: DRINK_NOW,
      }),
    ).toBe(true);
    expect(
      venueDrinkRowNote({
        label: "Beer",
        day: "11 Aug",
        category: "beer",
        price: candidateRow,
        pintDropAt: null,
        now: DRINK_NOW,
      }),
    ).toContain("reaches the map");
  });

  it("gives up the map promise to a newer Pint Drop, and to an unknown one", () => {
    const row = price({ priceGbp: 4.2, corroborations: 3, submittedAt: DRINK_NOW - 4 * DAY });
    expect(
      venueDrinkRowReachesMap({
        category: "beer",
        price: row,
        pintDropAt: DRINK_NOW - 2 * DAY,
        now: DRINK_NOW,
      }),
    ).toBe(false);
    expect(
      venueDrinkRowNote({
        label: "Beer",
        day: "11 Aug",
        category: "beer",
        price: row,
        pintDropAt: DRINK_NOW - 2 * DAY,
        now: DRINK_NOW,
      }),
    ).not.toContain("reaches the map");

    expect(
      venueDrinkRowReachesMap({
        category: "beer",
        price: row,
        pintDropAt: undefined,
        now: DRINK_NOW,
      }),
    ).toBe(false);
    const unchecked = venueDrinkRowNote({
      label: "Beer",
      day: "11 Aug",
      category: "beer",
      price: row,
      pintDropAt: undefined,
      now: DRINK_NOW,
    });
    expect(unchecked).toContain("two people agree on this figure");
    expect(unchecked).not.toContain("map");
  });
});

describe("find_desk policy", () => {
  it("answers only from work-friendly kinds, never a pub", () => {
    expect(WORK_FRIENDLY_VENUE_KINDS).toEqual(["cafe", "coworking", "library"]);
    expect(isWorkFriendlyVenueKind("pub")).toBe(false);
    expect(isWorkFriendlyVenueKind("bar")).toBe(false);
    expect(isWorkFriendlyVenueKind("cafe")).toBe(true);
    expect(isWorkFriendlyVenueKind(undefined)).toBe(false);
  });

  it("keeps three empty findings apart", () => {
    expect(FIND_DESK_NO_SEAT_DATA).toContain("No seat data yet");
    expect(findDeskEmptyLine({ area: null, reason: "none-anywhere" })).toBe(
      FIND_DESK_NO_SEAT_DATA,
    );
    expect(findDeskEmptyLine({ area: "Angel", reason: "none-anywhere" })).toBe(
      FIND_DESK_NO_SEAT_DATA,
    );

    const unknown = findDeskEmptyLine({
      area: "Angel",
      reason: "unknown-area",
    });
    expect(unknown).toContain("Angel");
    expect(unknown).not.toContain("No seat data yet");
    expect(unknown).toMatch(/don't know an area/i);
    expect(unknown).toMatch(/haven't looked there/i);

    expect(
      findDeskEmptyLine({ area: "Angel", reason: "unavailable" }),
    ).toContain("couldn't read");
  });

  it("admits what is missing on a row it did find", () => {
    expect(findDeskRowNote({ area: "Angel", kind: "coworking" })).toBe(
      "co-working space in Angel · no seat or wifi report on record",
    );
  });
});

describe("report_occupancy policy", () => {
  it("holds the three buttons R-011 names", () => {
    expect(OCCUPANCY_LEVELS).toEqual(["empty", "some-seats", "full"]);
  });

  it("reads plain speech into a level", () => {
    expect(parseOccupancyLevel("Full")).toBe("full");
    expect(parseOccupancyLevel("some seats")).toBe("some-seats");
    expect(parseOccupancyLevel("it's rammed")).toBe("full");
    expect(parseOccupancyLevel("No seats in The Lamb")).toBe("full");
    expect(parseOccupancyLevel("no room at all")).toBe("full");
    expect(parseOccupancyLevel("dead in here")).toBe("empty");
    expect(parseOccupancyLevel("mustard")).toBeNull();
    expect(parseOccupancyLevel(7)).toBeNull();
  });

  it("ships with a crowd store, so a valid report becomes a confirm-gated proposal", () => {
    expect(occupancyStoreState()).toBe("ready");
    const outcome = occupancyReportOutcome({
      venueId: "v1",
      venueName: "The Lamb",
      level: "full",
      store: occupancyStoreState(),
    });
    expect(outcome.status).toBe("proposed");
    expect(outcome.line).toContain("Nothing is saved until you confirm.");
  });

  it("becomes a confirm-gated proposal the moment a store exists", () => {
    const outcome = occupancyReportOutcome({
      venueId: "v1",
      venueName: "The Lamb",
      level: "some seats",
      store: "ready",
    });
    expect(outcome.status).toBe("proposed");
    expect(outcome.line).toContain("Nothing is saved until you confirm.");
  });

  it("asks for the pub and the level rather than assuming either", () => {
    expect(
      occupancyReportOutcome({
        venueId: "",
        venueName: "",
        level: "full",
        store: "unbuilt",
      }).status,
    ).toBe("no-venue");
    expect(
      occupancyReportOutcome({
        venueId: "v1",
        venueName: "The Lamb",
        level: "mustard",
        store: "unbuilt",
      }).status,
    ).toBe("no-level");
  });
});
