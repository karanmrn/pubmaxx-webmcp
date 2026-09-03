import { describe, expect, it } from "vitest";

import type { HeritageFact } from "@/lib/heritageFacts";
import {
  buildQuietPint,
  QUIET_PINT_LIMIT,
  QUIET_PINT_MIN,
  type QuietPintCandidate,
} from "@/lib/quietPint";

// A Tuesday 10:00 London (BST) — a genuinely quiet typical-pattern window, so
// the module renders. 09:00Z + 1h BST = 10:00 London, weekday Tuesday.
const QUIET_TUESDAY = new Date("2026-07-21T09:00:00Z");
// A Friday 21:00 London — the fri/sat evening peak, a busy window.
const BUSY_FRIDAY = new Date("2026-07-24T20:00:00Z");
// A Tuesday 13:00 London — a "moderate" lunchtime window (not quiet).
const MODERATE_LUNCH = new Date("2026-07-21T12:00:00Z");

const wiki = (fact: string, ref = "https://en.wikipedia.org/wiki/Example"): HeritageFact => ({
  source: "wikipedia",
  fact,
  sourceRef: ref,
});

function candidate(over: Partial<QuietPintCandidate> & { venueId: string }): QuietPintCandidate {
  return {
    name: over.name ?? over.venueId,
    slug: over.slug ?? over.venueId,
    hook: over.hook ?? `${over.venueId} hook`,
    facts: over.facts ?? [wiki(over.hook ?? `${over.venueId} hook`)],
    era: over.era ?? "1700",
    listed: over.listed ?? null,
    ...over,
  };
}

// Four heritage-cited candidates spanning every grade, enough to clear the floor.
const CANDIDATES: QuietPintCandidate[] = [
  candidate({ venueId: "venue-a", slug: "a", listed: "I", era: "1600" }),
  candidate({ venueId: "venue-b", slug: "b", listed: "II*", era: "1520" }),
  candidate({ venueId: "venue-c", slug: "c", listed: "II", era: "1700" }),
  candidate({ venueId: "venue-d", slug: "d", listed: null, era: "1900" }),
];

const PRICES = new Map<string, number>([
  ["venue-a", 4.5],
  ["venue-b", 5],
  ["venue-d", 4],
]);

describe("buildQuietPint", () => {
  it("ranks by listed-grade weight first: Grade I over II* over II over unlisted", () => {
    const mod = buildQuietPint({ candidates: CANDIDATES, priceById: PRICES, now: QUIET_TUESDAY });
    expect(mod).not.toBeNull();
    expect(mod!.rows.map((r) => r.id)).toEqual(["venue-a", "venue-b", "venue-c", "venue-d"]);
  });

  it("within the same grade, sorts oldest era first", () => {
    const mod = buildQuietPint({
      candidates: [
        candidate({ venueId: "venue-new", slug: "new", listed: "II*", era: "1850" }),
        candidate({ venueId: "venue-old", slug: "old", listed: "II*", era: "1600" }),
        candidate({ venueId: "venue-mid", slug: "mid", listed: "II*", era: "1700" }),
      ],
      now: QUIET_TUESDAY,
    });
    expect(mod!.rows.map((r) => r.id)).toEqual(["venue-old", "venue-mid", "venue-new"]);
  });

  it("breaks a grade+era tie by priced-before-unpriced, then cheaper first", () => {
    const mod = buildQuietPint({
      candidates: [
        candidate({ venueId: "venue-none", slug: "none", listed: "II", era: "1700" }),
        candidate({ venueId: "venue-dear", slug: "dear", listed: "II", era: "1700" }),
        candidate({ venueId: "venue-cheap", slug: "cheap", listed: "II", era: "1700" }),
      ],
      priceById: new Map([
        ["venue-dear", 6],
        ["venue-cheap", 4.2],
      ]),
      now: QUIET_TUESDAY,
    });
    expect(mod!.rows.map((r) => r.id)).toEqual(["venue-cheap", "venue-dear", "venue-none"]);
  });

  it("skips candidates whose only fact is seed example material", () => {
    const seedOnly = candidate({
      venueId: "venue-seed",
      slug: "seed",
      listed: "I",
      facts: [{ source: "seed", fact: "Seed example only." }],
    });
    const mod = buildQuietPint({
      candidates: [seedOnly, ...CANDIDATES],
      priceById: PRICES,
      now: QUIET_TUESDAY,
    });
    expect(mod!.rows.map((r) => r.id)).not.toContain("venue-seed");
    expect(mod!.rows).toHaveLength(4);
  });

  it("skips candidates whose only fact is harvest web lore", () => {
    const webOnly = candidate({
      venueId: "venue-web",
      slug: "web",
      listed: "I",
      facts: [
        {
          source: "web",
          fact: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
          sourceRef: "https://history.example/red-lion-clapham",
        },
      ],
    });
    const mod = buildQuietPint({
      candidates: [webOnly, ...CANDIDATES],
      priceById: PRICES,
      now: QUIET_TUESDAY,
    });
    expect(mod!.rows.map((r) => r.id)).not.toContain("venue-web");
  });

  it("surfaces the cited heritage line, the Sourced chip, the source, and the map link", () => {
    const mod = buildQuietPint({ candidates: CANDIDATES, priceById: PRICES, now: QUIET_TUESDAY });
    const top = mod!.rows[0];
    expect(top.heritageLine).toBe("venue-a hook");
    expect(top.provenanceLabel).toBe("Sourced");
    expect(top.sourceLabel).toBe("Wikipedia");
    expect(top.sourceRef).toBe("https://en.wikipedia.org/wiki/Example");
    expect(top.gradeLabel).toBe("Grade I");
    expect(top.eraLabel).toBe("1600");
    expect(top.mapHref).toBe("/map?sel=venue-a");
  });

  it("names the quiet register honestly with the London weekday", () => {
    const mod = buildQuietPint({ candidates: CANDIDATES, now: QUIET_TUESDAY });
    expect(mod!.weekdayName).toBe("Tuesday");
    for (const row of mod!.rows) expect(row.quietLabel).toBe("Usually quiet on a Tuesday");
  });

  it("shows a verified price when present and null when absent, never fabricated", () => {
    const mod = buildQuietPint({ candidates: CANDIDATES, priceById: PRICES, now: QUIET_TUESDAY });
    const byId = new Map(mod!.rows.map((r) => [r.id, r.priceLabel]));
    expect(byId.get("venue-a")).toBe("£4.50");
    expect(byId.get("venue-c")).toBeNull();
  });

  it("caps at the limit (default and explicit)", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      candidate({ venueId: `venue-${i}`, slug: `s${i}`, listed: "II", era: "1700" }),
    );
    expect(buildQuietPint({ candidates: many, now: QUIET_TUESDAY })!.rows).toHaveLength(
      QUIET_PINT_LIMIT,
    );
    expect(buildQuietPint({ candidates: many, now: QUIET_TUESDAY, limit: 3 })!.rows).toHaveLength(3);
  });

  it("fails soft to null in a busy window", () => {
    expect(buildQuietPint({ candidates: CANDIDATES, now: BUSY_FRIDAY })).toBeNull();
  });

  it("fails soft to null in a merely moderate window (only a quiet hour qualifies)", () => {
    expect(buildQuietPint({ candidates: CANDIDATES, now: MODERATE_LUNCH })).toBeNull();
  });

  it("fails soft to null below the minimum cited set", () => {
    const two = CANDIDATES.slice(0, QUIET_PINT_MIN - 1);
    expect(buildQuietPint({ candidates: two, now: QUIET_TUESDAY })).toBeNull();
  });

  it("fails soft to null with no candidates", () => {
    expect(buildQuietPint({ candidates: [], now: QUIET_TUESDAY })).toBeNull();
  });

  it("is deterministic: identical inputs yield identical row order", () => {
    const a = buildQuietPint({ candidates: CANDIDATES, priceById: PRICES, now: QUIET_TUESDAY });
    const b = buildQuietPint({ candidates: CANDIDATES, priceById: PRICES, now: QUIET_TUESDAY });
    expect(a!.rows.map((r) => r.id)).toEqual(b!.rows.map((r) => r.id));
  });
});
