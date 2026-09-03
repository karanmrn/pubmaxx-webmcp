// A shared cache holds ONE answer for everybody, so only a route whose answer
// is the same for everybody may ask for one.
//
// U6 of docs/plans/SITE_SPEED_2026-09-01.md. The rule this fence keeps is
// narrower than "is it public": a body that is a pure function of the request
// URL and the deployment may sit at the edge, and everything else may not -
// a session, a caller's identity, a store read that can change between two
// requests, or a URL that can carry the viewer's own coordinates.
//
// That last one is the trap. /api/tonight-conditions is public and read-only
// and still may not be cached: its URL carries lat and lng, so a shared cache
// key would hold a viewer's point. It stays no-store, and the reason is written
// down here rather than left to the next reader's judgement.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const API_ROOT = join(REPO_ROOT, "app/api");

function routeFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry === "route.ts" || entry === "route.tsx") found.push(full);
    }
  };
  walk(API_ROOT);
  return found;
}

/** Anything that makes an answer differ between two callers of the same URL. */
const PER_CALLER_READS = [
  "callerUserId",
  "requireLinkedActor",
  "resolveMessageHandle",
  "gateHandleAction",
  "verifySupabaseSessionFromRequest",
  "isModerator",
  "cookies()",
];

/** A URL that can carry where the reader is standing. */
const VIEWER_POINT_READS = ["coarsenViewerPoint", 'searchParams.get("lat")'];

/**
 * Routes that return a shared-cache header from a file that also mentions
 * `coarsenViewerPoint`, and are RULED to be honest.
 *
 * The captain's invariant (2026-09-01): no UN-COARSENED viewer point may ever
 * appear in a URL or a shared cache key; a bucket many people share by
 * construction may. Each entry below states which side of that line it is on,
 * and the assertions under it check the claim rather than trusting it.
 *
 * This list may only ever SHRINK. A new entry is a decision somebody makes on
 * purpose, with the trace that justifies it.
 */
const VIEWER_POINT_CACHE_RULED: Record<string, { reason: string }> = {
  // Case (1): every caller coarsens BEFORE building the URL, so the key holds
  // only bucket values. Kept cached.
  "app/api/tfl-disruption/route.ts": {
    reason: "callers coarsen before the URL; key holds a shared bucket",
  },
  // Not a viewer-point cache at all: the cacheable GET carries venue-to-venue
  // coordinates, which are public map data, and a request that starts where the
  // reader stands goes by POST with cache: no-store.
  "app/api/citymcp/journey/route.ts": {
    reason: "cached lane is venue-to-venue; the viewer lane is POST no-store",
  },
};

function sharedCached(source: string): boolean {
  return source.includes("jsonCached") || source.includes("s-maxage");
}

describe("only a route with one answer may take a shared cache", () => {
  const files = routeFiles();

  it("finds the API tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("never puts a per-caller answer at the edge", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!sharedCached(source)) continue;
      const reads = PER_CALLER_READS.filter((read) => source.includes(read));
      if (reads.length > 0) {
        offenders.push(`${file.slice(REPO_ROOT.length + 1)}: ${reads.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never puts a viewer's own point in a shared cache key", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!sharedCached(source)) continue;
      const relative = file.slice(REPO_ROOT.length + 1);
      if (relative in VIEWER_POINT_CACHE_RULED) continue;
      const reads = VIEWER_POINT_READS.filter((read) => source.includes(read));
      if (reads.length > 0) offenders.push(`${relative}: ${reads.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the ruled pair a closed, shrinking list that still states its reason", () => {
    const entries = Object.entries(VIEWER_POINT_CACHE_RULED);
    expect(entries.length).toBeLessThanOrEqual(2);
    for (const [relative, { reason }] of entries) {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");
      expect(sharedCached(source), relative).toBe(true);
      expect(reason.length, relative).toBeGreaterThan(20);
    }
  });
});

// The invariant itself, checked rather than trusted: a client that builds a URL
// for a shared-cached route out of a viewer point must reduce it to a bucket
// BEFORE the URL exists. Coarsening on the server would be too late - the raw
// point would already be in the request line, the proxy logs and the cache key.
describe("a viewer point is bucketed before it reaches a cached URL", () => {
  const CACHED_VIEWER_POINT_CALLERS = [
    "components/transport/DisruptionLine.tsx",
    "app/today/TodayTubeCard.tsx",
  ];

  it("coarsens in every caller, above the line that builds the URL", () => {
    for (const relative of CACHED_VIEWER_POINT_CALLERS) {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");
      const coarsenAt = source.indexOf("coarsenViewerPoint(");
      const urlAt = source.indexOf("/api/tfl-disruption?lat=");
      expect(coarsenAt, `${relative} coarsens`).toBeGreaterThan(-1);
      expect(urlAt, `${relative} builds the URL`).toBeGreaterThan(-1);
      expect(coarsenAt, `${relative} coarsens first`).toBeLessThan(urlAt);
    }
  });

  it("keeps the viewer-origin journey on POST, never on the cached GET", () => {
    const caller = readFileSync(
      join(REPO_ROOT, "components/map/useVenueJourney.ts"),
      "utf8",
    );
    expect(caller).toContain('method: "POST"');
    expect(caller).toContain('cache: "no-store"');
    expect(caller).not.toContain("/api/citymcp/journey?");
  });

  it("states the bucket width beside the route that spends it", () => {
    const route = readFileSync(
      join(REPO_ROOT, "app/api/tfl-disruption/route.ts"),
      "utf8",
    );
    expect(route).toContain("three decimal places");
    expect(route).toContain("many people");
  });
});

describe("the routes this unit classified", () => {
  function read(relative: string): string {
    return readFileSync(join(REPO_ROOT, relative), "utf8");
  }

  it("caches a Night Area, list and slug alike", () => {
    // Bundled config: a pure function of the URL and the deploy. The list has
    // said so since it shipped; the slug said no-store for no reason of its own.
    expect(read("app/api/night-areas/route.ts")).toContain("jsonCached");
    expect(read("app/api/night-areas/[slug]/route.ts")).toContain("jsonCached");
  });

  it("leaves the conditions strip uncached, because its URL carries a point", () => {
    const conditions = read("app/api/tonight-conditions/route.ts");
    expect(conditions).toContain("jsonNoStore");
    expect(conditions).not.toContain("jsonCached");
  });
});
