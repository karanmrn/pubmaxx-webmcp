import { describe, expect, it } from "vitest";

import {
  buildTodayPintsForPatch,
  buildTodayPintsIndex,
  resolveTodayPintsPatchId,
  TODAY_PINTS_DEFAULT_PATCH_ID,
  TODAY_PINTS_LIMIT,
  type TodayPintsIndex,
  type TodayPintsModule,
} from "@/app/today/todayPints";
import { CENTRAL_PATCH, NIGHT_PATCHES } from "@/lib/nightPatches";
import type { Venue } from "@/lib/venues";

const SOHO = NIGHT_PATCHES.find((p) => p.id === "soho")!;
const CAMDEN = NIGHT_PATCHES.find((p) => p.id === "camden")!;

// Minimal Venue factory — only the fields the area models read matter. Mirrors
// __tests__/areaButton.test.ts. Placed at the Soho patch heart by default so the
// venue sits inside the Piccadilly & Soho night area.
function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: SOHO.lat,
    longitude: SOHO.lng,
    cheapestPrice: null,
    latestContributorPrice: null,
    ...overrides,
  } as Venue;
}

describe("buildTodayPintsForPatch — the area's cheapest priced pints", () => {
  it("returns the cheapest priced pints, cheapest first, named for the real area", () => {
    const venues = [
      venue({ id: "a", cheapestPrice: 5.5 }),
      venue({ id: "b", cheapestPrice: 4.8 }),
      venue({ id: "c", cheapestPrice: 3.9 }),
    ];
    const mod = buildTodayPintsForPatch(SOHO, venues);
    expect(mod).not.toBeNull();
    expect(mod?.patchId).toBe("soho");
    expect(mod?.areaName).toBe("Piccadilly & Soho");
    expect(mod?.rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(mod?.rows[0]).toMatchObject({
      price: 3.9,
      priceLabel: "£3.90",
      mapHref: "/map?sel=c",
    });
  });

  it("caps the list at five even when more pints are priced", () => {
    const venues = [7.2, 6.1, 5.0, 4.4, 4.1, 3.6, 3.2].map((price, i) =>
      venue({ id: `v${i}`, cheapestPrice: price }),
    );
    const mod = buildTodayPintsForPatch(SOHO, venues);
    expect(mod?.rows).toHaveLength(TODAY_PINTS_LIMIT);
    // Cheapest five, ascending — the two dearest are dropped.
    expect(mod?.rows.map((r) => r.price)).toEqual([3.2, 3.6, 4.1, 4.4, 5.0]);
  });

  it("drops unpriced venues rather than padding the list with them", () => {
    const venues = [
      venue({ id: "priced", cheapestPrice: 4.5 }),
      venue({ id: "blank1" }),
      venue({ id: "blank2" }),
    ];
    const mod = buildTodayPintsForPatch(SOHO, venues);
    expect(mod?.rows.map((r) => r.id)).toEqual(["priced"]);
  });

  it("prefers a contributor drop over the baseline price", () => {
    const venues = [
      venue({ id: "dropped", cheapestPrice: 9.0, latestContributorPrice: 3.1 }),
    ];
    const mod = buildTodayPintsForPatch(SOHO, venues);
    expect(mod?.rows[0]).toMatchObject({ price: 3.1, priceLabel: "£3.10" });
  });

  it("returns null (no module) when the area has no verified prices", () => {
    const venues = [venue({ id: "blank1" }), venue({ id: "blank2" })];
    expect(buildTodayPintsForPatch(SOHO, venues)).toBeNull();
  });
});

describe("buildTodayPintsIndex — precomputed per-area map", () => {
  it("keys only the areas that actually have priced pints", () => {
    const venues = [
      venue({ id: "a", cheapestPrice: 4.2 }),
      venue({ id: "b", cheapestPrice: 5.1 }),
    ];
    const index = buildTodayPintsIndex(venues);
    // Soho venues fall in the central default's area too, so both resolve.
    expect(index.soho).toBeDefined();
    expect(index[TODAY_PINTS_DEFAULT_PATCH_ID]).toBeDefined();
    // A distant patch with no venues nearby is simply absent.
    expect(index.camden).toBeUndefined();
    expect(buildTodayPintsForPatch(CAMDEN, venues)).toBeNull();
  });

  it("is empty when nothing is priced anywhere", () => {
    expect(buildTodayPintsIndex([venue({ id: "blank" })])).toEqual({});
  });
});

describe("resolveTodayPintsPatchId — remembered area to a precomputed patch", () => {
  const stub = (patchId: string): TodayPintsModule => ({
    patchId,
    areaName: "Anywhere",
    rows: [],
  });
  const full: TodayPintsIndex = { soho: stub("soho"), [CENTRAL_PATCH.id]: stub(CENTRAL_PATCH.id) };

  it("uses a remembered patch when it has a precomputed module", () => {
    expect(resolveTodayPintsPatchId({ kind: "patch", id: "soho" }, full)).toBe("soho");
  });

  it("falls back to central for a borough, for no memory, and for an unmodelled patch", () => {
    expect(resolveTodayPintsPatchId({ kind: "borough", name: "Hackney" }, full)).toBe(
      CENTRAL_PATCH.id,
    );
    expect(resolveTodayPintsPatchId(null, full)).toBe(CENTRAL_PATCH.id);
    // Camden is a real patch but absent from this index → central default.
    expect(resolveTodayPintsPatchId({ kind: "patch", id: "camden" }, full)).toBe(
      CENTRAL_PATCH.id,
    );
    // A junk patch id never resolves to a patch → central default.
    expect(resolveTodayPintsPatchId({ kind: "patch", id: "nope" }, full)).toBe(
      CENTRAL_PATCH.id,
    );
  });

  it("returns null when even the central default has no priced pints", () => {
    const noCentral: TodayPintsIndex = { soho: stub("soho") };
    expect(resolveTodayPintsPatchId(null, noCentral)).toBeNull();
    // A remembered patch that IS in the index still resolves, though.
    expect(resolveTodayPintsPatchId({ kind: "patch", id: "soho" }, noCentral)).toBe("soho");
  });
});
