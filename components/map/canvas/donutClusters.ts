import * as maplibregl from "maplibre-gl";
import type { GeoJSONFeature } from "maplibre-gl";
import { buildDonutMarkerSvg, donutTotal, type DonutCounts } from "@/lib/donutClusterGeometry";
import { readTokens } from "./tokens";
import { CLUSTER_MAX_ZOOM } from "./buildScene";

// M5 — donut cluster markers segmented by price band. `clusterProperties`
// (wired in buildPubs, buildScene.ts) accumulate per-bucket counts (b0..b3 —
// same priceBucket() order the legend/pin fill already use: ≤£5.50 / >£5.50–
// ≤£7 / >£7 / no price) directly on the supercluster tree, so no extra
// source or client-side aggregation is needed here — just read them off the
// queried cluster features.
//
// This is the ONE sanctioned DOM-marker exception (MAP_MARKERS_PLAN /
// PRD_MAP_BEAUTY): everything else on the map is a GL layer. The count is
// bounded (DONUT_CAP) precisely so this never turns into an unbounded-DOM
// perf trap — past the cap we fall back to the plain circle+count GL layers
// (buildScene's `clusters` / `cluster-count`), which stay in the style as an
// underlay the whole time and are simply toggled visible/none rather than
// added/removed, so there is never a frame where neither is visible.
const DONUT_CAP = 60;
// Sync runs off the map's own `render`/`moveend`/`sourcedata` events — no new
// RAF loop (Single-RAF rule). `render` still fires every animation frame during
// explicit camera moves, so throttle the expensive querySourceFeatures + diff
// pass rather than run it 60x/sec.
const RENDER_THROTTLE_MS = 120;

const BUCKET_COLOR_KEYS = ["pint", "amber", "brick", "muted"] as const;

// Exported for unit tests — coerces the supercluster's accumulated b0..b3
// per-bucket props into a DonutCounts tuple, guarding a missing / non-numeric /
// non-finite prop down to 0 so a malformed cluster property can never NaN the
// donut geometry.
export function readCounts(props: GeoJSON.GeoJsonProperties): DonutCounts {
  const at = (key: string) => {
    const v = props?.[key];
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return [at("b0"), at("b1"), at("b2"), at("b3")];
}

// Exported for unit tests — the SVG-rebuild perf guard: markers only re-render
// their donut when this returns false, so position-only updates stay cheap.
export function countsEqual(a: DonutCounts, b: DonutCounts): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

type MarkerEntry = {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  counts: DonutCounts;
};

export type DonutClusterSync = {
  /** Detach every listener + marker. Safe to call once, from the same
   *  cleanup path that tears down the rest of the map instance. */
  destroy: () => void;
};

/** Wires donut-marker sync for the clustered `pubs` source. Reuses the exact
 *  cluster-expansion-zoom click behaviour the plain `clusters` circle layer
 *  already has (interactions.ts) so clicking a donut zooms in identically to
 *  clicking the bubble it replaced. */
export function createDonutClusterSync(
  map: maplibregl.Map,
  cinematic: (options: maplibregl.EaseToOptions, kind?: "cluster" | "venue" | "landmark") => void,
  { enabled = true }: { enabled?: boolean } = {},
): DonutClusterSync {
  // Mobile Safari is especially sensitive to DOM markers being reconciled
  // while vector-source tiles settle. The permanent MapLibre cluster/count
  // layers already carry the same interaction and remain GPU-composited, so
  // mobile/coarse-pointer callers disable this decorative DOM enhancement.
  if (!enabled) return { destroy: () => {} };

  const markers = new Map<number, MarkerEntry>();
  let donutsActive = false;
  let lastRenderAt = 0;

  const setLegacyLayersVisible = (visible: boolean) => {
    const visibility: "visible" | "none" = visible ? "visible" : "none";
    for (const id of ["clusters", "cluster-count"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
    }
  };

  const clearMarkers = () => {
    for (const entry of markers.values()) entry.marker.remove();
    markers.clear();
  };

  const deactivate = () => {
    if (markers.size > 0) clearMarkers();
    if (donutsActive) {
      donutsActive = false;
      setLegacyLayersVisible(true);
    }
  };

  const handleClusterClick = (clusterId: number, coordinates: [number, number]) => {
    const source = map.getSource("pubs") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source
      .getClusterExpansionZoom(clusterId)
      .then((zoom) => {
        cinematic({ center: coordinates, zoom, duration: 700 }, "cluster");
      })
      .catch(() => {
        // A cluster can dissolve between the click and this resolving
        // (rapid zoom/theme swap); nothing to recover from client-side.
      });
  };

  const sync = (emptyIsAuthoritative: boolean) => {
    if (!map.getSource("pubs") || !map.getLayer("clusters")) return;
    // D2 contract: cluster features exist while floor(zoom) <= CLUSTER_MAX_ZOOM
    // (MapLibre serves cluster tiles through the whole 13.x band and dissolves
    // them at CLUSTER_MAX_ZOOM + 1), so keep donuts live for that entire band —
    // markers clear only once no cluster features remain to query.
    if (map.getZoom() >= CLUSTER_MAX_ZOOM + 1) {
      deactivate();
      return;
    }
    let features: GeoJSONFeature[];
    try {
      features = map.querySourceFeatures("pubs", { filter: ["has", "point_count"] });
    } catch {
      return;
    }
    const byId = new Map<number, GeoJSONFeature>();
    for (const feature of features) {
      const id = feature.properties?.cluster_id;
      if (typeof id === "number" && !byId.has(id)) byId.set(id, feature);
    }
    if (byId.size === 0) {
      // MapLibre 6 can briefly expose an empty querySourceFeatures snapshot
      // between render/source-data passes while the settled viewport still has
      // clusters. Active DOM donuts are already projected by Marker, so retain
      // them until moveend gives us an authoritative empty viewport. Clearing
      // on a transient render hands ownership to the GL underlay; hiding that
      // underlay again on the next non-empty render creates a perpetual swap.
      if (emptyIsAuthoritative) deactivate();
      return;
    }
    if (byId.size > DONUT_CAP) {
      // Bounded-count guardrail: fall back to the GL circle layers rather
      // than create/manage more than DONUT_CAP live Marker instances.
      deactivate();
      return;
    }
    if (!donutsActive) {
      donutsActive = true;
      setLegacyLayersVisible(false);
    }
    const tokens = readTokens();
    const dark = document.documentElement.dataset.theme === "dark";
    const colors = BUCKET_COLOR_KEYS.map((key) => tokens[key]);
    const textColor = dark ? tokens.ink : tokens.inkDeep;
    const seen = new Set<number>();
    for (const [clusterId, feature] of byId) {
      seen.add(clusterId);
      const counts = readCounts(feature.properties);
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const existing = markers.get(clusterId);
      if (existing) {
        existing.marker.setLngLat([lng, lat]);
        // Perf guardrail: rebuild the SVG only when this cluster's counts
        // actually changed — position updates are cheap setLngLat calls.
        if (!countsEqual(existing.counts, counts)) {
          existing.counts = counts;
          existing.el.innerHTML = buildDonutMarkerSvg({
            counts,
            colors,
            ringColor: tokens.panelRaised,
            textColor,
          });
        }
        continue;
      }
      const el = document.createElement("div");
      el.className = "donut-cluster-marker";
      el.style.cursor = "pointer";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${donutTotal(counts)} pubs, tap to zoom in`);
      el.innerHTML = buildDonutMarkerSvg({
        counts,
        colors,
        ringColor: tokens.panelRaised,
        textColor,
      });
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        handleClusterClick(clusterId, [lng, lat]);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      markers.set(clusterId, { marker, el, counts });
    }
    for (const [id, entry] of markers) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
  };

  const throttledSync = () => {
    const now = performance.now();
    if (now - lastRenderAt < RENDER_THROTTLE_MS) return;
    lastRenderAt = now;
    sync(false);
  };
  // `sourcedata` fires for every tile/source on the map, including basemap
  // tiles that have nothing to do with the `pubs` cluster tree, so only the
  // app-owned source may drive this reconciliation.
  const onSourceData = (e: maplibregl.MapSourceDataEvent) => {
    if (e.sourceId !== "pubs") return;
    // Every pubs event may expose the first non-empty cluster snapshot, even
    // when it is not authoritative evidence that an empty source is settled.
    // This keeps activation independent from unrelated basemap render churn.
    sync(e.sourceDataType === "content" && e.isSourceLoaded);
  };
  // A theme/style swap (setStyle) recreates the `pubs` source and its
  // supercluster tree — old marker els carry stale-themed SVG and cluster
  // ids that are not guaranteed to survive the rebuild, so drop them and let
  // the next sync repopulate from the fresh style with fresh tokens.
  const onStyleLoad = () => {
    clearMarkers();
    donutsActive = false;
  };
  const onSettledMap = () => sync(true);

  map.on("render", throttledSync);
  map.on("moveend", onSettledMap);
  map.on("idle", onSettledMap);
  map.on("sourcedata", onSourceData);
  map.on("style.load", onStyleLoad);

  return {
    destroy: () => {
      map.off("render", throttledSync);
      map.off("moveend", onSettledMap);
      map.off("idle", onSettledMap);
      map.off("sourcedata", onSourceData);
      map.off("style.load", onStyleLoad);
      clearMarkers();
    },
  };
}
