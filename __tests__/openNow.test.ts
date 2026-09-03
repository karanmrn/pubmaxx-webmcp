import { describe, expect, it } from "vitest";

import { initialFilters } from "@/components/map/ControlRail";
import { evaluateOpenState } from "@/lib/busyness";
import { filterMapVenues } from "@/lib/filterMapVenues";
import {
  OPEN_NOW_FILTER_CAPTION,
  matchesOpenNowFilter,
  openNowStatesForVenues,
  openStateForWetherspoonsPub,
  weeklyHoursFromWetherspoons,
} from "@/lib/openNow";
import { filterVenues, type Filters, type Venue } from "@/lib/venues";
import type { WetherspoonsPub } from "@/lib/wetherspoonsDirectory";

function directoryPub(
  overrides: Partial<WetherspoonsPub> & Pick<WetherspoonsPub, "name" | "latitude" | "longitude">,
): WetherspoonsPub {
  return {
    wpId: 1,
    jdwPubId: "1",
    slug: "test",
    pageUrl: "https://www.jdwetherspoon.com/pubs/test/",
    menuUrl: null,
    phone: null,
    fullAddress: null,
    addressLine1: null,
    addressLine2: null,
    townCity: null,
    county: null,
    postcode: null,
    country: "England",
    bookATableLink: null,
    regularOpeningTimes: [
      { day_of_the_week: "Monday", opening_time: "08:00", closing_time: "23:00" },
      { day_of_the_week: "Tuesday", opening_time: "08:00", closing_time: "23:00" },
      { day_of_the_week: "Wednesday", opening_time: "08:00", closing_time: "23:00" },
      { day_of_the_week: "Thursday", opening_time: "08:00", closing_time: "23:00" },
      { day_of_the_week: "Friday", opening_time: "08:00", closing_time: "23:00" },
      { day_of_the_week: "Saturday", opening_time: "08:00", closing_time: "23:00" },
      { day_of_the_week: "Sunday", opening_time: "08:00", closing_time: "23:00" },
    ],
    facilities: [],
    regions: [],
    statuses: ["Open"],
    menuPricesAvailableOnWeb: false,
    source: {
      label: "jdwetherspoon.com",
      url: "https://www.jdwetherspoon.com/",
      licence: "scraped",
    },
    // Fresh within OPENING_EVIDENCE_FRESH_DAYS of the fixed clock below.
    observedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function venue(overrides: Partial<Venue> & Pick<Venue, "id" | "name">): Venue {
  return {
    address: "Test Street",
    latitude: 51.54,
    longitude: -0.14,
    primaryBorough: "Camden",
    visibleBoroughs: [],
    // Hydrated path: a non-empty prices array (contents unused by openNow).
    prices: [{ pint_name: "Lager", price_gbp: 4.5 } as Venue["prices"][number]],
    cheapestPrice: 4.5,
    cheapestPint: "Lager",
    averagePrice: 4.5,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...overrides,
  };
}

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...initialFilters, ...overrides };
}

/** Friday 2026-08-07 12:00 BST (= 11:00 UTC). */
const FRIDAY_NOON = new Date("2026-08-07T11:00:00.000Z");
/** Friday 2026-08-07 23:30 BST (= 22:30 UTC). */
const FRIDAY_LATE = new Date("2026-08-07T22:30:00.000Z");

describe("evaluateOpenState (busyness)", () => {
  it("returns unknown when hours are missing", () => {
    expect(evaluateOpenState({ now: FRIDAY_NOON })).toBe("unknown");
  });

  it("returns open inside a listed window and closed outside it", () => {
    const hours = {
      5: [{ opens: "08:00", closes: "23:00" }],
    };
    expect(evaluateOpenState({ now: FRIDAY_NOON, openingHours: hours })).toBe(true);
    expect(evaluateOpenState({ now: FRIDAY_LATE, openingHours: hours })).toBe(false);
  });
});

describe("weeklyHoursFromWetherspoons", () => {
  it("maps weekday names onto the busyness day index", () => {
    const hours = weeklyHoursFromWetherspoons([
      { day_of_the_week: "Friday", opening_time: "08:00", closing_time: "23:00" },
    ]);
    expect(hours?.[5]).toEqual([{ opens: "08:00", closes: "23:00" }]);
  });
});

describe("openStateForWetherspoonsPub", () => {
  it("marks a matched pub open during listed hours", () => {
    expect(openStateForWetherspoonsPub(directoryPub({
      name: "The Ice Wharf",
      latitude: 51.5404,
      longitude: -0.1426,
    }), FRIDAY_NOON)).toBe(true);
  });

  it("marks a matched pub closed outside listed hours", () => {
    expect(openStateForWetherspoonsPub(directoryPub({
      name: "The Ice Wharf",
      latitude: 51.5404,
      longitude: -0.1426,
    }), FRIDAY_LATE)).toBe(false);
  });

  it("stays unknown with no hours, no match, or stale observation", () => {
    expect(openStateForWetherspoonsPub(null, FRIDAY_NOON)).toBe("unknown");
    expect(openStateForWetherspoonsPub(directoryPub({
      name: "The Ice Wharf",
      latitude: 51.5404,
      longitude: -0.1426,
      regularOpeningTimes: [],
    }), FRIDAY_NOON)).toBe("unknown");
    expect(openStateForWetherspoonsPub(directoryPub({
      name: "The Ice Wharf",
      latitude: 51.5404,
      longitude: -0.1426,
      observedAt: "2026-01-01T00:00:00.000Z",
    }), FRIDAY_NOON)).toBe("unknown");
  });

  it("treats a non-Open directory status as closed", () => {
    expect(openStateForWetherspoonsPub(directoryPub({
      name: "The Ice Wharf",
      latitude: 51.5404,
      longitude: -0.1426,
      statuses: ["Closed"],
    }), FRIDAY_NOON)).toBe(false);
  });
});

describe("matchesOpenNowFilter / filterVenues wiring", () => {
  it("keeps unknown and open; drops only known-closed when the filter is on", () => {
    expect(matchesOpenNowFilter(true, true)).toBe(true);
    expect(matchesOpenNowFilter(true, "unknown")).toBe(true);
    expect(matchesOpenNowFilter(true, false)).toBe(false);
    expect(matchesOpenNowFilter(false, false)).toBe(true);
  });

  it("caption is honest about unknown hours", () => {
    expect(OPEN_NOW_FILTER_CAPTION).toContain("Pubs without hours stay visible");
    expect(OPEN_NOW_FILTER_CAPTION).not.toMatch(/[—–!]/);
  });

  it("filterVenues drops known-closed and keeps unknown when openNow is on", () => {
    const openPub = venue({ id: "open", name: "Open Arms" });
    const closedPub = venue({ id: "closed", name: "Closed Arms" });
    const unknownPub = venue({ id: "unknown", name: "Mystery Arms" });
    const state = (id: string) => {
      if (id === "open") return true as const;
      if (id === "closed") return false as const;
      return "unknown" as const;
    };

    const kept = filterVenues(
      [openPub, closedPub, unknownPub],
      filters({ openNow: true }),
      () => false,
      state,
    ).map((row) => row.id);

    expect(kept).toEqual(["open", "unknown"]);
  });

  it("filterVenues is a no-op for openNow when the toggle is off", () => {
    const closedPub = venue({ id: "closed", name: "Closed Arms" });
    expect(
      filterVenues([closedPub], filters({ openNow: false }), () => false, () => false),
    ).toHaveLength(1);
  });

  it("filterMapVenues applies openNow to slim pins as well as hydrated ones", () => {
    const slimClosed = venue({
      id: "slim-closed",
      name: "Slim Closed",
      prices: [],
      cheapestPrice: null,
      cheapestPint: "",
      averagePrice: null,
    });
    const hydratedOpen = venue({ id: "hydrated-open", name: "Hydrated Open" });
    const kept = filterMapVenues(
      [slimClosed, hydratedOpen],
      filters({ openNow: true }),
      () => false,
      (id) => (id === "slim-closed" ? false : true),
    ).map((row) => row.id);
    expect(kept).toEqual(["hydrated-open"]);
  });
});

describe("openNowStatesForVenues", () => {
  it("joins by name+distance and leaves unmatched venues unknown", () => {
    const pubs = [
      directoryPub({
        name: "The Ice Wharf",
        latitude: 51.5404,
        longitude: -0.1426,
      }),
    ];
    const states = openNowStatesForVenues(
      [
        { id: "match", name: "The Ice Wharf - JD Wetherspoon", lat: 51.5405, lng: -0.1425 },
        { id: "far", name: "The Ice Wharf", lat: 51.6, lng: -0.2 },
        { id: "other", name: "Unrelated Arms", lat: 51.54, lng: -0.14 },
      ],
      pubs,
      FRIDAY_NOON,
    );
    expect(states.get("match")).toBe(true);
    expect(states.get("far")).toBe("unknown");
    expect(states.get("other")).toBe("unknown");
  });
});
