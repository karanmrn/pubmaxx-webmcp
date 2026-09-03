import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AreaSheet from "@/components/map/AreaSheet";
import {
  AREA_PUB_LIMIT,
  AREA_SHEET_LEAD_ROWS,
  areaSheetOverflowLabel,
} from "@/lib/areaButton";
import { nearMeLocationMessage } from "@/lib/nearMeLocation";
import { getNightArea } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

// The Area sheet answers two questions: what is cheap here, and how do I go
// somewhere else. It used to print all ten price rows before the picker, which
// put the picker about 650 px below the fold of a 390x844 phone. That became
// load-bearing once a failed Near me started offering "Pick an area" as its
// way on, so these pin the picker's POSITION, not its presence.

const soho = getNightArea("piccadilly-soho");

/** Priced pubs at the area centre, cheapest first once ranked. */
function venue(index: number): Venue {
  return {
    id: `pub-${index}`,
    name: `Pub number ${index}`,
    latitude: soho.centre.lat,
    longitude: soho.centre.lng,
    cheapestPrice: 4 + index * 0.1,
    latestContributorPrice: null,
  } as Venue;
}

function renderSheet(
  overrides: Record<string, unknown> = {},
  venueCount = AREA_PUB_LIMIT + 4,
) {
  return renderToStaticMarkup(
    createElement(AreaSheet, {
      cityId: "london" as const,
      area: soho,
      venues: Array.from({ length: venueCount }, (_, i) => venue(i)),
      distanceFrom: {
        point: [soho.centre.lng, soho.centre.lat] as [number, number],
        origin: "map" as const,
      },
      onSelectVenue: vi.fn(),
      onFlyToArea: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    }),
  );
}

/** How many pub rows a reader scrolls past before the picker's heading. */
function rowsBeforePicker(html: string): number {
  const picker = html.indexOf("Go somewhere else");
  expect(picker).toBeGreaterThan(-1);
  return html.slice(0, picker).split('class="areaSheetPub"').length - 1;
}

describe("Area sheet: the picker is reachable", () => {
  it("prints a short lead, not the whole price list, above the picker", () => {
    const html = renderSheet();
    // The defect rendered AREA_PUB_LIMIT rows here. Three is the lead.
    expect(rowsBeforePicker(html)).toBe(AREA_SHEET_LEAD_ROWS);
    expect(AREA_SHEET_LEAD_ROWS).toBeLessThan(AREA_PUB_LIMIT);
  });

  it("keeps the picker's first choice ahead of the whole price list", () => {
    const html = renderSheet();
    const firstArea = html.indexOf('class="areaSheetChip');
    const lastRow = html.lastIndexOf('class="areaSheetPub"');
    expect(firstArea).toBeGreaterThan(-1);
    expect(firstArea).toBeGreaterThan(lastRow);
    // ...and every one of the twenty choices is below one short lead, so the
    // reader reaches the grid without scrolling past a full page of prices.
    expect(rowsBeforePicker(html)).toBeLessThanOrEqual(AREA_SHEET_LEAD_ROWS);
  });

  it("names the rows it did not print rather than passing the lead off as all", () => {
    const html = renderSheet();
    expect(html).toContain(areaSheetOverflowLabel(AREA_PUB_LIMIT));
    expect(html).toContain(`See the other ${AREA_PUB_LIMIT - AREA_SHEET_LEAD_ROWS} on the map`);
    // The lead itself is the cheapest rows, not an arbitrary slice.
    expect(html).toContain("Pub number 0");
    expect(html).not.toContain(`Pub number ${AREA_SHEET_LEAD_ROWS}<`);
  });

  it("still says all when the lead already is all of them", () => {
    const html = renderSheet({}, AREA_SHEET_LEAD_ROWS);
    expect(html).toContain("See all on the map");
    expect(html).not.toContain("See the other");
    expect(rowsBeforePicker(html)).toBe(AREA_SHEET_LEAD_ROWS);
  });

  it("counts one leftover row in words, not as a bare 1", () => {
    expect(areaSheetOverflowLabel(AREA_SHEET_LEAD_ROWS + 1)).toBe(
      "See the other one on the map",
    );
    expect(areaSheetOverflowLabel(0)).toBe("See all on the map");
  });
});

describe("Area sheet: the location action", () => {
  it("offers the reader's own spot above the fixed choices", () => {
    const onUseMyLocation = vi.fn();
    const html = renderSheet({ onUseMyLocation });
    const locate = html.indexOf("Use my location");
    const firstArea = html.indexOf('class="areaSheetChip');
    expect(locate).toBeGreaterThan(-1);
    expect(locate).toBeLessThan(firstArea);
  });

  it("waits rather than firing a second request while one is running", () => {
    const html = renderSheet({ onUseMyLocation: vi.fn(), locationBusy: true });
    expect(html).toContain("Locating");
    expect(html).not.toContain("Use my location");
    expect(html).toMatch(/class="areaSheetLocate"[^>]*disabled/);
  });

  it("offers nothing when the host has no location path to hand it", () => {
    const html = renderSheet();
    expect(html).not.toContain("Use my location");
    expect(html).not.toContain("areaSheetLocate");
  });

  it("prints the failure the map already worded and invents none of its own", () => {
    const denied = nearMeLocationMessage("denied");
    const html = renderSheet({ onUseMyLocation: vi.fn(), locationNote: denied });
    expect(html).toContain(denied);
    // That sentence tells the reader to pick an area. The picker has to be the
    // next thing under it, or the advice points at nothing.
    expect(html.indexOf(denied)).toBeLessThan(html.indexOf('class="areaSheetChip'));
  });

  it("keeps a stale reason off a sheet that cannot locate at all", () => {
    const html = renderSheet({ locationNote: nearMeLocationMessage("timeout") });
    expect(html).not.toContain("could not get your location");
  });
});
