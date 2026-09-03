import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OCCUPANCY_RETAKE_WINDOW_MS } from "@/lib/occupancy";
import {
  __resetFeedFreshnessStore,
  memoryFeedFreshnessStore,
} from "@/lib/feedFreshnessStore";
import {
  __resetMemoryOccupancyReports,
  memoryOccupancyStore,
  occupancyStore,
  supabaseOccupancyStore,
} from "@/lib/occupancyStore";

// The durable table is absent: exactly the window between a code deploy and
// migration 0107 being applied.
const supabaseState = vi.hoisted(() => ({ configured: false }));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => supabaseState.configured,
  requireSupabaseAdmin: () => {
    throw new Error(
      "Could not find the table 'public.venue_occupancy_reports' in the schema cache",
    );
  },
}));

const NOW = Date.parse("2026-08-16T18:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  supabaseState.configured = false;
  __resetFeedFreshnessStore();
  __resetMemoryOccupancyReports();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.VERCEL_ENV;
});

describe("occupancyStore", () => {
  it("writes a signed-in crowd report and reads it as now", async () => {
    const stored = await occupancyStore().report({
      venueId: "venue-1",
      level: "some-seats",
      reporterUserId: "user-a",
    });
    expect(stored.level).toBe("some-seats");
    expect(stored.source).toBe("crowd");
    expect(stored.reporterUserId).toBe("user-a");

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.degraded).toBe(false);
    expect(reading.now).toBe("some-seats");
    expect(reading.ageMinutes).toBe(0);
    expect(reading.reportersLast90).toBe(1);
    expect(reading.state).toBe("fresh");
  });

  it("updates a re-tap inside 15 minutes instead of stacking", async () => {
    await occupancyStore().report({
      venueId: "venue-1",
      level: "empty",
      reporterUserId: "user-a",
    });
    vi.setSystemTime(NOW + OCCUPANCY_RETAKE_WINDOW_MS - 1_000);
    const updated = await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });
    expect(updated.level).toBe("full");

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.reportersLast90).toBe(1);
    expect(reading.now).toBe("full");
  });

  it("keeps an older row once the retake window closes", async () => {
    const first = await occupancyStore().report({
      venueId: "venue-1",
      level: "empty",
      reporterUserId: "user-a",
    });
    vi.setSystemTime(NOW + OCCUPANCY_RETAKE_WINDOW_MS + 1_000);
    const second = await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });

    // Two rows, because the retake window closed between them.
    expect(second.id).not.toBe(first.id);

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.now).toBe("full");
    expect(reading.id).toBe(second.id);
    // Still one drinker: rows are not corroboration.
    expect(reading.reportersLast90).toBe(1);
  });

  it("counts two accounts as two people", async () => {
    await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });
    await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-b",
    });

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.reportersLast90).toBe(2);
  });

  it("drops a reading past 90 minutes and still answers, never as a failed empty", async () => {
    await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });
    vi.setSystemTime(NOW + 91 * 60 * 1000);

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.degraded).toBe(false);
    expect(reading.now).toBeNull();
    expect(reading.state).toBe("stale");
    expect(reading.reportersLast90).toBe(0);
  });

  it("drops a hidden report from the now reading and keeps the row", async () => {
    const stored = await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });
    expect(await occupancyStore().flag(stored.id, "not true", "actor-1")).toBe(
      true,
    );
    expect(await occupancyStore().moderate(stored.id, true)).toBe(true);

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.now).toBeNull();
    expect(reading.reportersLast90).toBe(0);
    expect(reading.state).toBe("none");

    expect(await occupancyStore().moderate(stored.id, false)).toBe(true);
    const restored = await occupancyStore().readNow("venue-1");
    expect(restored.now).toBe("full");
    expect(restored.reportersLast90).toBe(1);
  });

  it("never retakes a hidden row, so a hide is not laundered into the next report", async () => {
    const hidden = await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });
    expect(await occupancyStore().moderate(hidden.id, true)).toBe(true);

    // Inside the 15-minute retake window, so the pre-fix store UPDATEd the
    // hidden row and the drinker's honest reading never appeared.
    vi.setSystemTime(NOW + OCCUPANCY_RETAKE_WINDOW_MS / 2);
    const fresh = await occupancyStore().report({
      venueId: "venue-1",
      level: "empty",
      reporterUserId: "user-a",
    });

    expect(fresh.id).not.toBe(hidden.id);
    expect(fresh.hiddenAt).toBeNull();

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.now).toBe("empty");
    expect(reading.reportersLast90).toBe(1);
    expect(reading.id).toBe(fresh.id);
  });
});

describe("occupancy read before the durable table exists", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("answers degraded in deployed production, never as no reports", async () => {
    process.env.VERCEL_ENV = "production";

    const reading = await supabaseOccupancyStore.readNow("venue-1");

    expect(reading.degraded).toBe(true);
    expect(reading.state).toBe("degraded");
    expect(reading.now).toBeNull();
  });

  it("keeps the memory backend outside a deployed production instance", async () => {
    process.env.VERCEL_ENV = "preview";
    await memoryOccupancyStore.report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });

    const reading = await supabaseOccupancyStore.readNow("venue-1");

    expect(reading.degraded).toBe(false);
    expect(reading.state).toBe("fresh");
    expect(reading.now).toBe("full");
  });

  it("refuses production moderation writes when the durable schema is missing", async () => {
    process.env.VERCEL_ENV = "production";
    supabaseState.configured = true;
    const stored = await memoryOccupancyStore.report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });

    await expect(
      supabaseOccupancyStore.flag(stored.id, "not true", "actor-1"),
    ).rejects.toThrow(/refusing process-memory write fallback.*0107 and 0109/);
    await expect(supabaseOccupancyStore.moderate(stored.id, true)).rejects.toThrow(
      /refusing process-memory write fallback.*0107 and 0109/,
    );

    await expect(memoryOccupancyStore.readNow("venue-1")).resolves.toMatchObject({
      now: "full",
      state: "fresh",
    });
  });

  it("keeps another store's memory rows when occupancy resets", async () => {
    await memoryOccupancyStore.report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });
    await memoryFeedFreshnessStore.stamp({
      feed: "reset-isolation",
      observedAt: "2026-08-16T18:00:00.000Z",
    });

    __resetMemoryOccupancyReports();

    await expect(memoryOccupancyStore.readNow("venue-1")).resolves.toMatchObject({
      state: "none",
    });
    await expect(memoryFeedFreshnessStore.read("reset-isolation")).resolves.toMatchObject({
      feed: "reset-isolation",
    });
  });

  it("keeps occupancy rows when feed freshness resets", async () => {
    await memoryOccupancyStore.report({
      venueId: "venue-inverse-reset",
      level: "some-seats",
      reporterUserId: "user-a",
    });
    await memoryFeedFreshnessStore.stamp({
      feed: "inverse-reset",
      observedAt: "2026-08-16T18:00:00.000Z",
    });

    __resetFeedFreshnessStore();

    await expect(memoryFeedFreshnessStore.read("inverse-reset")).resolves.toBeNull();
    await expect(memoryOccupancyStore.readNow("venue-inverse-reset")).resolves.toMatchObject({
      now: "some-seats",
      state: "fresh",
    });
  });
});
