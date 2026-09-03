// Ambient points-of-interest layer for the map: tube stations, green spaces, and
// tourist sights. Static and bundled (public/data/london_pois.json) — the app is
// deliberately keyless/offline, so there are no runtime external API calls here.
//
// This is a SEPARATE, lighter layer from lib/landmarks.ts: POIs carry no history
// text and no sources. They are ambient orientation dots that complement the
// sourced heritage landmarks, not duplicates of them.

import { discardBody } from "@/lib/responseBody";

// Transport categories carry their own real-world TfL / National Rail symbol on
// the map (roundel, double-arrow, bus roundel, river-bus pier). The rest —
// parks, gardens, markets, historic sites, viewpoints, sights — are ambient
// coloured dots. Kept in one union so the toggle + filters iterate them all.
export type PoiCategory =
  | "tube"
  | "rail"
  | "bus"
  | "river"
  | "park"
  | "garden"
  | "market"
  | "historic"
  | "viewpoint"
  | "sight";

export type Poi = {
  id: string;
  name: string;
  category: PoiCategory;
  /** [lng, lat] — same convention as lib/landmarks.ts. */
  coordinates: [number, number];
  /**
   * Zoom-depth tier. 1 = a major interchange / terminus, drawn from a wide zoom
   * so the network reads at a glance; 2 (or absent) = a minor stop that only
   * fades in as you zoom deeper, the way a real transit map reveals detail.
   */
  rank?: 1 | 2;
};

export const POI_CATEGORIES: readonly PoiCategory[] = [
  "tube",
  "rail",
  "bus",
  "river",
  "park",
  "garden",
  "market",
  "historic",
  "viewpoint",
  "sight",
];

// Advisory display metadata the map canvas (WS-D) consumes. Colours reuse the
// app's brass/river/pint token hexes from app/globals.css where sensible; the
// canvas decides final rendering, so treat glyph/colour as typed hints.
export const POI_CATEGORY_META: Record<
  PoiCategory,
  { label: string; color: string; glyph: string }
> = {
  // Transport swatches use the real TfL / National Rail brand colours so the
  // toggle chips match the symbols drawn on the map.
  tube: { label: "Tube", color: "#DC241F", glyph: "Ⓤ" },
  rail: { label: "Rail", color: "#E30613", glyph: "≷" },
  bus: { label: "Bus", color: "#DC241F", glyph: "▭" },
  river: { label: "River", color: "#009FDF", glyph: "⛴" },
  // Green space → the "cheap pint / positive" pint token.
  park: { label: "Parks", color: "#2f8f5b", glyph: "🌳" },
  // Formal / botanic gardens — a lighter, cultivated green.
  garden: { label: "Gardens", color: "#4ca96a", glyph: "🌿" },
  // Street & food markets — a warm market-stall orange.
  market: { label: "Markets", color: "#d2691e", glyph: "🛒" },
  // Historic sites / monuments / houses — an old-stone taupe.
  historic: { label: "Historic", color: "#8b7355", glyph: "🏛" },
  // Viewpoints / rooftops / hills — a clear-sky blue.
  viewpoint: { label: "Views", color: "#2e86ab", glyph: "🔭" },
  // Tourist sight → the guidebook brass accent.
  sight: { label: "Sights", color: "#9a6a24", glyph: "★" },
};

// Transport categories that render as their real-world TfL symbol (drawn by the
// map canvas) rather than an ambient dot. Exported so the canvas and any filter
// share one source of truth.
export const TRANSPORT_CATEGORIES: readonly PoiCategory[] = ["tube", "rail", "bus", "river"];

function isPoiCategory(value: unknown): value is PoiCategory {
  return typeof value === "string" && (POI_CATEGORIES as readonly string[]).includes(value);
}

// Light runtime guard: hand-authored JSON can drift, so drop malformed rows
// rather than letting a bad coordinate poison the map layer.
function isValidPoi(value: unknown): value is Poi {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) return false;
  if (typeof row.name !== "string" || row.name.length === 0) return false;
  if (!isPoiCategory(row.category)) return false;
  const coords = row.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return false;
  const [lng, lat] = coords;
  return (
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    typeof lat === "number" &&
    Number.isFinite(lat)
  );
}

/**
 * One normaliser for every POI reader. Drops malformed rows and pins `rank` to
 * 1 | 2 | undefined so the canvas's zoom-depth expression never sees a stray
 * value. Shared so a server-side reader of the same file cannot drift from the
 * browser fetch below.
 */
export function normalizePois(data: unknown): Poi[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isValidPoi).map((poi) => {
    const rank = (poi as { rank?: unknown }).rank;
    return rank === 1 || rank === 2 ? { ...poi, rank } : { ...poi, rank: undefined };
  });
}

export const LONDON_POIS_PATH = "/data/london_pois.json";

/**
 * Fetches a POI dataset from an explicit public path (client-side).
 * Malformed rows are filtered out so callers always get a clean Poi[].
 * Pass `null` / empty to skip the fetch (non-London cities with no POI layer).
 */
export async function loadPoisFromPath(
  path: string | null | undefined,
): Promise<Poi[]> {
  if (!path) return [];
  const response = await fetch(path);
  if (!response.ok) {
    discardBody(response);
    return [];
  }
  return normalizePois(await response.json());
}

/**
 * London default POI loader — same contract as before multi-city routing.
 */
export async function loadPois(): Promise<Poi[]> {
  return loadPoisFromPath(LONDON_POIS_PATH);
}
