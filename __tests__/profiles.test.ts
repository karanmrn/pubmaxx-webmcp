import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  computeBadges,
  deriveProfileFromDrops,
  formatCheapestPint,
  HANDLE_MAX,
  LOCAL_LEGEND_THRESHOLD,
  NO_CHEAPEST_PINT,
  normalizeHandle,
  profileStats,
  REGULAR_THRESHOLD,
  type ProfileDrop,
} from "@/lib/profiles";
import {
  removeSaved,
  upsertSaved,
  isSaved,
  groupByList,
  type SavedPub,
} from "@/lib/savedPubs";

function drop(overrides: Partial<ProfileDrop> = {}): ProfileDrop {
  return { handle: "someone", priceGbp: 5, venueId: "v1", ...overrides };
}

function saved(overrides: Partial<SavedPub> = {}): SavedPub {
  return {
    venueId: "v1",
    listType: "Want to Visit",
    savedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeHandle", () => {
  it("lowercases and strips a leading @", () => {
    expect(normalizeHandle("@Foo_Bar")).toBe("foo_bar");
  });

  it("strips junk to the [a-z0-9_] alphabet", () => {
    expect(normalizeHandle("  @Cheap-Pint Ken! 🍺 ")).toBe("cheappintken");
    expect(normalizeHandle("a.b/c")).toBe("abc");
  });

  it("keeps underscores and digits", () => {
    expect(normalizeHandle("borough_9_regular")).toBe("borough_9_regular");
  });

  it("strips multiple leading @ signs", () => {
    expect(normalizeHandle("@@@name")).toBe("name");
  });

  it("caps the length at 30 characters", () => {
    const long = "a".repeat(50);
    expect(normalizeHandle(long)).toHaveLength(30);
  });

  it("is total: null/undefined/non-strings yield an empty string", () => {
    expect(normalizeHandle(null)).toBe("");
    expect(normalizeHandle(undefined)).toBe("");
    // @ts-expect-error — guarding a non-string caller
    expect(normalizeHandle(42)).toBe("");
  });
});

describe("profileStats", () => {
  it("counts pints logged", () => {
    const stats = profileStats([drop(), drop(), drop()]);
    expect(stats.pintsLogged).toBe(3);
  });

  it("computes the cheapest priced pint", () => {
    const stats = profileStats([
      drop({ priceGbp: 6.5 }),
      drop({ priceGbp: 4.2 }),
      drop({ priceGbp: 5.75 }),
    ]);
    expect(stats.cheapestPintGbp).toBe(4.2);
  });

  it("ignores null / non-finite / non-positive prices when finding the cheapest", () => {
    const stats = profileStats([
      drop({ priceGbp: null }),
      drop({ priceGbp: undefined }),
      drop({ priceGbp: 0 }),
      drop({ priceGbp: 7 }),
    ]);
    // Four drops logged, but only £7 is a real price.
    expect(stats.pintsLogged).toBe(4);
    expect(stats.cheapestPintGbp).toBe(7);
  });

  it("returns null cheapest when no drop has a price", () => {
    const stats = profileStats([drop({ priceGbp: null }), drop({ priceGbp: null })]);
    expect(stats.cheapestPintGbp).toBeNull();
  });

  it("handles an empty / missing drop list without throwing", () => {
    expect(profileStats([])).toEqual({
      pintsLogged: 0,
      cheapestPintGbp: null,
      crawlsPosted: 0,
      memoriesPosted: 0,
    });
    expect(profileStats(null)).toEqual({
      pintsLogged: 0,
      cheapestPintGbp: null,
      crawlsPosted: 0,
      memoriesPosted: 0,
    });
    expect(profileStats(undefined)).toEqual({
      pintsLogged: 0,
      cheapestPintGbp: null,
      crawlsPosted: 0,
      memoriesPosted: 0,
    });
  });

  it("counts era-tagged and anecdote/heritage drops as memories", () => {
    const stats = profileStats([
      drop(),
      drop({ era: "Victorian" }),
      drop({ provenance: "anecdote" }),
      drop({ provenance: "heritage" }),
      drop({ provenance: "demo" }),
    ]);
    expect(stats.memoriesPosted).toBe(3);
  });

  it("crawlsPosted defaults to 0 and is null-safe", () => {
    expect(profileStats([drop()]).crawlsPosted).toBe(0);
    expect(profileStats([drop()], undefined).crawlsPosted).toBe(0);
    expect(profileStats([drop()], null).crawlsPosted).toBe(0);
  });

  it("crawlsPosted passes through a positive count, flooring/guarding junk", () => {
    expect(profileStats([drop()], 3).crawlsPosted).toBe(3);
    // non-integers floor; negatives / NaN / Infinity guard to 0
    expect(profileStats([drop()], 2.9).crawlsPosted).toBe(2);
    expect(profileStats([drop()], -5).crawlsPosted).toBe(0);
    expect(profileStats([drop()], Number.NaN).crawlsPosted).toBe(0);
    expect(profileStats([drop()], Number.POSITIVE_INFINITY).crawlsPosted).toBe(0);
  });

  it("omits boroughs entirely when no drop names one", () => {
    expect(profileStats([drop()])).not.toHaveProperty("boroughs");
  });

  it("collects unique sorted boroughs when present", () => {
    const stats = profileStats([
      drop({ borough: "Southwark" }),
      drop({ borough: "Camden" }),
      drop({ borough: "Southwark" }),
      drop({ borough: null }),
    ]);
    expect(stats.boroughs).toEqual(["Camden", "Southwark"]);
  });
});

describe("computeBadges", () => {
  // Small helper: earned badge ids for a given drop list (crawls default 0).
  function earnedIds(drops: ProfileDrop[], crawls?: number): string[] {
    const stats = profileStats(drops, crawls);
    return computeBadges(drops, stats)
      .filter((b) => b.earned)
      .map((b) => b.id);
  }

  it("returns the full catalogue with earned flags (nothing earned on empty)", () => {
    const badges = computeBadges([], profileStats([]));
    expect(badges.map((b) => b.id)).toEqual([
      "first-pint",
      "cheap-legend",
      "heritage-walker",
      "regular",
      "local-legend",
    ]);
    expect(badges.every((b) => b.earned === false)).toBe(true);
  });

  it("is null-safe for a null/undefined drop list", () => {
    expect(computeBadges(null, profileStats(null)).every((b) => !b.earned)).toBe(true);
    expect(computeBadges(undefined, profileStats(undefined)).every((b) => !b.earned)).toBe(true);
  });

  it("First Pint triggers on ≥1 drop, not on zero", () => {
    expect(earnedIds([])).not.toContain("first-pint");
    expect(earnedIds([drop()])).toContain("first-pint");
  });

  it("Cheap Legend triggers strictly under £4 — not at £4.00", () => {
    expect(earnedIds([drop({ priceGbp: 3.99 })])).toContain("cheap-legend");
    // £4.00 exactly is NOT under £4
    expect(earnedIds([drop({ priceGbp: 4 })])).not.toContain("cheap-legend");
    expect(earnedIds([drop({ priceGbp: 4.5 })])).not.toContain("cheap-legend");
  });

  it("Cheap Legend ignores null / zero / negative prices", () => {
    expect(earnedIds([drop({ priceGbp: null })])).not.toContain("cheap-legend");
    expect(earnedIds([drop({ priceGbp: 0 })])).not.toContain("cheap-legend");
    expect(earnedIds([drop({ priceGbp: -1 })])).not.toContain("cheap-legend");
  });

  it("Heritage Walker triggers on an era", () => {
    expect(earnedIds([drop({ era: "Victorian" })])).toContain("heritage-walker");
    // blank/whitespace era does not count
    expect(earnedIds([drop({ era: "   " })])).not.toContain("heritage-walker");
    expect(earnedIds([drop({ era: null })])).not.toContain("heritage-walker");
  });

  it("Heritage Walker triggers on an anecdote/heritage provenance (case-insensitive)", () => {
    expect(earnedIds([drop({ provenance: "anecdote" })])).toContain("heritage-walker");
    expect(earnedIds([drop({ provenance: "Heritage" })])).toContain("heritage-walker");
    // a sourced/contributor/demo drop is NOT a passed-down memory
    expect(earnedIds([drop({ provenance: "sourced" })])).not.toContain("heritage-walker");
    expect(earnedIds([drop({ provenance: "contributor" })])).not.toContain("heritage-walker");
    expect(earnedIds([drop({ provenance: "demo" })])).not.toContain("heritage-walker");
  });

  it("awards Regular at the threshold but not Local Legend below 100", () => {
    const many = Array.from({ length: REGULAR_THRESHOLD }, () => drop());
    const ids = earnedIds(many);
    expect(ids).toContain("regular");
    expect(ids).not.toContain("local-legend");
    // one short of Regular → not yet
    const nearlyThere = Array.from({ length: REGULAR_THRESHOLD - 1 }, () => drop());
    expect(earnedIds(nearlyThere)).not.toContain("regular");
  });

  it("awards Local Legend (and Regular) at 100 pints", () => {
    const legend = Array.from({ length: LOCAL_LEGEND_THRESHOLD }, () => drop());
    const ids = earnedIds(legend);
    expect(ids).toContain("regular");
    expect(ids).toContain("local-legend");
  });

  it("is deterministic and does not mutate its inputs", () => {
    const drops = [drop({ priceGbp: 3.5, era: "Georgian" })];
    const snapshot = JSON.stringify(drops);
    const stats = profileStats(drops);
    const a = computeBadges(drops, stats);
    const b = computeBadges(drops, stats);
    expect(a).toEqual(b);
    expect(JSON.stringify(drops)).toBe(snapshot);
  });
});

describe("deriveProfileFromDrops", () => {
  it("synthesizes a display name from the handle", () => {
    const p = deriveProfileFromDrops("@Cheap_Pint_Ken", []);
    expect(p.handle).toBe("cheap_pint_ken");
    expect(p.displayName).toBe("Cheap Pint Ken");
  });

  it("summarizes stats into a bio when there are drops", () => {
    const p = deriveProfileFromDrops("ken", [drop({ priceGbp: 4.2 }), drop({ priceGbp: 6 })]);
    expect(p.bio).toContain("2 pints logged");
    expect(p.bio).toContain("£4.20");
  });

  it("has no bio for a handle with no drops", () => {
    const p = deriveProfileFromDrops("ghost", []);
    expect(p.bio).toBeUndefined();
  });

  it("falls back to a placeholder name for an empty handle", () => {
    const p = deriveProfileFromDrops("@@@", []);
    expect(p.handle).toBe("");
    expect(p.displayName).toBe("Anonymous Drinker");
  });
});

describe("upsertSaved / removeSaved — (venueId,listType) uniqueness", () => {
  it("adds a new entry", () => {
    const list = upsertSaved([], saved());
    expect(list).toHaveLength(1);
    expect(isSaved(list, "v1", "Want to Visit")).toBe(true);
  });

  it("never duplicates the same (venueId,listType) — re-save replaces in place", () => {
    const first = upsertSaved([], saved({ note: "old" }));
    const second = upsertSaved(first, saved({ note: "new", savedAt: "2026-02-02T00:00:00.000Z" }));
    expect(second).toHaveLength(1);
    expect(second[0].note).toBe("new");
    expect(second[0].savedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("allows the same venue in different lists", () => {
    let list = upsertSaved([], saved({ listType: "Want to Visit" }));
    list = upsertSaved(list, saved({ listType: "Cheap Pint" }));
    expect(list).toHaveLength(2);
    expect(isSaved(list, "v1", "Want to Visit")).toBe(true);
    expect(isSaved(list, "v1", "Cheap Pint")).toBe(true);
  });

  it("removeSaved deletes only the matching (venueId,listType)", () => {
    let list = upsertSaved([], saved({ listType: "Want to Visit" }));
    list = upsertSaved(list, saved({ listType: "Cheap Pint" }));
    list = removeSaved(list, "v1", "Want to Visit");
    expect(list).toHaveLength(1);
    expect(isSaved(list, "v1", "Want to Visit")).toBe(false);
    expect(isSaved(list, "v1", "Cheap Pint")).toBe(true);
  });

  it("removeSaved on a missing key is an idempotent no-op", () => {
    const list = upsertSaved([], saved());
    const after = removeSaved(list, "does-not-exist", "Want to Visit");
    expect(after).toHaveLength(1);
    // idempotent: removing again is stable
    expect(removeSaved(after, "does-not-exist", "Want to Visit")).toHaveLength(1);
  });

  it("does not mutate the input list (pure)", () => {
    const original = [saved()];
    const snapshot = JSON.stringify(original);
    upsertSaved(original, saved({ listType: "Cheap Pint" }));
    removeSaved(original, "v1", "Want to Visit");
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("groupByList", () => {
  it("groups by list type and sorts newest-first within a group", () => {
    const groups = groupByList([
      saved({ venueId: "a", listType: "Cheap Pint", savedAt: "2026-01-01T00:00:00.000Z" }),
      saved({ venueId: "b", listType: "Cheap Pint", savedAt: "2026-03-01T00:00:00.000Z" }),
      saved({ venueId: "c", listType: "Historic", savedAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(Object.keys(groups).sort()).toEqual(["Cheap Pint", "Historic"]);
    expect(groups["Cheap Pint"]!.map((p) => p.venueId)).toEqual(["b", "a"]);
    expect(groups["Historic"]).toHaveLength(1);
  });

  it("omits empty lists", () => {
    expect(groupByList([])).toEqual({});
  });
});

// A price the handle has not logged. The two profile stat grids each carried
// their own `value == null ? "–" : ...`, so a fresh account was greeted by a
// bare en dash: a separator standing in for a sentence. `docs/VOICE.md` wants
// the words, and one formatter is what stops the two grids drifting apart
// again. The source sweep is the half that matters - a unit test on the helper
// cannot see a component that stopped calling it.
describe("an absent cheapest pint says so in words", () => {
  const GRIDS = [
    "components/profile/PintPassport.tsx",
    "components/profile/ProfileHeader.tsx",
  ];

  it("prints the words, never a dash of either width", () => {
    expect(formatCheapestPint(null)).toBe(NO_CHEAPEST_PINT);
    expect(NO_CHEAPEST_PINT).not.toMatch(/[–—-]/);
    expect(formatCheapestPint(4.5)).toBe("£4.50");
    expect(formatCheapestPint(0)).toBe("£0.00");
  });

  it("keeps both stat grids on the one formatter", () => {
    for (const grid of GRIDS) {
      const source = readFileSync(join(process.cwd(), grid), "utf8");
      expect(source, `${grid} must format the cheapest pint through lib/profiles`)
        .toContain("formatCheapestPint");
      expect(source, `${grid} must not re-declare its own price formatter`)
        .not.toMatch(/function formatGbp/);
      expect(source, `${grid} must not print a bare dash for an absent price`)
        .not.toMatch(/["'`]\s*[–—]\s*["'`]/);
    }
  });
});

function listSourceFiles(...roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    const abs = join(process.cwd(), root);
    for (const entry of readdirSync(abs)) {
      const path = join(abs, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        out.push(...listSourceFiles(join(root, entry)));
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
        out.push(join(root, entry));
      }
    }
  }
  return out;
}

describe("one handle normaliser (#1043 L6)", () => {
  it("HANDLE_MAX matches migration 0029 CHECK", () => {
    expect(HANDLE_MAX).toBe(30);
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260715134000_0029_identity_and_social_connections.sql"),
      "utf8",
    );
    expect(migration).toMatch(/char_length\(handle\) between 1 and 30/);
  });

  it("only handleNormalize declares HANDLE_MAX or MAX_HANDLE", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles("app", "components", "lib")) {
      if (file === "lib/handleNormalize.ts") continue;
      const source = readFileSync(join(process.cwd(), file), "utf8");
      if (/(?:export\s+)?const\s+(MAX_HANDLE|HANDLE_MAX)\b/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("formatGbp and numeric clamp helpers (#1043 L7)", () => {
  it("declares formatGbp only in lib/formatGbp.ts", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles("app", "components", "lib")) {
      if (file === "lib/formatGbp.ts") continue;
      const source = readFileSync(join(process.cwd(), file), "utf8");
      if (/function formatGbp\b/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("declares numeric clamp only in lib/mathClamp.ts", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles("lib")) {
      if (file === "lib/mathClamp.ts") continue;
      const source = readFileSync(join(process.cwd(), file), "utf8");
      if (/function clamp\s*\(\s*value:\s*number/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
