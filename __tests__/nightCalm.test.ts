import { describe, expect, it } from "vitest";

import {
  MIN_CALM_SAMPLE,
  NIGHT_CALM_LABELS,
  aggregateNightCalm,
  crimeMonthFromLastUpdated,
  isCrimeMonth,
  parsePoliceCrimes,
  publicNightCalm,
  targetCrimeMonth,
  type PoliceCrime,
} from "@/lib/nightCalm";

function crimes(spec: Record<string, number>): PoliceCrime[] {
  const rows: PoliceCrime[] = [];
  for (const [category, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i += 1) rows.push({ category });
  }
  return rows;
}

describe("targetCrimeMonth", () => {
  it("lags two months behind and pads the month", () => {
    expect(targetCrimeMonth(new Date("2026-07-17T00:00:00Z"))).toBe("2026-05");
  });

  it("rolls the year back across January", () => {
    expect(targetCrimeMonth(new Date("2026-01-15T00:00:00Z"))).toBe("2025-11");
  });
});

describe("isCrimeMonth / crimeMonthFromLastUpdated", () => {
  it("accepts YYYY-MM and rejects junk", () => {
    expect(isCrimeMonth("2026-05")).toBe(true);
    expect(isCrimeMonth("2026-13")).toBe(false);
    expect(isCrimeMonth("2026-5")).toBe(false);
    expect(isCrimeMonth(20265)).toBe(false);
  });

  it("reads the month off the police last-updated payload", () => {
    expect(crimeMonthFromLastUpdated({ date: "2026-05-01" })).toBe("2026-05");
    expect(crimeMonthFromLastUpdated({ date: "nope" })).toBeNull();
    expect(crimeMonthFromLastUpdated(null)).toBeNull();
    expect(crimeMonthFromLastUpdated({})).toBeNull();
  });
});

describe("parsePoliceCrimes", () => {
  it("returns null for non-array input", () => {
    expect(parsePoliceCrimes({})).toBeNull();
    expect(parsePoliceCrimes(null)).toBeNull();
  });

  it("keeps rows with a category and drops malformed ones", () => {
    const parsed = parsePoliceCrimes([
      { category: "anti-social-behaviour" },
      { category: "  violent-crime  " },
      { category: "" },
      { nope: true },
      42,
    ]);
    expect(parsed).toEqual([{ category: "anti-social-behaviour" }, { category: "violent-crime" }]);
  });
});

describe("aggregateNightCalm", () => {
  it("stays silent (null band) below the minimum sample", () => {
    const result = aggregateNightCalm(crimes({ "other-theft": MIN_CALM_SAMPLE - 1 }));
    expect(result.band).toBeNull();
    expect(result.label).toBeNull();
    expect(result.calmScore).toBeNull();
    expect(result.sampleSize).toBe(MIN_CALM_SAMPLE - 1);
  });

  it("reads a low night-relevant share as settled, well-used streets", () => {
    // 6 night-relevant of 100 -> share 0.06 -> settled
    const result = aggregateNightCalm(crimes({ "anti-social-behaviour": 6, "other-theft": 94 }));
    expect(result.band).toBe("settled");
    expect(result.label).toBe(NIGHT_CALM_LABELS.settled);
    expect(result.calmScore).toBe(88);
  });

  it("reads a mid share as steady", () => {
    // 25 of 100 -> share 0.25 -> steady
    const result = aggregateNightCalm(crimes({ "violent-crime": 15, robbery: 10, "other-theft": 75 }));
    expect(result.band).toBe("steady");
  });

  it("reads a high share as aware and never zeroes below the floor", () => {
    // 60 of 100 -> share 0.6, clamped at 0.5 floor -> calmScore 0
    const result = aggregateNightCalm(crimes({ "violent-crime": 60, "other-theft": 40 }));
    expect(result.band).toBe("aware");
    expect(result.label).toBe(NIGHT_CALM_LABELS.aware);
    expect(result.calmScore).toBe(0);
  });

  it("counts robbery and possession-of-weapons as night-relevant", () => {
    const result = aggregateNightCalm(
      crimes({ robbery: 20, "possession-of-weapons": 20, "other-theft": 60 }),
    );
    // 40 of 100 -> share 0.4 -> aware
    expect(result.band).toBe("aware");
  });

  it("never surfaces alarming copy; labels stay reassuring", () => {
    for (const label of Object.values(NIGHT_CALM_LABELS)) {
      expect(label).not.toMatch(/danger|unsafe|warning|crime|avoid/i);
      expect(label).not.toContain("—");
    }
  });
});

describe("publicNightCalm", () => {
  it("strips the internal sample size", () => {
    const aggregate = aggregateNightCalm(crimes({ "anti-social-behaviour": 6, "other-theft": 94 }));
    const pub = publicNightCalm(aggregate);
    expect(pub).toEqual({ band: "settled", label: NIGHT_CALM_LABELS.settled, calmScore: 88 });
    expect("sampleSize" in pub).toBe(false);
  });
});
