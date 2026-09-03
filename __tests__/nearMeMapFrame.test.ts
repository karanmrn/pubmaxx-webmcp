import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { haversineKm } from "@/lib/haversine";
import {
  NEAR_ME_MAP_MIN_VENUES,
  NEAR_ME_MAP_RADIUS_KM,
  NEAR_ME_MAX_ZOOM,
  NEAR_ME_MIN_ZOOM,
  mapVisibleBand,
  metresPerPixel,
  nearMeCameraFrame,
  nearMeMapVenues,
  nearMeVisibleBounds,
  nearestVenueKm,
  withinNearMeRing,
} from "@/lib/nearMeMapFrame";
import type { Venue } from "@/lib/venues";

// The framing math reads id/latitude/longitude only; a partial cast keeps the
// fixture honest without dragging in the full Venue shape.
function makeVenue(id: string, lat: number, lng: number): Venue {
  return { id, latitude: lat, longitude: lng } as Venue;
}

// The reader in the reported defect: standing at Victoria station.
const VICTORIA = { lat: 51.4952, lng: -0.1441 };

// A phone at 390x844 with the near-me sheet open. Both numbers are measured
// from the shipped app, not invented: the sheet's top edge sat at 296px.
const PHONE = { width: 390, height: 844 };
const SHEET_TOP = 296;
const PHONE_BAND = mapVisibleBand({
  height: PHONE.height,
  topInset: 190,
  coverTop: SHEET_TOP,
  bottomInset: 190,
});

/**
 * A London-wide venue set: a dense West End cloud roughly 2 km north of the
 * reader, a handful on the reader's own streets, and outer-London pubs that
 * make the full set span the city. This is the shape that broke the camera —
 * the nearest pubs are local, but the crowd is not.
 */
function londonWideVenues(): Venue[] {
  const venues: Venue[] = [];
  // On the reader's own streets, inside the walk ring. Victoria really does
  // carry this many: the shipped index holds 36 within 1 km.
  for (let i = 0; i < 24; i += 1) {
    venues.push(makeVenue(
      `victoria-${i}`,
      VICTORIA.lat + ((i % 6) - 3) * 0.0011,
      VICTORIA.lng + (Math.floor(i / 6) - 2) * 0.0018,
    ));
  }
  // Soho / Mayfair / Piccadilly: dense, and 1.5 - 2.5 km north.
  for (let i = 0; i < 40; i += 1) {
    venues.push(makeVenue(`westend-${i}`, 51.5115 + (i % 8) * 0.001, -0.1355 + Math.floor(i / 8) * 0.002));
  }
  // The rest of London, corner to corner.
  const outer: [number, number][] = [
    [51.4, -0.35], [51.61, -0.28], [51.44, 0.09], [51.58, 0.12],
    [51.35, -0.09], [51.65, -0.02], [51.47, -0.45], [51.53, 0.2],
  ];
  outer.forEach(([lat, lng], index) => venues.push(makeVenue(`outer-${index}`, lat, lng)));
  return venues;
}

const LONDON = londonWideVenues();

function boundsContain(
  bounds: [[number, number], [number, number]],
  point: { lat: number; lng: number },
): boolean {
  const [[west, south], [east, north]] = bounds;
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

function boundsWidthKm(bounds: [[number, number], [number, number]]): number {
  const [[west, south], [east, north]] = bounds;
  const midLat = (south + north) / 2;
  return haversineKm([west, midLat], [east, midLat]);
}

describe("nearMeMapVenues", () => {
  it("answers the walk ring the sheet names, not a wider one", () => {
    const selected = nearMeMapVenues(VICTORIA.lat, VICTORIA.lng, LONDON);
    const ring = withinNearMeRing(VICTORIA, LONDON);
    expect(ring).toBeGreaterThanOrEqual(NEAR_ME_MAP_MIN_VENUES);
    // The chip counts this set. Its number must be the ring's number.
    expect(selected).toHaveLength(ring);
    for (const venue of selected) {
      const km = haversineKm(
        [VICTORIA.lng, VICTORIA.lat],
        [venue.longitude, venue.latitude],
      );
      expect(km).toBeLessThanOrEqual(NEAR_ME_MAP_RADIUS_KM);
    }
  });

  it("tops a thin ring up to the nearest few rather than answering with nothing", () => {
    const thin = { lat: 51.66, lng: 0.15 };
    expect(withinNearMeRing(thin, LONDON)).toBe(0);
    expect(nearMeMapVenues(thin.lat, thin.lng, LONDON)).toHaveLength(NEAR_ME_MAP_MIN_VENUES);
  });
});

describe("nearMeCameraFrame at Victoria", () => {
  const frame = nearMeCameraFrame({
    location: VICTORIA,
    nearestVenueKm: nearestVenueKm(VICTORIA, nearMeMapVenues(VICTORIA.lat, VICTORIA.lng, LONDON)),
    viewport: PHONE,
    band: PHONE_BAND,
  });
  const visible = nearMeVisibleBounds(frame, PHONE, PHONE_BAND);

  it("centres the reader", () => {
    expect(frame.center).toEqual([VICTORIA.lng, VICTORIA.lat]);
  });

  it("puts the reader inside the band of map the sheet leaves visible", () => {
    expect(boundsContain(visible, VICTORIA)).toBe(true);
  });

  it("does not span London", () => {
    expect(boundsWidthKm(visible)).toBeLessThan(2);
    expect(frame.zoom).toBeGreaterThanOrEqual(NEAR_ME_MIN_ZOOM);
    expect(frame.zoom).toBeLessThanOrEqual(NEAR_ME_MAX_ZOOM);
  });

  it("lands close enough to read the reader's own street", () => {
    // Under 5 m per pixel the street network is legible at phone density.
    expect(metresPerPixel(frame.zoom, VICTORIA.lat)).toBeLessThan(5);
  });

  it("lifts the reader above the sheet rather than centring the canvas", () => {
    // MapLibre puts the target BELOW the container centre for a positive y, so
    // lifting the reader into the band above the sheet is a negative offset.
    expect(frame.offset[1]).toBeLessThan(0);
    expect(PHONE.height / 2 + frame.offset[1]).toBeCloseTo(
      (PHONE_BAND.top + PHONE_BAND.bottom) / 2,
      0,
    );
  });
});

/**
 * The defect, stated as geometry.
 *
 * The old camera fitted a LngLatBounds over the reader plus the nearby venues
 * and let MapLibre centre that box. The West End crowd pulled the box north, so
 * the box centre was not the reader — and on a phone the canvas centre sits
 * under the near-me sheet, so the reader was off the visible band entirely.
 */
describe("the bounds-of-venues camera it replaced", () => {
  function legacyFrame() {
    const nearby = nearMeMapVenues(VICTORIA.lat, VICTORIA.lng, LONDON);
    let west = VICTORIA.lng, east = VICTORIA.lng, south = VICTORIA.lat, north = VICTORIA.lat;
    for (const venue of nearby) {
      west = Math.min(west, venue.longitude);
      east = Math.max(east, venue.longitude);
      south = Math.min(south, venue.latitude);
      north = Math.max(north, venue.latitude);
    }
    // A fit centres the box on the canvas, with no offset for the sheet.
    return {
      center: [(west + east) / 2, (south + north) / 2] as [number, number],
      zoom: 14.25,
      offset: [0, 0] as [number, number],
    };
  }

  it("left the reader off the visible band", () => {
    const visible = nearMeVisibleBounds(legacyFrame(), PHONE, PHONE_BAND);
    expect(boundsContain(visible, VICTORIA)).toBe(false);
  });

  it("showed the reader ground well to the north of where they stood", () => {
    const [[, south]] = nearMeVisibleBounds(legacyFrame(), PHONE, PHONE_BAND);
    // The whole visible band began north of the reader.
    expect(south).toBeGreaterThan(VICTORIA.lat);
    const gapMetres = haversineKm(
      [VICTORIA.lng, VICTORIA.lat],
      [VICTORIA.lng, south],
    ) * 1000;
    expect(gapMetres).toBeGreaterThan(500);
  });
});

describe("nearMeCameraFrame where the ring is empty", () => {
  const thin = { lat: 51.66, lng: 0.15 };
  const frame = nearMeCameraFrame({
    location: thin,
    nearestVenueKm: nearestVenueKm(thin, nearMeMapVenues(thin.lat, thin.lng, LONDON)),
    viewport: PHONE,
    band: PHONE_BAND,
  });

  it("still centres the reader and still refuses to frame the city", () => {
    expect(frame.center).toEqual([thin.lng, thin.lat]);
    expect(frame.zoom).toBe(NEAR_ME_MIN_ZOOM);
    const visible = nearMeVisibleBounds(frame, PHONE, PHONE_BAND);
    expect(boundsContain(visible, thin)).toBe(true);
    expect(boundsWidthKm(visible)).toBeLessThan(4);
  });
});

describe("the shipped near-me camera", () => {
  const source = readFileSync(
    join(process.cwd(), "components/map/canvas/useMapCamera.ts"),
    "utf8",
  );
  const fitNearby = source.slice(source.indexOf("const fitNearby"));

  it("frames the reader, never a bounds over venues", () => {
    expect(fitNearby).toContain("nearMeCameraFrame");
    expect(fitNearby).not.toContain("fitBounds");
    expect(fitNearby).not.toContain("LngLatBounds");
  });

  it("measures its chrome rather than assuming it", () => {
    // Both edges of the band are facts about the moment: a content-sized sheet
    // below, a stack of coming-and-going rows above.
    expect(fitNearby).toContain("whenBottomSheetSettles");
    expect(fitNearby).toContain("measureTopChromeBottom");
    expect(source).toContain("function measureBottomSheetTop");
  });

  it("moves once, so the camera never corrects itself on screen", () => {
    // The first version aimed immediately and re-aimed when the sheet settled.
    // The first reading is taken while the sheet is still a sliver, so that
    // correction fired on EVERY open and was worth about 180px of pan.
    expect(fitNearby.match(/easeTo\(/g) ?? []).toHaveLength(1);
    expect(fitNearby).not.toContain("NEAR_ME_SETTLE_DURATION_MS");
    expect(source).not.toContain("NEAR_ME_SETTLE_DURATION_MS");
  });

  it("still takes the reduced-motion jump, and takes only one", () => {
    expect(fitNearby).toContain("reducedRef.current ? 0");
    // One easeTo above plus duration 0 here means one instant jump, not two.
    expect(fitNearby.match(/duration:/g) ?? []).toHaveLength(1);
  });

  it("does not spend the settle timeout when no sheet covers the map", () => {
    const watcher = source.slice(source.indexOf("function whenBottomSheetSettles"));
    expect(watcher).toContain("BOTTOM_SHEET_SELECTOR");
    expect(watcher).toMatch(/done\(null\);/);
  });
});

describe("mapVisibleBand", () => {
  it("reads the measured sheet top", () => {
    expect(PHONE_BAND).toEqual({ top: 190, bottom: SHEET_TOP });
  });

  it("falls back to the bottom inset when no sheet covers the map", () => {
    expect(
      mapVisibleBand({ height: 844, topInset: 190, coverTop: null, bottomInset: 190 }),
    ).toEqual({ top: 190, bottom: 654 });
  });

  it("never squeezes the reader into a sliver", () => {
    const band = mapVisibleBand({ height: 844, topInset: 190, coverTop: 200, bottomInset: 190 });
    expect(band.bottom - band.top).toBeGreaterThanOrEqual(96);
  });
});
