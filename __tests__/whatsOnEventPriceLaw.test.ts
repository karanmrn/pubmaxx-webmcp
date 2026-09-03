// A kind=event row's priceGbp is a TICKET price. It prints on the /out event
// card, worded "Tickets from £X" beside its source credit, and nowhere else:
// every other What's-On lane prints a bare "£23.50", which in this product
// reads as a drink price.
//
// Each case below drives the REAL projection a surface uses, so a lane that
// started reading row.priceGbp directly again would fail here.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const tonightRows: WhatsOnRow[] = [];
const ACTIVE_STARTS_AT = "2099-08-16T19:00:00.000Z";
const ACTIVE_ENDS_AT = "2099-08-16T22:00:00.000Z";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({
    rows: tonightRows,
    asOf: "2026-08-16T09:00:00.000Z",
    sourceObservedAt: "2026-08-16T09:00:00.000Z",
    sourceFreshnessKind: "listed",
    kindObservedAt: {},
    status: "ready",
    retry: () => {},
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/tonight/TonightConditionsStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightGetHomeStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightShareButton", () => ({ default: () => null }));
vi.mock("@/components/desktop/AreaNewsRail", () => ({ default: () => null }));
vi.mock("@/components/discovery/DealsTonightLane", () => ({ default: () => null }));
vi.mock("@/components/discovery/MusicTonightLane", () => ({ default: () => null }));

import TonightClient from "@/app/tonight/TonightClient";
import { ticketFromLine } from "@/components/out/OutCard";
import { stopEventChips } from "@/lib/planWhatsOn";
import { TRUSTED_HANDOFF_FLAGS_OFF } from "@/lib/trustedHandoffFlags";
import { toTonightPickDto } from "@/lib/todayBrief";
import { laneCardsFromRows } from "@/lib/whatsOnBadges";
import { whatsOnBarePriceGbp, type WhatsOnRow } from "@/lib/whatsOn";
import { buildWhatsOnAnswer } from "@/lib/concierge/whatsOn";

function row(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "row-1",
    venueId: "venue-1",
    placeName: "The Ticketed Arms",
    lat: 51.5,
    lng: -0.1,
    kind: "event",
    startsAt: ACTIVE_STARTS_AT,
    title: "A Night at the Playhouse",
    priceGbp: 23.5,
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

const dealRow = () =>
  row({
    id: "row-deal",
    kind: "deal",
    title: "Two for one burgers",
    endsAt: ACTIVE_ENDS_AT,
    source: { label: "Wetherspoon", url: "https://www.jdwetherspoon.com/deal" },
  });

describe("whatsOnBarePriceGbp", () => {
  it("refuses an event ticket price and keeps every other kind's figure", () => {
    expect(whatsOnBarePriceGbp(row())).toBeNull();
    expect(whatsOnBarePriceGbp(dealRow())).toBe(23.5);
    expect(whatsOnBarePriceGbp(row({ kind: "quiz" }))).toBe(23.5);
    expect(whatsOnBarePriceGbp(row({ kind: "deal", priceGbp: undefined }))).toBeNull();
  });
});

describe("the lanes that project a What's-On row", () => {
  it("keeps the ticket price off the map lane card", () => {
    const cards = laneCardsFromRows([row(), dealRow()]);
    const event = cards.find((card) => card.kind === "event");
    const deal = cards.find((card) => card.kind === "deal");
    expect(event).toBeDefined();
    expect(event?.priceGbp).toBeUndefined();
    expect(deal?.priceGbp).toBe(23.5);
  });

  it("keeps the ticket price off the Today pick", () => {
    expect(toTonightPickDto(row()).priceGbp).toBeNull();
    expect(toTonightPickDto(dealRow()).priceGbp).toBe(23.5);
  });

  it("keeps the ticket price out of the Pub Pal listing answer", () => {
    const answer = buildWhatsOnAnswer({}, [row(), dealRow()]);
    const listings = answer.listings;
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      if (listing.kind === "event") expect(listing.priceGbp).toBeUndefined();
    }
    expect(JSON.stringify(listings.filter((l) => l.kind === "event"))).not.toContain("23.5");
  });
});

describe("the out card is the one place a ticket price prints", () => {
  it("says Tickets from £X for an event and nothing for any other kind", () => {
    expect(ticketFromLine(row())).toBe("Tickets from £23.50");
    expect(ticketFromLine(row({ priceGbp: 12 }))).toBe("Tickets from £12");
    expect(ticketFromLine(dealRow())).toBeNull();
    expect(ticketFromLine(row({ priceGbp: undefined }))).toBeNull();
  });
});

describe("the plan stop chip", () => {
  it("labels an event stop without its ticket price, and a deal stop with its figure", () => {
    const planStart = ACTIVE_STARTS_AT;
    const now = Date.parse("2099-08-16T18:00:00.000Z");
    const eventChip = stopEventChips([row()], ["venue-1"], planStart, now).get("venue-1");
    expect(eventChip).toBeDefined();
    expect(eventChip?.kind).toBe("event");
    expect(eventChip?.label).not.toContain("£");
    const dealChip = stopEventChips([dealRow()], ["venue-1"], planStart, now).get("venue-1");
    expect(dealChip?.label).toContain("£23.50");
  });
});

describe("the Tonight page renders no bare ticket price", () => {
  function renderTonight(rows: WhatsOnRow[]) {
    tonightRows.length = 0;
    tonightRows.push(...rows);
    return renderToStaticMarkup(
      createElement(TonightClient, { flags: TRUSTED_HANDOFF_FLAGS_OFF, quietPint: null }),
    );
  }

  it("prints a deal's figure and no figure at all for an event", () => {
    const withDeal = renderTonight([dealRow()]);
    expect(withDeal).toContain("Two for one burgers");
    expect(withDeal).toContain("£23.50");

    const withEvent = renderTonight([row()]);
    expect(withEvent).toContain("A Night at the Playhouse");
    expect(withEvent).not.toContain("£23.50");
    expect(withEvent).not.toContain("tonightRowPrice");
  });
});
