import { describe, expect, it } from "vitest";

import { areaClaimedByViewport, areaUnderCentre } from "@/lib/areaButton";
import { getNightArea } from "@/lib/nightAreas";
import type { MapBounds } from "@/lib/slimShards";

// A map may name the place it SITS OVER, and no other.
//
// The bar named the nearest modelled area to the map centre. Nearest is not
// over: the phone header printed "Camden" while the open pub sheet was in
// North Finchley N12, and "Balham" over a view holding Luton to Crawley. These
// hold the three rules apart: containment, one heart on screen, and a view no
// wider than the area it claims.

const camden = getNightArea("camden");
const kingsCross = getNightArea("kings-cross");

/** A view of `spanKm` across, centred on a point. Square, so both edges test. */
function viewAround(
  centre: { lat: number; lng: number },
  spanKm: number,
): MapBounds {
  const halfLat = spanKm / 2 / 111;
  const halfLng = halfLat / Math.cos((centre.lat * Math.PI) / 180);
  return {
    west: centre.lng - halfLng,
    east: centre.lng + halfLng,
    south: centre.lat - halfLat,
    north: centre.lat + halfLat,
  };
}

const CAMDEN_CENTRE: [number, number] = [camden.centre.lng, camden.centre.lat];
/** North Finchley N12 — a real London place, inside no modelled Night Area. */
const NORTH_FINCHLEY: [number, number] = [-0.174, 51.615];

describe("areaClaimedByViewport — what the bar may name", () => {
  it("names the area a tight view sits inside", () => {
    const claimed = areaClaimedByViewport(
      "london",
      CAMDEN_CENTRE,
      viewAround(camden.centre, 1.6),
    );
    expect(claimed?.name).toBe("Camden");
  });

  it("names nothing when the view spans more than one area", () => {
    // 6 km across Camden holds King's Cross, Islington and Marylebone too.
    const bounds = viewAround(camden.centre, 6);
    expect(
      areaClaimedByViewport("london", CAMDEN_CENTRE, bounds),
    ).toBeNull();
    // The heart of a second area really is on screen, so this is not a
    // scale-rule accident.
    expect(kingsCross.centre.lng).toBeGreaterThan(bounds.west);
    expect(kingsCross.centre.lng).toBeLessThan(bounds.east);
    expect(kingsCross.centre.lat).toBeGreaterThan(bounds.south);
    expect(kingsCross.centre.lat).toBeLessThan(bounds.north);
    // The defect: the old answer named one of them anyway.
    expect(areaUnderCentre("london", CAMDEN_CENTRE)?.name).toBe("Camden");
  });

  it("names nothing over a place that is inside no area", () => {
    // The N12 screenshot. The nearest modelled area was Camden, 8 km away.
    expect(
      areaClaimedByViewport("london", NORTH_FINCHLEY, viewAround(
        { lat: NORTH_FINCHLEY[1], lng: NORTH_FINCHLEY[0] },
        1.2,
      )),
    ).toBeNull();
    expect(areaUnderCentre("london", NORTH_FINCHLEY)).not.toBeNull();
  });

  it("names nothing over a view that covers the southeast", () => {
    // The "Balham" screenshot: Luton to Crawley in one frame.
    expect(
      areaClaimedByViewport("london", [-0.13, 51.5], {
        west: -1.1,
        east: 0.85,
        south: 50.95,
        north: 52.05,
      }),
    ).toBeNull();
  });

  it("names nothing before the map has settled, and on unusable input", () => {
    expect(areaClaimedByViewport("london", CAMDEN_CENTRE, null)).toBeNull();
    expect(
      areaClaimedByViewport("london", [Number.NaN, 51.5], viewAround(camden.centre, 1.6)),
    ).toBeNull();
    expect(
      areaClaimedByViewport("london", CAMDEN_CENTRE, {
        west: Number.NaN,
        east: 0,
        south: 51,
        north: 52,
      }),
    ).toBeNull();
    // A city with no modelled areas answers with no place, never a guess.
    expect(
      areaClaimedByViewport("bath", [-2.36, 51.38], viewAround({ lat: 51.38, lng: -2.36 }, 1.2)),
    ).toBeNull();
  });
});
