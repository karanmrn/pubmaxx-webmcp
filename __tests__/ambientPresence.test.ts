import { beforeEach, describe, expect, it } from "vitest";

// Deterministic ambient DEMO presence (PRD next-wave P2, second half): the
// time-of-day curve (lib/ambientPresence) and its wiring into the fallback
// presence read (lib/presenceStore.recentPresenceWithAmbient).
//
// FORCE the in-memory path (see presenceStore.test.ts): on Vercel vitest runs
// under the project's env, so Supabase keys must be cleared or the store would
// pick the network backend and these cases would fail only in CI.

import {
  ambientPresenceCurve,
  ambientPresenceRows,
  londonHour,
  MAX_AMBIENT_PER_VENUE,
} from "@/lib/ambientPresence";
import {
  markPresence,
  recentPresenceWithAmbient,
  __resetPresence,
} from "@/lib/presenceStore";
import { demoPintDrops } from "@/lib/pintDropSeeds";

// Fixed instants (UTC — July, so Europe/London is UTC+1). Chosen so the London
// wall-clock hour is unambiguous per case.
const AFTERNOON = new Date(Date.UTC(2026, 6, 7, 13, 30, 0)); // 14:30 London
const EVENING = new Date(Date.UTC(2026, 6, 7, 17, 30, 0)); // 18:30 London
const PEAK = new Date(Date.UTC(2026, 6, 7, 21, 0, 0)); // 22:00 London
const SHUT = new Date(Date.UTC(2026, 6, 7, 4, 0, 0)); // 05:00 London

const VENUES = ["venue-16pnwmm", "venue-ekvkuv", "venue-1yd70c7", "venue-abc123"];

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetPresence();
});

describe("londonHour", () => {
  it("maps a UTC instant to the Europe/London wall-clock hour (BST in July)", () => {
    expect(londonHour(PEAK)).toBe(22);
    expect(londonHour(AFTERNOON)).toBe(14);
    expect(londonHour(SHUT)).toBe(5);
  });
});

describe("ambientPresenceCurve — shape", () => {
  it("peaks in the 21:00–23:00 band above the afternoon, for every venue", () => {
    for (const venue of VENUES) {
      const peak = ambientPresenceCurve(venue, PEAK);
      const afternoon = ambientPresenceCurve(venue, AFTERNOON);
      expect(peak).toBeGreaterThan(afternoon);
    }
  });

  it("builds through the evening: peak ≥ early evening ≥ afternoon", () => {
    for (const venue of VENUES) {
      const afternoon = ambientPresenceCurve(venue, AFTERNOON);
      const evening = ambientPresenceCurve(venue, EVENING);
      const peak = ambientPresenceCurve(venue, PEAK);
      expect(evening).toBeGreaterThanOrEqual(afternoon);
      expect(peak).toBeGreaterThanOrEqual(evening);
    }
  });

  it("is zero during shut hours (deep night / morning)", () => {
    for (const venue of VENUES) {
      expect(ambientPresenceCurve(venue, SHUT)).toBe(0);
      expect(ambientPresenceCurve(venue, new Date(Date.UTC(2026, 6, 7, 8, 0, 0)))).toBe(0);
    }
  });

  it("tails off after midnight (below the peak, above shut)", () => {
    const afterMidnight = new Date(Date.UTC(2026, 6, 7, 23, 30, 0)); // 00:30 London
    for (const venue of VENUES) {
      const tail = ambientPresenceCurve(venue, afterMidnight);
      expect(tail).toBeGreaterThanOrEqual(1);
      expect(tail).toBeLessThan(ambientPresenceCurve(venue, PEAK));
    }
  });
});

describe("ambientPresenceCurve — determinism + bounds", () => {
  it("same (venue, hour) always yields the same count — including across dates", () => {
    for (const venue of VENUES) {
      const a = ambientPresenceCurve(venue, PEAK);
      const b = ambientPresenceCurve(venue, PEAK);
      // A different DAY at the same wall-clock hour keys the same seed.
      const c = ambientPresenceCurve(venue, new Date(Date.UTC(2026, 6, 14, 21, 0, 0)));
      expect(b).toBe(a);
      expect(c).toBe(a);
    }
  });

  it("is non-negative and never exceeds the per-venue cap, across all 24 hours", () => {
    for (const venue of VENUES) {
      for (let h = 0; h < 24; h += 1) {
        const at = new Date(Date.UTC(2026, 6, 7, h, 15, 0));
        const count = ambientPresenceCurve(venue, at);
        expect(count).toBeGreaterThanOrEqual(0);
        expect(count).toBeLessThanOrEqual(MAX_AMBIENT_PER_VENUE);
        expect(Number.isInteger(count)).toBe(true);
      }
    }
  });
});

describe("ambientPresenceRows", () => {
  it("draws only from the seeded demo personas, freshest-first, recent timestamps", () => {
    const rows = ambientPresenceRows(PEAK);
    expect(rows.length).toBeGreaterThan(0);
    const personas = new Set(demoPintDrops.map((d) => `${d.venueId}|${d.handle}`));
    for (const row of rows) {
      expect(personas.has(`${row.venueId}|${row.handle}`)).toBe(true);
      const ageMs = PEAK.getTime() - new Date(row.at).getTime();
      expect(ageMs).toBeGreaterThan(0);
      expect(ageMs).toBeLessThanOrEqual(60 * 60_000); // within the last hour
    }
    const ats = rows.map((r) => r.at);
    expect(ats).toEqual([...ats].sort().reverse());
  });

  it("is deterministic for the same instant and empty during shut hours", () => {
    expect(ambientPresenceRows(PEAK)).toEqual(ambientPresenceRows(PEAK));
    expect(ambientPresenceRows(SHUT)).toEqual([]);
  });

  it("scopes to one venue when asked", () => {
    const rows = ambientPresenceRows(PEAK, "venue-16pnwmm");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.venueId).toBe("venue-16pnwmm");
  });

  it("shows more people out at peak than in the afternoon (city-wide)", () => {
    expect(ambientPresenceRows(PEAK).length).toBeGreaterThan(
      ambientPresenceRows(AFTERNOON).length,
    );
  });
});

describe("recentPresenceWithAmbient — fallback wiring", () => {
  it("tags every ambient row provenance:'demo' and enriches it like a real row", async () => {
    const rows = await recentPresenceWithAmbient(undefined, PEAK.getTime());
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.provenance).toBe("demo");
      expect(typeof row.venueName).toBe("string");
      expect(row.venueName.length).toBeGreaterThan(0);
      expect(row.venueMapUrl).toBe(`/map?sel=${encodeURIComponent(row.venueId)}`);
    }
  });

  it("keeps real in-memory taps first and NEVER marks them demo", async () => {
    await markPresence(
      { handle: "real_ken", venueId: "venue-16pnwmm", actorHash: "actor-1" },
      PEAK.getTime(),
    );
    const rows = await recentPresenceWithAmbient(undefined, PEAK.getTime() + 1000);
    expect(rows[0].handle).toBe("real_ken");
    expect(rows[0].provenance).toBeUndefined();
    expect(rows.some((r) => r.provenance === "demo")).toBe(true);
  });

  it("a real tap by a demo persona wins over its ambient twin (no duplicates)", async () => {
    const ambient = ambientPresenceRows(PEAK);
    const twin = ambient[0];
    await markPresence(
      { handle: twin.handle, venueId: twin.venueId, actorHash: "actor-twin" },
      PEAK.getTime(),
    );
    const rows = await recentPresenceWithAmbient(undefined, PEAK.getTime() + 1000);
    const matches = rows.filter(
      (r) => r.handle === twin.handle && r.venueId === twin.venueId,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].provenance).toBeUndefined();
  });

  it("returns [] during shut hours when nobody real is out (honest empty strip)", async () => {
    await expect(recentPresenceWithAmbient(undefined, SHUT.getTime())).resolves.toEqual([]);
  });
});
