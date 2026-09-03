// The honesty fence for what the harvest turns into rows: a page that does not
// state a thing yields no row, and every row that survives carries provenance
// and passes the same What's-On guard the app serves through.

import { describe, expect, it } from "vitest";

import { parseChainDealDays, parseScheduleLine, parseStatedClock } from "@/lib/harvest/chainDeals";
import {
  buildPubFacts,
  isOperatorHost,
  parseStatedOpeningHours,
  pickOperatorUrl,
  registrableLabel,
} from "@/lib/harvest/pubFacts";
import {
  eventKindFrom,
  findEventsPageUrl,
  parseVenueEventListings,
  resolveEventClock,
  resolveEventDate,
} from "@/lib/harvest/venueEvents";
import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";

// The shape Wetherspoon's own Food & drink page publishes its club days in.
const WETHERSPOON_PAGE = `
## Club deals

![a picture](https://example.com/a.png)

### Small plates

Every Monday, 11.30am - 11pm

A selection of small plates at even better prices.

[Find a pub](https://www.jdwetherspoon.com/pub-search/)

### Afternoon deals

Monday-Friday, 2pm - 5pm

A range of pub classics at even better prices.

## Calling all superheroes

All children's meals are served with a drink and fruit option included.
`;

describe("a deal day has to state a weekday and a window", () => {
  it("reads a single-day club with its own window", () => {
    const { deals } = parseChainDealDays(WETHERSPOON_PAGE);
    const small = deals.find((deal) => deal.id === "small-plates");
    expect(small).toBeDefined();
    expect(small!.days).toEqual(["Monday"]);
    expect(small!.startTime).toBe("11:30");
    expect(small!.endTime).toBe("23:00");
    expect(small!.cadenceLabel).toBe("every Monday");
  });

  it("expands a stated day range and labels the cadence the way the page does", () => {
    const { deals } = parseChainDealDays(WETHERSPOON_PAGE);
    const afternoon = deals.find((deal) => deal.id === "afternoon-deals");
    expect(afternoon!.days).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    expect(afternoon!.cadenceLabel).toBe("Monday to Friday");
    expect(afternoon!.startTime).toBe("14:00");
    expect(afternoon!.endTime).toBe("17:00");
  });

  it("takes no deal from a heading that states no schedule", () => {
    const { deals } = parseChainDealDays(WETHERSPOON_PAGE);
    expect(deals.map((deal) => deal.id)).not.toContain("calling-all-superheroes");
  });

  it("drops a day with no window rather than inventing hours, and says why", () => {
    const { deals, drops } = parseChainDealDays(`
## Steak from £8.99!

Available Monday - Wednesday

Sink your teeth into the juiciest steaks.
`);
    expect(deals).toHaveLength(0);
    expect(drops).toEqual([{ title: "Steak from £8.99!", reason: "no-stated-window" }]);
  });

  it("drops a window with no day", () => {
    const { deals, drops } = parseChainDealDays(`
## Happy hour

5pm - 7pm

Cheaper drinks.
`);
    expect(deals).toHaveLength(0);
    expect(drops).toEqual([{ title: "Happy hour", reason: "no-stated-day" }]);
  });

  it("never mistakes prose that mentions a day for a schedule", () => {
    const { deals, drops } = parseChainDealDays(`
## New clubs

From Monday 23 June, customers at our pubs across the UK will enjoy new weekly club deals.
`);
    expect(deals).toHaveLength(0);
    expect(drops).toHaveLength(0);
  });

  it("records the sister brand a deal names, so it cannot be hung on the wrong pubs", () => {
    const { deals } = parseChainDealDays(`
## Two courses from £8.99 at your local Farmhouse Inns

Available Monday-Friday 12pm-5pm

Enjoy a selection of dishes from the Farmhouse Inns Weekday Set Menu.
`);
    expect(deals).toHaveLength(1);
    expect(deals[0].brand).toBe("Farmhouse Inns");
  });

  it("refuses a bare clock with no meridiem, because which 11 is a guess", () => {
    expect(parseStatedClock("11am")).toBe("11:00");
    expect(parseStatedClock("11pm")).toBe("23:00");
    expect(parseStatedClock("12am")).toBe("00:00");
    expect(parseStatedClock("19:30")).toBe("19:30");
    expect(parseStatedClock("11")).toBeNull();
    expect(parseStatedClock("half past")).toBeNull();
  });

  it("treats a half-stated window as no window at all", () => {
    expect(parseScheduleLine("Every Monday, 11.30am")?.startTime).toBeNull();
  });
});

describe("every harvested deal row is a valid What's-On row with provenance", () => {
  const observedAt = "2026-08-09T10:00:00.000Z";
  const now = Date.parse("2026-08-09T12:00:00.000Z");

  function rowFor(deal: { title: string; cadenceLabel: string; detail: string | null }): WhatsOnRow {
    return {
      id: "deal-jdw-small-plates-a-pub",
      placeName: "A Pub",
      kind: "deal",
      startsAt: "2026-08-10T11:30:00+01:00",
      endsAt: "2026-08-10T23:00:00+01:00",
      title: `${deal.title} - ${deal.cadenceLabel}`,
      detail: `${deal.detail ?? "See the chain's own page."} Price, dishes and participation may vary per pub.`,
      source: { label: "J D Wetherspoon - Food & drink", url: "https://www.jdwetherspoon.com/food-drink/" },
      observedAt,
      confidence: "listed",
    };
  }

  it("passes the app's own row guard", () => {
    const { deals } = parseChainDealDays(WETHERSPOON_PAGE);
    for (const deal of deals) {
      expect(isValidWhatsOnRow(rowFor(deal), now)).toBe(true);
    }
  });

  it("fails the guard the moment provenance is missing", () => {
    const { deals } = parseChainDealDays(WETHERSPOON_PAGE);
    const row = rowFor(deals[0]) as Record<string, unknown>;
    delete row.source;
    expect(isValidWhatsOnRow(row, now)).toBe(false);
  });

  it("fails the guard when the source url is not a real link", () => {
    const { deals } = parseChainDealDays(WETHERSPOON_PAGE);
    const row = { ...rowFor(deals[0]), source: { label: "Somewhere", url: "not-a-url" } };
    expect(isValidWhatsOnRow(row, now)).toBe(false);
  });

  it("fails the guard when observedAt is in the future", () => {
    const { deals } = parseChainDealDays(WETHERSPOON_PAGE);
    const row = { ...rowFor(deals[0]), observedAt: "2027-01-01T00:00:00.000Z" };
    expect(isValidWhatsOnRow(row, now)).toBe(false);
  });
});

describe("an event needs a kind, a date and a time", () => {
  const now = Date.parse("2026-08-09T12:00:00.000Z");

  it("maps only the words that name one of our kinds", () => {
    expect(eventKindFrom("Pub quiz night")).toBe("quiz");
    expect(eventKindFrom("Live music with The Band")).toBe("music");
    expect(eventKindFrom("Live football on the big screen")).toBe("sport");
    expect(eventKindFrom("Comedy night")).toBeNull();
    expect(eventKindFrom("Supper club")).toBeNull();
  });

  it("takes the year a listing states", () => {
    const resolved = resolveEventDate("Friday 12 September 2026", now);
    expect(resolved).toEqual({ ok: true, date: { year: 2026, month: 9, day: 12 } });
  });

  it("lets the stated weekday pick the year when the listing omits it", () => {
    // 12 September 2026 is a Saturday; 12 September 2027 is a Sunday.
    expect(resolveEventDate("Saturday 12 September", now)).toEqual({
      ok: true,
      date: { year: 2026, month: 9, day: 12 },
    });
  });

  it("refuses a date whose stated weekday matches nothing in the horizon", () => {
    expect(resolveEventDate("Monday 12 September", now)).toEqual({ ok: false, reason: "ambiguous-date" });
  });

  it("reads a start time only when one is written down", () => {
    expect(resolveEventClock("Doors 7pm")).toBe("19:00");
    expect(resolveEventClock("Starts 19:30")).toBe("19:30");
    expect(resolveEventClock("All evening")).toBeNull();
  });

  it("emits a listing that states all three, and drops one that misses the time", () => {
    const { events, drops } = parseVenueEventListings(
      `
### Pub quiz night

Thursday 13 August 2026, 8pm

Six rounds, teams of up to six, cash prize for the winners.

### Live music: The Wanderers

Friday 14 August 2026

An evening of folk from a much-loved local band playing their own songs.
`,
      now,
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("quiz");
    expect(events[0].startClock).toBe("20:00");
    expect(drops).toEqual([{ title: "Live music: The Wanderers", reason: "no-time" }]);
  });

  it("follows the site's own what's-on link and refuses another host", () => {
    const markdown = `
[Home](/) [What's On](/whats-on/) [Book](https://opentable.com/x)
`;
    expect(findEventsPageUrl(markdown, "https://thepub.co.uk/")).toBe("https://thepub.co.uk/whats-on/");
    expect(findEventsPageUrl(`[Events](https://elsewhere.com/events)`, "https://thepub.co.uk/")).toBeNull();
  });
});

describe("pub facts are only what the operator page states", () => {
  it("reads the days a page mentions and leaves the rest absent", () => {
    const { hours, statedDays } = parseStatedOpeningHours(`
We Are Open

Sunday12pm to 11pm

Monday - Thursday: 11am - 11pm
`);
    expect(statedDays).toEqual(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"]);
    expect(hours[0]).toEqual([{ opens: "12:00", closes: "23:00" }]);
    expect(hours[1]).toEqual([{ opens: "11:00", closes: "23:00" }]);
    // Friday and Saturday were never mentioned, so they stay unknown.
    expect(hours[5]).toBeUndefined();
    expect(hours[6]).toBeUndefined();
  });

  it("records an explicitly closed day as a closed day, not as unknown", () => {
    const { hours, statedDays } = parseStatedOpeningHours("Monday: closed");
    expect(statedDays).toEqual(["Monday"]);
    expect(hours[1]).toEqual([]);
  });

  it("keeps two stated windows on one day", () => {
    const { hours } = parseStatedOpeningHours(`
Tuesday 12pm to 3pm
Tuesday 5pm to 11pm
`);
    expect(hours[2]).toEqual([
      { opens: "12:00", closes: "15:00" },
      { opens: "17:00", closes: "23:00" },
    ]);
  });

  it("takes nothing from prose that merely names a day", () => {
    const { statedDays } = parseStatedOpeningHours(
      "Our roasts are served every Sunday from midday and they sell out fast, so book ahead.",
    );
    expect(statedDays).toEqual([]);
  });

  it("picks the venue's own site and refuses a directory listing", () => {
    const results = [
      { url: "https://www.tripadvisor.co.uk/Restaurant_Review-arnos-arms" },
      { url: "https://www.arnosarms.co.uk/" },
    ];
    expect(pickOperatorUrl(results, "Arnos Arms")).toBe("https://www.arnosarms.co.uk/");
    expect(isOperatorHost("https://www.tripadvisor.co.uk/x")).toBe(false);
    expect(isOperatorHost("https://www.facebook.com/x")).toBe(false);
  });

  it("refuses a result that merely mentions the pub", () => {
    expect(pickOperatorUrl([{ url: "https://londonpubguide.example/arnos-arms" }], "Arnos Arms")).toBeNull();
  });

  it("refuses a directory that puts the pub's name in a subdomain", () => {
    expect(
      pickOperatorUrl([{ url: "https://bexleyheath-working-mens-club.wheree.com/" }], "Bexleyheath Working Mens Club"),
    ).toBeNull();
    expect(registrableLabel("bexleyheath-working-mens-club.wheree.com")).toBe("wheree");
    expect(registrableLabel("www.thebohemia.co.uk")).toBe("thebohemia");
  });

  it("refuses a match made only on a generic trade word", () => {
    // "club" is in the venue's name and in ciuclub.co.uk, and means nothing.
    expect(
      pickOperatorUrl([{ url: "https://www.ciuclub.co.uk/BRANCHDB/155.html" }], "Finchley United Services Club Ltd"),
    ).toBeNull();
  });

  it("still accepts a chain operator's own page for its own pub", () => {
    expect(
      pickOperatorUrl(
        [{ url: "https://www.jdwetherspoon.com/pubs/the-furze-wren-bexleyheath/" }],
        "The Furze Wren - JD Wetherspoon",
      ),
    ).toBe("https://www.jdwetherspoon.com/pubs/the-furze-wren-bexleyheath/");
  });

  it("carries provenance on every fact record", () => {
    const record = buildPubFacts({
      venueId: "venue-abc",
      placeName: "Arnos Arms",
      operatorUrl: "https://www.arnosarms.co.uk/",
      markdown: "Sunday 12pm to 11pm",
      hadWebsite: false,
      observedAt: "2026-08-09T10:00:00.000Z",
    });
    expect(record).not.toBeNull();
    expect(record!.source.url).toBe("https://www.arnosarms.co.uk/");
    expect(record!.observedAt).toBe("2026-08-09T10:00:00.000Z");
    expect(record!.statedDays).toEqual(["Sunday"]);
  });

  it("yields nothing when the page states nothing new", () => {
    expect(
      buildPubFacts({
        venueId: "venue-abc",
        placeName: "Arnos Arms",
        operatorUrl: "https://www.arnosarms.co.uk/",
        markdown: "A lovely local pub with a warm welcome.",
        hadWebsite: true,
        observedAt: "2026-08-09T10:00:00.000Z",
      }),
    ).toBeNull();
  });
});
