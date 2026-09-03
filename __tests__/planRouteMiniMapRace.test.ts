// @vitest-environment jsdom

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlanRouteMiniMap from "@/components/plan/PlanRouteMiniMap";

type Stop = { venueId: string; venueName: string; position: number };

type PendingResponse = {
  url: string;
  resolve: (response: Response) => void;
};

const PLAN_A: Stop[] = [
  { venueId: "venue-a", venueName: "First pub", position: 0 },
  { venueId: "venue-b", venueName: "Second pub", position: 1 },
];
const PLAN_B: Stop[] = [
  { venueId: "venue-c", venueName: "Third pub", position: 0 },
  { venueId: "venue-d", venueName: "Fourth pub", position: 1 },
];
const PLAN_A_RENAMED: Stop[] = [
  { venueId: "venue-a", venueName: "Renamed first pub", position: 0 },
  { venueId: "venue-b", venueName: "Renamed second pub", position: 1 },
];

let host: HTMLDivElement;
let root: Root;
let pending: PendingResponse[];

function venueResponse(latitude: number, longitude: number): Response {
  return Response.json({
    venue: { latitude, longitude, primaryBorough: "Westminster" },
  });
}

function routeResponse(
  coordinates: number[][] = [
    [-0.14, 51.51],
    [-0.135, 51.515],
    [-0.13, 51.52],
  ],
): Response {
  return Response.json({
    source: "ors",
    line: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates,
          },
        },
      ],
    },
  });
}

function findPending(urlPart: string): PendingResponse {
  const request = pending.find((entry) => entry.url.includes(urlPart));
  if (!request) throw new Error(`No pending request contains ${urlPart}`);
  return request;
}

function resolvePending(urlPart: string, response: Response): void {
  const index = pending.findIndex((entry) => entry.url.includes(urlPart));
  if (index < 0) throw new Error(`No pending request contains ${urlPart}`);
  const [request] = pending.splice(index, 1);
  request!.resolve(response);
}

async function settleVenueLookups(
  rows: ReadonlyArray<{ id: string; latitude: number; longitude: number }>,
): Promise<void> {
  await act(async () => {
    for (const row of rows) {
      resolvePending(`/api/venue/${row.id}`, venueResponse(row.latitude, row.longitude));
    }
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      new Promise<Response>((resolve) => {
        pending.push({ url: String(input), resolve });
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe("PlanRouteMiniMap request identity", () => {
  it("frames routed detour vertices inside the padded viewport", async () => {
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A }));
    });
    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    await act(async () => {
      resolvePending(
        "/api/walk-route?",
        routeResponse([
          [-0.14, 51.51],
          [-0.16, 51.515],
          [-0.13, 51.52],
        ]),
      );
      await Promise.resolve();
    });

    const path = host.querySelector<SVGPathElement>(".planRouteMiniMap__line");
    const values = path?.getAttribute("d")?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(values).toHaveLength(6);
    for (let index = 0; index < values.length; index += 2) {
      expect(values[index]).toBeGreaterThanOrEqual(26);
      expect(values[index]).toBeLessThanOrEqual(294);
      expect(values[index + 1]).toBeGreaterThanOrEqual(26);
      expect(values[index + 1]).toBeLessThanOrEqual(150);
    }
  });

  it("does not let a late previous route paint while a new plan resolves", async () => {
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A }));
    });
    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    expect(host.querySelector(".planRouteMiniMap")).not.toBeNull();
    const previousRoute = findPending("/api/walk-route?");

    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_B }));
    });

    // The new plan has not resolved yet. The old SVG must not remain as the
    // visible answer while its replacement is in flight.
    expect(host.querySelector(".planRouteMiniMap")).toBeNull();

    // The route request ignores abort in this harness. This models a response
    // that was already buffered when the old effect was cleaned up.
    await act(async () => {
      previousRoute.resolve(routeResponse());
      await Promise.resolve();
    });
    expect(host.querySelector(".planRouteMiniMap")).toBeNull();

    await settleVenueLookups([
      { id: "venue-c", latitude: 51.53, longitude: -0.12 },
      { id: "venue-d", latitude: 51.54, longitude: -0.11 },
    ]);

    expect(host.querySelector(".planRouteMiniMap")).not.toBeNull();
    expect(host.querySelector(".planRouteMiniMap desc")?.textContent).toContain(
      "Third pub, Fourth pub",
    );
    expect(host.querySelector(".planRouteMiniMap desc")?.textContent).not.toContain(
      "First pub",
    );
  });

  it("re-resolves when venue names change but ids and positions stay the same", async () => {
    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A }));
    });
    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    expect(host.querySelector(".planRouteMiniMap desc")?.textContent).toContain(
      "First pub, Second pub",
    );

    await act(async () => {
      root.render(createElement(PlanRouteMiniMap, { stops: PLAN_A_RENAMED }));
    });

    // A venue rename changes the accessible route description. Do not retain
    // the old labels while the renamed stops are being resolved.
    expect(host.querySelector(".planRouteMiniMap")).toBeNull();

    await settleVenueLookups([
      { id: "venue-a", latitude: 51.51, longitude: -0.14 },
      { id: "venue-b", latitude: 51.52, longitude: -0.13 },
    ]);

    expect(host.querySelector(".planRouteMiniMap desc")?.textContent).toContain(
      "Renamed first pub, Renamed second pub",
    );
    expect(host.querySelector(".planRouteMiniMap desc")?.textContent).not.toContain(
      "First pub",
    );
  });
});
