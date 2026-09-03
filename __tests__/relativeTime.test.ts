import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { relativeTime } from "@/lib/relativeTime";

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([null, undefined, "", "not-a-date"])(
    "omits a label for the missing or invalid timestamp %s",
    (timestamp) => {
      expect(relativeTime(timestamp)).toBe("");
    },
  );

  it.each([
    ["2026-07-18T12:00:01.000Z", "just now"],
    ["2026-07-18T12:00:00.000Z", "just now"],
    ["2026-07-18T11:59:01.000Z", "just now"],
    ["2026-07-18T11:59:00.000Z", "1m ago"],
    ["2026-07-18T11:01:00.000Z", "59m ago"],
    ["2026-07-18T11:00:00.000Z", "1h ago"],
    ["2026-07-17T13:00:00.000Z", "23h ago"],
    ["2026-07-17T12:00:00.000Z", "1d ago"],
    ["2026-07-12T12:00:00.000Z", "6d ago"],
    ["2026-07-11T12:00:00.000Z", "1w ago"],
    ["2026-06-20T12:00:00.000Z", "4w ago"],
    ["2026-06-13T12:00:00.000Z", "Jun 2026"],
  ])("formats %s as %s", (timestamp, expected) => {
    expect(relativeTime(timestamp)).toBe(expected);
  });
});
