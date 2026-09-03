import { describe, expect, it, vi } from "vitest";

// The hard seam of the ambient demo layer (PRD next-wave P2): when Supabase IS
// configured, recentPresenceWithAmbient must return REAL presence only — the
// deterministic demo curve never mixes into (or overrides) live data. We mock
// the Supabase client module so "configured" is true without any network, and
// the stub returns one known live row.

vi.mock("@/lib/supabase", () => {
  const result = {
    data: [
      {
        handle: "live_sam",
        venue_id: "venue-16pnwmm",
        created_at: "2026-07-07T21:00:00.000Z",
      },
    ],
    error: null,
  };
  // The store chains .from().select().gt().order().limit() then optionally
  // .eq(), and awaits the tail — so the tail must be a thenable carrying .eq.
  const tail: Promise<typeof result> & { eq?: () => unknown } = Object.assign(
    Promise.resolve(result),
    { eq: () => tail },
  );
  const chain = {
    select: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: () => tail,
  };
  const admin = () => ({ from: () => chain });
  return {
    isSupabaseConfigured: () => true,
    getSupabaseAdmin: admin,
    requireSupabaseAdmin: admin,
  };
});

import { recentPresenceWithAmbient } from "@/lib/presenceStore";
import { ambientPresenceRows } from "@/lib/ambientPresence";

// 22:00 London (BST) — peak hour, so the ambient layer WOULD be non-empty if it
// leaked past the Supabase gate.
const PEAK = Date.UTC(2026, 6, 7, 21, 5, 0);

describe("recentPresenceWithAmbient — Supabase configured", () => {
  it("returns real presence only; no demo rows even at peak hour", async () => {
    // Precondition: the ambient layer is genuinely non-empty at this instant —
    // otherwise this test would pass vacuously.
    expect(ambientPresenceRows(new Date(PEAK)).length).toBeGreaterThan(0);

    const rows = await recentPresenceWithAmbient(undefined, PEAK);
    expect(rows).toHaveLength(1);
    expect(rows[0].handle).toBe("live_sam");
    expect(rows[0].provenance).toBeUndefined();
    expect(rows.every((r) => r.provenance !== "demo")).toBe(true);
  });
});
