// Gamification core for the Pint Drop CONTRIBUTION loop (feat/price-drops-v2).
//
// This is the honest, browser-safe maths behind "your impact": a mapping
// streak, a per-borough contributor tally, and a personal running total. It is
// PURE — no server imports (no @/lib/supabase, no node builtins), no React — so
// the same functions power the server stats route AND the You-page card, and the
// two can never drift. Precedent: lib/pintContributions.ts sits beside
// lib/pintDropShared.ts as the browser-safe twin of a server domain.
//
// DUTY OF CARE: every streak/tally here rewards the CONTRIBUTION — days you
// added a price observation to the map — and never the drinking. The reward is
// visible impact ("you mapped 12 pints in Hackney"), never a points economy.
// Copy must stay on the mapping framing.

import { DAY_MS } from "@/lib/dayMs";

/**
 * The calendar day (YYYY-MM-DD) an instant falls on in Europe/London — the one
 * timezone every PUBMAXX day-bucket is anchored to (mirrors lib/dataFreshness.ts,
 * which pins user-facing day stamps to Europe/London so a US-locale build can't
 * shift the day). Streaks and the per-day duplicate guard both bucket on this, so
 * "one drop a day" means one London day, not one UTC day. Pure + deterministic.
 */
export function londonDayKey(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  // en-CA formats as YYYY-MM-DD, so the key sorts lexicographically = chronologically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Whole days between two YYYY-MM-DD London day keys (b - a), calendar-day exact. */
function daysBetween(a: string, b: string): number {
  // Parse the date-only keys at UTC midnight so DST never adds/drops an hour —
  // the keys are already London calendar days, so the arithmetic is pure.
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return NaN;
  return Math.round((tb - ta) / DAY_MS);
}

export type ContributionStreak = {
  /** Consecutive London days ending today (or yesterday) with at least one drop. */
  current: number;
  /** The longest consecutive-day run the contributor has ever posted. */
  longest: number;
  /** Total distinct London days the contributor has ever dropped on. */
  activeDays: number;
  /** The most recent London day (YYYY-MM-DD) with a drop, or "" when none. */
  lastDay: string;
};

/**
 * Compute the mapping streak from a contributor's drop timestamps.
 *
 * `current` counts consecutive London days ending on the most recent active day
 * ONLY when that day is today or yesterday relative to `now` — a streak that has
 * already lapsed reads 0, not a stale figure. `longest` is the best run ever, so
 * a lapsed contributor still keeps their record. Empty input → all zeroes (never
 * a fabricated streak). Duplicate same-day drops collapse to one day.
 */
export function contributionStreak(
  dropIsoTimestamps: readonly string[],
  now: Date = new Date(),
): ContributionStreak {
  const days = Array.from(
    new Set(dropIsoTimestamps.map((iso) => londonDayKey(iso)).filter(Boolean)),
  ).sort(); // ascending YYYY-MM-DD

  if (days.length === 0) {
    return { current: 0, longest: 0, activeDays: 0, lastDay: "" };
  }

  // Longest run: walk ascending, resetting whenever the gap to the previous
  // active day is more than one calendar day.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // Current run: only "live" if the last active day is today or yesterday.
  const today = londonDayKey(now);
  const lastDay = days[days.length - 1];
  const gapToNow = daysBetween(lastDay, today);
  let current = 0;
  if (gapToNow === 0 || gapToNow === 1) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (daysBetween(days[i - 1], days[i]) === 1) current += 1;
      else break;
    }
  }

  return { current, longest, activeDays: days.length, lastDay };
}

export type BoroughTally = {
  borough: string;
  count: number;
};

/**
 * Tally contributions by borough, most-mapped first (ties broken alphabetically
 * for a stable render). `borough` is already resolved by the caller (server-side
 * via getVenueIndex — venue records carry a `borough`), so this stays a pure
 * transform. Blank/unknown boroughs are folded under "London" rather than
 * dropped, so the total across boroughs always equals the personal total.
 */
export function tallyByBorough(
  entries: readonly { borough?: string | null }[],
): BoroughTally[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const borough = (entry.borough ?? "").trim() || "London";
    counts.set(borough, (counts.get(borough) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([borough, count]) => ({ borough, count }))
    .sort((a, b) => b.count - a.count || a.borough.localeCompare(b.borough));
}

export type ContributionSummary = {
  handle: string;
  /** Priced observations (the price moat) mapped by this contributor. */
  pintsMapped: number;
  /** Every contribution (priced or anecdote) — the honest full count. */
  total: number;
  streak: ContributionStreak;
  /** Per-borough breakdown of the PRICED observations (the "12 in Hackney" line). */
  byBorough: BoroughTally[];
};

export type ContributionInput = {
  createdAt: string;
  borough?: string | null;
  /** Null for a note-only anecdote; a number for a priced observation. */
  priceGbp?: number | null;
};

/**
 * Fold a contributor's drops into the full personal summary the You-page card
 * renders. The streak counts EVERY contribution day (a note-only memory still
 * keeps the streak alive), but the headline "pints mapped" total and the borough
 * breakdown count only PRICED observations — that is the price moat the loop
 * deepens, and calling a passed-down anecdote a "mapped pint" would be dishonest.
 */
export function summariseContributions(
  handle: string,
  drops: readonly ContributionInput[],
  now: Date = new Date(),
): ContributionSummary {
  const priced = drops.filter((d) => typeof d.priceGbp === "number");
  return {
    handle,
    pintsMapped: priced.length,
    total: drops.length,
    streak: contributionStreak(
      drops.map((d) => d.createdAt),
      now,
    ),
    byBorough: tallyByBorough(priced),
  };
}

/** A short, honest streak label. Never celebratory about drinking — "mapping". */
export function streakLabel(streak: ContributionStreak): string {
  if (streak.current <= 0) return "No active streak. Drop a price to start one";
  const unit = streak.current === 1 ? "day" : "days";
  return `${streak.current}-${unit} mapping streak`;
}
