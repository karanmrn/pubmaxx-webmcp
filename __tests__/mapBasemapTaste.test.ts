import { describe, expect, it, vi } from "vitest";

import {
  applyBasemapTaste,
  applySelectionMute,
  buildPalette,
  clusterCircleColorExpr,
  isBasemapSelectionMuteLayer,
  mixHex,
  muteOpacityExpr,
  SELECTION_MUTE_OPACITY,
  tameNumericShieldFilters,
  withAlpha,
} from "@/lib/mapBasemapTaste";
import { applySelectionState, type SceneCtx } from "@/components/map/canvas/buildScene";

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** WCAG relative luminance, so a token's separation is measured, not eyeballed. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** HSL saturation as a percentage — the axis a park must NOT grow along. */
function saturationPct(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return ((max - min) / (l > 0.5 ? 2 - max - min : max + min)) * 100;
}

const tokens = {
  paper: "#f4efe4",
  panelRaised: "#ffffff",
  ink: "#1b2620",
  inkDeep: "#0f1c16",
  line: "#ddd5c4",
  muted: "#6b726a",
  pint: "#2f8f5b",
  amber: "#d99f45",
  brick: "#d16353",
  brass: "#b0813a",
  river: "#2f6f8f",
  riverBright: "#4f9ec4",
  buildingEmissive: "#d99f45",
  parkTint: "#7ea052",
};

const darkTokens = {
  ...tokens,
  paper: "#14110f",
  panelRaised: "#241f1b",
  ink: "#fff4e8",
  inkDeep: "#090806",
  line: "#413a34",
  muted: "#9c9388",
  pint: "#39d98a",
  amber: "#ffc247",
  brass: "#ff6b7a",
  river: "#64b5ff",
  riverBright: "#7dd3fc",
  buildingEmissive: "#8f7d6b",
  parkTint: "#3f5c38",
};

function evaluateClusterExpression(
  expression: unknown,
  properties: Record<string, unknown>,
): unknown {
  if (!Array.isArray(expression)) return expression;
  const [operator, ...args] = expression;
  const value = (item: unknown) =>
    evaluateClusterExpression(item, properties);

  if (operator === "get") return properties[String(args[0])];
  if (operator === "coalesce") {
    return args.map(value).find((item) => item !== null && item !== undefined);
  }
  if (operator === ">") return Number(value(args[0])) > Number(value(args[1]));
  if (operator === ">=") return Number(value(args[0])) >= Number(value(args[1]));
  if (operator === "!=") return value(args[0]) !== value(args[1]);
  if (operator === "has") return Object.hasOwn(properties, String(args[0]));
  if (operator === "%") return Number(value(args[0])) % Number(value(args[1]));
  if (operator === "all") return args.every((item) => Boolean(value(item)));
  if (operator === "match") {
    const input = value(args[0]);
    for (let index = 1; index < args.length - 1; index += 2) {
      if (value(args[index]) === input) return value(args[index + 1]);
    }
    return value(args.at(-1));
  }
  if (operator === "case") {
    for (let index = 0; index < args.length - 1; index += 2) {
      if (value(args[index])) return value(args[index + 1]);
    }
    return value(args.at(-1));
  }
  throw new Error(`Unsupported test expression operator: ${String(operator)}`);
}

// Wave A — crude luminance proxy (sum of RGB channels) shared by the dark-map
// hierarchy assertions. Accepts `#rrggbb`; the dark palette paints solid hex.
function lumSum(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
}

describe("mapBasemapTaste (Wave A / dark basemap overhaul)", () => {
  it("guards OpenFreeMap shield length filters against missing numeric values", () => {
    const original = [
      "all",
      ["<=", ["get", "ref_length"], 6],
      ["match", ["get", "network"], ["us-interstate"], true, false],
    ];
    const filters = new Map<string, unknown>([
      ["highway-shield-non-us", original],
      ["highway-shield-us-interstate", original],
    ]);
    const writes: Array<[string, unknown]> = [];
    const map = {
      getLayer: (id: string) => (filters.has(id) ? { id } : undefined),
      getFilter: (id: string) => filters.get(id),
      setFilter: (id: string, filter: unknown) => writes.push([id, filter]),
    };

    tameNumericShieldFilters(map);

    expect(writes).toHaveLength(2);
    for (const [, filter] of writes) {
      expect(filter).toEqual([
        "all",
        ["<=", ["number", ["get", "ref_length"], 0], 6],
        ["match", ["get", "network"], ["us-interstate"], true, false],
      ]);
    }
  });

  it("keeps dark land near-black — never cream ink", () => {
    const dark = buildPalette(darkTokens, true);
    const light = buildPalette(tokens, false);
    // Wave A: land is a warm near-black constant (hint of house ink, not pure
    // #000 and never the cream --ink). Decoupled from --ink-deep so it can sit
    // a hair warmer than the fog while still blending at the horizon.
    expect(dark.land).toBe("#0a0c11");
    expect(dark.land).not.toBe(darkTokens.ink);
    expect(lumSum(dark.land)).toBeLessThan(40); // unmistakably near-black
    expect(light.land).toBe(mixHex(tokens.paper, "#f4efe6", 0.35));
  });

  it("keeps dark roads legible but subordinate to product marks", () => {
    const dark = buildPalette(darkTokens, true);
    expect(dark.roadMajor).toBe("#66625c");
    expect(dark.road).toBe("#484542");
    expect(dark.roadMinor).toBe("#2c2a28");
    // Strict luminance hierarchy: major > secondary > minor > building > ground.
    expect(lumSum(dark.roadMajor)).toBeGreaterThan(lumSum(dark.road));
    expect(lumSum(dark.road)).toBeGreaterThan(lumSum(dark.roadMinor));
    expect(lumSum(dark.roadMinor)).toBeGreaterThan(lumSum(dark.building));
    expect(lumSum(dark.building)).toBeGreaterThan(lumSum(dark.land));
    // Roads provide context. They never compete with even muted interface text.
    expect(lumSum(dark.roadMajor)).toBeLessThan(lumSum(darkTokens.muted));
  });

  it("Wave A — dark buildings are a clear step above ground, warm, never a coral wash", () => {
    const dark = buildPalette(darkTokens, true);
    expect(dark.building).toBe("#2a241e");
    expect(dark.building).not.toBe(darkTokens.inkDeep);
    expect(dark.building).not.toBe(darkTokens.buildingEmissive);
    expect(dark.building).not.toBe(darkTokens.brass);
    expect(dark.building).not.toContain("255, 107, 122"); // old brass coral
    // Warm gray-brown: red channel ≥ green ≥ blue.
    const n = parseInt(dark.building.slice(1), 16);
    expect((n >> 16) & 255).toBeGreaterThanOrEqual((n >> 8) & 255);
    expect((n >> 8) & 255).toBeGreaterThanOrEqual(n & 255);
  });

  it("Wave A — dark water is a deep slate-blue, read as water at a glance", () => {
    const dark = buildPalette(darkTokens, true);
    // Solid deep slate-blue (was a low-alpha --river wash that near-black ground
    // drowned). Blue channel dominates, clearly above the ground floor.
    expect(dark.water).toBe("#224e78");
    const n = parseInt(dark.water.slice(1), 16);
    expect(n & 255).toBeGreaterThan((n >> 16) & 255); // blue > red → reads blue
    // The Thames is London's strongest wayfinder. Below about 2:1 against the
    // night ground it reads as slightly-darker land on a phone, so the whole
    // map becomes one dark field with only labels to navigate by.
    expect(contrast(dark.water, dark.land)).toBeGreaterThan(2);
  });

  it("Wave A — dark park is a dark desaturated green, distinct from the building brown", () => {
    const dark = buildPalette(darkTokens, true);
    const light = buildPalette(tokens, false);
    // Old formula washed --pint/--parkTint at low alpha; now a solid dark green
    // constant, hue-distinct from the warm building brown so parks never read
    // as building blocks.
    expect(dark.park).toBe("#384f2e");
    expect(dark.park).not.toBe(withAlpha(darkTokens.pint, 0.32));
    // Parks must read as geography, not as a slightly different shade of night.
    // Widen the LUMINANCE to earn that, never the saturation: a park that grows
    // toward --pint starts reading as a cheap-pint pin.
    expect(contrast(dark.park, dark.land)).toBeGreaterThan(2);
    expect(saturationPct(dark.park)).toBeLessThan(45);
    const n = parseInt(dark.park.slice(1), 16);
    expect((n >> 8) & 255).toBeGreaterThan((n >> 16) & 255); // green > red → reads green
    expect((n >> 8) & 255).toBeGreaterThan(n & 255); // green > blue
    // Light park is UNTOUCHED by Wave A — still the parkTint wash.
    expect(light.park).not.toBe(withAlpha(tokens.pint, 0.26));
    expect(light.park).toContain("126, 160, 82"); // tokens.parkTint rgb
  });

  it("M4 — light water is a calmer translucent wash, not the loud opaque cyan", () => {
    const light = buildPalette(tokens, false);
    // Old behaviour painted the fully-opaque riverBright cyan directly.
    expect(light.water).not.toBe(tokens.riverBright);
    expect(light.water).toMatch(/^rgba\(/);
    expect(light.water).toContain("47, 111, 143"); // tokens.river rgb
  });

  it("M4 — light roads read brighter than land, with a major/minor tier", () => {
    const light = buildPalette(tokens, false);
    // Neither tier is the old flat brass/coral wash.
    expect(light.road).not.toContain("176, 129, 58"); // old brass rgb
    expect(light.roadMajor).not.toContain("176, 129, 58");
    // Major tier is a distinct, warmer step from the near-white minor tier.
    expect(light.road).not.toBe(light.roadMajor);
  });

  it("applies land/water/road/building paints when layers exist", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layers = new Set([
      "background",
      "park",
      "water",
      "road_major",
      "highway_minor",
      "highway_major_inner",
      "building",
      "landuse_residential",
      "landuse_park",
      "mystery",
    ]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      getStyle: () => ({
        layers: [
          { id: "background", type: "background" },
          { id: "park", type: "fill" },
          { id: "water", type: "fill" },
          { id: "road_major", type: "line" },
          { id: "highway_minor", type: "line" },
          { id: "highway_major_inner", type: "line" },
          { id: "building", type: "fill" },
          { id: "landuse_residential", type: "fill" },
          { id: "landuse_park", type: "fill" },
        ],
      }),
    };

    applyBasemapTaste(map, darkTokens, true);

    const bg = paints.find(([id, prop]) => id === "background" && prop === "background-color");
    expect(bg?.[2]).toBe("#0a0c11"); // neon-noir near-black ground

    expect(paints.some(([id, prop]) => id === "park" && prop === "fill-color")).toBe(true);
    expect(paints.some(([id, prop]) => id === "water" && prop === "fill-color")).toBe(true);
    expect(paints.some(([id, prop]) => id === "road_major" && prop === "line-color")).toBe(true);
    expect(paints.some(([id, prop]) => id === "highway_minor" && prop === "line-color")).toBe(true);
    expect(
      paints.some(([id, prop]) => id === "highway_major_inner" && prop === "line-color"),
    ).toBe(true);
    expect(paints.some(([id, prop]) => id === "building" && prop === "fill-color")).toBe(true);
    expect(
      paints.find(([id, prop]) => id === "building" && prop === "fill-opacity")?.[2],
    ).toBe(0.92);
    expect(
      paints.find(([id, prop]) => id === "building" && prop === "fill-outline-color")?.[2],
    ).toBe("rgba(140,132,122,0.3)"); // warm light edge
    expect(
      paints.some(([id, prop]) => id === "landuse_residential" && prop === "fill-color"),
    ).toBe(true);
  });

  it("makes dark road labels quieter than place labels", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layouts: Array<[string, string, unknown]> = [];
    const layers = [
      { id: "road_label", type: "symbol" },
      { id: "place_city", type: "symbol" },
      // OpenFreeMap's `place_other` layer carries neighbourhood features.
      { id: "place_other", type: "symbol" },
      { id: "poi_pub", type: "symbol" },
      // CARTO/OFM generic POI layer: every category at once, so it stays generic.
      { id: "poi_label", type: "symbol" },
    ];
    const map = {
      getLayer: (id: string) => layers.find((layer) => layer.id === id),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      setLayoutProperty: (layerId: string, name: string, value: unknown) => {
        layouts.push([layerId, name, value]);
      },
      getStyle: () => ({ layers }),
    };

    applyBasemapTaste(map, darkTokens, true);

    expect(
      paints.find(([id, prop]) => id === "road_label" && prop === "text-opacity")?.[2],
    ).toBe(0.45);
    expect(
      paints.find(([id, prop]) => id === "place_city" && prop === "text-opacity")?.[2],
    ).toBe(0.72);
    expect(
      paints.find(([id, prop]) => id === "place_other" && prop === "text-opacity")?.[2],
    ).toBe(0.38);
    expect(
      layouts.find(([id, prop]) => id === "place_other" && prop === "text-size")?.[2],
    ).toBe(9);
    expect(
      paints.find(([id, prop]) => id === "poi_pub" && prop === "text-opacity")?.[2],
    ).toBe(0.86);
    expect(
      layouts.find(([id, prop]) => id === "poi_pub" && prop === "text-size")?.[2],
    ).toBe(10);
    expect(
      paints.find(([id, prop]) => id === "poi_label" && prop === "text-opacity")?.[2],
    ).toBe(0.72);
    expect(
      layouts.find(([id, prop]) => id === "poi_label" && prop === "text-size"),
    ).toBeUndefined();
    expect(
      paints.find(([id, prop]) => id === "poi_pub" && prop === "text-opacity")?.[2],
    ).toBeGreaterThan(
      paints.find(([id, prop]) => id === "place_other" && prop === "text-opacity")?.[2] as number,
    );
  });

  it("treats live positron label_other as neighbourhood tier, not poi_barber as pub", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layouts: Array<[string, string, unknown]> = [];
    const layers = [
      { id: "label_other", type: "symbol" },
      { id: "poi_barber_label", type: "symbol" },
      { id: "poi_bar_label", type: "symbol" },
    ];
    const map = {
      getLayer: (id: string) => layers.find((layer) => layer.id === id),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      setLayoutProperty: (layerId: string, name: string, value: unknown) => {
        layouts.push([layerId, name, value]);
      },
      getStyle: () => ({ layers }),
    };

    applyBasemapTaste(map, darkTokens, true);

    expect(
      paints.find(([id, prop]) => id === "label_other" && prop === "text-opacity")?.[2],
    ).toBe(0.38);
    expect(
      layouts.find(([id, prop]) => id === "label_other" && prop === "text-size")?.[2],
    ).toBe(9);
    expect(
      paints.find(([id, prop]) => id === "poi_barber_label" && prop === "text-opacity")?.[2],
    ).toBe(0.72);
    expect(
      layouts.find(([id, prop]) => id === "poi_barber_label" && prop === "text-size"),
    ).toBeUndefined();
    expect(
      paints.find(([id, prop]) => id === "poi_bar_label" && prop === "text-opacity")?.[2],
    ).toBe(0.86);
    expect(
      layouts.find(([id, prop]) => id === "poi_bar_label" && prop === "text-size")?.[2],
    ).toBe(10);
  });

  it("withholds pub styling from generic POI layers that name no drink", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layouts: Array<[string, string, unknown]> = [];
    // CARTO Positron and OpenFreeMap each ship ONE generic POI layer carrying
    // every category, so pub opacity/sizing here would promote cash machines.
    const layers = [
      { id: "poi_label", type: "symbol" },
      { id: "poi_name", type: "symbol" },
      { id: "pois-label", type: "symbol" },
      { id: "poi-name", type: "symbol" },
      // A non-POI id can contain `poi` as part of another token.
      { id: "point_bar_label", type: "symbol" },
      // Named drink categories still earn pub treatment, including plurals.
      { id: "poi_pub_label", type: "symbol" },
      { id: "poi_bars_label", type: "symbol" },
      { id: "poi_beer_name", type: "symbol" },
      { id: "poi_brewery_name", type: "symbol" },
      { id: "pois-pubs-label", type: "symbol" },
      { id: "poi_breweries_name", type: "symbol" },
    ];
    const map = {
      getLayer: (id: string) => layers.find((layer) => layer.id === id),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      setLayoutProperty: (layerId: string, name: string, value: unknown) => {
        layouts.push([layerId, name, value]);
      },
      getStyle: () => ({ layers }),
    };

    applyBasemapTaste(map, darkTokens, true);

    for (const generic of [
      "poi_label",
      "poi_name",
      "pois-label",
      "poi-name",
      "point_bar_label",
    ]) {
      expect(
        paints.find(([id, prop]) => id === generic && prop === "text-opacity")?.[2],
      ).toBe(0.72);
      expect(
        layouts.find(([id, prop]) => id === generic && prop === "text-size"),
      ).toBeUndefined();
    }

    for (const drink of [
      "poi_pub_label",
      "poi_bars_label",
      "poi_beer_name",
      "poi_brewery_name",
      "pois-pubs-label",
      "poi_breweries_name",
    ]) {
      expect(
        paints.find(([id, prop]) => id === drink && prop === "text-opacity")?.[2],
      ).toBe(0.86);
      expect(
        layouts.find(([id, prop]) => id === drink && prop === "text-size")?.[2],
      ).toBe(10);
    }
  });

  it("treats CARTO place_town as neighbourhood tier, not city tier", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layouts: Array<[string, string, unknown]> = [];
    const layers = [
      { id: "place_town", type: "symbol" },
      { id: "place_hamlet", type: "symbol" },
      // City tier must stay louder — `place_town` sits below it, not beside it.
      { id: "place_city", type: "symbol" },
    ];
    const map = {
      getLayer: (id: string) => layers.find((layer) => layer.id === id),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      setLayoutProperty: (layerId: string, name: string, value: unknown) => {
        layouts.push([layerId, name, value]);
      },
      getStyle: () => ({ layers }),
    };

    applyBasemapTaste(map, darkTokens, true);

    expect(
      paints.find(([id, prop]) => id === "place_town" && prop === "text-opacity")?.[2],
    ).toBe(0.38);
    expect(
      layouts.find(([id, prop]) => id === "place_town" && prop === "text-size")?.[2],
    ).toBe(9);
    expect(
      paints.find(([id, prop]) => id === "place_town" && prop === "text-opacity")?.[2],
    ).toBe(
      paints.find(([id, prop]) => id === "place_hamlet" && prop === "text-opacity")?.[2],
    );
    expect(
      paints.find(([id, prop]) => id === "place_city" && prop === "text-opacity")?.[2],
    ).toBe(0.72);
  });

  it("does not rewrite label layout that already matches", () => {
    const paintWrites: Array<[string, string, unknown]> = [];
    const layoutWrites: Array<[string, string, unknown]> = [];
    const layers = [{ id: "place_other", type: "symbol" }];
    const map = {
      getLayer: (id: string) => layers.find((layer) => layer.id === id),
      getPaintProperty: (_layerId: string, name: string) =>
        ({
          "text-color": darkTokens.ink,
          "text-halo-color": darkTokens.inkDeep,
          "text-halo-width": 1.15,
          "text-opacity": 0.38,
        })[name],
      getLayoutProperty: (_layerId: string, name: string) =>
        name === "text-size" ? 9 : name === "text-letter-spacing" ? 0.04 : undefined,
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paintWrites.push([layerId, name, value]);
      },
      setLayoutProperty: (layerId: string, name: string, value: unknown) => {
        layoutWrites.push([layerId, name, value]);
      },
      getStyle: () => ({ layers }),
    };

    applyBasemapTaste(map, darkTokens, true);

    expect(paintWrites).toEqual([]);
    expect(layoutWrites).toEqual([]);
  });

  it("skips missing layers without throwing", () => {
    const map = {
      getLayer: () => undefined,
      setPaintProperty: vi.fn(),
      getStyle: () => ({ layers: [] }),
    };
    expect(() => applyBasemapTaste(map, darkTokens, true)).not.toThrow();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it("keeps painting when a basemap getter rejects an optional property", () => {
    const paints: Array<[string, string, unknown]> = [];
    const map = {
      getLayer: (id: string) => (id === "background" ? { id } : undefined),
      getPaintProperty: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'value')");
      },
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      getStyle: () => ({ layers: [{ id: "background", type: "background" }] }),
    };

    expect(() => applyBasemapTaste(map, darkTokens, true)).not.toThrow();
    expect(paints).toContainEqual(["background", "background-color", "#0a0c11"]);
  });

  it("does not force night-black casings in light mode", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layers = new Set(["highway_major_casing", "road_minor"]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      getStyle: () => ({
        layers: [
          { id: "highway_major_casing", type: "line" },
          { id: "road_minor", type: "line" },
        ],
      }),
    };

    applyBasemapTaste(map, tokens, false);

    expect(
      paints.some(([id, prop]) => id === "highway_major_casing" && prop === "line-color"),
    ).toBe(false);
    expect(paints.some(([id, prop]) => id === "road_minor" && prop === "line-color")).toBe(true);
  });

  it("discovered pass does not repaint known layers (no double-paint)", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layers = new Set(["road_major", "highway_major_casing", "custom_road_layer"]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      getStyle: () => ({
        layers: [
          // Known layers — should only be painted once by paintKnownLayers
          { id: "road_major", type: "line" },
          { id: "highway_major_casing", type: "line" },
          // Unknown layer — should be painted by the discovered pass
          { id: "custom_road_layer", type: "line" },
        ],
      }),
    };

    applyBasemapTaste(map, darkTokens, true);

    // Known layers: each painted exactly once (by paintKnownLayers only)
    const roadMajorPaints = paints.filter(([id]) => id === "road_major");
    expect(roadMajorPaints.length).toBe(1);

    // Discovered-only layer must still be painted
    expect(paints.some(([id]) => id === "custom_road_layer")).toBe(true);
  });

  it("colours fallback clusters by their most common known pint-price band", () => {
    const expr = clusterCircleColorExpr(tokens, false) as unknown[];
    const serialized = JSON.stringify(expr);

    expect(expr[0]).toBe("case");
    expect(serialized).toContain('"b0"');
    expect(serialized).toContain('"b1"');
    expect(serialized).toContain('"b2"');
    expect(serialized).not.toContain('"point_count"');
    expect(serialized).toContain("47, 143, 91"); // pint rgb
    expect(serialized).toContain("217, 159, 69"); // amber
    expect(serialized).toContain("209, 99, 83"); // brick
    expect(serialized).toContain("107, 114, 106"); // no known price
  });

  it.each([
    {
      name: "cheap wins a three-way tie",
      properties: { b0: 2, b1: 2, b2: 2 },
      expected: withAlpha(tokens.pint, 0.9),
    },
    {
      name: "middle wins a middle-dear tie",
      properties: { b0: 0, b1: 3, b2: 3 },
      expected: withAlpha(tokens.amber, 0.92),
    },
    {
      name: "dear wins when it has the largest count",
      properties: { b0: 1, b1: 2, b2: 4 },
      expected: withAlpha(tokens.brick, 0.88),
    },
    {
      name: "unknown pubs do not outvote a known band",
      properties: { b0: 1, b1: 0, b2: 0, b3: 99 },
      expected: withAlpha(tokens.pint, 0.9),
    },
    {
      name: "all unknown is grey",
      properties: { b0: 0, b1: 0, b2: 0, b3: 12 },
      expected: withAlpha(tokens.muted, 0.84),
    },
    {
      name: "missing counts are grey",
      properties: {},
      expected: withAlpha(tokens.muted, 0.84),
    },
  ])("$name", ({ properties, expected }) => {
    expect(
      evaluateClusterExpression(
        clusterCircleColorExpr(tokens, false),
        properties,
      ),
    ).toBe(expected);
  });
});

describe("mixHex (M4 token-derivation primitive)", () => {
  it("returns hexA unchanged at t=0 and hexB at t=1", () => {
    expect(mixHex("#ffffff", "#f2a71b", 0)).toBe("#ffffff");
    expect(mixHex("#ffffff", "#f2a71b", 1)).toBe("#f2a71b");
  });

  it("blends channel-wise at a mid ratio", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("clamps out-of-range ratios instead of extrapolating", () => {
    expect(mixHex("#000000", "#ffffff", 2)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", -1)).toBe("#000000");
  });

  it("falls back to hexA for malformed input rather than throwing", () => {
    expect(mixHex("not-a-color", "#ffffff", 0.5)).toBe("not-a-color");
  });
});

describe("M2 · POI-at-initiation selection mute", () => {
  describe("isBasemapSelectionMuteLayer (pure classifier)", () => {
    it("matches baked transit / POI / street-name symbol layers", () => {
      for (const id of [
        "poi_z16",
        "poi_transit",
        "poi_label",
        "road_label",
        "road_shield",
        "highway-name-path",
        "transit_stop_label",
        "railway_station_label",
        "airport-label",
      ]) {
        expect(isBasemapSelectionMuteLayer(id, "symbol")).toBe(true);
      }
    });

    it("leaves place / water labels and road GEOMETRY untouched", () => {
      // Place + water labels are legit overview context — never muted.
      for (const id of [
        "place_city",
        "place_suburb",
        "place_country_1",
        "water_name",
        "waterway-name",
        "mountain_peak",
      ]) {
        expect(isBasemapSelectionMuteLayer(id, "symbol")).toBe(false);
      }
      // Road/water GEOMETRY are line/fill layers, not symbols — out of scope.
      expect(isBasemapSelectionMuteLayer("road_major", "line")).toBe(false);
      expect(isBasemapSelectionMuteLayer("water", "fill")).toBe(false);
      expect(isBasemapSelectionMuteLayer("background", "background")).toBe(false);
    });

    it("skips our own app layers (they are muted by explicit id, not the classifier)", () => {
      for (const id of [
        "pois-label",
        "pois-transport-major",
        "pubs-point",
        "tube-lines-color",
        "landmarks-label",
        "landmarks-icon",
        "route-line",
        "tonight-point",
      ]) {
        expect(isBasemapSelectionMuteLayer(id, "symbol")).toBe(false);
      }
    });
  });

  // A minimal fake map: layers with per-prop paint values that getPaintProperty
  // reads back and setPaintProperty mutates, so we can assert snapshot/restore.
  function makeMuteMap() {
    const paint: Record<string, Record<string, unknown>> = {
      // Baked basemap symbol (should be muted).
      poi_label: { "text-opacity": 0.9 },
      road_label: { "text-opacity": 1 },
      // Baked place label (should be LEFT ALONE).
      place_city: { "text-opacity": 0.95 },
      // Our own app layers (muted by explicit id list).
      "pois-label": { "text-opacity": 0.88 },
      "tube-lines-color": { "line-opacity": ["interpolate"] },
      "landmarks-label": { "text-opacity": 0.86 },
      "landmarks-icon": { "icon-opacity": 1 },
    };
    const layerTypes: Record<string, string> = {
      poi_label: "symbol",
      road_label: "symbol",
      place_city: "symbol",
      "pois-label": "symbol",
      "tube-lines-color": "line",
      "landmarks-label": "symbol",
      "landmarks-icon": "symbol",
    };
    return {
      paint,
      getLayer: (id: string) => (paint[id] ? { id } : undefined),
      getPaintProperty: (id: string, prop: string) => paint[id]?.[prop],
      setPaintProperty: (id: string, prop: string, value: unknown) => {
        (paint[id] ??= {})[prop] = value;
      },
      getStyle: () => ({
        layers: Object.keys(layerTypes).map((id) => ({ id, type: layerTypes[id] })),
      }),
    };
  }

  it("mutes basemap + app label layers on selection, leaves place labels alone", () => {
    const map = makeMuteMap();
    const store = new Map<string, unknown>();
    applySelectionMute(map, true, store);

    // Issue #222 — the muted value is min(original, 0.12), not a flat 0.12.
    expect(map.paint.poi_label["text-opacity"]).toEqual(["min", 0.9, SELECTION_MUTE_OPACITY]);
    expect(map.paint.road_label["text-opacity"]).toEqual(["min", 1, SELECTION_MUTE_OPACITY]);
    expect(map.paint["pois-label"]["text-opacity"]).toEqual(["min", 0.88, SELECTION_MUTE_OPACITY]);
    expect(map.paint["tube-lines-color"]["line-opacity"]).toEqual([
      "min",
      ["interpolate"],
      SELECTION_MUTE_OPACITY,
    ]);
    expect(map.paint["landmarks-label"]["text-opacity"]).toEqual([
      "min",
      0.86,
      SELECTION_MUTE_OPACITY,
    ]);
    expect(map.paint["landmarks-icon"]["icon-opacity"]).toEqual(["min", 1, SELECTION_MUTE_OPACITY]);
    // Place labels are overview context — untouched.
    expect(map.paint.place_city["text-opacity"]).toBe(0.95);
  });

  it("restores EXACT originals on deselect (idempotent select/deselect cycles)", () => {
    const map = makeMuteMap();
    const store = new Map<string, unknown>();
    const before = JSON.stringify(map.paint);

    // Two select→deselect cycles must land back on the exact original paint.
    for (let i = 0; i < 2; i++) {
      applySelectionMute(map, true, store);
      applySelectionMute(map, false, store);
      expect(JSON.stringify(map.paint)).toBe(before);
      expect(store.size).toBe(0);
    }
  });

  it("re-muting while already muted does not clobber the stored original", () => {
    const map = makeMuteMap();
    const store = new Map<string, unknown>();
    applySelectionMute(map, true, store); // captures 0.9
    applySelectionMute(map, true, store); // must NOT capture the muted 0.12
    expect(store.get("poi_label::text-opacity")).toBe(0.9);
    applySelectionMute(map, false, store);
    expect(map.paint.poi_label["text-opacity"]).toBe(0.9);
  });

  it("restores an unset paint prop to style default via undefined", () => {
    const map = makeMuteMap();
    // road_label has text-opacity but no icon-opacity — snapshot must be undefined.
    const store = new Map<string, unknown>();
    applySelectionMute(map, true, store);
    expect(store.get("road_label::icon-opacity")).toBeUndefined();
    applySelectionMute(map, false, store);
    // Restored to undefined (style default), not left at the mute value.
    expect(map.paint.road_label["icon-opacity"]).toBeUndefined();
  });
});

describe("muteOpacityExpr (issue #222 — mute must only ever attenuate)", () => {
  it("wraps the original in a min() against the mute floor", () => {
    expect(muteOpacityExpr(0.9, SELECTION_MUTE_OPACITY)).toEqual(["min", 0.9, SELECTION_MUTE_OPACITY]);
  });

  it("defaults a missing (unset) original to the style spec's opacity default of 1", () => {
    expect(muteOpacityExpr(undefined, SELECTION_MUTE_OPACITY)).toEqual(["min", 1, SELECTION_MUTE_OPACITY]);
    expect(muteOpacityExpr(null, SELECTION_MUTE_OPACITY)).toEqual(["min", 1, SELECTION_MUTE_OPACITY]);
  });

  it("never raises a zoom-ramped original that dips below the mute floor", () => {
    // pois-transport-minor's real icon-opacity ramp (buildScene.ts): 0 at
    // zoom 12.4, 1 by zoom 13.1. At the low end it's already invisible (0) —
    // min(0, 0.12) must stay 0, not jump to 0.12 and pop the icon visible.
    const expr = muteOpacityExpr(0, SELECTION_MUTE_OPACITY) as [string, number, number];
    expect(expr).toEqual(["min", 0, SELECTION_MUTE_OPACITY]);
    expect(expr[1]).toBe(0); // the pre-mute original, verbatim — never rewritten upward
  });

  it("preserves a zoom-ramp original expression verbatim inside min()", () => {
    const original = ["interpolate", ["linear"], ["zoom"], 12.4, 0, 13.1, 1];

    expect(muteOpacityExpr(original, SELECTION_MUTE_OPACITY)).toEqual([
      "min",
      original,
      SELECTION_MUTE_OPACITY,
    ]);
  });

  it("still attenuates a plain original that sits above the mute floor", () => {
    const expr = muteOpacityExpr(0.98, SELECTION_MUTE_OPACITY) as [string, number, number];
    expect(expr[2]).toBe(SELECTION_MUTE_OPACITY);
  });
});

describe("style.load recapture path (applySelectionState, buildScene.ts)", () => {
  // A minimal SceneCtx-shaped fake: applySelectionState only reads
  // map/selectionMuteStore/selectedId off ctx, so the rest can stay absent.
  function makeCtx(map: unknown, store: Map<string, unknown>, selectedId: string): SceneCtx {
    return { map, selectionMuteStore: store, selectedId } as unknown as SceneCtx;
  }

  it("clears stale originals from the old style and re-snapshots fresh ones from the new style", () => {
    // Simulate the NEW style's freshly-rebuilt pois-transport-minor layer,
    // caught at the low end of its zoom ramp (icon-opacity 0 — invisible).
    const paint: Record<string, Record<string, unknown>> = {
      "pois-transport-minor": { "icon-opacity": 0 },
    };
    const map = {
      getLayer: (id: string) => (paint[id] ? { id } : undefined),
      getPaintProperty: (id: string, prop: string) => paint[id]?.[prop],
      setPaintProperty: (id: string, prop: string, value: unknown) => {
        (paint[id] ??= {})[prop] = value;
      },
      getStyle: () => ({ layers: [{ id: "pois-transport-minor", type: "symbol" }] }),
    };

    // A STALE store entry left over from the OLD style — e.g. a moment where
    // the layer's icon-opacity happened to be 0.9 pre-mute. If this survived
    // the reload, muteOpacityExpr(0.9, 0.12) === min(0.9, 0.12) = 0.12 would
    // raise the fresh (0-opacity) layer visible, reintroducing #222.
    const store = new Map<string, unknown>([["pois-transport-minor::icon-opacity", 0.9]]);

    applySelectionState(makeCtx(map, store, "venue-1"));

    // The stale 0.9 must be gone — re-snapshotted from the NEW style's own
    // fresh paint value (0), not reused from before the reload.
    expect(store.get("pois-transport-minor::icon-opacity")).toBe(0);
    // The muted paint attenuates the FRESH original, never the stale one —
    // min(0, 0.12) stays 0, not min(0.9, 0.12) = 0.12 (a raise).
    expect(paint["pois-transport-minor"]["icon-opacity"]).toEqual(["min", 0, SELECTION_MUTE_OPACITY]);
  });

  it("with nothing selected, a reload is a pure clear — no mute is (re)applied", () => {
    const setPaintProperty = vi.fn();
    const map = {
      getLayer: () => ({ id: "pois-transport-minor" }),
      getPaintProperty: () => 0,
      setPaintProperty,
      getStyle: () => ({ layers: [] }),
    };
    const store = new Map<string, unknown>([["stale::key", 1]]);

    applySelectionState(makeCtx(map, store, ""));

    expect(store.size).toBe(0);
    expect(setPaintProperty).not.toHaveBeenCalled();
  });

  it("full round-trip: setStyle → style.load re-mute → deselect restores the FRESH original, not the stale one", () => {
    // Issue #222 item 2 — the whole chain, not just the recapture half. The NEW
    // style's pois-transport-minor sits mid-ramp at icon-opacity 0.7 (a value
    // that DIFFERS from the stale 0.9 the old style left behind), so a restore
    // that replayed the stale snapshot instead of the freshly-recaptured one
    // would be observable.
    const paint: Record<string, Record<string, unknown>> = {
      "pois-transport-minor": { "icon-opacity": 0.7 },
    };
    const map = {
      getLayer: (id: string) => (paint[id] ? { id } : undefined),
      getPaintProperty: (id: string, prop: string) => paint[id]?.[prop],
      setPaintProperty: (id: string, prop: string, value: unknown) => {
        (paint[id] ??= {})[prop] = value;
      },
      getStyle: () => ({ layers: [{ id: "pois-transport-minor", type: "symbol" }] }),
    };
    // Stale leftover from the OLD style — must never leak into the restore.
    const store = new Map<string, unknown>([["pois-transport-minor::icon-opacity", 0.9]]);

    // style.load with a venue still selected: clear stale, recapture fresh, mute.
    applySelectionState(makeCtx(map, store, "venue-1"));
    expect(store.get("pois-transport-minor::icon-opacity")).toBe(0.7); // fresh, not 0.9
    expect(paint["pois-transport-minor"]["icon-opacity"]).toEqual([
      "min",
      0.7,
      SELECTION_MUTE_OPACITY,
    ]);

    // Deselect: restore must land on the FRESH original (0.7), and clear.
    applySelectionMute(map, false, store);
    expect(paint["pois-transport-minor"]["icon-opacity"]).toBe(0.7);
    expect(store.size).toBe(0);
  });
});
