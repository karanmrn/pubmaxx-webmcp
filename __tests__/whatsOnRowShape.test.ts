// The row shape is written down ONCE (lib/whatsOnRowShape.mjs) and read by the
// app spine (lib/whatsOn.ts), scripts/validate-data.mjs and
// scripts/refresh_whats_on.mjs. It used to be three hand-kept copies, and they
// drifted: a date-only row was valid to the app and a hard failure to the
// validator, which would have broken the refresh workflow's validate step, the
// local scheduler and the pre-push gate the first time one shipped.

import { describe, expect, it } from "vitest";

import { isValidWhatsOnRow, whatsOnRowProblems } from "@/lib/whatsOnRowShape.mjs";
import { isValidWhatsOnRow as spineIsValidWhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-08-16T10:00:00.000Z");

function base(overrides: Record<string, unknown> = {}) {
  return {
    id: "events-cm-1",
    placeName: "Camberwell",
    kind: "event",
    title: "Sunday roast club",
    source: { label: "common", url: "https://www.common-social.com/post/abc" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

describe("what a What's-On row must look like", () => {
  it("accepts a date-only row, the shape a listing with no published clock time takes", () => {
    const row = base({
      startsDate: "2026-08-16",
      timeEvidence: "Date listed, start time not published",
    });
    expect(whatsOnRowProblems(row, NOW)).toEqual([]);
    expect(isValidWhatsOnRow(row, NOW)).toBe(true);
    // The gate the validator, the refresh script and the app all read is ONE
    // function, so the spine cannot answer differently from the validator.
    expect(spineIsValidWhatsOnRow(row, NOW)).toBe(true);
  });

  it("still accepts an exact-start row and still refuses a row that says no WHEN", () => {
    expect(isValidWhatsOnRow(base({ startsAt: "2026-08-16T19:00:00.000Z" }), NOW)).toBe(true);
    expect(whatsOnRowProblems(base(), NOW)).toContain(
      "no startsAt, startsDate, timeEvidence or listedWindow",
    );
  });

  it("refuses a startsDate that is not a real calendar day", () => {
    expect(whatsOnRowProblems(base({ startsDate: "2026-02-30" }), NOW)).toContain(
      'startsDate "2026-02-30" is not a YYYY-MM-DD calendar date',
    );
    expect(whatsOnRowProblems(base({ startsDate: "16 Aug 2026" }), NOW).length).toBeGreaterThan(0);
  });

  it("names each broken field so a validator can print it", () => {
    const problems = whatsOnRowProblems(
      {
        id: "",
        placeName: "",
        kind: "banquet",
        startsAt: "not a date",
        title: "",
        source: { label: "common", url: "not-a-url" },
        observedAt: "2099-01-01T00:00:00.000Z",
        confidence: "vibes",
        priceGbp: -1,
      },
      NOW,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "missing/empty id",
        "missing/empty placeName",
        'invalid kind "banquet"',
        "startsAt is not a valid ISO timestamp",
        "missing/empty title",
        "missing/invalid source {label, url}",
        'invalid confidence "vibes"',
        "priceGbp must be a finite number >= 0",
      ]),
    );
    expect(problems.some((problem) => problem.includes("observedAt"))).toBe(true);
  });

  it("refuses an endsAt that has no exact start to close", () => {
    expect(
      whatsOnRowProblems(
        base({ startsDate: "2026-08-16", endsAt: "2026-08-16T23:00:00.000Z" }),
        NOW,
      ),
    ).toContain("endsAt needs an exact startsAt and a valid ISO value");
  });
});
