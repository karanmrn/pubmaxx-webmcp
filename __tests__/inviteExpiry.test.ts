import { describe, expect, it } from "vitest";

import { ACTIVE_PLAN_POST_MS } from "@/lib/activePlan";
import { inviteExpiresAtIso, isPastPlanScheduledEnd, planScheduledEndMs } from "@/lib/inviteExpiry";

describe("inviteExpiry", () => {
  const startTime = "2026-07-16T19:00:00.000Z";
  const planEnd = Date.parse(startTime) + ACTIVE_PLAN_POST_MS;

  it("computes scheduled end as start + active post window", () => {
    expect(planScheduledEndMs(startTime)).toBe(planEnd);
    expect(planScheduledEndMs("not-a-date")).toBeNull();
  });

  it("keeps short TTLs that end before plan end", () => {
    const now = new Date("2026-07-16T18:00:00.000Z");
    expect(inviteExpiresAtIso({ startTime, expiresInMinutes: 30, now })).toBe("2026-07-16T18:30:00.000Z");
  });

  it("clamps long TTLs to plan end", () => {
    const now = new Date("2026-07-16T20:00:00.000Z");
    expect(inviteExpiresAtIso({ startTime, expiresInMinutes: 1_440, now })).toBe(new Date(planEnd).toISOString());
  });

  it("refuses to mint invites after the plan has ended", () => {
    const now = new Date(planEnd + 60_000);
    expect(inviteExpiresAtIso({ startTime, expiresInMinutes: 30, now })).toBeNull();
    expect(isPastPlanScheduledEnd(startTime, now)).toBe(true);
  });
});
