import type * as maplibregl from "maplibre-gl";
import {
  CATEGORY_COLORS,
  categoryVar,
  type DrinkCategory,
} from "@/lib/categoryColors";
import {
  MAP_ICON_SPECS,
  iconId,
  rasterize,
  type IconTokens,
} from "@/lib/mapIcons";

// OpenFreeMap vector styles — truly keyless, MIT-licensed styles on ODbL/OSM
// data (free for commercial use, unlike CARTO's basemaps), and OpenMapTiles
// schema: a `building` source-layer with `render_height` for our 3-D extrusion.
// "liberty" is a rich, colourful consumer-map look (land-use tints, POI labels,
// road hierarchy); "dark" matches our candle-lit night mode.
export const MAP_STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  // Positron, not Liberty: Liberty is the full-colour OSM look (yellow POIs,
  // pastel landuse) and read as a different product next to the bar-mat dark
  // theme (owner audit). Positron is the muted paper-grey sibling on the same
  // openmaptiles source, so buildScene's building/3-D layers keep working.
  // A fully brand-tinted custom style JSON remains the follow-up.
  light: "https://tiles.openfreemap.org/styles/positron",
} as const;

// If OpenFreeMap (community-run) is slow or down, fall back to CARTO's keyless
// vector styles — same OpenMapTiles-ish `building` source-layer so 3-D buildings
// and buildScene keep working. Last resort after this is the WebGL notice.
export const FALLBACK_STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;
export const STYLE_LOAD_TIMEOUT_MS = 8000;

// ODbL attribution for OUR OWN pub data, not the basemap's. The basemap styles
// above ship their own credit inside the style JSON; this line exists because a
// large share of the venues we draw on top of it are themselves OSM-derived
// (the curated index's `outer_london_osm` venues and the whole UK base layer),
// and the OSMF attribution guidelines expect a browsable map to credit the
// contributors in the map corner, not only on an About page.
// https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
//
// Passed as MapLibre's `customAttribution` so it is present on EVERY city and
// every style, including the fallback styles and the non-London cities that
// skip the rail-lines source (whose own attribution is in buildScene).
export const OSM_ATTRIBUTION = "Pub data © OpenStreetMap contributors (ODbL)";

// Slightly wider opening London zoom (outer-London P0) so outer boroughs read
// at first glance while drink icons still appear soon after a nudge in.
export const LONDON_VIEW = {
  center: [-0.12, 51.52] as [number, number],
  zoom: 10.7,
  pitch: 42,
  bearing: -12,
};
export const LONDON_BOUNDS: [[number, number], [number, number]] = [
  [-0.55, 51.28],
  [0.35, 51.72],
];
export const UK_BOUNDS: [[number, number], [number, number]] = [
  [-8.7, 49.8],
  [1.9, 61],
];


// M1 selection spotlight — non-selected pub pins ease down to this opacity so
// the selected pin reads as unmissable at any zoom. Filtered-out pins (the
// favourite-pint `serves` dim) stay at their existing 0.22 floor either way.
export const SELECTION_DIM_OPACITY = 0.45;
// Selected-glow "breathing" pulse — one continuous sine cycle driven off the
// EXISTING RAF loop (no second requestAnimationFrame). Base values match the
// static pubs-selected-glow paint below so a deselect cleanly resets to them.
export const GLOW_BASE_STROKE_OPACITY = 0.35;
export const GLOW_BASE_STROKE_WIDTH = 3.2;
export const GLOW_PULSE_PERIOD_MS = 1600;
export const GLOW_PULSE_MIN_OPACITY = 0.3;
export const GLOW_PULSE_MAX_OPACITY = 0.62;
export const GLOW_PULSE_MIN_WIDTH = 3;
export const GLOW_PULSE_MAX_WIDTH = 4.6;

// M7 pin entrance — a per-pub icon-size/opacity ramp fired once, right after
// settleSceneReady()'s first pin reveal, off the SAME RAF loop the M1 pulse
// uses (no second requestAnimationFrame). Each pub's own ramp is spread out
// (`entranceSeed`, a hash of its id — see filters.ts pinEntranceLocalT) over
// PIN_ENTRANCE_STAGGER_MS so the cascade isn't mechanical/left-to-right, then
// individually ramps in over PIN_ENTRANCE_RAMP_MS. Stagger + ramp sum to the
// PRD's "~400ms" total. Reduced-motion is a hard skip (see PubMapCanvas) —
// those users keep today's instant pin paint.
export const PIN_ENTRANCE_BUCKETS = 14;
export const PIN_ENTRANCE_STAGGER_MS = 220;
export const PIN_ENTRANCE_RAMP_MS = 180;
export const PIN_ENTRANCE_TOTAL_MS = PIN_ENTRANCE_STAGGER_MS + PIN_ENTRANCE_RAMP_MS;

// Classic "marching ants" dash cycle for the brass route line.
export const DASH_SEQ: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

export type Tokens = {
  ink: string;
  inkDeep: string;
  paper: string;
  panelRaised: string;
  line: string;
  muted: string;
  pint: string;
  amber: string;
  brick: string;
  brass: string;
  brassBright: string;
  pricePlaqueInk: string;
  pricePlaqueSurface: string;
  /**
   * The reader's own position. Named rather than borrowed from a price band,
   * because "where you are" is not a price and must never be read as one.
   * Resolves the same `--color-info-strong` the DOM marker used, so the dot
   * looks unchanged and a theme change still reaches it. River, not coral: a
   * coral dot would wear the selection ring's colour, and the accent budget
   * (design judgement 2026-08-01, finding 2.1) has no room for a fourth place.
   */
  userLocation: string;
  priceStampTiltDeg: number;
  river: string;
  riverBright: string;
  // Crawl walk-route line colour — dark crimson (light) / bright coral-ember
  // (dark). High-contrast on both basemaps; see buildScene.buildRoute.
  routeLine: string;
  // M4 — dusk/night signature look + light-theme hierarchy audit. Sky gradient
  // (setSky zenith/horizon), warmed 3-D building emissive tint, and a park
  // green kept deliberately distinct from --pint (see theme.css / globals.css).
  skyZenith: string;
  skyHorizon: string;
  buildingEmissive: string;
  parkTint: string;
  // Drink-category accents (E5). ADDITIVE — resolves the live `--cat-*` vars
  // (lib/categoryColors.ts) into the map's token object so a future
  // pin-by-category paint tints a pin by a venue's dominant drink family from
  // the SAME light/dark/legacy source the venue-sheet swatches use. Not wired
  // into any live paint yet: the Venue model carries no honest dominant category
  // (see the ready-to-apply patch in components/map/mapColor.css), and the
  // honesty rule is never to colour a pin by a guessed category.
  cat: Record<DrinkCategory, string>;
};

const CSS_SRGB =
  /^color\(\s*srgb\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*\/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)))?\s*\)$/i;
const MAPLIBRE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;

/**
 * MapLibre's colour parser does not accept CSS Color 4 `color(srgb …)`,
 * which Chromium returns for computed color-mix() values. Convert that one
 * browser-native form without re-owning any theme colour in map code.
 */
export function toMapLibreColor(colour: string, fallback: string): string {
  const source = colour.trim();
  const srgb = CSS_SRGB.exec(source);
  if (srgb) {
    const channel = (value: string) =>
      Math.round(Math.min(Math.max(Number(value), 0), 1) * 255);
    const [red, green, blue] = srgb.slice(1, 4).map(channel);
    const alpha = srgb[4] === undefined
      ? 1
      : Math.min(Math.max(Number(srgb[4]), 0), 1);
    return alpha < 1
      ? `rgba(${red}, ${green}, ${blue}, ${alpha})`
      : `rgb(${red}, ${green}, ${blue})`;
  }
  return MAPLIBRE_COLOR.test(source) ? source : fallback;
}

type MapThemeToken = Exclude<
  keyof Tokens,
  | "cat"
  | "pricePlaqueInk"
  | "pricePlaqueSurface"
  | "priceStampTiltDeg"
  | "userLocation"
>;

const MAP_THEME_TOKEN_PROPERTIES = {
  ink: "--ink",
  inkDeep: "--ink-deep",
  paper: "--paper",
  panelRaised: "--panel-raised",
  line: "--line",
  muted: "--muted",
  pint: "--pint",
  amber: "--amber",
  brick: "--brick",
  brass: "--brass",
  brassBright: "--brass-bright",
  river: "--river",
  riverBright: "--river-bright",
  routeLine: "--route-line",
  skyZenith: "--map-sky-zenith",
  skyHorizon: "--map-sky-horizon",
  buildingEmissive: "--map-building-emissive",
  parkTint: "--map-park-tint",
} as const satisfies Record<MapThemeToken, `--${string}`>;

// Every map colour derives from the app's theme tokens so both modes
// (candle-lit night / positron day guidebook) flip from one system.
export function readTokens(): Tokens {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const mapToken = (name: MapThemeToken, fallback: string) =>
    token(MAP_THEME_TOKEN_PROPERTIES[name], fallback);
  // Custom properties preserve their color-mix() source text. MapLibre needs a
  // resolved CSS colour, so briefly ask the browser to compute the two plaque
  // roles instead of duplicating theme hex values in the map.
  const colourProbe = document.createElement("span");
  colourProbe.hidden = true;
  document.documentElement.appendChild(colourProbe);
  const resolvedColour = (name: string, fallback: string) => {
    colourProbe.style.color = `var(${name}, ${fallback})`;
    return toMapLibreColor(getComputedStyle(colourProbe).color, fallback);
  };
  const pricePlaqueInk = resolvedColour("--accent-price-ink", "#8f671f");
  const pricePlaqueSurface = resolvedColour("--price-plaque-surface", "#f4ead5");
  const userLocation = resolvedColour("--color-info-strong", "#29b6f6");
  colourProbe.remove();
  // Additive `--cat-*` read: one entry per drink family, resolved from the live
  // computed vars (with the canonical light hex as a fallback) so map consumers
  // never re-hardcode a category palette.
  const cat = Object.fromEntries(
    (Object.keys(CATEGORY_COLORS) as DrinkCategory[]).map((c) => [
      c,
      token(categoryVar(c), CATEGORY_COLORS[c].light),
    ]),
  ) as Record<DrinkCategory, string>;
  return {
    cat,
    ink: mapToken("ink", "#1b2620"),
    inkDeep: mapToken("inkDeep", "#0f1c16"),
    paper: mapToken("paper", "#f4efe4"),
    panelRaised: mapToken("panelRaised", "#ffffff"),
    line: mapToken("line", "#ddd5c4"),
    muted: mapToken("muted", "#6b726a"),
    pint: mapToken("pint", "#2f8f5b"),
    amber: mapToken("amber", "#d99f45"),
    brick: mapToken("brick", "#d16353"),
    brass: mapToken("brass", "#b0813a"),
    brassBright: mapToken("brassBright", "#d3a44a"),
    pricePlaqueInk,
    pricePlaqueSurface,
    userLocation,
    priceStampTiltDeg:
      Number.parseFloat(token("--ink-stamp-tilt", "-1.5deg")) || -1.5,
    river: mapToken("river", "#2f6f8f"),
    riverBright: mapToken("riverBright", "#4f9ec4"),
    routeLine: mapToken("routeLine", "#8b1a2b"),
    skyZenith: mapToken("skyZenith", "#0f1c16"),
    skyHorizon: mapToken("skyHorizon", "#b0813a"),
    buildingEmissive: mapToken("buildingEmissive", "#8f7d6b"),
    parkTint: mapToken("parkTint", "#7ea052"),
  };
}

/**
 * The drink pin's EDGE, per theme — the rim that separates a glass from the
 * basemap, plus the opposite-luminance casing just outside it.
 *
 * Why the dark theme needs both and the light theme needs neither: a pin's FILL
 * carries the price band, so the edge is the only thing that can make a pin
 * findable independently of what it is standing on. The light basemap is one
 * luminance regime (pale paper land, paler roads), so one light rim knocks the
 * glass out of the map everywhere. The DARK basemap deliberately is not:
 * night ground, water, buildings, and the now-subordinate warm road tiers still
 * span distinct tones. No single rim reliably edges every price band across
 * that range. The tone this map had been using was the worst option: `paper`
 * resolves to the near-black `--ink-deep` in dark, which sits within 1.02:1 of
 * dark land, so the "light rim on saturated glasses" was a black rim that
 * erased the glass's own outline, its stem and its foot, and left the
 * lowest-luminance bands (>£7 and unpriced) carrying findability on fill alone.
 *
 * So dark mode pairs the two tones the price tag beside the pin already pairs -
 * a cream `--ink` figure over an `--ink-deep` halo. Neither is a new colour and
 * neither is a ring, so nothing here can be confused with the brass selection
 * and scraped rings, the river Pint Drops ring and provisional badge, the
 * what's-on accent ring, the band halo, or the base layer's brass sockets.
 * __tests__/mapPinBandContrast.test.ts pins the contrast this buys per band.
 */
export function venuePinEdgeTokens(
  tokens: Pick<Tokens, "ink" | "inkDeep">,
  dark: boolean,
): Pick<IconTokens, "pinRim" | "pinCasing"> {
  if (!dark) return {};
  return { pinRim: tokens.ink, pinCasing: tokens.inkDeep };
}

export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Register every designed marker image (landmark pictograms + TfL symbols) with
// the map, re-tinting from the live theme tokens. Called from buildScene on the
// first load and after each theme-driven setStyle (which wipes prior images).
export function registerMapIcons(map: maplibregl.Map, tokens: IconTokens) {
  for (const spec of MAP_ICON_SPECS) {
    const id = iconId(spec.ns, spec.key);
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, rasterize(spec, tokens), { pixelRatio: 2 });
  }
}
