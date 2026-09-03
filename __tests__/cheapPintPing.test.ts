import { describe, expect, it } from "vitest";

import {
  canPromptCheapPint,
  canSendCheapPint,
  composeCheapPintPing,
  isAllowedCheapPintCopy,
  isCheapPintPingWindow,
  londonWeekdayMon0,
} from "@/lib/cheapPintPing";

describe("cheapPintPing policy", () => {
  const wed5pm = new Date("2026-08-19T16:00:00.000Z");
  const sat5pm = new Date("2026-08-22T16:00:00.000Z");
  const wed4pm = new Date("2026-08-19T15:00:00.000Z");

  it("opens only on weekday 5pm Europe/London", () => {
    expect(londonWeekdayMon0(wed5pm)).toBe(2);
    expect(isCheapPintPingWindow(wed5pm)).toBe(true);
    expect(isCheapPintPingWindow(sat5pm)).toBe(false);
    expect(isCheapPintPingWindow(wed4pm)).toBe(false);
  });

  it("asks once: prompt only before opt-in or decline", () => {
    expect(
      canPromptCheapPint({
        qualified: true,
        enabled: false,
        declined: false,
        sentAt: null,
      }),
    ).toBe(true);
    expect(
      canPromptCheapPint({
        qualified: true,
        enabled: true,
        declined: false,
        sentAt: null,
      }),
    ).toBe(false);
    expect(
      canPromptCheapPint({
        qualified: true,
        enabled: false,
        declined: true,
        sentAt: null,
      }),
    ).toBe(false);
  });

  it("sends once when opted in inside the window", () => {
    const pref = {
      qualified: true,
      enabled: true,
      declined: false,
      sentAt: null,
    };
    expect(canSendCheapPint(pref, wed5pm)).toBe(true);
    expect(
      canSendCheapPint({ ...pref, sentAt: "2026-08-12T16:00:00.000Z" }, wed5pm),
    ).toBe(false);
    expect(canSendCheapPint(pref, sat5pm)).toBe(false);
  });

  it("composes grounded listed copy and refuses growth language", () => {
    const payload = composeCheapPintPing({
      venueName: "The Example Arms",
      priceGbp: 4.5,
      venueId: "venue-1",
      walkMinutes: 8,
      areaName: "Camden",
    });
    expect(payload).toMatchObject({
      title: "Cheap pint nearby",
      url: "/map?sel=venue-1",
      priceLabel: "£4.50",
    });
    expect(payload?.body).toContain("£4.50 at The Example Arms");
    expect(isAllowedCheapPintCopy(payload?.body ?? "")).toBe(true);
    expect(isAllowedCheapPintCopy("You haven't been out lately")).toBe(false);
  });
});
