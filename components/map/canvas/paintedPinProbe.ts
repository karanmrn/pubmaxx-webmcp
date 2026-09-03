import type * as maplibregl from "maplibre-gl";

// A browser test cannot ask a canvas where its pins are, so it used to guess:
// a grid of taps across the map, hoping one landed on a pin before the scan
// gave up. Under worker contention it did not, and the guess read as a
// product defect. This publishes the one answer a tap needs - the viewport
// point of each pub mark the map is drawing RIGHT NOW - so the tap lands on a
// mark because a mark is known to be there.
//
// Clusters are answered beside pins because the map opens with the pubs
// gathered: the way to a pin is to open a cluster, and a test that has to
// find that cluster by touch is back to guessing.
//
// The probe reads the live map and stores nothing, so it can never name a
// mark the map has stopped drawing. A returned point has cleared three gates:
//   1. the mark survived symbol collision (queryRenderedFeatures over the
//      viewport returns placed symbols only, so an unpainted mark is absent);
//   2. the projected centre is on the map canvas; symbol pins also pass a
//      point re-query, which means the click router in `interactions.ts`
//      resolves a pub there rather than a landmark card;
//   3. nothing in the app chrome covers it, so the map canvas - not a topbar
//      button - receives the tap.
export const PAINTED_MAP_PROBE_KEY = "__pubmaxPaintedMapTapPoints";

/** A pub mark the map is painting, in viewport coordinates a tap can use. */
export type PaintedMapTapPoint = {
  /** `pin` opens a venue sheet; `cluster` opens the pubs inside it. */
  kind: "pin" | "cluster";
  id: string;
  x: number;
  y: number;
};

type ProbeWindow = Window & {
  [PAINTED_MAP_PROBE_KEY]?: () => PaintedMapTapPoint[];
};

// The click router treats a pub hit as the winner before every other layer, so
// a point that hits either of these opens the venue sheet.
const PIN_LAYERS = ["pubs-point-selected", "pubs-point"] as const;
const CLUSTER_LAYER = "clusters";
const PIN_PROBE_OVERVIEW_ZOOM = 12;

function markId(
  feature: maplibregl.MapGeoJSONFeature,
  kind: PaintedMapTapPoint["kind"],
): string | null {
  const raw = kind === "pin"
    ? feature.properties?.id
    : feature.properties?.cluster_id;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return null;
}

export function paintedMapTapPoints(map: maplibregl.Map): PaintedMapTapPoint[] {
  const pinLayers = PIN_LAYERS.filter((id) => Boolean(map.getLayer(id)));
  const clusterLayers = [CLUSTER_LAYER].filter((id) => Boolean(map.getLayer(id)));

  const container = map.getContainer();
  const rect = container.getBoundingClientRect();
  const ownerDocument = container.ownerDocument;
  const canvas = map.getCanvas();

  const points: PaintedMapTapPoint[] = [];
  const collect = (
    kind: PaintedMapTapPoint["kind"],
    layers: string[],
    firstOnly = false,
  ) => {
    if (!layers.length) return;
    const seen = new Set<string>();
    for (const feature of map.queryRenderedFeatures({ layers })) {
      const id = markId(feature, kind);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const geometry = feature.geometry;
      if (geometry.type !== "Point") continue;
      const [lng, lat] = geometry.coordinates;
      // No icon-anchor or icon-offset on the pin layers and no circle
      // translate on the cluster layer, so the projected coordinate is the
      // mark's centre (buildScene.ts).
      const point = map.project([lng, lat]);

      const x = rect.left + point.x;
      const y = rect.top + point.y;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      if (ownerDocument.elementFromPoint(x, y) !== canvas) continue;

      // Circle clusters have no placement box. Once the viewport query found
      // one and the projected centre is on the map canvas, the click router's
      // own point query will resolve it. Avoid repeating that query for every
      // cluster while the browser is waiting for first paint. Symbol pins keep
      // the stricter point re-query because collision placement can change
      // their hit result.
      if (kind === "pin") {
        const hits = map.queryRenderedFeatures(point, { layers });
        if (!hits.some((hit) => markId(hit, kind) === id)) continue;
      }

      points.push({ kind, id, x, y });
      if (firstOnly) return;
    }
  };

  // At the opening zoom, clusters are the only pub marks that can paint. Check
  // them before asking MapLibre for symbol placement: repeated symbol queries
  // during the browser wait can otherwise occupy the render thread and delay
  // the very paint this probe is waiting to observe. At street zoom, retain
  // pin-first ordering because a pin is the shorter route into a venue.
  if (
    typeof map.getZoom === "function" &&
    map.getZoom() < PIN_PROBE_OVERVIEW_ZOOM
  ) {
    collect("cluster", clusterLayers, true);
    if (points.length > 0) return points;
  }

  // Pins first: where a pin and a cluster share a point the router opens the
  // pub, so a caller taking the first point takes the shorter way in.
  collect("pin", pinLayers);
  collect("cluster", clusterLayers);
  return points;
}

/**
 * Publishes {@link paintedMapTapPoints} for the browser suite. Unconditional,
 * like the `pubmax:pin-reveal` event beside it: the e2e run exercises a
 * production build, so a development-only hook would not exist where the test
 * needs it. Returns its own removal.
 */
export function installPaintedPinProbe(map: maplibregl.Map): () => void {
  const probeWindow = window as ProbeWindow;
  probeWindow[PAINTED_MAP_PROBE_KEY] = () => paintedMapTapPoints(map);
  return () => {
    delete probeWindow[PAINTED_MAP_PROBE_KEY];
  };
}
