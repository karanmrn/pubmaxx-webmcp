import type * as maplibregl from "maplibre-gl";
import { iconId } from "@/lib/mapIcons";
import { offsetIndexForLine } from "@/lib/tubeOffsets";
import { TRANSPORT_CATEGORIES, type PoiCategory } from "@/lib/pois";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import {
  SELECTION_DIM_OPACITY,
  GLOW_PULSE_PERIOD_MS,
  GLOW_PULSE_MIN_OPACITY,
  GLOW_PULSE_MAX_OPACITY,
  GLOW_PULSE_MIN_WIDTH,
  GLOW_PULSE_MAX_WIDTH,
} from "./tokens";
import { SELECTED_PIN_SIZE_SCALE } from "./easing";

// Ambient categories render as soft coloured dots; transport (TRANSPORT_CATEGORIES)
// render as their real TfL / National Rail symbol on separate layers.
export const AMBIENT_CATEGORIES: readonly PoiCategory[] = [
  "park",
  "garden",
  "market",
  "historic",
  "viewpoint",
  "sight",
];

/** Dot and label layers controlled by Parks, Gardens, Markets, Historic, Views, and Sights. */
export const POI_AMBIENT_LAYERS = ["pois-dot", "pois-label"] as const;

/** Station and stop symbols controlled by Tube, Rail, Bus, and River. */
export const POI_TRANSPORT_LAYERS = [
  "pois-transport-major",
  "pois-transport-minor",
  "pois-transport-label",
] as const;

/** Coloured TfL line network governed by `isTransitNetworkVisible`. */
export const TUBE_LINE_LAYERS = [
  "tube-lines-casing",
  "tube-lines-color",
  "tube-lines-label",
] as const;

// A MapLibre filter keeping only the not-hidden categories within a given group
// (the transport symbols and the ambient dots live on different layers).
export function poiFilter(
  hidden: Record<PoiCategory, boolean>,
  group: readonly PoiCategory[],
): maplibregl.FilterSpecification {
  const visible = group.filter((category) => !hidden[category]);
  return ["in", ["get", "category"], ["literal", visible]];
}

// Transport filter, split by rank so majors (the skeleton) and minors (revealed
// deeper) can sit on separate zoom-gated layers while both honour the toggles.
export function transportFilter(
  hidden: Record<PoiCategory, boolean>,
  majorOnly: boolean,
): maplibregl.FilterSpecification {
  const visible = TRANSPORT_CATEGORIES.filter((category) => !hidden[category]);
  const inCategory: maplibregl.ExpressionSpecification = [
    "in",
    ["get", "category"],
    ["literal", visible],
  ];
  const rankTest: maplibregl.ExpressionSpecification = majorOnly
    ? ["==", ["coalesce", ["get", "rank"], 2], 1]
    : ["!=", ["coalesce", ["get", "rank"], 2], 1];
  return ["all", inCategory, rankTest];
}

/**
 * Push Layers-chip state onto the live map without a scene rebuild.
 *
 * Callers must run this whenever `poiHidden` changes AND after deferred
 * transit layers land (tube-lines-* are added after first idle, so a toggle
 * that fired earlier could not set their visibility yet).
 *
 * Missing layers are skipped, so a pre-transit toggle is safe.
 * This is the single owner of setFilter / tube-line visibility for POI chips;
 * buildScene only seeds the initial values at layer creation.
 */
export function applyPoiCategoryVisibility(
  map: Pick<maplibregl.Map, "getLayer" | "setFilter" | "setLayoutProperty">,
  hidden: Record<PoiCategory, boolean>,
): void {
  const ambient = poiFilter(hidden, AMBIENT_CATEGORIES);
  const transportAll = poiFilter(hidden, TRANSPORT_CATEGORIES);
  const setFilter = (layer: string, filter: maplibregl.FilterSpecification) => {
    if (map.getLayer(layer)) map.setFilter(layer, filter);
  };
  setFilter("pois-dot", ambient);
  setFilter("pois-label", ambient);
  setFilter("pois-transport-major", transportFilter(hidden, true));
  setFilter("pois-transport-minor", transportFilter(hidden, false));
  setFilter("pois-transport-label", transportAll);

  // Keep this equivalent to isTransitNetworkVisible without importing the UI
  // toggle table into the canvas filter module.
  const tubeVisibility: "visible" | "none" = !hidden.tube ? "visible" : "none";
  for (const layer of TUBE_LINE_LAYERS) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", tubeVisibility);
  }
}

// icon-image match for a transport feature → its TfL symbol id (lib/mapIcons).
export const TRANSPORT_ICON_MATCH: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "category"],
  "tube",
  iconId("tfl", "underground"),
  "rail",
  iconId("tfl", "rail"),
  "bus",
  iconId("tfl", "bus"),
  "river",
  iconId("tfl", "river"),
  iconId("tfl", "underground"),
];
type PinIconSizeScale = number | maplibregl.ExpressionSpecification;

function pinIconSizeOutput(
  storySize: number,
  standardSize: number,
  scale: PinIconSizeScale,
): maplibregl.ExpressionSpecification {
  // Truthy `["get", "story"]` matches the long-standing paint property form
  // (boolean true on the feature). Missing/null story falls to standardSize.
  const base: maplibregl.ExpressionSpecification = [
    "case",
    ["get", "story"],
    storySize,
    standardSize,
  ];
  if (scale === 1) return base;
  // Coalesce guards against a transient null product during entrance ramp
  // frames (MapLibre warns "Expected number, found null" if * ever sees null).
  return ["coalesce", ["*", base, scale], standardSize];
}

// MapLibre only permits `zoom` as the input to a top-level step/interpolate.
// Selection and entrance multipliers therefore live inside each stop output;
// wrapping this interpolation in case/multiply causes the invalid icon-size
// warning and feeds a needless style-reload loop through the tile error net.
function pinIconSizeExpr(scale: PinIconSizeScale): maplibregl.ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    pinIconSizeOutput(0.7, 0.62, scale),
    15,
    pinIconSizeOutput(1.05, 0.95, scale),
  ];
}

// pubs-point `icon-size`, extracted so M7's entrance ramp (PubMapCanvas) can
// reuse the exact same zoom-driven outputs rather than re-declaring them.
export const PIN_ICON_SIZE_EXPR: maplibregl.ExpressionSpecification = pinIconSizeExpr(1);

/**
 * pubs-point `symbol-sort-key` — placement priority now that pins collide
 * instead of overlapping. MapLibre places the LOWEST sort key first, and a
 * symbol that is placed keeps its spot, so this is the order in which pins
 * survive a crowded street: the selected pin, then story pins (a band/crawl is
 * telling you about them), then pins carrying a real price, then the rest.
 * Ties fall back to MapLibre's own ordering.
 */
export function pinSortKeyExpr(selectedId: string): maplibregl.ExpressionSpecification {
  const unselected: maplibregl.ExpressionSpecification = [
    "case",
    ["get", "story"],
    1,
    ["<", ["coalesce", ["get", "bucket"], 3], 3],
    2,
    3,
  ];
  if (!selectedId) return unselected;
  return ["case", ["==", ["get", "id"], selectedId], 0, unselected];
}

// The zoom at/above which a priced pin prints its figure (`priceLabel`) under
// the glyph. Deliberately ABOVE PIN_MIN_ZOOM (12) and above CLUSTER_MAX_ZOOM
// (13), so a label only ever appears on a map that has already unclustered:
//
//   z12–z13  the mixed cluster band. Measured on a 390px viewport centred on
//            Piccadilly/Soho: at z13.5 the West End is still almost entirely
//            cluster discs - THREE individual pins in the whole viewport. A
//            price there is a scatter of numbers over a city that is otherwise
//            reading as colour, competing with the disc counts for the same
//            space. Below the gate the text-field evaluates to "", so the
//            overview is byte-identical to the map before labels existed.
//   z14+     street reading. Same viewport at z14: 31 pins, no discs - the
//            first zoom at which the source has actually unclustered
//            (CLUSTER_MAX_ZOOM is 13), and the first at which the surviving
//            pins are far enough apart for their labels to place. 18 of those
//            31 carried a price; roughly two thirds of those labels placed and
//            the rest yielded, which is the density contract working, not a
//            failure.
//
// Placement still decides per pin - `text-optional` means a label that cannot
// fit is dropped and its pin stays. This constant only decides when the map
// STARTS asking.
export const PIN_PRICE_LABEL_MIN_ZOOM = 14;

/** The label text for one feature, "" where the pub has no sayable price. */
const PRICE_LABEL_TEXT: maplibregl.ExpressionSpecification = [
  "coalesce",
  ["get", "priceLabel"],
  "",
];

/**
 * `pubs-point` `text-field`. Zoom-gated at PIN_PRICE_LABEL_MIN_ZOOM (MapLibre
 * only accepts `zoom` as the input to a top-level step, hence the outer step
 * wrapping the data expression), and blank for the SELECTED pub - that one is
 * redrawn a size up on `pubs-point-selected`, which carries its own label at
 * the offset its bigger glyph needs. Without this hole the two layers would
 * print the same figure twice, half a glyph apart.
 */
export function pinPriceLabelExpr(selectedId: string): maplibregl.ExpressionSpecification {
  const text: maplibregl.ExpressionSpecification = selectedId
    ? ["case", ["==", ["get", "id"], selectedId], "", PRICE_LABEL_TEXT]
    : PRICE_LABEL_TEXT;
  return ["step", ["zoom"], "", PIN_PRICE_LABEL_MIN_ZOOM, text];
}

/**
 * `pubs-point-selected` `text-field`. That layer's filter already narrows it to
 * the one selected pub, so this needs no selected id and never changes.
 */
export const SELECTED_PIN_PRICE_LABEL_EXPR: maplibregl.ExpressionSpecification = [
  "step",
  ["zoom"],
  "",
  PIN_PRICE_LABEL_MIN_ZOOM,
  PRICE_LABEL_TEXT,
];

/**
 * Filter for the dedicated selected-pin layer (`pubs-point-selected`): exactly
 * the selected unclustered pub, or nothing while no venue is selected. The
 * style spec makes `icon-allow-overlap` data-constant (no feature-data
 * expressions), so "only the selected pin may overlap" has to be its own layer
 * with a constant `true` behind this filter — the base pubs-point layer keeps
 * `icon-allow-overlap: false` and the density contract for every other pin.
 */
export function selectedPinFilter(selectedId: string): maplibregl.FilterSpecification {
  return [
    "all",
    ["!", ["has", "point_count"]],
    ["==", ["get", "id"], selectedId],
  ];
}

/**
 * Global 0→1 ease for the cluster entrance fade. Pub PINS stagger per feature
 * (pinEntranceLocalT); cluster discs are few and large, so they share one
 * eased ramp — enough to kill the "everything pops at once" flash without
 * turning the city overview into a light show. Pure + unit-tested.
 */
export function clusterEntranceProgress(elapsedMs: number, totalMs: number): number {
  if (!(totalMs > 0)) return 1;
  const t = Math.max(0, Math.min(1, elapsedMs / totalMs));
  // easeOutCubic — fast to mostly-there, then settles.
  return 1 - Math.pow(1 - t, 3);
}

/**
 * pubs-point `icon-size` with the selected pin scaled up so it reads as the
 * pinpoint among neighbours. Deselect restores PIN_ICON_SIZE_EXPR.
 */
export function selectedPinIconSizeExpr(
  selectedId: string,
): maplibregl.ExpressionSpecification {
  if (!selectedId) return PIN_ICON_SIZE_EXPR;
  return pinIconSizeExpr([
    "case",
    ["==", ["get", "id"], selectedId],
    SELECTED_PIN_SIZE_SCALE,
    1,
  ]);
}

// M1 selection spotlight — pubs-point `icon-opacity`. With no selection, the
// existing serves-based dim is untouched (0.98 serving / 0.22 filtered-out).
// With a selection: the selected pub always reads at full opacity (unmissable
// even if it's dimmed by the favourite-pint filter), every other serving pub
// eases to SELECTION_DIM_OPACITY, and already-filtered-out pubs stay at their
// existing 0.22 floor rather than popping brighter.
export function pubIconOpacityExpr(selectedId: string): maplibregl.ExpressionSpecification {
  if (!selectedId) {
    return ["case", ["get", "serves"], 0.98, 0.22];
  }
  return [
    "case",
    ["==", ["get", "id"], selectedId],
    1,
    ["case", ["get", "serves"], SELECTION_DIM_OPACITY, 0.22],
  ];
}

// M1 selection spotlight — the breathing pulse for `pubs-selected-glow`,
// driven off the map's EXISTING RAF loop (no second requestAnimationFrame).
// Pure function of `now` (ms) so it's unit-testable without a map/DOM.
export function glowPulsePaint(now: number): { opacity: number; width: number } {
  const phase = ((now % GLOW_PULSE_PERIOD_MS) / GLOW_PULSE_PERIOD_MS) * Math.PI * 2;
  const wave = (1 + Math.sin(phase)) / 2; // 0..1, smooth breathing cycle
  return {
    opacity: GLOW_PULSE_MIN_OPACITY + (GLOW_PULSE_MAX_OPACITY - GLOW_PULSE_MIN_OPACITY) * wave,
    width: GLOW_PULSE_MIN_WIDTH + (GLOW_PULSE_MAX_WIDTH - GLOW_PULSE_MIN_WIDTH) * wave,
  };
}

// M7 pin entrance — deterministic FNV-1a-style hash of a pub id into
// 0..buckets-1, stashed once as `entranceSeed` on the GeoJSON feature
// (components/map/canvas/geojson.ts) so the stagger is stable across
// re-renders/theme rebuilds without a second per-frame hash pass. Pure,
// unit-tested: any string in, a bounded bucket index out.
export function hashEntranceSeed(id: string, buckets: number): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % Math.max(1, buckets);
}

// Per-feature entrance progress (0..1) at `elapsedMs` since the entrance
// started: bucket `seed` gets a proportional delay across `staggerMs`, then
// ramps 0→1 over `rampMs` — the plain-number twin of
// pinEntranceLocalTExpr below, used by unit tests and by the t=0 synchronous
// first paint (settleSceneReady) before the RAF loop takes over.
export function pinEntranceLocalT(
  elapsedMs: number,
  seed: number,
  buckets: number,
  staggerMs: number,
  rampMs: number,
): number {
  const delay = (seed / Math.max(1, buckets)) * staggerMs;
  const t = (elapsedMs - delay) / rampMs;
  return Math.max(0, Math.min(1, t));
}

// MapLibre-expression twin of pinEntranceLocalT — data-driven off the
// feature's own `entranceSeed` property, so one setPaintProperty /
// setLayoutProperty call per RAF frame animates every pin's ramp without a
// giant per-id match table or feature-state bookkeeping.
//
// `entranceSeed` is always set by pubsToGeoJSON (hashEntranceSeed), but a
// feature reaching this layer without it (a defensive guard — e.g. a future
// data path that forgets the property) must not NaN the whole ramp: `/` and
// `-` on a missing (`null`) get would poison every downstream arithmetic op.
// `coalesce` to 0 — the same "no stagger delay" value seed 0 already
// produces — so the pin still ramps in on schedule instead of freezing.
export function pinEntranceLocalTExpr(
  elapsedMs: number,
  buckets: number,
  staggerMs: number,
  rampMs: number,
): maplibregl.ExpressionSpecification {
  const delay: maplibregl.ExpressionSpecification = [
    "*",
    ["/", ["coalesce", ["get", "entranceSeed"], 0], Math.max(1, buckets)],
    staggerMs,
  ];
  const raw: maplibregl.ExpressionSpecification = [
    "/",
    ["-", elapsedMs, delay],
    rampMs,
  ] as unknown as maplibregl.ExpressionSpecification;
  return ["max", 0, ["min", 1, raw]] as unknown as maplibregl.ExpressionSpecification;
}

// pubs-point `icon-size` during the M7 entrance window: every pub ramps in
// from 0 to its normal PIN_ICON_SIZE_EXPR size — EXCEPT the selected pin
// (deep-linked `?sel=` or otherwise), which must read at full size
// immediately; M1's spotlight always wins over the entrance choreography.
export function pinEntranceIconSizeExpr(
  elapsedMs: number,
  selectedId: string,
  buckets: number,
  staggerMs: number,
  rampMs: number,
): maplibregl.ExpressionSpecification {
  const localT = pinEntranceLocalTExpr(elapsedMs, buckets, staggerMs, rampMs);
  if (!selectedId) return pinIconSizeExpr(localT);
  return pinIconSizeExpr([
    "case",
    ["==", ["get", "id"], selectedId],
    SELECTED_PIN_SIZE_SCALE,
    localT,
  ]);
}

// pubs-point `icon-opacity` during the M7 entrance window — same guard: the
// selected pin keeps its normal pubIconOpacityExpr value (1, unmissable),
// every other pin ramps in against ITS resolved (serves-aware) opacity.
export function pinEntranceIconOpacityExpr(
  elapsedMs: number,
  selectedId: string,
  buckets: number,
  staggerMs: number,
  rampMs: number,
): maplibregl.ExpressionSpecification {
  const localT = pinEntranceLocalTExpr(elapsedMs, buckets, staggerMs, rampMs);
  const baseOpacity = pubIconOpacityExpr(selectedId);
  const ramped: maplibregl.ExpressionSpecification = ["*", localT, baseOpacity];
  if (!selectedId) return ramped;
  return ["case", ["==", ["get", "id"], selectedId], baseOpacity, ramped];
}

export const TONIGHT_OPPORTUNITY_LAYERS = [
  "tonight-halo",
  "tonight-point",
  "tonight-label",
] as const;

function normaliseFeatureString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function opportunityForFeature(
  props: GeoJSON.GeoJsonProperties | undefined,
  opportunities: readonly ThingsToDoOpportunity[],
): ThingsToDoOpportunity | undefined {
  const title = normaliseFeatureString(props?.title);
  const placeName = normaliseFeatureString(props?.placeName);
  return opportunities.find((op) => {
    const opTitle = normaliseFeatureString(op.title);
    const opPlaceName = normaliseFeatureString(op.place?.name);
    if (title && placeName) return opTitle === title && opPlaceName === placeName;
    if (title) return opTitle === title;
    return Boolean(placeName && opPlaceName === placeName);
  });
}

// Issue #16 — parallel coloured tube lines. The known sub-surface fan lines
// (Metropolitan / Circle / H&C / District) run four-abreast through shared
// central corridors; we fan them apart with a per-line `line-offset` so they
// read side-by-side like the real tube map instead of one overlapping stroke.
//
// Offset math: offsetIndexForLine(line) gives a symmetric index (…-1.5, -0.5,
// 0.5, 1.5) for the fan lines and 0 for everything else. We turn that index into
// a MapLibre `match` expression, then multiply by a zoom-scaled pixel step so
// the lines CONVERGE at low zoom (network reads as one line) and FAN OUT from
// ~zoom 12 (the corridor separates). Documented ceiling: the source geometry is
// per-line from independent OSM ways and rarely shares vertices, so we offset
// the whole line by its fan index rather than per-shared-segment — the accepted
// ceiling in issue #16.
const FAN_LINES = ["Metropolitan", "Circle", "Hammersmith & City", "District"] as const;

// A `["match", ["get","line"], name, index, …, 0]` expression: each fan line to
// its offset index, all others to 0. Built once (module const) from the pure
// offsetIndexForLine so the map and the unit-tested logic never drift.
const TUBE_OFFSET_INDEX_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "line"],
  ...FAN_LINES.flatMap((line) => [line, offsetIndexForLine(line)] as [string, number]).flat(),
  0,
] as unknown as maplibregl.ExpressionSpecification;

// The signed pixel offset for a line at the current zoom: offsetIndex × a
// zoom-interpolated per-index step. At or below zoom 11 the step is 0 (lines
// converge); it grows to a full fan by zoom 14. `line-offset` is in pixels and
// perpendicular to the line, so a symmetric index set fans the group evenly.
//
// MapLibre permits `zoom` only as input to a top-level step or interpolate
// expression. Multiply the fan index at each stop so zoom stays top-level;
// nesting this interpolation under multiplication fails layer validation.
export const TUBE_LINE_OFFSET_EXPR: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  11,
  ["*", TUBE_OFFSET_INDEX_EXPR, 0],
  12,
  ["*", TUBE_OFFSET_INDEX_EXPR, 1.4],
  14,
  ["*", TUBE_OFFSET_INDEX_EXPR, 3.2],
  16,
  ["*", TUBE_OFFSET_INDEX_EXPR, 4.5],
] as unknown as maplibregl.ExpressionSpecification;
