import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountAuthSnapshot } from "@/lib/accountBoundFetch";

const events = vi.hoisted(
  () => [] as Array<{ name: string; props: Record<string, unknown> }>,
);

vi.mock("@/lib/analytics", () => ({
  trackEvent: (name: string, props: Record<string, unknown> = {}) => {
    events.push({ name, props });
  },
}));

const postState = vi.hoisted(() => ({ ok: true, state: "fresh" }));

vi.mock("@/lib/accountBoundFetch", () => ({
  captureAccountAuth: () => ({}) as AccountAuthSnapshot,
  accountBoundFetch: async () =>
    postState.ok
      ? new Response(
          JSON.stringify({
            now: "full",
            ageMinutes: 0,
            reportersLast90: 1,
            degraded: false,
            state: postState.state,
            level: "full",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      : new Response(JSON.stringify({ error: { message: "Nope." } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
}));

import {
  __resetOccupancyReadTracking,
  confirmOccupancyProposal,
  trackOccupancyRead,
} from "@/components/map/useVenueOccupancy";

const auth = {} as AccountAuthSnapshot;

function reads(): Array<Record<string, unknown>> {
  return events.filter((e) => e.name === "occupancy_read").map((e) => e.props);
}

beforeEach(() => {
  events.length = 0;
  postState.ok = true;
  postState.state = "fresh";
  __resetOccupancyReadTracking();
});

describe("occupancy_read emission policy", () => {
  it("emits once per venue and state, whichever surface asked", () => {
    trackOccupancyRead("venue-1", "fresh");
    trackOccupancyRead("venue-1", "fresh");

    expect(reads()).toEqual([{ state: "fresh" }]);

    trackOccupancyRead("venue-1", "stale");
    trackOccupancyRead("venue-2", "fresh");

    expect(reads()).toEqual([
      { state: "fresh" },
      { state: "stale" },
      { state: "fresh" },
    ]);
  });

  it("never emits a state outside the closed read set", () => {
    trackOccupancyRead("venue-1", "unknown");
    trackOccupancyRead("venue-1", "");

    expect(reads()).toEqual([]);
  });

  it("holds the Pal and map-Ask confirms to that one policy", async () => {
    const first = await confirmOccupancyProposal(
      { venueId: "venue-1", level: "full" },
      auth,
      "pal",
    );
    const second = await confirmOccupancyProposal(
      { venueId: "venue-1", level: "full" },
      auth,
      "pal",
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(
      events.filter((e) => e.name === "occupancy_reported"),
    ).toHaveLength(2);
    expect(reads()).toEqual([{ state: "fresh" }]);
  });

  it("reports nothing at all when the write was refused", async () => {
    postState.ok = false;

    const result = await confirmOccupancyProposal(
      { venueId: "venue-1", level: "full" },
      auth,
      "pal",
    );

    expect(result.ok).toBe(false);
    expect(events).toEqual([]);
  });

  it("asks for no report and names no venue when nobody is signed in", async () => {
    const result = await confirmOccupancyProposal(
      { venueId: "venue-1", level: "full" },
      null,
      "venue-sheet",
    );

    expect(result).toMatchObject({ ok: false, needsSignIn: true });
    expect(events).toEqual([]);
  });
});
