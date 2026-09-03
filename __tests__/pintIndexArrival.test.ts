import { describe, expect, it } from "vitest";

import { LONDON_BOROUGHS, slugifyBorough } from "@/lib/boroughs";
import { boroughCode, LONDON_BOROUGH_NAMES } from "@/lib/pintIndex";
import {
  ARRIVAL_PARAM_VALUE,
  ARRIVAL_VISIT_MARKER,
  arrivalAreas,
  arrivalMapHref,
  isPintIndexArrival,
  MIN_ARRIVAL_PRICED_PUBS,
  visitFromMarker,
} from "@/lib/pintIndexArrival";
import { sanitizeEvent } from "@/lib/analyticsEvents";
import type { Venue } from "@/lib/venues";

// Only the fields the arrival reads; the rest of Venue is irrelevant here.
function venue(id: string, borough: string, cheapestPrice: number | null): Venue {
  return { id, name: id, primaryBorough: borough, cheapestPrice } as unknown as Venue;
}

function areaOf(borough: string, priced: number, from = 500): Venue[] {
  return Array.from({ length: priced }, (_, index) =>
    venue(`${slugifyBorough(borough)}-${index}`, borough, (from + index) / 100));
}

describe("Pint Index arrival areas", () => {
  it("offers the busiest priced areas first, and opens each on its cheapest pint", () => {
    const areas = arrivalAreas([
      ...areaOf("Camden", 12, 420),
      ...areaOf("Hackney", 20, 380),
      venue("camden-cheap", "Camden", 3.4),
    ]);
    expect(areas.map((area) => [area.slug, area.pricedCount])).toEqual([
      ["hackney", 20],
      ["camden", 13],
    ]);
    const camden = areas.find((area) => area.slug === "camden")!;
    expect(camden.cheapestGbp).toBe(3.4);
    expect(camden.cheapestVenueId).toBe("camden-cheap");
    expect(arrivalMapHref(camden)).toBe("/map?sel=camden-cheap&from=pint-index");
  });

  it("never offers an area too thin to be worth the tap", () => {
    const thin = arrivalAreas(areaOf("Bexley", MIN_ARRIVAL_PRICED_PUBS - 1));
    expect(thin).toEqual([]);
    expect(arrivalAreas(areaOf("Bexley", MIN_ARRIVAL_PRICED_PUBS))).toHaveLength(1);
  });

  it("counts only priced pubs in a real borough", () => {
    const areas = arrivalAreas([
      ...areaOf("Camden", MIN_ARRIVAL_PRICED_PUBS),
      ...Array.from({ length: 5 }, (_, i) => venue(`unpriced-${i}`, "Camden", null)),
      ...Array.from({ length: 20 }, (_, i) => venue(`soho-${i}`, "Soho", 4.5)),
    ]);
    expect(areas.map((area) => [area.slug, area.pricedCount])).toEqual([["camden", MIN_ARRIVAL_PRICED_PUBS]]);
  });

  it("picks the same pub on every render when two share the cheapest price", () => {
    const tied = [
      ...areaOf("Camden", MIN_ARRIVAL_PRICED_PUBS, 900),
      venue("b-tied", "Camden", 4),
      venue("a-tied", "Camden", 4),
    ];
    expect(arrivalAreas(tied)[0].cheapestVenueId).toBe("a-tied");
    expect(arrivalAreas([...tied].reverse())[0].cheapestVenueId).toBe("a-tied");
  });

  it("caps the strip", () => {
    const many = LONDON_BOROUGHS.slice(0, 12).flatMap((borough) => areaOf(borough, MIN_ARRIVAL_PRICED_PUBS));
    expect(arrivalAreas(many)).toHaveLength(8);
    expect(arrivalAreas(many, 3)).toHaveLength(3);
  });

  it("recognises its own arrival marker on the map, and nothing else", () => {
    expect(isPintIndexArrival(`?sel=venue-1&from=${ARRIVAL_PARAM_VALUE}`)).toBe(true);
    expect(isPintIndexArrival(`from=${ARRIVAL_PARAM_VALUE}`)).toBe(true);
    expect(isPintIndexArrival("?sel=venue-1")).toBe(false);
    expect(isPintIndexArrival("?from=elsewhere")).toBe(false);
    expect(isPintIndexArrival("")).toBe(false);
  });

  it("reads a first visit as first until the marker is written", () => {
    expect(visitFromMarker(null)).toBe("first");
    expect(visitFromMarker("")).toBe("first");
    expect(visitFromMarker(ARRIVAL_VISIT_MARKER)).toBe("repeat");
  });
});

describe("the press-arrival funnel events", () => {
  it("keeps arrivals, taps and map reaches countable", () => {
    expect(sanitizeEvent("pint_index_viewed", { surface: "index", visit: "first" })?.props)
      .toEqual({ surface: "index", visit: "first" });
    expect(sanitizeEvent("pint_index_viewed", { surface: "archive", visit: "repeat" })?.props)
      .toEqual({ surface: "archive", visit: "repeat" });
    expect(sanitizeEvent("pint_index_area_opened", { surface: "index", area: "tower-hamlets" })?.props)
      .toEqual({ surface: "index", area: "tower-hamlets" });
    expect(sanitizeEvent("pint_index_map_reached", {})).toEqual({ name: "pint_index_map_reached", props: {} });
  });

  it("rejects a step it could not count, and anything outside the closed sets", () => {
    expect(sanitizeEvent("pint_index_viewed", { surface: "index" })).toBeNull();
    expect(sanitizeEvent("pint_index_area_opened", { surface: "index" })).toBeNull();
    expect(sanitizeEvent("pint_index_viewed", { surface: "landing", visit: "first" })).toBeNull();
    expect(sanitizeEvent("pint_index_viewed", { surface: "index", visit: "third" })).toBeNull();
    expect(sanitizeEvent("pint_index_area_opened", { surface: "index", area: "paris" })).toBeNull();
    // No venue id, no coordinate, no free text can ride along as an area.
    expect(sanitizeEvent("pint_index_area_opened", { surface: "index", area: "venue-18uogns" })).toBeNull();
  });

  it("keeps the area vocabulary in step with the borough the tap came from", () => {
    // A chip's slug comes from lib/boroughs; the event allow-list comes from
    // the Index's own borough list. If those two ever drift, every area tap
    // would be dropped by the sanitiser in silence.
    expect(LONDON_BOROUGH_NAMES.map(boroughCode)).toEqual(LONDON_BOROUGHS.map(slugifyBorough));
    for (const name of LONDON_BOROUGHS) {
      expect(sanitizeEvent("pint_index_area_opened", { surface: "index", area: slugifyBorough(name) }))
        .not.toBeNull();
    }
  });
});
