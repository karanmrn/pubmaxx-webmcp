import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { venuePinEdgeTokens } from "@/components/map/canvas/tokens";
import {
  BUILDING_EXTRUSION_OPACITY,
  UK_BASE_ICON_OPACITY,
} from "@/components/map/canvas/buildScene";
import { buildPalette, mixHex } from "@/lib/mapBasemapTaste";
import {
  BASE_PUB_DARK_RING_OPACITY,
  BASE_PUB_RING_COLOR,
  BASE_PUB_RING_OPACITY,
  UNPRICED_PIN_FILL,
  VENUE_PIN_FILL_TOKEN,
} from "@/lib/mapIcons";

// The dark theme's own values, read from the SHIPPED stylesheet rather than
// restated here. That is the whole point of this file: the defect it guards
// against was a token whose dark value contradicted the code's comment about it
// (`--paper` is a near-black in dark, so a "light rim on saturated glasses" was
// a black rim on a near-black basemap). A restated copy of the palette could not
// have caught that, and cannot catch the next one.
const themeCss = readFileSync(join(process.cwd(), "app/theme.css"), "utf8");
// The LIGHT palette, read from its own shipped stylesheet for the same reason.
const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function darkBlock(): string {
  const start = themeCss.indexOf('html[data-theme="dark"] {');
  expect(start).toBeGreaterThan(-1);
  // Up to the first rule that closes at column 0 — the block is flat.
  const end = themeCss.indexOf("\n}", start);
  return themeCss.slice(start, end);
}

function darkToken(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(darkBlock());
  expect(match, `${name} must be a plain hex in the dark theme block`).toBeTruthy();
  return match![1].toLowerCase();
}

function lightBlock(): string {
  const start = globalsCss.indexOf(":root {");
  expect(start).toBeGreaterThan(-1);
  const end = globalsCss.indexOf("\n}", start);
  return globalsCss.slice(start, end);
}

function lightToken(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(lightBlock());
  expect(match, `${name} must be a plain hex in the light :root block`).toBeTruthy();
  return match![1].toLowerCase();
}

const LIGHT = {
  paper: lightToken("--paper"),
  panel: lightToken("--panel"),
  pint: lightToken("--pint"),
  amber: lightToken("--amber"),
  brick: lightToken("--brick"),
  brass: lightToken("--brass"),
};

const DARK = {
  ink: darkToken("--ink"),
  inkDeep: darkToken("--ink-deep"),
  paper: darkToken("--paper"),
  pint: darkToken("--pint"),
  amber: darkToken("--amber"),
  brick: darkToken("--brick"),
  parkTint: darkToken("--map-park-tint"),
  buildingEmissive: darkToken("--map-building-emissive"),
};

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two opaque hex colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every opaque tone the dark basemap paints UNDER a pin. Roads now sit behind
// product marks, but the two-tone edge remains a robust boundary over every
// land, water, building, and road tier.
// `buildPalette` ignores `tokens` on its dark branch (lib/mapBasemapTaste.ts
// returns the hardcoded DARK constants there), so every key below is an inert
// placeholder that satisfies the type and feeds nothing under test.
const IGNORED_ON_DARK = "#000000";
const palette = buildPalette(
  {
    paper: IGNORED_ON_DARK,
    panelRaised: IGNORED_ON_DARK,
    ink: IGNORED_ON_DARK,
    inkDeep: IGNORED_ON_DARK,
    line: IGNORED_ON_DARK,
    muted: IGNORED_ON_DARK,
    pint: IGNORED_ON_DARK,
    amber: IGNORED_ON_DARK,
    brass: IGNORED_ON_DARK,
    river: IGNORED_ON_DARK,
    riverBright: IGNORED_ON_DARK,
    buildingEmissive: IGNORED_ON_DARK,
    parkTint: IGNORED_ON_DARK,
  },
  true,
);

// A building's roof under the 3-D massing pass: the 2-D footprint fill with
// `buildings-3d` composited over it at its hard opacity ceiling. This is the
// brightest thing a pin routinely stands on that is not a road, i.e. the
// "dark buildings" the bug report named.
const massedBuilding = mixHex(
  palette.building,
  DARK.buildingEmissive,
  BUILDING_EXTRUSION_OPACITY,
);

const BACKGROUNDS: Record<string, string> = {
  ground: palette.land,
  landSoft: palette.landSoft,
  residential: palette.residential,
  park: palette.park,
  building: palette.building,
  "building + 3-D massing": massedBuilding,
  water: palette.water,
  "road (minor)": palette.roadMinor,
  "road (secondary)": palette.road,
  "road (major)": palette.roadMajor,
};

const BAND_FILL: Record<string, string> = {
  "0 (<=GBP5.50)": DARK.pint,
  "1 (<=GBP7.00)": DARK.amber,
  "2 (>GBP7.00)": DARK.brick,
  "3 (unpriced)": UNPRICED_PIN_FILL,
};

/** WCAG SC 1.4.11's bar for a non-text graphical object. */
const EDGE_MIN = 3;

describe("dark-mode pin band contrast", () => {
  const edge = venuePinEdgeTokens({ ink: DARK.ink, inkDeep: DARK.inkDeep }, true);

  it("publishes a rim and a casing in dark, and neither in light", () => {
    expect(edge).toEqual({ pinRim: DARK.ink, pinCasing: DARK.inkDeep });
    // Light mode keeps the per-band rim the glasses have always had, so these
    // edge tokens move no light-theme pixel. (The coupe's bowl is deeper in
    // both themes now — a separate, deliberate geometry change, recorded in
    // docs/evidence/dark-pin-edge/README.md as the one visible light-mode
    // difference.)
    expect(venuePinEdgeTokens({ ink: DARK.ink, inkDeep: DARK.inkDeep }, false)).toEqual({});
  });

  it("introduces no new colour: the edge reuses the map's label tones", () => {
    // --ink over --ink-deep is exactly the pairing the price tag beside the pin
    // already uses (text-color / text-halo-color in buildScene). Reusing it is
    // what keeps the edge clear of every ring semantic on this map: brass
    // (selection, scraped), river (Pint Drops, provisional badge), the what's-on
    // accents, the band halo, and the base layer's sockets.
    expect([edge.pinRim, edge.pinCasing]).toEqual([DARK.ink, DARK.inkDeep]);
    expect(Object.values(BAND_FILL)).toEqual([
      DARK.pint,
      DARK.amber,
      DARK.brick,
      UNPRICED_PIN_FILL,
    ]);
  });

  it("keeps four bands, in the same order, fed by the same tokens", () => {
    expect(VENUE_PIN_FILL_TOKEN).toEqual(["pint", "amber", "brick", null]);
  });

  it("gives every pin an edge over every dark basemap tone", () => {
    const failures: string[] = [];
    for (const [name, background] of Object.entries(BACKGROUNDS)) {
      // The rim and the casing are opposite luminances, so the pin's edge on any
      // background is whichever of the two separates from it.
      const best = Math.max(
        contrast(edge.pinRim!, background),
        contrast(edge.pinCasing!, background),
      );
      if (best < EDGE_MIN) failures.push(`${name} ${background}: ${best.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it("keeps the historical near-black rim defect impossible", () => {
    // Before the fix the rim was `paper`, which buildScene resolves to
    // `--ink-deep` in dark: a black rim, within 1.1:1 of dark land.
    expect(contrast(DARK.inkDeep, palette.land)).toBeLessThan(1.2);
    expect(contrast(edge.pinRim!, palette.land)).toBeGreaterThanOrEqual(EDGE_MIN);
  });

  it("keeps the >GBP7 band the weakest fill on the buildings the report named", () => {
    // No band's fill has to clear a bar on its own any more - that is what the
    // edge above is for - but the ORDERING is the diagnosis, so it stays pinned.
    // Measured on the 3-D massed building tone, the two lowest-luminance bands
    // sit at ~3.1:1 and ~2.4:1, which is why a pin whose edge is invisible there
    // is a pin you cannot find.
    expect(contrast(DARK.brick, massedBuilding)).toBeLessThan(
      contrast(DARK.pint, massedBuilding),
    );
    expect(contrast(DARK.brick, massedBuilding)).toBeLessThan(
      contrast(DARK.amber, massedBuilding),
    );
  });
});

// "This pint is dear" and "press this" are two different sentences, so they may
// never be one colour. Light shipped them byte-identical (#ff5a5f both), on the
// surface whose entire argument is price; dark had always separated them. This
// is the fence that keeps both themes honest.
describe("the dear band is never the CTA colour", () => {
  it("keeps --brick and --brass apart in both themes", () => {
    expect(LIGHT.brick).not.toBe(LIGHT.brass);
    expect(darkToken("--brick")).not.toBe(darkToken("--brass"));
  });

  it("keeps the three light price bands distinct from each other", () => {
    const bands = [LIGHT.pint, LIGHT.amber, LIGHT.brick];
    expect(new Set(bands).size).toBe(3);
  });

  it("keeps the light dear band legible as destructive text", () => {
    // --color-negative is --brick, so the same token carries a refusal sentence
    // on the light elevation ladder. The recessed well is its darkest step.
    expect(contrast(LIGHT.brick, LIGHT.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT.brick, LIGHT.panel)).toBeGreaterThanOrEqual(4.5);
  });
});

// A base pub is second-class, not invisible.
//
// DEFECT (captain, live, 2026-09-01): browsing Cumbria, the map answered with
// no pubs at all while the banner said the town's pubs were on the map. They
// were: the shards loaded, the features were placed in `uk-base-point`, the
// icon was registered. It was drawn as a 0.6-alpha bark ring over a `paper`
// backing disc, and `paper` is a near-black in dark - the SAME defect the
// drink pins were fixed for, repeated on the layer that covers the country.
//
// The fix gives this mark the same two-tone edge the bands take, from the same
// tokens, so the two cannot drift apart again.
describe("dark-mode base pub pin", () => {
  const edge = venuePinEdgeTokens({ ink: DARK.ink, inkDeep: DARK.inkDeep }, true);

  /** The tone actually laid down: icon alpha, then the layer's own opacity. */
  function laid(background: string, ink: string, alpha: number): string {
    return mixHex(background, ink, alpha * UK_BASE_ICON_OPACITY);
  }

  it("takes the shared edge tokens rather than a colour of its own", () => {
    const source = readFileSync(join(process.cwd(), "lib/mapIcons.ts"), "utf8");
    const draw = source.slice(source.indexOf("function drawBasePub"));
    const body = draw.slice(0, draw.indexOf("\n}"));
    expect(body).toContain("t.pinRim");
    expect(body).toContain("t.pinCasing");
  });

  it("gives the base ring an edge over every dark basemap tone", () => {
    const failures: string[] = [];
    for (const [name, background] of Object.entries(BACKGROUNDS)) {
      const rim = laid(background, edge.pinRim!, BASE_PUB_DARK_RING_OPACITY);
      const casing = laid(background, edge.pinCasing!, 0.9);
      const best = Math.max(contrast(rim, background), contrast(casing, background));
      if (best < EDGE_MIN) failures.push(`${name} ${background}: ${best.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it("keeps the historical invisible base ring impossible", () => {
    // What shipped: BASE_PUB_RING_COLOR at 0.6 over a `paper` disc, where dark
    // `paper` is buildScene's `--ink-deep`. Nothing separated it from the land.
    const wasBacking = laid(palette.land, DARK.inkDeep, 0.72);
    const wasRing = laid(wasBacking, BASE_PUB_RING_COLOR, BASE_PUB_RING_OPACITY);
    expect(contrast(wasRing, palette.land)).toBeLessThan(EDGE_MIN);

    const nowRing = laid(palette.land, edge.pinRim!, BASE_PUB_DARK_RING_OPACITY);
    expect(contrast(nowRing, palette.land)).toBeGreaterThanOrEqual(EDGE_MIN);
  });

  it("leaves the light base pin exactly as it was", () => {
    // Light mode publishes no edge tokens, so drawBasePub keeps its paper disc
    // and bark ring - the look the design judgement of 2026-08-01 settled.
    expect(venuePinEdgeTokens({ ink: DARK.ink, inkDeep: DARK.inkDeep }, false)).toEqual({});
    expect(BASE_PUB_RING_COLOR).toBe("#6b5f57");
    expect(BASE_PUB_RING_OPACITY).toBe(0.6);
  });

  it("keeps a base pub visibly second-class beside a priced pin", () => {
    // Never fully opaque, and never the brand accent the selection ring owns.
    expect(UK_BASE_ICON_OPACITY).toBeLessThan(1);
    expect(BASE_PUB_DARK_RING_OPACITY).toBeLessThan(1);
  });
});
