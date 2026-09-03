import { describe, expect, it } from "vitest";

import {
  MS_PER_DAY,
  dayBucketFromDate,
  parseStoredDayBucket,
  shouldRecordDailyActivity,
} from "@/lib/dailyActivity";

describe("dayBucketFromDate", () => {
  it("is whole days since the epoch, in UTC", () => {
    expect(dayBucketFromDate(new Date("1970-01-01T00:00:00.000Z"))).toBe(0);
    expect(dayBucketFromDate(new Date("1970-01-02T00:00:00.000Z"))).toBe(1);
    expect(dayBucketFromDate(new Date("1970-01-01T23:59:59.999Z"))).toBe(0);
  });

  it("advances only once a full day has passed", () => {
    const start = new Date("2026-07-17T00:00:00.000Z");
    const sameDay = new Date(start.getTime() + MS_PER_DAY - 1);
    const nextDay = new Date(start.getTime() + MS_PER_DAY);
    expect(dayBucketFromDate(sameDay)).toBe(dayBucketFromDate(start));
    expect(dayBucketFromDate(nextDay)).toBe(dayBucketFromDate(start) + 1);
  });
});

describe("shouldRecordDailyActivity", () => {
  it("is true the first time (no prior recording)", () => {
    expect(shouldRecordDailyActivity(null, new Date())).toBe(true);
  });

  it("is false again within the same UTC day", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    expect(shouldRecordDailyActivity(dayBucketFromDate(now), now)).toBe(false);
  });

  it("is true again once the day bucket has advanced", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    const yesterday = dayBucketFromDate(now) - 1;
    expect(shouldRecordDailyActivity(yesterday, now)).toBe(true);
  });
});

describe("parseStoredDayBucket", () => {
  it("parses a valid stored integer", () => {
    expect(parseStoredDayBucket("20285")).toBe(20_285);
  });

  it("treats missing or malformed values as never recorded", () => {
    expect(parseStoredDayBucket(null)).toBeNull();
    expect(parseStoredDayBucket("")).toBeNull();
    expect(parseStoredDayBucket("not-a-number")).toBeNull();
    expect(parseStoredDayBucket("-5")).toBeNull();
    expect(parseStoredDayBucket("12.5")).toBeNull();
  });
});
