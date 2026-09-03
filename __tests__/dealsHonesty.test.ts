import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import TonightOnTonightSummary from "@/app/tonight/TonightOnTonightSummary";
import {
  DEAL_ENDING_SOON_MS,
  DEAL_LISTING_STALE_DAYS,
  dealEndsCaption,
  dealListingAgeCaption,
  dealProximityAnchor,
  dealsEndingSoon,
  liveDeals,
  orderDeals,
  orderDealsInPlace,
} from "@/lib/dealsHonesty";
import { getNightArea } from "@/lib/nightAreas";
import { londonServiceDayBounds, type WhatsOnRow } from "@/lib/whatsOn";
import { laneKindFacets } from "@/lib/whatsOnBadges";

// A fixed evening inside the London service window, so every caption and every
// window test reads the same night rather than whatever hour the suite runs at.
const NOW = Date.parse("2026-08-06T19:00:00+01:00");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function deal(overrides: Partial<WhatsOnRow> & { id: string }): WhatsOnRow {
  return {
    placeName: "The Coronet",
    kind: "deal",
    startsAt: new Date(NOW - 6 * HOUR).toISOString(),
    endsAt: new Date(NOW + 4 * HOUR).toISOString(),
    title: "Curry Club",
    source: { label: "J D Wetherspoon", url: "https://www.jdwetherspoon.com/food-drink/" },
    observedAt: new Date(NOW - HOUR).toISOString(),
    confidence: "listed",
    ...overrides,
  };
}

// Clapham's published centre, and a point a few streets off it.
const CLAPHAM = getNightArea("clapham")!.centre;
const NEAR_CLAPHAM = { lat: CLAPHAM.lat + 0.0007, lng: CLAPHAM.lng - 0.0009 };

/** A point roughly `km` north of `from`. 1 degree of latitude is about 111km. */
function north(from: { lat: number; lng: number }, km: number) {
  return { lat: from.lat + km / 111, lng: from.lng };
}

describe("deal proximity anchor", () => {
  it("answers with the area centre, so two viewers in one patch rank alike", () => {
    const a = dealProximityAnchor(NEAR_CLAPHAM);
    const b = dealProximityAnchor({ lat: CLAPHAM.lat - 0.0008, lng: CLAPHAM.lng + 0.0006 });
    expect(a).toEqual({ lat: CLAPHAM.lat, lng: CLAPHAM.lng });
    expect(b).toEqual(a);
  });

  it("answers nothing when there is no location to work from", () => {
    expect(dealProximityAnchor(null)).toBeNull();
    expect(dealProximityAnchor({ lat: Number.NaN, lng: 0 })).toBeNull();
  });
});

describe("deal order", () => {
  it("puts the nearer ring first, then the one closing soonest inside a ring", () => {
    const anchor = dealProximityAnchor(NEAR_CLAPHAM);
    // Two deals in the anchor's own ring, one of them closing later, plus one
    // several rings out that closes before either.
    const nearLate = deal({
      id: "near-late",
      ...north(CLAPHAM, 0.2),
      endsAt: new Date(NOW + 5 * HOUR).toISOString(),
    });
    const nearSoon = deal({
      id: "near-soon",
      ...north(CLAPHAM, 0.4),
      endsAt: new Date(NOW + 1 * HOUR).toISOString(),
    });
    const farSoonest = deal({
      id: "far-soonest",
      ...north(CLAPHAM, 6),
      endsAt: new Date(NOW + 15 * 60 * 1000).toISOString(),
    });

    expect(orderDeals([nearLate, farSoonest, nearSoon], anchor).map((r) => r.id)).toEqual([
      "near-soon",
      "near-late",
      "far-soonest",
    ]);
  });

  it("orders by closing time alone when no location was shared", () => {
    const late = deal({ id: "late", ...north(CLAPHAM, 0.1), endsAt: new Date(NOW + 3 * HOUR).toISOString() });
    const soon = deal({ id: "soon", ...north(CLAPHAM, 9), endsAt: new Date(NOW + HOUR).toISOString() });

    expect(orderDeals([late, soon], null).map((r) => r.id)).toEqual(["soon", "late"]);
  });

  it("sorts a row with no coordinates last, never above a placed one", () => {
    const anchor = dealProximityAnchor(NEAR_CLAPHAM);
    const placed = deal({ id: "placed", ...north(CLAPHAM, 8), endsAt: new Date(NOW + 6 * HOUR).toISOString() });
    const unplaced = deal({ id: "unplaced", endsAt: new Date(NOW + 30 * 60 * 1000).toISOString() });

    expect(orderDeals([unplaced, placed], anchor).map((r) => r.id)).toEqual(["placed", "unplaced"]);
  });

  it("keeps the incoming order when ring and closing time both tie", () => {
    const anchor = dealProximityAnchor(NEAR_CLAPHAM);
    const first = deal({ id: "first", ...north(CLAPHAM, 0.2) });
    const second = deal({ id: "second", ...north(CLAPHAM, 0.3) });

    expect(orderDeals([first, second], anchor).map((r) => r.id)).toEqual(["first", "second"]);
    expect(orderDeals([second, first], anchor).map((r) => r.id)).toEqual(["second", "first"]);
  });
});

describe("deal order inside a mixed list", () => {
  const quiz = (id: string): WhatsOnRow => ({
    ...deal({ id }),
    kind: "quiz",
    title: `Quiz ${id}`,
  });

  it("reorders the deals without moving any other kind", () => {
    const anchor = dealProximityAnchor(NEAR_CLAPHAM);
    const mixed: WhatsOnRow[] = [
      deal({ id: "far", ...north(CLAPHAM, 7), endsAt: new Date(NOW + 20 * 60 * 1000).toISOString() }),
      quiz("quiz-a"),
      deal({ id: "near-late", ...north(CLAPHAM, 0.2), endsAt: new Date(NOW + 5 * HOUR).toISOString() }),
      quiz("quiz-b"),
      deal({ id: "near-soon", ...north(CLAPHAM, 0.4), endsAt: new Date(NOW + HOUR).toISOString() }),
    ];

    expect(orderDealsInPlace(mixed, (row) => row, anchor).map((r) => r.id)).toEqual([
      "near-soon",
      "quiz-a",
      "near-late",
      "quiz-b",
      "far",
    ]);
  });

  it("changes nothing when there is only one deal to place", () => {
    const mixed: WhatsOnRow[] = [quiz("q"), deal({ id: "only" }), quiz("q2")];
    expect(orderDealsInPlace(mixed, (row) => row, null).map((r) => r.id)).toEqual([
      "q",
      "only",
      "q2",
    ]);
  });

  it("gives an all-deal list the full deal order", () => {
    const anchor = dealProximityAnchor(NEAR_CLAPHAM);
    const rows = [
      deal({ id: "late", ...north(CLAPHAM, 0.2), endsAt: new Date(NOW + 5 * HOUR).toISOString() }),
      deal({ id: "soon", ...north(CLAPHAM, 0.3), endsAt: new Date(NOW + HOUR).toISOString() }),
    ];
    expect(orderDealsInPlace(rows, (row) => row, anchor).map((r) => r.id)).toEqual(
      orderDeals(rows, anchor).map((r) => r.id),
    );
  });

  it("orders the families a grouped list renders, not just bare rows", () => {
    const anchor = dealProximityAnchor(NEAR_CLAPHAM);
    const groups = [
      { row: deal({ id: "g-late", ...north(CLAPHAM, 0.2), endsAt: new Date(NOW + 4 * HOUR).toISOString() }), venueCount: 3 },
      { row: deal({ id: "g-soon", ...north(CLAPHAM, 0.3), endsAt: new Date(NOW + HOUR).toISOString() }), venueCount: 5 },
    ];
    expect(orderDealsInPlace(groups, (g) => g.row, anchor).map((g) => g.row.id)).toEqual([
      "g-soon",
      "g-late",
    ]);
  });
});

describe("ends caption", () => {
  it("prints the row's own closing time and nothing else", () => {
    expect(
      dealEndsCaption(deal({ id: "e", endsAt: "2026-08-06T21:00:00+01:00" }), NOW),
    ).toBe("Ends 9:00 pm");
  });

  it("says nothing when the row never said when it closes", () => {
    const row = deal({ id: "no-end" });
    delete row.endsAt;
    expect(dealEndsCaption(row, NOW)).toBeNull();
  });

  it("never invents a closing time from the kind's grace", () => {
    // Deal grace is 0, so a deal with no endsAt has no window to print. Proving
    // it against a row whose start has already passed keeps the two apart.
    const row = deal({ id: "point", startsAt: new Date(NOW - HOUR).toISOString() });
    delete row.endsAt;
    expect(dealEndsCaption(row, NOW)).toBeNull();
  });

  it("says nothing once the window has closed", () => {
    expect(
      dealEndsCaption(deal({ id: "gone", endsAt: new Date(NOW - 60_000).toISOString() }), NOW),
    ).toBeNull();
  });

  it("says nothing for a bare clock that belongs to another night", () => {
    const { end } = londonServiceDayBounds(NOW);
    const tomorrowEvening = new Date(Date.parse(end) + 18 * HOUR).toISOString();
    expect(dealEndsCaption(deal({ id: "other-night", endsAt: tomorrowEvening }), NOW)).toBeNull();
  });
});

describe("listing age caption", () => {
  it("stays quiet while the listing is still fresh", () => {
    const fresh = deal({
      id: "fresh",
      observedAt: new Date(NOW - (DEAL_LISTING_STALE_DAYS - 1) * DAY).toISOString(),
    });
    expect(dealListingAgeCaption(fresh, NOW)).toBeNull();
  });

  it("says the listing's age and hands the reader the only real check", () => {
    const stale = deal({ id: "stale", observedAt: new Date(NOW - 22 * DAY).toISOString() });
    expect(dealListingAgeCaption(stale, NOW)).toBe("Listed 3 weeks ago - check at the bar");
  });

  it("counts in weeks at the threshold and in months once weeks stop reading", () => {
    const twoWeeks = deal({ id: "two-weeks", observedAt: new Date(NOW - 14 * DAY).toISOString() });
    const oneMonth = deal({ id: "one-month", observedAt: new Date(NOW - 62 * DAY).toISOString() });
    const threeMonths = deal({ id: "three-months", observedAt: new Date(NOW - 95 * DAY).toISOString() });

    expect(dealListingAgeCaption(twoWeeks, NOW)).toBe("Listed 2 weeks ago - check at the bar");
    expect(dealListingAgeCaption(oneMonth, NOW)).toBe("Listed 2 months ago - check at the bar");
    expect(dealListingAgeCaption(threeMonths, NOW)).toBe("Listed 3 months ago - check at the bar");
  });
});

describe("live deals and ending soon", () => {
  it("drops a closed deal, because deal grace is zero", () => {
    const closed = deal({ id: "closed", endsAt: new Date(NOW - 1).toISOString() });
    const open = deal({ id: "open" });
    expect(liveDeals([closed, open], NOW).map((r) => r.id)).toEqual(["open"]);
  });

  it("keeps only deal rows", () => {
    const quiz: WhatsOnRow = { ...deal({ id: "quiz" }), kind: "quiz", title: "Quiz night" };
    expect(liveDeals([quiz, deal({ id: "d" })], NOW).map((r) => r.id)).toEqual(["d"]);
  });

  it("calls a deal ending soon only inside the two-hour window", () => {
    const soon = deal({ id: "soon", endsAt: new Date(NOW + 90 * 60 * 1000).toISOString() });
    const later = deal({ id: "later", endsAt: new Date(NOW + DEAL_ENDING_SOON_MS + 60_000).toISOString() });
    const undated = deal({ id: "undated" });
    delete undated.endsAt;

    expect(dealsEndingSoon([soon, later, undated], NOW).map((r) => r.id)).toEqual(["soon"]);
  });
});

describe("DealsTonightLane", () => {
  it("prints the closing time the row carries", () => {
    const html = renderToStaticMarkup(
      createElement(DealsTonightLane, {
        rows: [deal({ id: "ends", endsAt: "2026-08-06T21:00:00+01:00" })],
        now: NOW,
      }),
    );
    expect(html).toContain('class="dealsTonightEnds">Ends 9:00 pm</span>');
  });

  it("states a stale listing's age beside the card", () => {
    const html = renderToStaticMarkup(
      createElement(DealsTonightLane, {
        rows: [deal({ id: "stale", observedAt: new Date(NOW - 22 * DAY).toISOString() })],
        now: NOW,
      }),
    );
    expect(html).toContain("Listed 3 weeks ago - check at the bar");
  });

  it("says nothing about age when the listing is fresh", () => {
    const html = renderToStaticMarkup(
      createElement(DealsTonightLane, { rows: [deal({ id: "fresh" })], now: NOW }),
    );
    expect(html).not.toContain("check at the bar");
  });

  it("never renders an expired deal", () => {
    const html = renderToStaticMarkup(
      createElement(DealsTonightLane, {
        rows: [
          deal({ id: "expired", title: "Closed Curry Club", endsAt: new Date(NOW - 60_000).toISOString() }),
          deal({ id: "open", title: "Open Pizza Club" }),
        ],
        now: NOW,
      }),
    );
    expect(html).toContain("Open Pizza Club");
    expect(html).not.toContain("Closed Curry Club");
  });

  it("renders nothing at all once every deal has closed", () => {
    const html = renderToStaticMarkup(
      createElement(DealsTonightLane, {
        rows: [deal({ id: "expired", endsAt: new Date(NOW - 60_000).toISOString() })],
        now: NOW,
      }),
    );
    expect(html).toBe("");
  });

  it("orders before it caps, so the eight cards are the near ones", () => {
    // Nine far deals closing early, plus one on the viewer's doorstep closing
    // late. Capping first would fill the lane with the far ones and drop it.
    const far = Array.from({ length: 9 }, (_, i) =>
      deal({
        id: `far-${i}`,
        title: `Far deal ${i}`,
        ...north(CLAPHAM, 6 + i * 0.5),
        endsAt: new Date(NOW + (30 + i) * 60 * 1000).toISOString(),
      }),
    );
    const near = deal({
      id: "doorstep",
      title: "Doorstep deal",
      ...north(CLAPHAM, 0.2),
      endsAt: new Date(NOW + 5 * HOUR).toISOString(),
    });

    const html = renderToStaticMarkup(
      createElement(DealsTonightLane, {
        rows: [...far, near],
        anchor: dealProximityAnchor(NEAR_CLAPHAM),
        now: NOW,
      }),
    );
    expect(html).toContain("Doorstep deal");
    expect(html.match(/class="dealsTonightCard"/g)).toHaveLength(8);
  });

  it("orders its cards nearest patch first, then closing soonest", () => {
    const rows = [
      deal({ id: "far", title: "Far deal", ...north(CLAPHAM, 7), endsAt: new Date(NOW + 30 * 60 * 1000).toISOString() }),
      deal({ id: "near-late", title: "Near late deal", ...north(CLAPHAM, 0.2), endsAt: new Date(NOW + 5 * HOUR).toISOString() }),
      deal({ id: "near-soon", title: "Near soon deal", ...north(CLAPHAM, 0.3), endsAt: new Date(NOW + 2 * HOUR).toISOString() }),
    ];
    const html = renderToStaticMarkup(
      createElement(DealsTonightLane, {
        rows,
        anchor: dealProximityAnchor(NEAR_CLAPHAM),
        now: NOW,
      }),
    );
    const order = [...html.matchAll(/(Near soon deal|Near late deal|Far deal)/g)].map((m) => m[1]);
    expect(order).toEqual(["Near soon deal", "Near late deal", "Far deal"]);
  });
});

describe("Tonight rail ending-soon row", () => {
  function summary(rows: WhatsOnRow[]) {
    return renderToStaticMarkup(
      createElement(TonightOnTonightSummary, {
        facets: laneKindFacets(rows),
        rows,
        totalCount: rows.length,
        now: NOW,
      }),
    );
  }

  it("appears, with a real count, only when deals really are about to close", () => {
    const html = summary([
      deal({ id: "soon-a", endsAt: new Date(NOW + 45 * 60 * 1000).toISOString() }),
      deal({ id: "soon-b", endsAt: new Date(NOW + 100 * 60 * 1000).toISOString() }),
      deal({ id: "later", endsAt: new Date(NOW + 6 * HOUR).toISOString() }),
    ]);
    expect(html).toContain("Deals ending soon");
    expect(html).toMatch(/Deals ending soon[\s\S]{0,60}>\s*2</);
    expect(html).toContain('href="#tonight-list"');
    // The count is the rows, never a saved-money figure.
    expect(html).toContain("3 deals");
  });

  it("stays away when nothing closes inside the window", () => {
    expect(summary([deal({ id: "later", endsAt: new Date(NOW + 6 * HOUR).toISOString() })])).not.toContain(
      "Deals ending soon",
    );
  });

  it("stays away when the only deal has already closed", () => {
    const rows = [deal({ id: "closed", endsAt: new Date(NOW - 60_000).toISOString() })];
    expect(summary(rows)).not.toContain("Deals ending soon");
  });

  it("stays away on a night with no deals at all", () => {
    const quiz: WhatsOnRow = { ...deal({ id: "quiz" }), kind: "quiz", title: "Quiz night" };
    expect(summary([quiz])).not.toContain("Deals ending soon");
  });
});

// ── Honesty fences ──────────────────────────────────────────────────────────

const DEAL_SURFACE_FILES = [
  "lib/dealsHonesty.ts",
  "components/discovery/DealsTonightLane.tsx",
  "components/map/TonightLane.tsx",
  "app/tonight/TonightOnTonightSummary.tsx",
] as const;

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

describe("deal surfaces claim only what a row can prove", () => {
  it.each(DEAL_SURFACE_FILES)("%s counts no money saved", (file) => {
    const source = read(file);
    for (const invented of [
      "money saved",
      "moneySaved",
      "you saved",
      "youSaved",
      "savedTotal",
      "totalSaved",
      "savingsTotal",
      "saved so far",
      "you've saved",
    ]) {
      expect(source.toLowerCase()).not.toContain(invented.toLowerCase());
    }
  });

  it("keeps every viewer coordinate out of the deal path", () => {
    // The deals request carries no point at all, and the ordering module builds
    // no request of its own: the coarse anchor is resolved and used in the
    // browser, so no deal surface can leak a viewer's position.
    const lane = read("components/discovery/DealsTonightLane.tsx");
    expect(lane).toContain("/api/whats-on?kind=deal&window=tonight&limit=8");
    expect(lane).not.toMatch(/near=/);

    const honesty = read("lib/dealsHonesty.ts");
    expect(honesty).not.toMatch(/\bfetch\s*\(/);
    expect(honesty).not.toMatch(/URLSearchParams|encodeURIComponent/);
  });

  it("orders from the area centre, not from the point the viewer shared", () => {
    // Same rows, same area, two different precise positions inside it: the deal
    // order may not be able to tell them apart.
    const rows = [
      deal({ id: "a", ...north(CLAPHAM, 0.15), endsAt: new Date(NOW + 4 * HOUR).toISOString() }),
      deal({ id: "b", ...north(CLAPHAM, 0.55), endsAt: new Date(NOW + 5 * HOUR).toISOString() }),
      deal({ id: "c", ...north(CLAPHAM, 2.6), endsAt: new Date(NOW + HOUR).toISOString() }),
    ];
    const fromEast = orderDeals(rows, dealProximityAnchor({ lat: CLAPHAM.lat, lng: CLAPHAM.lng + 0.004 }));
    const fromWest = orderDeals(rows, dealProximityAnchor({ lat: CLAPHAM.lat, lng: CLAPHAM.lng - 0.004 }));
    expect(fromEast.map((r) => r.id)).toEqual(fromWest.map((r) => r.id));
  });
});
