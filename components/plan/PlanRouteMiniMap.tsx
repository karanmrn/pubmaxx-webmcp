"use client";

import { useEffect, useId, useMemo, useState } from "react";

import {
  boundsFromCoords,
  lineCoordsFromFeatureCollection,
  projectCoords,
  stopsParam,
  svgPath,
  type LngLat,
} from "@/lib/routeMiniMap";
import { discardBody } from "@/lib/responseBody";

// A lightweight static route mini-map for the locked plan page. It draws the
// crawl's stops as numbered discs joined by the walking line — a self-contained
// SVG with NO MapLibre mount, no tiles and no basemap, styled as an abstract
// transit diagram. It matches the honesty rule the big map follows: the line is
// SOLID when the route is real (ORS road geometry) and DASHED when it is the
// straight-line approximation.
//
// Loading is progressive, never a spinner: the moment the stop coordinates
// resolve, the straight line paints; when GET /api/walk-route answers, it
// upgrades to the routed line. It degrades to nothing (renders null) whenever
// there are fewer than two locatable stops or a coordinate lookup fails — never
// a broken box.

type Stop = { venueId: string; venueName: string; position: number };
type RouteSource = "ors" | "straight";

// Mobile-first viewBox. The SVG scales to its container width via CSS; these are
// user-space units the projection fits into. Padding clears the disc radius.
const VIEW_W = 320;
const VIEW_H = 176;
const PADDING = 26;
const DISC_R = 13;

type ResolvedStops = {
  coords: LngLat[];
  names: string[];
  area: string;
};

async function fetchStopCoords(
  stops: Stop[],
  signal: AbortSignal,
): Promise<ResolvedStops | null> {
  // Source coordinates the same way the plan page already loads venue detail —
  // the existing per-venue endpoint (the id encodes the city, so this stays
  // correct for every supported city). No new API. All-or-nothing: if any stop
  // fails to resolve we render nothing rather than mislabel the numbered discs.
  const results = await Promise.all(
    stops.map(async (stop) => {
      try {
        const res = await fetch(`/api/venue/${encodeURIComponent(stop.venueId)}`, {
          signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { venue?: unknown };
        const venue = body.venue as
          | { latitude?: unknown; longitude?: unknown; primaryBorough?: unknown }
          | undefined;
        const lat = venue?.latitude;
        const lng = venue?.longitude;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          coord: [lng, lat] as LngLat,
          name: stop.venueName,
          area: typeof venue?.primaryBorough === "string" ? venue.primaryBorough : "",
        };
      } catch {
        return null;
      }
    }),
  );
  if (results.some((row) => row === null)) return null;
  const rows = results as NonNullable<(typeof results)[number]>[];
  if (rows.length < 2) return null;
  return {
    coords: rows.map((row) => row.coord),
    names: rows.map((row) => row.name),
    area: rows.find((row) => row.area)?.area ?? "",
  };
}

// The drawn line: the straight stop-to-stop segments at first, upgraded to the
// routed geometry once /api/walk-route answers. `source` drives the honesty
// styling (solid for "ors" roads, dashed for the straight approximation).
type DrawnRoute = { line: LngLat[]; source: RouteSource };

export default function PlanRouteMiniMap({ stops }: { stops: Stop[] }) {
  const [resolved, setResolved] = useState<ResolvedStops | null>(null);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<DrawnRoute | null>(null);
  const [drawnKey, setDrawnKey] = useState<string | null>(null);

  // Include every stop field used by the mini-map and encode structurally so
  // venue ids or names containing commas cannot collide in the request key.
  const stopsKey = JSON.stringify(
    stops.map(({ venueId, venueName, position }) => ({ venueId, venueName, position })),
  );
  const titleId = useId();
  const descId = useId();

  // 1) Resolve stop coordinates, then paint the straight line immediately. All
  //    state writes happen inside the async callback (never synchronously in the
  //    effect body), and a null result clears any prior map so a later fetch
  //    failure degrades to nothing rather than lingering on stale geometry.
  useEffect(() => {
    const controller = new AbortController();
    void fetchStopCoords(stops, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      if (!next) {
        setResolved(null);
        setResolvedKey(stopsKey);
        setDrawn(null);
        setDrawnKey(stopsKey);
        return;
      }
      setResolved(next);
      setResolvedKey(stopsKey);
      setDrawn({ line: next.coords, source: "straight" }); // instant straight paint
      setDrawnKey(stopsKey);
    });
    return () => controller.abort();
    // stopsKey captures the meaningful identity of `stops`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey]);

  // 2) Upgrade to the routed line once coordinates exist. Honesty rule: solid
  //    only when the endpoint routed real roads ("ors"); otherwise stay dashed.
  useEffect(() => {
    if (!resolved || resolvedKey !== stopsKey) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/walk-route?stops=${encodeURIComponent(stopsParam(resolved.coords))}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { line?: unknown; source?: unknown };
        const routed = lineCoordsFromFeatureCollection(body.line);
        if (controller.signal.aborted || routed.length < 2) return;
        setDrawn({ line: routed, source: body.source === "ors" ? "ors" : "straight" });
        setDrawnKey(stopsKey);
      } catch {
        /* fail-soft: keep the straight line already drawn */
      }
    })();
    return () => controller.abort();
  }, [resolved, resolvedKey, stopsKey]);

  const activeResolved = resolvedKey === stopsKey ? resolved : null;
  const activeDrawn = drawnKey === stopsKey ? drawn : null;

  const geometry = useMemo(() => {
    if (!activeResolved || !activeDrawn) return null;
    const bounds = boundsFromCoords([...activeResolved.coords, ...activeDrawn.line]);
    if (!bounds) return null;
    const viewport = { width: VIEW_W, height: VIEW_H, padding: PADDING };
    const discs = projectCoords(activeResolved.coords, bounds, viewport);
    const linePoints = projectCoords(activeDrawn.line, bounds, viewport);
    return { discs, path: svgPath(linePoints) };
  }, [activeResolved, activeDrawn]);

  if (!activeResolved || !activeDrawn || !geometry) return null;

  const count = activeResolved.coords.length;
  const title = activeResolved.area
    ? `Route map: ${count} stops in ${activeResolved.area}`
    : `Route map: ${count} stops`;
  const description = `Walking route between ${activeResolved.names.join(", ")}.`;

  return (
    <figure className="planRouteMiniMap planRouteMiniMap--in" data-source={activeDrawn.source}>
      <svg
        className="planRouteMiniMap__svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{description}</desc>
        {geometry.path ? (
          <>
            <path className="planRouteMiniMap__casing" d={geometry.path} />
            <path className="planRouteMiniMap__line" d={geometry.path} pathLength={1} />
          </>
        ) : null}
        {geometry.discs.map((point, index) => (
          <g className="planRouteMiniMap__stop" key={`${index}-${activeResolved.names[index]}`}>
            <circle
              className="planRouteMiniMap__disc"
              cx={point.x}
              cy={point.y}
              r={DISC_R}
            />
            <text
              className="planRouteMiniMap__num"
              x={point.x}
              y={point.y}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {index + 1}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
