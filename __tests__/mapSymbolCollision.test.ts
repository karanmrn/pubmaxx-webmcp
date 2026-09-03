import type * as maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";

import {
  buildLandmarks,
  buildPois,
  buildPubs,
  buildUkBase,
  CLUSTER_COLLISION_PADDING,
  CLUSTER_MAX_RADIUS_PX,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS_PX,
  LANDMARK_ICON_PRIORITY_ZOOM,
  PIN_HALO_ENVELOPE_PX,
  PIN_MIN_ZOOM,
  PIN_PRICE_LABEL_PADDING,
  PROVISIONAL_BADGE_OFFSET_PX,
  PROVISIONAL_BADGE_RADIUS_MAX_PX,
  UK_BASE_ICON_OPACITY,
  UK_BASE_ICON_SIZE_EXPR,
  UK_BASE_MIN_ZOOM,
  type SceneCtx,
} from "@/components/map/canvas/buildScene";
import {
  clusterEntranceProgress,
  pinSortKeyExpr,
  pinPriceLabelExpr,
  PIN_ICON_SIZE_EXPR,
  PIN_PRICE_LABEL_MIN_ZOOM,
  pubIconOpacityExpr,
  selectedPinFilter,
  SELECTED_PIN_PRICE_LABEL_EXPR,
} from "@/components/map/canvas/filters";
import { landmarksToGeoJSON } from "@/components/map/canvas/geojson";
import type { Landmark } from "@/lib/landmarks";
import type { Tokens } from "@/components/map/canvas/tokens";

// The mobile map's density contract (owner report: "as you load the map all the
// places are so grouped together … you can see they are so close and it's so
// janky"). Every rule below is one that, when broken, puts two symbols on top of
// each other on a 390px-wide phone, so they are asserted on the built scene
// rather than left to a screenshot review.

type BuiltLayer = maplibregl.AddLayerObject & {
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  filter?: unknown;
};

function buildScenePieces(selectedId = "") {
  const layers = new Map<string, BuiltLayer>();
  const sources = new Map<string, Record<string, unknown>>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: Record<string, unknown>) => sources.set(id, spec),
    getLayer: (id: string) => layers.get(id),
    setPaintProperty: () => {},
    setLayoutProperty: () => {},
  } as unknown as maplibregl.Map;

  const ctx = {
    map,
    tokens: new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "priceStampTiltDeg" ? -1.5 : "#000000",
      },
    ) as unknown as Tokens,
    dark: false,
    textFont: ["Noto Sans Regular"],
    addLayerOnce: ((layer: BuiltLayer) => layers.set(layer.id, layer)) as SceneCtx["addLayerOnce"],
    poiHidden: {} as SceneCtx["poiHidden"],
    transitLinesPath: null,
    showLandmarks: true,
    landmarksGeoJSON: { type: "FeatureCollection", features: [] },
    poisData: { type: "FeatureCollection", features: [] },
    routeLine: { type: "FeatureCollection", features: [] },
    routeStops: { type: "FeatureCollection", features: [] },
    bandCorridor: { type: "FeatureCollection", features: [] },
    bandColor: "#000000",
    bandMemberIds: [],
    pubsData: { type: "FeatureCollection", features: [] },
    userLocationData: { type: "FeatureCollection", features: [] },
    ukBaseData: { type: "FeatureCollection", features: [] },
    tonightData: { type: "FeatureCollection", features: [] },
    tonightVisible: false,
    selectedId,
    selectionMuteStore: new Map<string, unknown>(),
  } satisfies SceneCtx;

  buildLandmarks(ctx);
  buildPois(ctx);
  buildUkBase(ctx);
  buildPubs(ctx);
  return { layers, sources };
}

function buildLateLandmarkLayers() {
  const beforeLayer = { id: "pubs-drops-halo" } as BuiltLayer;
  const calls: Array<{ id: string; before?: string }> = [];
  const map = {
    getSource: () => undefined,
    addSource: () => {},
    getLayer: (id: string) => (id === beforeLayer.id ? beforeLayer : undefined),
  } as unknown as maplibregl.Map;
  const ctx = {
    map,
    tokens: new Proxy({}, { get: () => "#000000" }) as unknown as Tokens,
    dark: false,
    textFont: ["Noto Sans Regular"],
    addLayerOnce: ((layer: BuiltLayer, before?: string) => calls.push({ id: layer.id, before })) as SceneCtx["addLayerOnce"],
    showLandmarks: true,
    landmarksGeoJSON: { type: "FeatureCollection", features: [] },
  } as unknown as SceneCtx;
  buildLandmarks(ctx);
  return calls;
}

describe("pub clustering density (scales to a UK-wide source)", () => {
  const { sources } = buildScenePieces();
  const pubs = sources.get("pubs")!;

  it("clusters the pubs source up to CLUSTER_MAX_ZOOM at the mobile radius", () => {
    expect(pubs.cluster).toBe(true);
    expect(pubs.clusterMaxZoom).toBe(CLUSTER_MAX_ZOOM);
    expect(pubs.clusterRadius).toBe(CLUSTER_RADIUS_PX);
  });

  it("keeps a mixed band where dense pockets stay clustered and roomy pubs are pins", () => {
    // Pins may appear from PIN_MIN_ZOOM while the source still clusters, which
    // is exactly what stops a dense street from unclustering into a pile.
    expect(PIN_MIN_ZOOM).toBeLessThanOrEqual(CLUSTER_MAX_ZOOM);
  });

  it("stops clustering below every camera zoom that targets one venue", () => {
    // Venue selection flies to max(zoom, 14) and the landmark inspector to 15;
    // a selected pub must always be a real pin, never swallowed by a cluster.
    expect(CLUSTER_MAX_ZOOM).toBeLessThan(14);
  });

  it("groups wider than the widest cluster disc so two discs cannot touch", () => {
    // `clusters` circle-radius tops out at the exported maximum (+ stroke) — a grouping radius
    // under that diameter would let neighbouring discs overlap.
    expect(CLUSTER_MAX_RADIUS_PX).toBe(20);
    expect(CLUSTER_RADIUS_PX).toBeGreaterThan(2 * CLUSTER_MAX_RADIUS_PX);
  });
});

describe("UK base layer (unpriced, visually subordinate, never clustered)", () => {
  const { layers, sources } = buildScenePieces();
  const base = sources.get("uk-base")!;
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;

  it("is its own source and is NOT clustered", () => {
    // Clustering base pubs into the curated `pubs` source would inflate every
    // London cluster count and grey out its donut — the curated overview below
    // the pin floor has to stay exactly what it was.
    expect(base.type).toBe("geojson");
    expect(base.cluster).toBeUndefined();
    expect(sources.get("pubs")!.cluster).toBe(true);
  });

  it("only appears from the pin floor, so the overview never carries it", () => {
    expect((layers.get("uk-base-point") as { minzoom?: number }).minzoom).toBe(UK_BASE_MIN_ZOOM);
    expect(UK_BASE_MIN_ZOOM).toBe(PIN_MIN_ZOOM);
  });

  it("draws under the curated pins, which is also how it loses collisions", () => {
    // Placement runs top layer first, so a base pin can only take a spot no
    // curated pin wanted. Insertion order IS the style order here.
    const ids = [...layers.keys()];
    expect(ids.indexOf("uk-base-point")).toBeLessThan(ids.indexOf("pubs-point"));
  });

  it("collides like every other symbol rather than stacking", () => {
    expect(layout("uk-base-point")["icon-allow-overlap"]).toBe(false);
    expect(layout("uk-base-point")["icon-ignore-placement"]).toBe(false);
  });

  it("stays visibly smaller than a curated pin at every shared zoom", () => {
    // Both are ["interpolate", ["linear"], ["zoom"], z, out, …]. A curated stop
    // output is itself ["case", story?, storySize, standardSize] — take the
    // standard (fallback) size, the smallest a curated pin ever draws at.
    const standard = (output: unknown) =>
      Array.isArray(output) ? (output[output.length - 1] as number) : (output as number);
    const sizeAt = (expr: unknown, zoom: number) => {
      const stops = (expr as unknown[]).slice(3);
      let value = standard(stops[1]);
      for (let i = 0; i < stops.length; i += 2) {
        if ((stops[i] as number) <= zoom) value = standard(stops[i + 1]);
      }
      return value;
    };
    for (const zoom of [UK_BASE_MIN_ZOOM, 15, 17]) {
      expect(sizeAt(UK_BASE_ICON_SIZE_EXPR, zoom)).toBeLessThan(sizeAt(PIN_ICON_SIZE_EXPR, zoom));
    }
    // …and never fully opaque, so it reads as background even when isolated.
    expect(UK_BASE_ICON_OPACITY).toBeLessThan(1);
  });

  it("carries no price-driven paint at all", () => {
    const paint = (layers.get("uk-base-point")?.paint ?? {}) as Record<string, unknown>;
    expect(JSON.stringify(paint)).not.toContain("bucket");
    expect(layout("uk-base-point")["icon-image"]).toBe("base:pub");
  });
});

describe("symbol collision policy", () => {
  const { layers } = buildScenePieces();
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;

  it("does not add removed pub halo layers to the scene", () => {
    expect(layers.has("pubs-hero-glow")).toBe(false);
    expect(layers.has("pubs-confidence-ring")).toBe(false);
  });

  it("drops crowded pub pins instead of stacking them", () => {
    const pins = layout("pubs-point");
    expect(pins["icon-allow-overlap"]).toBe(false);
    expect(pins["icon-ignore-placement"]).toBe(false);
    // Padding has to clear the widest halo ring a pin wears (radius ≤ 15px at
    // z15 on the scraped / drops / what's-on layers).
    expect(pins["icon-padding"]).toBeGreaterThanOrEqual(4);
    expect(pins["symbol-sort-key"]).toEqual(pinSortKeyExpr(""));
  });

  it("allows only the selected pub pin to overlap competing symbols", () => {
    const selectedLayers = buildScenePieces("venue-abc").layers;

    // The base layer keeps colliding even while a venue is selected —
    // icon-allow-overlap is data-constant, so the exemption cannot live here.
    const pins = (selectedLayers.get("pubs-point")?.layout ?? {}) as Record<string, unknown>;
    expect(pins["icon-allow-overlap"]).toBe(false);

    // The exemption is the dedicated selected-pin layer: one feature via the
    // selected-id filter, constant overlap, still visible to the collision
    // index so neighbours keep off it.
    const selected = selectedLayers.get("pubs-point-selected")!;
    const selectedLayout = (selected.layout ?? {}) as Record<string, unknown>;
    expect(selected.filter).toEqual(selectedPinFilter("venue-abc"));
    expect(selectedLayout["icon-allow-overlap"]).toBe(true);
    expect(selectedLayout["icon-ignore-placement"]).toBe(false);
  });

  it("keeps the cluster count drawn while still reserving the disc's space", () => {
    const count = layout("cluster-count");
    // A numberless disc would be worse than a tight fit…
    expect(count["text-allow-overlap"]).toBe(true);
    // …but a circle layer contributes nothing to the collision index, so the
    // count's padded box is what keeps other labels off the disc.
    expect(count["text-ignore-placement"]).toBe(false);
    expect(count["text-padding"]).toBe(CLUSTER_COLLISION_PADDING);
    expect(CLUSTER_COLLISION_PADDING).toBe(10);
  });

  it("drops crowded landmark names rather than overprinting them", () => {
    const label = layout("landmarks-label");
    expect(label["text-allow-overlap"]).toBe(false);
    expect(label["text-ignore-placement"]).toBe(false);
    expect(label["text-variable-anchor"]).toEqual([
      "top",
      "bottom",
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
  });

  it("inserts hydrated landmark layers before the first pub layer", () => {
    expect(buildLateLandmarkLayers()).toEqual([
      { id: "landmarks-label", before: "pubs-drops-halo" },
      { id: "landmarks-icon", before: "pubs-drops-halo" },
    ]);
  });

  it("places landmark names independently when a pub cluster owns the pictogram coordinate", () => {
    const label = layout("landmarks-label");
    const icon = layout("landmarks-icon");

    expect(label["text-field"]).toEqual(["get", "name"]);
    expect(icon["text-field"]).toBeUndefined();
    expect(label["symbol-sort-key"]).toEqual([
      "coalesce",
      ["get", "priority"],
      999,
    ]);
    expect(icon["symbol-sort-key"]).toEqual([
      "coalesce",
      ["get", "priority"],
      999,
    ]);
  });

  it("keeps both landmark candidates below priced pubs in collision priority", () => {
    const ids = [...layers.keys()];
    expect(ids.indexOf("landmarks-label")).toBeLessThan(ids.indexOf("pubs-point"));
    expect(ids.indexOf("landmarks-icon")).toBeLessThan(ids.indexOf("pubs-point"));
  });

  it("lets landmark icons yield below the inspector band and win at/above it", () => {
    const landmark = layout("landmarks-icon");
    expect(landmark["icon-allow-overlap"]).toEqual([
      "step",
      ["zoom"],
      false,
      LANDMARK_ICON_PRIORITY_ZOOM,
      true,
    ]);
    // Never invisible to placement — that flag is what let one pictogram
    // bulldoze every neighbouring label into a pile.
    expect(landmark["icon-ignore-placement"]).toBe(false);
  });

  it("collides transport roundels too", () => {
    expect(layout("pois-transport-major")["icon-allow-overlap"]).toBe(false);
    expect(layout("pois-transport-minor")["icon-allow-overlap"]).toBe(false);
  });

  it("leaves no app symbol layer invisible to the collision index", () => {
    for (const [id, layer] of layers) {
      if (layer.type !== "symbol") continue;
      const props = (layer.layout ?? {}) as Record<string, unknown>;
      expect(
        { id, icon: props["icon-ignore-placement"] ?? false },
        `${id} must not ignore placement`,
      ).toEqual({ id, icon: false });
      expect(
        { id, text: props["text-ignore-placement"] ?? false },
        `${id} must not ignore placement`,
      ).toEqual({ id, text: false });
    }
  });
});

// The provisional-report badge is the newest thing riding on a pin, so it is
// also the easiest way to break two contracts at once: the density rule (a
// marker that grows the pin's footprint changes which pins get placed) and the
// price-band colour system (a badge that borrows a band colour reads as a
// price). Both are asserted here rather than left to a screenshot.
describe("provisional-report badge (ungated visibility, zero authority)", () => {
  const { layers } = buildScenePieces();
  const badge = layers.get("pubs-provisional-badge")!;
  const paint = (badge.paint ?? {}) as Record<string, unknown>;

  it("uses the same mark on base pubs without joining their price lane", () => {
    const baseBadge = layers.get("uk-base-provisional-badge")!;
    const basePaint = (baseBadge.paint ?? {}) as Record<string, unknown>;
    expect((baseBadge as { source?: string }).source).toBe("uk-base");
    expect(baseBadge.filter).toEqual(["get", "provisional"]);
    expect((baseBadge as { minzoom?: number }).minzoom).toBe(
      UK_BASE_MIN_ZOOM,
    );
    for (const property of [
      "circle-color",
      "circle-radius",
      "circle-translate",
      "circle-stroke-color",
      "circle-stroke-width",
    ]) {
      expect(basePaint[property], property).toEqual(paint[property]);
    }
    expect(JSON.stringify(baseBadge)).not.toContain("bucket");
    expect(JSON.stringify(baseBadge)).not.toContain("price");

    const ids = [...layers.keys()];
    expect(ids.indexOf("uk-base-point")).toBeLessThan(
      ids.indexOf("uk-base-provisional-badge"),
    );
    expect(ids.indexOf("uk-base-provisional-badge")).toBeLessThan(
      ids.indexOf("pubs-point"),
    );
  });

  it("only ever rides an unclustered pin, from the pin floor", () => {
    expect(badge.filter).toEqual([
      "all",
      ["!", ["has", "point_count"]],
      ["get", "provisional"],
    ]);
    expect((badge as { minzoom?: number }).minzoom).toBe(PIN_MIN_ZOOM);
  });

  it("stays inside the halo envelope the pin's icon-padding already clears", () => {
    // A circle layer is invisible to MapLibre's collision index, so the badge
    // can only be free of the density contract while it sits inside the
    // footprint `pubs-point` already reserves. Grow it past this and pins start
    // touching on a 390px phone.
    const [dx, dy] = PROVISIONAL_BADGE_OFFSET_PX;
    expect(Math.hypot(dx, dy) + PROVISIONAL_BADGE_RADIUS_MAX_PX).toBeLessThanOrEqual(
      PIN_HALO_ENVELOPE_PX,
    );
    expect(paint["circle-translate"]).toEqual(PROVISIONAL_BADGE_OFFSET_PX);
  });

  it("dims with its own pin instead of popping out of the spotlight", () => {
    const selected = buildScenePieces("venue-abc").layers.get("pubs-provisional-badge")!;
    const selectedPaint = (selected.paint ?? {}) as Record<string, unknown>;
    expect(selectedPaint["circle-opacity"]).toEqual(pubIconOpacityExpr("venue-abc"));
    expect(selectedPaint["circle-stroke-opacity"]).toEqual(pubIconOpacityExpr("venue-abc"));
  });

  it("draws over every per-pin layer, so no ring or selection can hide it", () => {
    const ids = [...layers.keys()];
    for (const under of [
      "pubs-point",
      "pubs-point-selected",
      "pubs-selected-glow",
      "pubs-selected",
    ]) {
      expect(ids.indexOf(under)).toBeLessThan(ids.indexOf("pubs-provisional-badge"));
    }
  });

  it("reads no price at all - not the bucket, not a band colour", () => {
    expect(JSON.stringify(paint)).not.toContain("bucket");
    expect(JSON.stringify(paint)).not.toContain("latestContributorPrice");
  });
});

// The price tag is the first thing this map draws OUTSIDE a pin's icon padding,
// so it is the first thing that can break the density contract by growing what
// a pin occupies. The badge above bought its exemption by hiding inside that
// padding; the tag cannot, so it takes the ordinary deal instead - and these
// assert it actually took it.
describe("priced-pin price tag (collides, and yields before the pin does)", () => {
  const { layers } = buildScenePieces();
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;
  const paint = (id: string) => (layers.get(id)?.paint ?? {}) as Record<string, unknown>;

  it("rides the priced-pin layer itself, not a second symbol layer", () => {
    // A separate label layer would place independently of its own pin: a price
    // could survive where its glyph was dropped, or drift onto a neighbour.
    expect(layout("pubs-point")["text-field"]).toEqual(pinPriceLabelExpr(""));
    expect(layers.get("pubs-point-price-label")).toBeUndefined();
  });

  it("participates in the same collision index the pins do", () => {
    const pins = layout("pubs-point");
    expect(pins["text-allow-overlap"]).toBe(false);
    expect(pins["text-ignore-placement"]).toBe(false);
    expect(pins["text-padding"]).toBe(PIN_PRICE_LABEL_PADDING);
    // A labelled pin must still reserve its halo envelope, unchanged.
    expect(pins["icon-padding"]).toBe(6);
  });

  it("yields before the icon does - the label goes, the pin stays", () => {
    expect(layout("pubs-point")["text-optional"]).toBe(true);
    // The mirror of that: icon-optional is never set, so a pin is never
    // dropped merely to keep its own price on screen.
    expect(layout("pubs-point")["icon-optional"]).toBeUndefined();
  });

  it("is zoom-gated above the pin floor and the cluster band", () => {
    // Below the gate the text-field evaluates to "" - no glyphs, no collision
    // box - so the overview is byte-identical to the map before labels.
    expect(PIN_PRICE_LABEL_MIN_ZOOM).toBeGreaterThan(PIN_MIN_ZOOM);
    expect(PIN_PRICE_LABEL_MIN_ZOOM).toBeGreaterThan(CLUSTER_MAX_ZOOM);
    const field = layout("pubs-point")["text-field"] as unknown[];
    expect(field.slice(0, 4)).toEqual(["step", ["zoom"], "", PIN_PRICE_LABEL_MIN_ZOOM]);
  });

  it("prints nothing for a pub with no sayable price", () => {
    // `priceLabel` is absent on unpriced/demo-only/provisional-only pubs
    // (see canvas-geojson.test.ts), and the coalesce turns that into "".
    const field = layout("pubs-point")["text-field"] as unknown[];
    expect(field[4]).toEqual(["coalesce", ["get", "priceLabel"], ""]);
  });

  it("reads exactly one property, so no view can widen what a figure means", () => {
    // `priceLabel` is the pint claim, gated to pub kinds and to a sourced
    // price. A second coalesce arm is how a soft drink or a dish price gets to
    // print bare over an unchanged pint glyph, which is the same masquerade
    // the anchor-price rule already forbids.
    for (const id of ["pubs-point", "pubs-point-selected"]) {
      const field = JSON.stringify(layout(id)["text-field"]);
      expect(field).toContain("priceLabel");
      expect(field).not.toContain("lensPrice");
      expect(field.match(/"get"/g)?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("never borrows a band colour for the figure", () => {
    // The number IS the price; tinting it would say the same thing twice and
    // invite reading it as a fourth signal alongside the three bands.
    //
    // The failable form of that rule: the tag's two colours must be CONSTANTS.
    // A band tint can only arrive as a data expression - ["match", ["get",
    // "bucket"], …] or a case/step over the same - which lands here as an
    // array, never a string. (Reading `text-color` off the LAYOUT object, as
    // an earlier version of this test did, asserts nothing: it is a paint
    // property, so that lookup is undefined no matter what the layer does.)
    const pins = paint("pubs-point");
    expect(typeof pins["text-color"]).toBe("string");
    expect(typeof pins["text-halo-color"]).toBe("string");
    expect(JSON.stringify(pins)).not.toContain("bucket");
  });

  it("dims with its own pin instead of shouting past the spotlight", () => {
    const selected = buildScenePieces("venue-abc").layers.get("pubs-point")!;
    const selectedPaint = (selected.paint ?? {}) as Record<string, unknown>;
    expect(selectedPaint["text-opacity"]).toEqual(pubIconOpacityExpr("venue-abc"));
  });

  it("draws the selected pub's figure once, on the selected-pin layer", () => {
    const selectedLayers = buildScenePieces("venue-abc").layers;
    const base = (selectedLayers.get("pubs-point")?.layout ?? {}) as Record<string, unknown>;
    // The base layer leaves a hole for the selected feature…
    expect(base["text-field"]).toEqual(pinPriceLabelExpr("venue-abc"));
    expect((base["text-field"] as unknown[])[4]).toEqual([
      "case",
      ["==", ["get", "id"], "venue-abc"],
      "",
      ["coalesce", ["get", "priceLabel"], ""],
    ]);
    // …which the enlarged pin fills at its own offset.
    const selected = (selectedLayers.get("pubs-point-selected")?.layout ??
      {}) as Record<string, unknown>;
    expect(selected["text-field"]).toEqual(SELECTED_PIN_PRICE_LABEL_EXPR);
    expect(selected["text-offset"]).not.toEqual(base["text-offset"]);
  });

  it("does not extend the selected pin's overlap exemption to its figure", () => {
    // The icon may stamp over a neighbour (it is the one thing the user is
    // looking at); a NUMBER doing so would be printing a price on the wrong pub.
    const selected = (buildScenePieces("venue-abc").layers.get("pubs-point-selected")
      ?.layout ?? {}) as Record<string, unknown>;
    expect(selected["icon-allow-overlap"]).toBe(true);
    expect(selected["text-allow-overlap"]).toBe(false);
    expect(selected["text-ignore-placement"]).toBe(false);
    expect(selected["text-optional"]).toBe(true);
  });

  it("leaves the unpriced UK base pubs with no text of any kind", () => {
    // ~38k pubs we know nothing about. Never a placeholder, never a "£?".
    expect(layout("uk-base-point")["text-field"]).toBeUndefined();
  });
});

describe("pinSortKeyExpr (placement priority when pins compete)", () => {
  it("puts the selected pin at the front of the queue", () => {
    const expr = pinSortKeyExpr("venue-abc") as unknown[];
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["==", ["get", "id"], "venue-abc"]);
    expect(expr[2]).toBe(0);
  });

  it("ranks story pins ahead of priced pins ahead of the rest", () => {
    expect(pinSortKeyExpr("")).toEqual([
      "case",
      ["get", "story"],
      1,
      ["<", ["coalesce", ["get", "bucket"], 3], 3],
      2,
      3,
    ]);
  });
});

describe("clusterEntranceProgress (load-in fade)", () => {
  it("starts at 0 and settles at exactly 1", () => {
    expect(clusterEntranceProgress(0, 400)).toBe(0);
    expect(clusterEntranceProgress(400, 400)).toBe(1);
    expect(clusterEntranceProgress(4000, 400)).toBe(1);
  });

  it("never leaves the 0..1 range for a negative or zero-length window", () => {
    expect(clusterEntranceProgress(-50, 400)).toBe(0);
    expect(clusterEntranceProgress(10, 0)).toBe(1);
  });

  it("eases out — most of the fade lands in the first half", () => {
    expect(clusterEntranceProgress(200, 400)).toBeGreaterThan(0.5);
    expect(clusterEntranceProgress(200, 400)).toBeLessThan(1);
  });
});

describe("landmarksToGeoJSON priority", () => {
  it("stamps curation order onto every feature as the collision sort key", () => {
    const catalog = [
      { id: "a", name: "A", coordinates: [0, 0], icon: "x" },
      { id: "b", name: "B", coordinates: [1, 1], icon: "y" },
    ] as unknown as readonly Landmark[];
    const collection = landmarksToGeoJSON(catalog);
    expect(collection.features.map((feature) => feature.properties?.priority)).toEqual([0, 1]);
  });
});
