import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { WhatsOnRow } from "@/lib/whatsOn";
import type { DeskVenueRead } from "@/lib/ask/deskVenues.server";

const state = {
  venues: [] as ConciergeVenue[],
  prices: { prices: [] as CommunityPrice[], degraded: false },
  whatsOn: { rows: [] as WhatsOnRow[], kindObservedAt: {} },
  whatsOnThrows: false,
  whatsOnReadStatus: "ready" as "ready" | "degraded",
  desk: { venues: [], status: "ready" } as DeskVenueRead,
};

vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: vi.fn(async () => state.venues),
}));

vi.mock("@/lib/communityPriceStore", () => ({
  readCommunityPricesWithStatus: vi.fn(async () => state.prices),
}));

// A tiny stand-in for the tonight window: rows are kept only when their own
// start sits inside the twelve hours around the clock the CALLER handed in, so
// a handler that leaves `now` out of the read answers about another day. A
// DATE-ONLY row states a day and no clock time, and the real store windows it
// by that day, so it is kept when its stated date is the caller's own.
vi.mock("@/lib/whatsOnStore", () => ({
  loadWhatsOn: vi.fn(async (_params: unknown, deps: { now?: number } = {}) => {
    if (state.whatsOnThrows) throw new Error("down");
    const now = deps.now ?? Date.now();
    return {
      ...state.whatsOn,
      readStatus: state.whatsOnReadStatus,
      rows: state.whatsOn.rows.filter((row) => {
        if (!row.startsAt && row.startsDate) {
          return row.startsDate === new Date(now).toISOString().slice(0, 10);
        }
        const startsAt = row.startsAt ? Date.parse(row.startsAt) : Number.NaN;
        return (
          Number.isFinite(startsAt) && Math.abs(startsAt - now) <= 12 * 3_600_000
        );
      }),
    };
  }),
}));

vi.mock("@/lib/ask/deskVenues.server", () => ({
  loadDeskVenues: vi.fn(async () => state.desk),
}));

import { CHEAPEST_NEAR_NO_ANCHOR, VENUE_DRINKS_NO_VENUE } from "@/lib/ask/conciergeTools";
import { routeAskDeterministically } from "@/lib/ask/router";
import { runAskTool } from "@/lib/ask/tools";
import type { AskToolContext } from "@/lib/ask/toolContract";

const NOW = Date.parse("2026-08-15T20:30:00.000Z");

function ctx(overrides: Partial<AskToolContext> = {}): AskToolContext {
  return { cityId: "london", query: "", now: NOW, skipModel: true, ...overrides };
}

function venue(overrides: Partial<ConciergeVenue> & { id: string; name: string }): ConciergeVenue {
  return {
    area: "Camden",
    lat: 51.5,
    lng: -0.13,
    cheapestPrice: 5,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...overrides,
  };
}

function price(overrides: Partial<CommunityPrice> = {}): CommunityPrice {
  return {
    venueId: "v1",
    drinkCategory: "beer",
    priceGbp: 5.4,
    submittedAt: NOW - 86_400_000,
    source: "community",
    corroborations: 2,
    ...overrides,
  } as CommunityPrice;
}

beforeEach(() => {
  state.venues = [];
  state.prices = { prices: [], degraded: false };
  state.whatsOn = { rows: [], kindObservedAt: {} };
  state.whatsOnThrows = false;
  state.whatsOnReadStatus = "ready";
  state.desk = { venues: [], status: "ready" };
});

describe("cheapest_pint_near", () => {
  it("ranks the listed pints round a named pub and leaves the anchor out", async () => {
    state.venues = [
      venue({ id: "anchor", name: "The Lamb", cheapestPrice: 4 }),
      venue({ id: "near-cheap", name: "The Crown", lat: 51.5005, cheapestPrice: 4.5 }),
      venue({ id: "near-dear", name: "The Ship", lat: 51.5008, cheapestPrice: 6.2 }),
    ];
    const result = await runAskTool("cheapest_pint_near", { venueName: "The Lamb" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => card.venueId)).toEqual(["near-cheap", "near-dear"]);
    expect(result.answerHint).toContain("The Crown at £4.50");
    for (const card of result.cards) {
      expect(card.provenance?.label).toBe("On record");
    }
  });

  it("answers an area ask from the borough list", async () => {
    state.venues = [
      venue({ id: "a", name: "The Crown", area: "Camden", cheapestPrice: 6 }),
      venue({ id: "b", name: "The Ship", area: "Camden", cheapestPrice: 4.2 }),
      venue({ id: "c", name: "The Anchor", area: "Hackney", cheapestPrice: 3 }),
    ];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx());
    expect(result.cards.map((card) => card.venueId)).toEqual(["b", "a"]);
    expect(result.answerHint).toContain("Cheapest listed pints in Camden");
  });

  it("answers bare London city-wide and refuses unknown districts", async () => {
    state.venues = [
      venue({ id: "camden", name: "The Crown", area: "Camden", cheapestPrice: 4.2 }),
      venue({ id: "hackney", name: "The Ship", area: "Hackney", cheapestPrice: 3.8 }),
      venue({ id: "city", name: "The Anchor", area: "City of London", cheapestPrice: 5.1 }),
    ];
    const london = await runAskTool("cheapest_pint_near", { area: "London" }, ctx());
    expect(london.ok).toBe(true);
    expect(london.cards.map((card) => card.venueId)).toEqual([
      "hackney",
      "camden",
      "city",
    ]);
    expect(london.answerHint).toContain("Cheapest listed pints in London");

    const soho = await runAskTool("cheapest_pint_near", { area: "Soho" }, ctx());
    expect(soho.ok).toBe(false);
    expect(soho.answerHint).toBe(CHEAPEST_NEAR_NO_ANCHOR);
  });

  it("asks for an anchor instead of guessing one", async () => {
    state.venues = [venue({ id: "a", name: "The Crown" })];
    const result = await runAskTool("cheapest_pint_near", {}, ctx());
    expect(result.ok).toBe(false);
    expect(result.answerHint).toContain("Name a listed pub");
    expect(result.cards).toHaveLength(0);
  });

  it("refuses a positional pronoun rather than landing on a pub that spells it", async () => {
    state.venues = [
      venue({ id: "bex", name: "Bexleyheath Working Mens Club", cheapestPrice: 3 }),
      venue({ id: "us", name: "The Custom House", cheapestPrice: 4 }),
    ];
    for (const query of ["cheapest pint near me", "cheapest pint near us"]) {
      const [call] = routeAskDeterministically(query);
      expect(call?.name).toBe("cheapest_pint_near");
      const result = await runAskTool("cheapest_pint_near", call.args, ctx({ query }));
      expect(result.ok).toBe(false);
      expect(result.cards).toHaveLength(0);
      expect(result.answerHint).toBe(CHEAPEST_NEAR_NO_ANCHOR);
    }
  });

  it("still resolves a real area word arriving the same way", async () => {
    state.venues = [
      venue({ id: "a", name: "The Crown", area: "Camden", cheapestPrice: 6 }),
      venue({ id: "b", name: "The Ship", area: "Camden", cheapestPrice: 4.2 }),
    ];
    const [call] = routeAskDeterministically("cheapest pint near Camden");
    const result = await runAskTool("cheapest_pint_near", call.args, ctx());
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => card.venueId)).toEqual(["b", "a"]);
  });

  it("never turns a place word it cannot place into a pub", async () => {
    // The pack files a pub under its BOROUGH, so a district word resolves to no
    // area. The Angel sits in Hillingdon, nowhere near Islington's Angel.
    state.venues = [
      venue({ id: "angel", name: "The Angel", area: "Hillingdon", cheapestPrice: 4 }),
      venue({ id: "crown", name: "The Crown", area: "Hillingdon", cheapestPrice: 4.5 }),
    ];
    const [call] = routeAskDeterministically("cheapest pint in Angel");
    expect(call?.name).toBe("cheapest_pint_near");
    const result = await runAskTool("cheapest_pint_near", call.args, ctx());
    expect(result.ok).toBe(false);
    expect(result.answerHint).toBe(CHEAPEST_NEAR_NO_ANCHOR);
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).not.toContain("Angel");
  });

  it("still ranks round a pub the drinker named", async () => {
    state.venues = [
      venue({ id: "lamb", name: "The Lamb", area: "Camden", cheapestPrice: 4 }),
      venue({ id: "near", name: "The Crown", area: "Camden", lat: 51.5005, cheapestPrice: 4.5 }),
    ];
    const [call] = routeAskDeterministically("cheapest pint near The Lamb");
    const result = await runAskTool("cheapest_pint_near", call.args, ctx());
    expect(result.ok).toBe(true);
    expect(result.answerHint).toContain("The Lamb");
    expect(result.cards.map((card) => card.venueId)).toContain("near");
    expect(result.cards.map((card) => card.venueId)).not.toContain("lamb");
  });

  it("reads a borough word in the centre slot as that borough", async () => {
    state.venues = [
      venue({ id: "a", name: "The Crown", area: "Westminster", cheapestPrice: 6 }),
      venue({ id: "b", name: "Golden Lion (Soho)", area: "Westminster", cheapestPrice: 4.2 }),
      venue({ id: "c", name: "The Anchor", area: "Hackney", cheapestPrice: 3 }),
    ];
    const result = await runAskTool(
      "cheapest_pint_near",
      { venueName: "Westminster" },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(result.answerHint).toContain("Cheapest listed pints in Westminster");
    expect(result.cards.map((card) => card.venueId)).toEqual(["b", "a"]);
  });

  it("degrades honestly when the listed index could not be read", async () => {
    state.venues = [];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read");
  });
});

describe("tonight_now", () => {
  it("splits running from still-to-start and never claims a crowd reading", async () => {
    state.whatsOn = {
      rows: [
        {
          id: "running",
          placeName: "The Lamb",
          kind: "quiz",
          title: "Quiz night",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
        {
          id: "later",
          placeName: "The Crown",
          kind: "music",
          title: "Live set",
          startsAt: "2026-08-15T22:30:00.000Z",
          endsAt: "2026-08-16T00:00:00.000Z",
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());
    expect(result.ok).toBe(true);
    expect(result.answerHint).toContain("1 on right now");
    expect(result.answerHint).toContain("1 still to start tonight");
    expect(result.answerHint).toContain("No live crowd reading yet");
    expect(result.cards[0]?.note).toBe("On right now");
  });

  it("keeps listing counts when tonight listings exceed six cards", async () => {
    state.whatsOn = {
      rows: Array.from({ length: 7 }, (_, index) => ({
        id: `later-${index}`,
        placeName: `The Pub ${index}`,
        kind: "music" as const,
        title: `Live set ${index}`,
        startsAt: new Date(NOW + (30 + index * 15) * 60_000).toISOString(),
        endsAt: new Date(NOW + (90 + index * 15) * 60_000).toISOString(),
        source: { label: "Venue site", url: "https://example.com" },
        observedAt: "2026-08-15T09:00:00.000Z",
        confidence: "listed" as const,
      })),
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());

    expect(result.cards).toHaveLength(6);
    expect(result.answerHint).toContain("7 still to start tonight");
    expect(result.answerHint).not.toContain("Here are the first 6.");
  });

  it("prints no bare figure for a listed night, and keeps the deal's own", async () => {
    // A kind=event priceGbp is a TICKET price. It belongs to the /out card,
    // worded "Tickets from £X" beside its source credit; a Pub Pal card prints
    // `price` as a bare figure, which in this product reads as a drink price.
    state.whatsOn = {
      rows: [
        {
          id: "ticketed",
          placeName: "Soho Theatre",
          kind: "event",
          title: "A Night at the Playhouse",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          priceGbp: 23.5,
          source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
        {
          id: "priced-deal",
          placeName: "The Lamb",
          kind: "deal",
          title: "Two for one",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          priceGbp: 4.5,
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());
    const byKey = new Map(result.cards.map((card) => [card.key, card]));
    expect(byKey.get("ticketed")?.price).toBeNull();
    expect(byKey.get("priced-deal")?.price).toBe(4.5);
    expect(JSON.stringify(result.cards)).not.toContain("23.5");
  });

  it("never says a date-only listing has or has not started", async () => {
    // Common (and a bare-date Skiddle listing) publishes a DAY and no clock
    // time. Calling it "still to start tonight" is a claim about a start the
    // source withheld, so the card carries the source's own line instead.
    state.whatsOn = {
      rows: [
        {
          id: "date-only",
          placeName: "Camberwell",
          kind: "event",
          title: "Sunday roast club",
          startsDate: "2026-08-15",
          timeEvidence: "Date listed, start time not published",
          source: { label: "common", url: "https://www.common-social.com/post/abc" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.note).toBe("Date listed, start time not published");
    expect(result.cards[0]?.note).not.toContain("start tonight");
    expect(result.cards[0]?.note).not.toContain("right now");
    // The summary counts it on its own, so it inflates neither running nor
    // still-to-start, and the answer is not "nothing sourced" either.
    expect(result.answerHint).toContain("1 listed tonight with no start time");
    expect(result.answerHint).not.toContain("still to start");
    expect(result.answerHint).not.toContain("Nothing sourced");
  });

  it("reads the window and the split off the same clock", async () => {
    state.whatsOn = {
      rows: [
        {
          id: "running",
          placeName: "The Lamb",
          kind: "quiz",
          title: "Quiz night",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const tonight = await runAskTool("tonight_now", {}, ctx());
    expect(tonight.answerHint).toContain("1 on right now");

    const anotherDay = await runAskTool(
      "tonight_now",
      {},
      ctx({ now: NOW + 3 * 86_400_000 }),
    );
    expect(anotherDay.cards).toHaveLength(0);
    expect(anotherDay.answerHint).toContain("Nothing sourced");
  });

  it("degrades rather than reading a failed listing load as a quiet city", async () => {
    state.whatsOnThrows = true;
    const result = await runAskTool("tonight_now", { area: "Soho" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read tonight's listings");
  });

  it("degrades on a read that answered degraded, not only on one that threw", async () => {
    // The bundled read stopped throwing and started reporting itself. Zero rows
    // from a read that did not run must not answer "Nothing sourced tonight".
    state.whatsOnReadStatus = "degraded";
    const result = await runAskTool("tonight_now", { area: "Soho" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read tonight's listings");
    expect(result.answerHint).not.toContain("Nothing sourced");
  });
});

describe("venue_drinks", () => {
  it("prints one row per drink with its own tag, figure and standing", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = {
      prices: [
        price({ drinkCategory: "beer", priceGbp: 5.4, corroborations: 2 }),
        price({ drinkCategory: "wine", priceGbp: 8, corroborations: 1 }),
      ],
      degraded: false,
    };
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.cards.map((card) => card.price)).toEqual([5.4, 8, 5]);
    // This lane reads no Pint Drop, so a corroborated figure states the
    // agreement and never claims the pin.
    expect(result.cards[0]?.note).toContain("two people agree on this figure");
    expect(result.cards[0]?.note).not.toContain("map");
    expect(result.cards[1]?.note).toContain("stays on this pub's page");
    expect(result.cards[2]?.provenance?.label).toBe("On record");
  });

  it("resolves a routed short pub name but never a borough", async () => {
    state.venues = [
      venue({ id: "lamb", name: "The Lamb", area: "Camden", cheapestPrice: 4 }),
      venue({ id: "head", name: "Camden Head", area: "Camden", cheapestPrice: 5 }),
    ];
    const named = await runAskTool("venue_drinks", { venueName: "Lamb" }, ctx());
    expect(named.ok).toBe(true);
    expect(named.data).toMatchObject({ venueId: "lamb" });

    const areaWord = await runAskTool("venue_drinks", { venueName: "Camden" }, ctx());
    expect(areaWord.ok).toBe(false);
    expect(areaWord.answerHint).toContain("Name a listed pub");
    expect(areaWord.cards).toHaveLength(0);
  });

  it("says nobody has logged one rather than inventing a figure", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: null })];
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).toContain("No drink prices logged at The Lamb yet");
  });

  it("separates a failed read from an unlogged pub", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: null })];
    state.prices = { prices: [], degraded: true };
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read what people have logged");
  });

  it("still names the failed read when a listed pint is on record", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = { prices: [], degraded: true };
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read what people have logged");
    expect(result.cards.map((card) => card.price)).toEqual([5]);
    expect(result.cards[0]?.provenance?.label).toBe("On record");
  });
});

describe("find_desk", () => {
  it("says no seat data yet while the pack carries no work-friendly rows", async () => {
    state.desk = { venues: [], status: "ready" };
    const result = await runAskTool("find_desk", { area: "Angel" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).toContain("No seat data yet");
    expect(result.answerHint).not.toContain("Angel");
  });

  it("never asserts absence in an area the places list does not name", async () => {
    state.desk = {
      status: "ready",
      venues: [
        { id: "c1", name: "Bean Counter", area: "Islington", lat: 51.53, lng: -0.1, kind: "cafe" },
      ],
    };
    const result = await runAskTool("find_desk", { area: "Angel" }, ctx());
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).not.toContain("No seat data yet");
    expect(result.answerHint).toContain("Angel");
    expect(result.answerHint).toMatch(/don't know an area/i);
  });

  it("answers from work-friendly rows and still admits the missing facts", async () => {
    state.desk = {
      status: "ready",
      venues: [
        { id: "c1", name: "Bean Counter", area: "Angel", lat: 51.53, lng: -0.1, kind: "cafe" },
      ],
    };
    const result = await runAskTool("find_desk", { area: "Angel" }, ctx());
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.note).toContain("no seat or wifi report on record");
    expect(result.answerHint).toContain("No seat or wifi report on any of them yet.");
  });

  it("degrades when the pack could not be read", async () => {
    state.desk = { venues: [], status: "unavailable" };
    const result = await runAskTool("find_desk", {}, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read the places list");
  });
});

describe("report_occupancy", () => {
  it("proposes a crowd report and writes nothing until confirm", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool(
      "report_occupancy",
      { venueName: "The Lamb", level: "rammed" },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      kind: "report_occupancy",
      venueId: "v1",
      level: "full",
    });
    expect(result.answerHint).toContain("Nothing is saved until you confirm.");
  });

  it("asks which pub before taking a report", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool("report_occupancy", { level: "full" }, ctx());
    expect(result.ok).toBe(false);
    expect(result.answerHint).toContain("Name the pub");
  });

  it("refuses a place word that would only land on a pub by prefix", async () => {
    // Each of these SHARES its first word with a London place. A district word
    // may not become the pub on the other side of the city.
    state.venues = [
      venue({ id: "angel", name: "The Angel Hillingdon", area: "Hillingdon" }),
      venue({ id: "mayfair", name: "The Mayfair Tavern", area: "Wandsworth" }),
      venue({ id: "clapham", name: "The Clapham North", area: "Lambeth" }),
    ];

    const occ = await runAskTool(
      "report_occupancy",
      { venueName: "Angel", level: "it's rammed" },
      ctx(),
    );
    expect(occ.answerHint).toContain("Name the pub");
    expect(occ.answerHint).not.toContain("The Angel Hillingdon");

    const drinks = await runAskTool("venue_drinks", { venueName: "Mayfair" }, ctx());
    expect(drinks.answerHint).toBe(VENUE_DRINKS_NO_VENUE);

    const clapham = await runAskTool(
      "report_occupancy",
      { venueName: "Clapham", level: "it's rammed" },
      ctx(),
    );
    expect(clapham.answerHint).not.toContain("The Clapham North");
    expect(clapham.answerHint).toContain("Name the pub");
  });

  it("still answers a pub whose whole name is a place word", async () => {
    // The router strips "the" before a tool sees the name, so "The Angel"
    // arrives as "Angel". An EXACT name, article or not, is the pub they named.
    state.venues = [
      venue({ id: "angel", name: "The Angel", area: "Islington" }),
      venue({ id: "lamb", name: "The Lamb", area: "Camden" }),
    ];

    const [call] = routeAskDeterministically("It's rammed at The Angel");
    expect(call?.name).toBe("report_occupancy");
    const occ = await runAskTool("report_occupancy", call.args, ctx());
    expect(occ.answerHint).toContain("Log The Angel as full");

    const drinks = await runAskTool("venue_drinks", { venueName: "Angel" }, ctx());
    expect(drinks.answerHint).not.toBe(VENUE_DRINKS_NO_VENUE);
    expect(drinks.answerHint).toContain("The Angel");
  });

  it("takes a report for the pub named, never a borough's name-alike", async () => {
    state.venues = [
      venue({ id: "lamb", name: "The Lamb", area: "Camden" }),
      venue({ id: "head", name: "Camden Head", area: "Camden" }),
    ];

    const [areaCall] = routeAskDeterministically("It's rammed in Camden");
    expect(areaCall?.name).toBe("report_occupancy");
    const areaResult = await runAskTool("report_occupancy", areaCall.args, ctx());
    expect(areaResult.answerHint).not.toContain("Camden Head");
    expect(areaResult.answerHint).toContain("Name the pub");

    const [pubCall] = routeAskDeterministically("It's rammed in The Lamb");
    const pubResult = await runAskTool("report_occupancy", pubCall.args, ctx());
    expect(pubResult.answerHint).toContain("Log The Lamb as full");
  });

  it("asks for the level when the words carry none", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool(
      "report_occupancy",
      { venueName: "The Lamb", level: "mustard" },
      ctx(),
    );
    expect(result.answerHint).toBe("Is The Lamb empty, some seats, or full?");
  });
});
