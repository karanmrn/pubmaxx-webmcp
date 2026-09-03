import { describe, expect, it, vi } from "vitest";

import { planGetInReport, type VenueLookup } from "@/lib/planGetIn";
import type { PlanState } from "@/lib/plan";

function fixtureState(crewCount: number): PlanState {
  const now = "2026-07-10T18:00:00.000Z";
  return {
    plan: { id: "11111111-1111-4111-8111-111111111111", title: "Test Plan", startTime: now, createdAt: now, routeRevision: 1 },
    stops: [
      { venueId: "venue-b", venueName: "The Second", position: 1 },
      { venueId: "venue-a", venueName: "The First", position: 0 },
    ],
    crew: Array.from({ length: crewCount }, (_, index) => ({
      id: `crew-${index}`,
      name: `Crew ${index}`,
      status: "in" as const,
      joinedAt: now,
      updatedAt: now,
    })),
  };
}

// Friday 21:00 Europe/London (no DST in Jan) — busyness.typicalLevel treats
// Fri/Sat 20:00-23:30 as "busy".
const BUSY_FRIDAY_NIGHT = new Date("2024-01-05T21:00:00.000Z");

describe("planGetInReport", () => {
  it("returns the getin contract shape, sorted by position, with a real groupSize", async () => {
    const state = fixtureState(3);
    const lookup: VenueLookup = vi.fn(async (venueId) =>
      venueId === "venue-a" ? { bookingLink: "https://book.example.com/a" } : null,
    );

    const report = await planGetInReport(state, lookup, BUSY_FRIDAY_NIGHT);

    expect(report.groupSize).toBe(3);
    expect(typeof report.generatedAt).toBe("string");
    expect(report.stops).toHaveLength(2);

    // Sorted by position, not input order.
    expect(report.stops[0].position).toBe(0);
    expect(report.stops[0].venueId).toBe("venue-a");
    expect(report.stops[1].position).toBe(1);
    expect(report.stops[1].venueId).toBe("venue-b");

    const [first, second] = report.stops;

    expect(first.venueName).toBe("The First");
    expect(first.busyness).toEqual(
      expect.objectContaining({
        level: expect.any(String),
        label: expect.any(String),
        source: expect.any(String),
        isOpen: "unknown",
        explanation: expect.any(String),
      }),
    );
    expect(first.getIn).toEqual(
      expect.objectContaining({ fit: expect.any(String), label: expect.any(String), reason: expect.any(String) }),
    );
    expect(first.booking).toEqual({ available: true, label: "Book a table", href: "https://book.example.com/a" });

    // No booking link found for the second stop — degrades to unavailable, never fabricated.
    expect(second.booking).toEqual({ available: false, label: "Booking link unavailable", href: null });
  });

  it("floors groupSize at 1 even for an empty crew", async () => {
    const state = fixtureState(0);
    const report = await planGetInReport(state, async () => null, BUSY_FRIDAY_NIGHT);
    expect(report.groupSize).toBe(1);
  });

  it("a large crew at a busy time without a booking link is never reported as a likely fit", async () => {
    const state = fixtureState(8);
    const report = await planGetInReport(state, async () => null, BUSY_FRIDAY_NIGHT);
    for (const stop of report.stops) {
      expect(stop.busyness.level).toBe("busy");
      expect(stop.getIn.fit).not.toBe("likely");
    }
  });
});
