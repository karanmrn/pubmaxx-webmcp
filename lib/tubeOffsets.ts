// Tube-line offsets — fan shared-track Underground lines side-by-side like the
// real tube map instead of stacking them into one muddy overlapping stroke.
//
// The honest ceiling (documented): the source geometry (public/data/tfl_lines.json)
// is drawn per-line from independent OSM ways, so lines that share a physical
// corridor almost never share vertices — exact segment matching finds only a
// handful of coincident edges (see the analysis in the PR notes). Perfect
// per-segment offsetting is therefore intractable on this data. What IS stable
// and legible is offsetting the *known shared corridors* for the sub-surface
// lines (Circle / District / Hammersmith & City / Metropolitan), which run
// four-abreast through the same tunnels for much of central London. We give
// each of those lines a fixed offset index so they fan out consistently, and
// leave every other line centred.
//
// Two pure, unit-tested pieces:
//   1. segmentKey / sharedSegmentLineCount — the general shared-segment
//      primitive (rounded coordinate-pair sequence), so the detection logic is
//      testable even though the current data rarely triggers it.
//   2. assignLineOffsets — the actual per-line offset index used by the map,
//      derived from the documented sub-surface corridor group. Deterministic:
//      the same feature always gets the same index (stability tested).
//
// The map turns an offsetIndex into a pixel `line-offset` and zoom-scales it so
// the lines converge at low zoom and fan out from ~zoom 12 (see PubMapCanvas).

import type { FeatureCollection, Feature } from "geojson";

// The four sub-surface lines that share sculpted corridors through central
// London. Order here IS the fan order (top-to-bottom on the offset axis), so
// it's stable and reviewable in one place. Names match the `line` property in
// tfl_lines.json exactly.
export const SUBSURFACE_FAN_ORDER = [
  "Metropolitan",
  "Circle",
  "Hammersmith & City",
  "District",
] as const;

export type OffsetableFeature = Feature & {
  properties: Record<string, unknown> & { line?: string };
};

// Round a coordinate to a stable key so near-identical vertices from different
// OSM ways collapse to the same segment id. 4 dp ≈ 11 m — tight enough to avoid
// false merges, loose enough to catch genuinely-shared track.
export function coordKey(coord: number[]): string {
  return `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
}

// An undirected segment key for an edge between two coordinates. Undirected so a
// segment drawn A→B on one line and B→A on another still matches.
export function segmentKey(a: number[], b: number[]): string {
  const ka = coordKey(a);
  const kb = coordKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

// Flatten a feature's geometry to a list of coordinate rings (LineString → one
// ring; MultiLineString → many). Non-line geometry yields nothing.
function coordRings(feature: Feature): number[][][] {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

// How many DISTINCT lines each undirected segment is shared by. The general
// shared-segment primitive: pure, order-independent, and the basis for any
// future per-segment offsetting if the source geometry ever gains shared
// vertices. Keyed by segmentKey → set-size.
export function sharedSegmentLineCount(
  collection: FeatureCollection,
): Map<string, number> {
  const lines = new Map<string, Set<string>>();
  for (const feature of collection.features) {
    const line = (feature.properties?.line as string | undefined) ?? "";
    for (const ring of coordRings(feature)) {
      for (let i = 0; i < ring.length - 1; i++) {
        const key = segmentKey(ring[i], ring[i + 1]);
        let set = lines.get(key);
        if (!set) {
          set = new Set();
          lines.set(key, set);
        }
        set.add(line);
      }
    }
  }
  const counts = new Map<string, number>();
  for (const [key, set] of lines) counts.set(key, set.size);
  return counts;
}

// The offset index for a line name within the fan: its position in
// SUBSURFACE_FAN_ORDER re-centred around zero so the group fans symmetrically
// about the true alignment (…-1.5, -0.5, 0.5, 1.5). Any line NOT in the fan
// group returns 0 (drawn centred). Deterministic and pure.
export function offsetIndexForLine(line: string): number {
  const idx = SUBSURFACE_FAN_ORDER.indexOf(line as (typeof SUBSURFACE_FAN_ORDER)[number]);
  if (idx === -1) return 0;
  const centre = (SUBSURFACE_FAN_ORDER.length - 1) / 2;
  return idx - centre;
}

// Stamp every feature with an `offsetIndex` property (the map reads it into a
// zoom-scaled `line-offset`). Returns a NEW FeatureCollection — never mutates
// the input — so re-running on the same data is stable and idempotent. Features
// keep all their existing properties (line, color, …); only offsetIndex is added.
export function assignLineOffsets(collection: FeatureCollection): FeatureCollection {
  return {
    ...collection,
    features: collection.features.map((feature) => {
      const line = (feature.properties?.line as string | undefined) ?? "";
      return {
        ...feature,
        properties: {
          ...feature.properties,
          offsetIndex: offsetIndexForLine(line),
        },
      } as Feature;
    }),
  };
}
