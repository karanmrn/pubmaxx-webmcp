import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { handleWhatsOnRequest } from "@/lib/whatsOnHandler";
import { buildOutVenueMatchIndex } from "@/lib/out/venueMatch";
import {
  baselineSourceObservedAt,
  loadBaselineWhatsOn,
  loadWhatsOn,
  mergeWhatsOn,
} from "@/lib/whatsOnStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

// The route now rate-limits per IP (S2) before anything else. Vercel's vitest
// run sets NODE_ENV=production with real Supabase env vars, which would send
// the limiter down its durable (network) path here; deleting the two env vars
// for the test keeps it on the deterministic in-memory path (same technique
// as __tests__/lastTrainRoute.test.ts).
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

const NOW = Date.parse("2026-07-11T20:00:00.000Z");

// Default startsAt is 22:00 London (21:00Z), just AFTER NOW (20:00Z), so a row
// with no explicit override is "currently live" and survives the default-path
// freshness guard (filterNotPast). The routing / merge / rate-limit tests below
// care about a servable row, not about staleness; the guard itself is covered
// by its own cases and by lib/whatsOn's hermetic suite.
function makeRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "r1",
    placeName: "The Test Arms",
    kind: "quiz",
    startsAt: "2026-07-11T22:00:00+01:00",
    title: "Pub quiz",
    source: { label: "Question One", url: "https://questionone.com/x/" },
    observedAt: "2026-07-11T18:00:00.000Z",
    confidence: "listed",
    area: "soho",
    ...overrides,
  };
}

function req(qs = ""): Request {
  return new Request(`http://localhost/api/whats-on${qs}`);
}

describe("loadBaselineWhatsOn", () => {
  it("loads + validates the bundled quiz_london.json baseline", () => {
    const rows = loadBaselineWhatsOn();
    expect(rows.length).toBeGreaterThan(0);
    const quizRows = rows.filter((r) => r.kind === "quiz");
    expect(quizRows.length).toBeGreaterThan(0);
    for (const r of quizRows) {
      expect(r.source.url).toMatch(/^https?:\/\//);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it("loads + validates the bundled deals_london.json baseline", () => {
    const rows = loadBaselineWhatsOn();
    const dealRows = rows.filter((r) => r.kind === "deal");
    expect(dealRows.length).toBeGreaterThan(0);
    for (const r of dealRows) {
      expect(r.confidence).toBe("listed");
      expect(r.source.label).toMatch(/Wetherspoon/);
      expect(r.source.url).toMatch(/^https?:\/\//);
      expect(r.endsAt).toBeDefined();
    }
  });

  it("loads + validates the bundled sport_fixtures.json derived rows", () => {
    const rows = loadBaselineWhatsOn();
    const sportRows = rows.filter((r) => r.kind === "sport");
    expect(sportRows.length).toBeGreaterThan(0);
    for (const r of sportRows) {
      expect(r.confidence).toBe("derived");
      expect(r.source.label).toBe("Greene King");
      expect(r.source.url).toMatch(/^https?:\/\//);
    }
  });
});

describe("mergeWhatsOn precedence", () => {
  it("a confirmed baseline row beats a listed live row on collision", () => {
    const base = makeRow({ id: "base", confidence: "confirmed", title: "confirmed" });
    const live = makeRow({
      id: "live",
      confidence: "listed",
      title: "listed",
      observedAt: "2026-07-11T19:00:00.000Z",
    });
    const merged = mergeWhatsOn([base], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("confirmed");
  });

  it("with equal confidence the freshest observedAt wins", () => {
    const base = makeRow({ id: "base", observedAt: "2026-07-11T10:00:00.000Z", title: "old" });
    const live = makeRow({ id: "live", observedAt: "2026-07-11T18:00:00.000Z", title: "fresh" });
    const merged = mergeWhatsOn([base], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("fresh");
  });

  it("unions non-colliding rows", () => {
    const merged = mergeWhatsOn([makeRow({ id: "a" })], [makeRow({ id: "b", kind: "music" })]);
    expect(merged).toHaveLength(2);
  });

  it("a derived row never beats a listed/confirmed row at the same (place, kind, startsAt) key", () => {
    // Same regardless of which side (baseline/live) each confidence lands on,
    // and regardless of which one is "fresher" by observedAt — derived:0 must
    // lose the collision outright (CONFIDENCE_RANK), not just on a tie-break.
    const derivedNewer = makeRow({
      id: "derived",
      confidence: "derived",
      title: "derived",
      observedAt: "2026-07-11T19:59:00.000Z",
    });
    const listedOlder = makeRow({
      id: "listed",
      confidence: "listed",
      title: "listed",
      observedAt: "2026-07-11T10:00:00.000Z",
    });
    expect(mergeWhatsOn([listedOlder], [derivedNewer])[0].title).toBe("listed");
    expect(mergeWhatsOn([derivedNewer], [listedOlder])[0].title).toBe("listed");

    const confirmedOlder = makeRow({
      id: "confirmed",
      confidence: "confirmed",
      title: "confirmed",
      observedAt: "2026-07-11T10:00:00.000Z",
    });
    expect(mergeWhatsOn([confirmedOlder], [derivedNewer])[0].title).toBe("confirmed");
  });
});

describe("loadWhatsOn orchestration", () => {
  it("classifies durable provider evidence as provider-observed", async () => {
    const result = await loadWhatsOn(
      { window: "tonight" },
      {
        now: NOW,
        loadBaseline: () => [makeRow({ observedAt: "2026-07-11T19:00:00.000Z" })],
        baselineProviderObservedAt: "2026-07-11T19:00:00.000Z",
        fetchLive: async () => [],
      },
    );
    expect(result.sourceFreshnessKind).toBe("provider-observed");
  });

  it("names a baseline throw as a degraded read, never as an empty night", async () => {
    const result = await loadWhatsOn(
      { window: "tonight" },
      {
        now: NOW,
        loadBaseline: () => {
          throw new Error("pack missing");
        },
        fetchLive: async () => [],
      },
    );
    expect(result.readStatus).toBe("degraded");
    expect(result.rows).toEqual([]);
    // The freshness cron stamps a feed on a MEASURED revalidation. A read that
    // could not run must not stamp an observation of zero rows.
    expect(result.revalidation).toEqual({
      status: "unmeasured",
      reason: "baseline-read-failed",
    });
  });

  it("reports the baseline failure even when the live layer answered", async () => {
    const result = await loadWhatsOn(
      { window: "tonight" },
      {
        now: NOW,
        loadBaseline: () => {
          throw new Error("pack missing");
        },
        fetchLive: async () => ({ rows: [], sourceObservedAt: null, stale: false }),
      },
    );
    expect(result.revalidation).toEqual({
      status: "unmeasured",
      reason: "baseline-read-failed",
    });
  });

  it("keeps ready when the bundled read answered empty", async () => {
    const result = await loadWhatsOn(
      { window: "tonight" },
      { now: NOW, loadBaseline: () => [], fetchLive: async () => [] },
    );
    expect(result.readStatus).toBe("ready");
    expect(result.rows).toEqual([]);
  });

  it("merges live rows and applies kind + tonight + near + limit filters", async () => {
    const baseline = [
      makeRow({ id: "quiz-in", kind: "quiz", startsAt: "2026-07-11T19:30:00+01:00" }),
      makeRow({ id: "quiz-out", kind: "quiz", startsAt: "2026-07-10T19:30:00+01:00" }),
    ];
    const live = [makeRow({ id: "music-in", kind: "music", startsAt: "2026-07-11T21:00:00+01:00" })];
    const { rows } = await loadWhatsOn(
      { window: "tonight", limit: 10 },
      { now: NOW, loadBaseline: () => baseline, fetchLive: async () => live },
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["music-in", "quiz-in"]);

    const musicOnly = await loadWhatsOn(
      { kind: "music" },
      { now: NOW, loadBaseline: () => baseline, fetchLive: async () => live },
    );
    expect(musicOnly.rows.map((r) => r.id)).toEqual(["music-in"]);

    const nearSorted = await loadWhatsOn(
      { near: { lat: 51.5, lng: -0.1 }, limit: 1 },
      {
        now: NOW,
        loadBaseline: () => [
          makeRow({ id: "far", lat: 51.6, lng: -0.3 }),
          makeRow({ id: "near", kind: "music", lat: 51.51, lng: -0.1 }),
        ],
        fetchLive: async () => [],
      },
    );
    expect(nearSorted.rows).toHaveLength(1);
    expect(nearSorted.rows[0].id).toBe("near");
  });

  it("filters pub-surface rows before applying the card limit", async () => {
    const unmatched = Array.from({ length: 60 }, (_, index) =>
      makeRow({ id: `theatre-${index}`, placeName: `Theatre ${index}` }),
    );
    const matched = makeRow({
      id: "matched-pub",
      placeName: "The Pub",
      lat: 51.5,
      lng: -0.1,
    });
    const response = await handleWhatsOnRequest(req("?window=tonight&limit=60&pubOnly=1"), {
      now: NOW,
      loadBaseline: () => unmatched,
      fetchLive: async () => [matched],
      loadVenueMatchIndex: async () =>
        buildOutVenueMatchIndex([
          { id: "pub-1", name: "The Pub", borough: "Camden", lat: 51.5, lng: -0.1 },
        ]),
    });

    const body = await response.json();
    expect(body.rows.map((row: WhatsOnRow) => row.id)).toEqual(["matched-pub"]);
    expect(body.rows[0].venueId).toBe("pub-1");
  });

  it("does not request-time match a bundled row that has no venue identity", async () => {
    const result = await loadWhatsOn(
      {
        window: "tonight",
        pubOnly: true,
        venueMatchIndex: buildOutVenueMatchIndex([
          { id: "pub-1", name: "The Test Arms", borough: "Camden", lat: 51.5, lng: -0.1 },
        ]),
      },
      {
        now: NOW,
        loadBaseline: () => [
          makeRow({ id: "bundled-unresolved", placeName: "The Test Arms", lat: 51.5, lng: -0.1 }),
        ],
        fetchLive: async () => [],
      },
    );

    expect(result.rows).toEqual([]);
  });

  it("drops an ambiguous pub name instead of assigning a guessed venue id", async () => {
    const response = await handleWhatsOnRequest(req("?window=tonight&pubOnly=1"), {
      now: NOW,
      loadBaseline: () => [makeRow({ placeName: "The Pub", lat: 51.5, lng: -0.1 })],
      fetchLive: async () => [],
      loadVenueMatchIndex: async () =>
        buildOutVenueMatchIndex([
          { id: "pub-1", name: "The Pub", borough: "Camden", lat: 51.5, lng: -0.1 },
          { id: "pub-2", name: "The Pub", borough: "Islington", lat: 51.5, lng: -0.1 },
        ]),
    });

    const body = await response.json();
    expect(body.rows).toEqual([]);
  });

  it("drops a stale venue id that is absent from the resolver index", async () => {
    const response = await handleWhatsOnRequest(req("?window=tonight&pubOnly=1"), {
      now: NOW,
      loadBaseline: () => [
        makeRow({ id: "stale-pub", placeName: "The Pub", venueId: "pub-removed" }),
      ],
      fetchLive: async () => [],
      loadVenueMatchIndex: async () =>
        buildOutVenueMatchIndex([
          { id: "pub-1", name: "The Pub", borough: "Camden", lat: 51.5, lng: -0.1 },
        ]),
    });

    const body = await response.json();
    expect(body.rows).toEqual([]);
  });

  it("hides venue-index errors from the public pub-only response", async () => {
    const response = await handleWhatsOnRequest(req("?window=tonight&pubOnly=1"), {
      loadVenueMatchIndex: async () => {
        throw new Error("private venue index path");
      },
    });

    const body = await response.json();
    expect(body).toEqual({ rows: [], error: "Could not check listings." });
  });

  it("keeps London default results inside Greater London before counting families", async () => {
    const london = makeRow({
      id: "london",
      placeName: "The London Arms",
      lat: 51.513,
      lng: -0.118,
    });
    const liverpool = makeRow({
      id: "liverpool",
      placeName: "The Liverpool Arms",
      lat: 53.4303544,
      lng: -2.9574746,
    });

    const result = await loadWhatsOn(
      { window: "tonight", limit: 10 },
      {
        now: NOW,
        loadBaseline: () => [liverpool, london],
        fetchLive: async () => [],
      },
    );

    expect(result.localityBasis).toBe("london-default");
    expect(result.rows.map((row) => row.id)).toEqual(["london"]);
  });

  it("fails closed for a coordinate-less row without London provenance", async () => {
    const result = await loadWhatsOn(
      { window: "tonight", limit: 10 },
      {
        now: NOW,
        loadBaseline: () => [
          makeRow({
            id: "unknown-locality",
            placeName: "The Somewhere Arms",
            area: undefined,
            lat: undefined,
            lng: undefined,
          }),
        ],
        fetchLive: async () => [],
      },
    );

    expect(result.rows).toEqual([]);
  });

  it("drops past-dated rows on the DEFAULT (no window) query path (grace-aware, #408/#409/#417 semantics)", async () => {
    // NOW = 2026-07-11T20:00:00.000Z. The guard reads each row as an interval
    // [startsAt, effectiveEnd] (a point row's end is startsAt + its kind grace,
    // #417) and drops it once that interval has ended, so a point row whose whole
    // grace has elapsed never renders, while an all-day deal still running at NOW
    // correctly survives.
    const baseline = [
      // point row (quiz, no endsAt) whose start + 3h grace has fully elapsed by NOW
      // (14:00+01 = 13:00Z, +3h = 16:00Z < 20:00Z) -> past -> dropped
      makeRow({ id: "point-past", placeName: "Past Arms", startsAt: "2026-07-11T14:00:00+01:00" }),
      // interval row still running at NOW (endsAt in the future) -> kept, even though it started before NOW
      makeRow({
        id: "interval-live",
        placeName: "Live Arms",
        kind: "deal",
        startsAt: "2026-07-11T12:30:00+01:00",
        endsAt: "2026-07-11T23:00:00+01:00",
      }),
      // interval row whose endsAt has already passed -> past -> dropped
      makeRow({
        id: "interval-over",
        placeName: "Over Arms",
        kind: "deal",
        startsAt: "2026-07-11T10:00:00+01:00",
        endsAt: "2026-07-11T15:00:00+01:00",
      }),
      // future point row -> kept
      makeRow({ id: "future", placeName: "Future Arms", startsAt: "2026-07-12T19:30:00+01:00" }),
    ];
    const { rows } = await loadWhatsOn(
      {},
      { now: NOW, loadBaseline: () => baseline, fetchLive: async () => [] },
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["future", "interval-live"]);
  });

  it("removes ended rows before the tonight window, including endsAt === now", async () => {
    const baseline = [
      makeRow({ id: "old", startsAt: "2026-07-10T19:30:00+01:00" }),
      makeRow({
        id: "boundary",
        kind: "deal",
        startsAt: "2026-07-11T18:00:00.000Z",
        endsAt: new Date(NOW).toISOString(),
      }),
    ];
    const { rows } = await loadWhatsOn(
      { window: "tonight" },
      { now: NOW, loadBaseline: () => baseline, fetchLive: async () => [] },
    );
    expect(rows).toEqual([]);
  });

  it("fails soft to baseline and reports dataset freshness when live fetch throws", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [makeRow({ id: "b1" })],
        baselineSourceObservedAt: "2026-07-11T17:00:00.000Z",
        fetchLive: async () => {
          throw new Error("live down");
        },
      },
    );
    expect(result.rows.map((r) => r.id)).toEqual(["b1"]);
    expect(result.servedAt).toBe(new Date(NOW).toISOString());
    // The artifact says it was built at 17:00 and the row it serves says it was
    // observed at 18:00. Both are dates somebody wrote down; the stamp reports
    // the fresher one. Captain decision 2026-08-10.
    expect(result.sourceObservedAt).toBe("2026-07-11T18:00:00.000Z");
    expect(result.sourceFreshnessKind).toBe("dataset-generated");
    expect(result.asOf).toBe(result.sourceObservedAt);
    expect(result.revalidation).toEqual({
      status: "unmeasured",
      reason: "live-provider-failed",
    });
  });

  it("uses provider-observed freshness without confusing it with servedAt", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [],
        fetchLive: async () => ({
          rows: [makeRow({ id: "live" })],
          sourceObservedAt: "2026-07-11T18:30:00.000Z",
        }),
      },
    );
    expect(result.servedAt).toBe("2026-07-11T20:00:00.000Z");
    expect(result.sourceObservedAt).toBe("2026-07-11T18:30:00.000Z");
    expect(result.sourceFreshnessKind).toBe("provider-observed");
    expect(result.asOf).toBe("2026-07-11T18:30:00.000Z");
    expect(result.revalidation).toEqual({ status: "measured" });
  });

  it("marks a stale provider cache as unmeasured", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [],
        fetchLive: async () => ({
          rows: [makeRow({ id: "cached-live" })],
          sourceObservedAt: "2026-07-11T18:30:00.000Z",
          stale: true,
        }),
      },
    );

    expect(result.rows.map((row) => row.id)).toEqual(["cached-live"]);
    expect(result.revalidation).toEqual({
      status: "unmeasured",
      reason: "live-provider-failed",
    });
  });

  it("reports unknown source freshness when provider inventory has no source timestamp", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [],
        fetchLive: async () => ({ rows: [makeRow({ id: "live" })], sourceObservedAt: null }),
      },
    );
    expect(result.rows.map((row) => row.id)).toEqual(["live"]);
    expect(result.sourceObservedAt).toBeNull();
    expect(result.sourceFreshnessKind).toBe("unknown");
    expect(result.asOf).toBeNull();
  });

  it("groups the full provider inventory before applying the final card limit", async () => {
    let fetchArgs: unknown;
    const curry = Array.from({ length: 60 }, (_, index) =>
      makeRow({ id: `curry-${index}`, placeName: `Curry ${index}`, title: "Curry Club" }),
    );
    const distinct = Array.from({ length: 12 }, (_, index) =>
      makeRow({
        id: `distinct-${index}`,
        placeName: `Distinct Arms ${index}`,
        title: `Distinct ${index}`,
      }),
    );
    const result = await loadWhatsOn(
      { window: "tonight", limit: 10 },
      {
        now: NOW,
        loadBaseline: () => [],
        fetchLive: async (args) => {
          fetchArgs = args;
          return { rows: [...curry, ...distinct], sourceObservedAt: "2026-07-11T18:00:00.000Z" };
        },
      },
    );

    expect(fetchArgs).toEqual({ now: NOW });
    // Ten families are selected, but all 60 members of the selected Curry family
    // survive so the existing client expander retains its full venue inventory.
    expect(result.rows).toHaveLength(69);
    expect(result.rows.filter((row) => row.title === "Curry Club")).toHaveLength(60);
    expect(new Set(result.rows.map((row) => row.title)).size).toBe(10);
  });

  it("threads the tonightGrouping V2 flag so distinct schedules split before the limit", async () => {
    // Same title/source/kind, two schedules, two venues each. The shipped collapse
    // folds all four into one card; V2 keeps the two schedule-distinct cards, so a
    // limit of one selects different inventory under each behaviour.
    const sched1 = "2026-07-11T22:00:00+01:00";
    const sched2 = "2026-07-11T23:00:00+01:00";
    const rows = [
      makeRow({ id: "a1", placeName: "A1", venueId: "va1", startsAt: sched1 }),
      makeRow({ id: "a2", placeName: "A2", venueId: "va2", startsAt: sched1 }),
      makeRow({ id: "b1", placeName: "B1", venueId: "vb1", startsAt: sched2 }),
      makeRow({ id: "b2", placeName: "B2", venueId: "vb2", startsAt: sched2 }),
    ];
    const deps = { now: NOW, loadBaseline: () => [], fetchLive: async () => ({ rows, sourceObservedAt: null }) };

    const off = await loadWhatsOn({ window: "tonight", limit: 1 }, { ...deps, tonightGroupingV2: false });
    expect(off.rows).toHaveLength(4); // one collapsed family carries all four venues
    expect(new Set(off.rows.map((r) => r.startsAt)).size).toBe(2);

    const on = await loadWhatsOn({ window: "tonight", limit: 1 }, { ...deps, tonightGroupingV2: true });
    expect(on.rows).toHaveLength(2); // only the first schedule-distinct family survives the limit
    expect(new Set(on.rows.map((r) => r.startsAt)).size).toBe(1);
  });

  it("reports locality basis independently from source freshness", async () => {
    const live = await loadWhatsOn(
      { near: { lat: 51.5, lng: -0.1 } },
      { now: NOW, loadBaseline: () => [], fetchLive: async () => [] },
    );
    expect(live.localityBasis).toBe("live-location");

    const remembered = await loadWhatsOn(
      {
        near: { lat: 51.51, lng: -0.12 },
        localityBasis: "remembered-patch",
      },
      { now: NOW, loadBaseline: () => [], fetchLive: async () => [] },
    );
    expect(remembered.localityBasis).toBe("remembered-patch");

    const fallback = await loadWhatsOn(
      {},
      { now: NOW, loadBaseline: () => [], fetchLive: async () => [] },
    );
    expect(fallback.localityBasis).toBe("london-default");
  });
});


// A "Checked" stamp is a claim that somebody looked, so it may only ever be
// built from a date somebody wrote into an artifact. It used to report the
// OLDEST contributing dataset, so one feed nobody had rebuilt since July dated
// the whole page while the deals feed beside it was rebuilt that morning.
// Captain decision 2026-08-10: report the freshest confirmation available at
// request time - with the clause that a stamp about ONE source still comes from
// that source, so a July lane still says July.
describe("the freshest confirmation available at request time", () => {
  it("reports the freshest bundled artifact, not the oldest", () => {
    const bundled = baselineSourceObservedAt(Date.parse("2027-01-01T00:00:00.000Z"));
    expect(bundled).not.toBeNull();
    const rows = loadBaselineWhatsOn();
    const freshestRow = rows
      .map((row) => Date.parse(row.observedAt))
      .filter((ms) => Number.isFinite(ms))
      .reduce((best, ms) => Math.max(best, ms), Number.NEGATIVE_INFINITY);
    // Nothing invented: the answer is one of the artifacts' own dates, and no
    // row the store serves was confirmed after it.
    expect(Date.parse(bundled as string)).toBeLessThanOrEqual(freshestRow);
    const oldest = rows
      .map((row) => Date.parse(row.observedAt))
      .filter((ms) => Number.isFinite(ms))
      .reduce((best, ms) => Math.min(best, ms), Number.POSITIVE_INFINITY);
    expect(Date.parse(bundled as string)).toBeGreaterThan(oldest);
  });

  it("takes the max of the artifact date and the rows the answer carries", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [
          makeRow({ id: "old", observedAt: "2026-07-11T09:00:00.000Z" }),
          makeRow({ id: "new", placeName: "Newer Arms", observedAt: "2026-07-11T19:00:00.000Z" }),
        ],
        baselineSourceObservedAt: "2026-07-11T12:00:00.000Z",
        fetchLive: async () => [],
      },
    );
    expect(result.sourceObservedAt).toBe("2026-07-11T19:00:00.000Z");
    expect(result.sourceFreshnessKind).toBe("dataset-generated");
  });

  it("never reaches past the evidence: an all-July answer stays in July", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: Date.parse("2026-08-10T13:00:00.000Z"),
        loadBaseline: () => [
          makeRow({
            id: "july",
            startsAt: "2026-08-10T22:00:00+01:00",
            observedAt: "2026-07-18T21:20:05.134Z",
          }),
        ],
        baselineSourceObservedAt: "2026-07-18T21:20:05.134Z",
        fetchLive: async () => [],
      },
    );
    // The request instant is August. The stamp is not.
    expect(result.sourceObservedAt).toBe("2026-07-18T21:20:05.134Z");
    expect(result.servedAt).toBe("2026-08-10T13:00:00.000Z");
  });

  it("refuses a live row's observedAt as evidence", async () => {
    // mapThingsToDoToRows falls back to the request instant when the provider
    // omits its own timestamp, so a live row can date itself "now" with nobody
    // having checked anything. Only the provider's own sourceObservedAt speaks
    // for the live layer.
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [],
        fetchLive: async () => ({
          rows: [makeRow({ id: "live", observedAt: new Date(NOW).toISOString() })],
          sourceObservedAt: null,
        }),
      },
    );
    expect(result.rows.map((row) => row.id)).toEqual(["live"]);
    expect(result.sourceObservedAt).toBeNull();
    expect(result.sourceFreshnessKind).toBe("unknown");
    expect(result.kindObservedAt).toEqual({});
  });

  it("prefers the provider only while the provider is the fresher one", async () => {
    const deps = {
      now: NOW,
      loadBaseline: () => [makeRow({ id: "b1", observedAt: "2026-07-11T19:30:00.000Z" })],
      baselineSourceObservedAt: "2026-07-11T10:00:00.000Z",
    };
    const providerFresher = await loadWhatsOn(
      {},
      {
        ...deps,
        fetchLive: async () => ({ rows: [], sourceObservedAt: "2026-07-11T19:45:00.000Z" }),
      },
    );
    expect(providerFresher.sourceObservedAt).toBe("2026-07-11T19:45:00.000Z");
    expect(providerFresher.sourceFreshnessKind).toBe("provider-observed");

    const bundledFresher = await loadWhatsOn(
      {},
      {
        ...deps,
        fetchLive: async () => ({ rows: [], sourceObservedAt: "2026-07-11T11:00:00.000Z" }),
      },
    );
    expect(bundledFresher.sourceObservedAt).toBe("2026-07-11T19:30:00.000Z");
    expect(bundledFresher.sourceFreshnessKind).toBe("dataset-generated");
  });

  it("keeps durable provider provenance when bundled evidence is newer", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [makeRow({ observedAt: "2026-07-11T10:00:00.000Z" })],
        baselineSourceObservedAt: "2026-07-11T19:00:00.000Z",
        baselineProviderObservedAt: "2026-07-11T10:00:00.000Z",
        fetchLive: async () => [],
      },
    );
    expect(result.sourceObservedAt).toBe("2026-07-11T10:00:00.000Z");
    expect(result.sourceFreshnessKind).toBe("provider-observed");
  });

  it("dates a live-carried kind by the provider's stated time, never by the row", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [],
        fetchLive: async () => ({
          // The row dates itself "now" because the provider omitted a timestamp
          // upstream; only the provider's OWN stated observation may speak.
          rows: [makeRow({ id: "live", kind: "music", observedAt: new Date(NOW).toISOString() })],
          sourceObservedAt: "2026-07-11T18:15:00.000Z",
        }),
      },
    );
    expect(result.kindObservedAt).toEqual({ music: "2026-07-11T18:15:00.000Z" });
    expect(result.sourceFreshnessKind).toBe("provider-observed");
  });

  it("dates each kind from its own source, so a July lane still says July", async () => {
    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [
          makeRow({ id: "music", kind: "music", placeName: "Gig Arms", observedAt: "2026-07-01T12:00:00.000Z" }),
          makeRow({ id: "deal", kind: "deal", placeName: "Deal Arms", observedAt: "2026-07-11T19:00:00.000Z" }),
          makeRow({ id: "deal-older", kind: "deal", placeName: "Older Arms", observedAt: "2026-07-02T19:00:00.000Z" }),
        ],
        fetchLive: async () => [],
      },
    );
    // The page as a whole can show the deals rebuild...
    expect(result.sourceObservedAt).toBe("2026-07-11T19:00:00.000Z");
    // ...and the music lane still reports the day music was last confirmed.
    expect(result.kindObservedAt).toEqual({
      music: "2026-07-01T12:00:00.000Z",
      deal: "2026-07-11T19:00:00.000Z",
    });
    // A kind with no rows in this answer is ABSENT, never null-filled with
    // somebody else's date.
    expect(result.kindObservedAt.quiz).toBeUndefined();
  });
});

describe("GET /api/whats-on serves the current service day and no other", () => {
  // A bare GET used to answer with every future row the bundled files held. On
  // Sunday 30 August 2026 that was 384 Wetherspoon weekday food clubs and
  // 244 KB, served as what is on tonight, on a night this same read had nothing
  // for. The scope is no longer a parameter a caller has to think to send.
  const TUESDAY_ROW = makeRow({
    id: "jdw-burgers-tuesday",
    kind: "deal",
    title: "Gourmet Burgers Club - every Tuesday",
    // Well past NOW's service day (Saturday 11 July 2026, London).
    startsAt: "2026-07-14T11:30:00+01:00",
    endsAt: "2026-07-14T23:00:00+01:00",
  });

  it("drops a row belonging to another day from a bare request", async () => {
    const res = await handleWhatsOnRequest(req(), {
      now: NOW,
      loadBaseline: () => [TUESDAY_ROW],
      fetchLive: async () => [],
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
    // An empty night is an honest empty, never an error.
    expect(body.error).toBeUndefined();
  });

  it("keeps a row that is on tonight", async () => {
    const res = await handleWhatsOnRequest(req(), {
      now: NOW,
      loadBaseline: () => [makeRow(), TUESDAY_ROW],
      fetchLive: async () => [],
    });
    const body = await res.json();
    expect(body.rows.map((row: WhatsOnRow) => row.id)).toEqual(["r1"]);
  });

  it("answers a kind with no rows tonight with nothing, rather than advertising it", async () => {
    const res = await handleWhatsOnRequest(req("?kind=deal"), {
      now: NOW,
      loadBaseline: () => [makeRow(), TUESDAY_ROW],
      fetchLive: async () => [],
    });
    const body = await res.json();
    expect(body.rows).toEqual([]);
  });

  it("gives an unrecognised window the same service day, not the whole horizon", async () => {
    const res = await handleWhatsOnRequest(req("?window=everything"), {
      now: NOW,
      loadBaseline: () => [TUESDAY_ROW],
      fetchLive: async () => [],
    });
    expect((await res.json()).rows).toEqual([]);
  });

  it("still means the same thing when a caller asks for tonight explicitly", async () => {
    const bare = await handleWhatsOnRequest(req(), {
      now: NOW,
      loadBaseline: () => [makeRow(), TUESDAY_ROW],
      fetchLive: async () => [],
    });
    const explicit = await handleWhatsOnRequest(req("?window=tonight"), {
      now: NOW,
      loadBaseline: () => [makeRow(), TUESDAY_ROW],
      fetchLive: async () => [],
    });
    expect((await bare.json()).rows).toEqual((await explicit.json()).rows);
  });
});

describe("GET /api/whats-on (handleWhatsOnRequest)", () => {
  it("returns honest freshness fields and no-store caching", async () => {
    const res = await handleWhatsOnRequest(req(), {
      now: NOW,
      loadBaseline: () => [makeRow()],
      baselineSourceObservedAt: "2026-07-11T17:00:00.000Z",
      fetchLive: async () => [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body).toMatchObject({
      servedAt: "2026-07-11T20:00:00.000Z",
      // Freshest of the artifact's own build date (17:00) and the row it serves
      // (18:00). servedAt stays a separate field and never feeds this one.
      sourceObservedAt: "2026-07-11T18:00:00.000Z",
      sourceFreshnessKind: "dataset-generated",
      kindObservedAt: { quiz: "2026-07-11T18:00:00.000Z" },
      localityBasis: "london-default",
      asOf: "2026-07-11T18:00:00.000Z",
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("forwards an injected tonightGrouping V2 flag through to grouping", async () => {
    const sched1 = "2026-07-11T22:00:00+01:00";
    const sched2 = "2026-07-11T23:00:00+01:00";
    const rows = [
      makeRow({ id: "a1", placeName: "A1", venueId: "va1", startsAt: sched1 }),
      makeRow({ id: "a2", placeName: "A2", venueId: "va2", startsAt: sched1 }),
      makeRow({ id: "b1", placeName: "B1", venueId: "vb1", startsAt: sched2 }),
      makeRow({ id: "b2", placeName: "B2", venueId: "vb2", startsAt: sched2 }),
    ];
    const deps = { now: NOW, loadBaseline: () => [], fetchLive: async () => ({ rows, sourceObservedAt: null }) };

    // The server route injects tonightGroupingV2 from the canonical flag reader;
    // the handler forwards it to the store. Off keeps the shipped collapse, on
    // splits distinct schedules before the limit.
    const off = await (await handleWhatsOnRequest(req("?window=tonight&limit=1"), { ...deps, tonightGroupingV2: false })).json();
    expect(off.rows).toHaveLength(4);

    const on = await (await handleWhatsOnRequest(req("?window=tonight&limit=1"), { ...deps, tonightGroupingV2: true })).json();
    expect(on.rows).toHaveLength(2);
  });

  it("applies params; unknown kind and bad near are dropped, not 400", async () => {
    const baseline = [
      makeRow({ id: "quiz1", kind: "quiz" }),
      makeRow({ id: "music1", kind: "music", lat: 51.51, lng: -0.1 }),
    ];
    const unknown = await handleWhatsOnRequest(req("?kind=bogus&near=not,coords"), {
      now: NOW,
      loadBaseline: () => baseline,
      fetchLive: async () => [],
    });
    expect(unknown.status).toBe(200);
    expect((await unknown.json()).rows).toHaveLength(2);

    const kinded = await handleWhatsOnRequest(req("?kind=music&near=51.5,-0.1&limit=1"), {
      now: NOW,
      loadBaseline: () => baseline,
      fetchLive: async () => [],
    });
    const body = await kinded.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe("music1");
  });

  it("returns { rows: [], error } (never 500) when the bundled read cannot answer", async () => {
    const res = await handleWhatsOnRequest(req(), {
      now: NOW,
      loadBaseline: () => {
        throw new Error("baseline corrupt");
      },
      fetchLive: async () => [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.error).toBe("Could not check listings.");
  });

  it("429s past its own ~60/min-per-IP budget, separate from the CityMCP surface", async () => {
    const deps = { now: NOW, loadBaseline: () => [makeRow()], fetchLive: async () => [] };
    const responses: Response[] = [];
    for (let i = 0; i < 61; i++) {
      responses.push(
        await handleWhatsOnRequest(
          new Request("http://localhost/api/whats-on", {
            headers: { "x-forwarded-for": "198.51.100.40" },
          }),
          deps,
        ),
      );
    }

    expect(responses.slice(0, 60).every((res) => res.status !== 429)).toBe(true);
    expect(responses[60].status).toBe(429);
    expect(await responses[60].json()).toEqual({
      rows: [],
      error: "Too many requests, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });
});
