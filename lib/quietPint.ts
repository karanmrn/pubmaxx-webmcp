// "A quiet pint" — the derivation that ranks heritage-cited pubs that also read
// as quiet right now, for the calmer, older cohort the youth-skewing surfaces
// under-serve (cohort review, 45-60). Pure and node-free by design:
//
//   - no fs, no serverEnv, no DOM, no clock of its own (every function takes
//     `now`), so it is hermetically unit-testable with fixed dates, and
//   - shaped as a structural derivation over (candidates, prices, now) rather
//     than over any one surface's types, so /today and /tonight share the lens
//     without either importing the other's page types.
//
// The honesty rules the rest of the app lives by hold here:
//   - heritage-cited only: a candidate whose only fact is seed example material
//     is skipped, exactly like the Pub of the Day pick. The heritage line is a
//     real, attributable claim carrying its source.
//   - the quiet signal is the SAME typical-pattern estimate the plan pages show
//     (lib/busyness), evaluated at `now`. We never invent footfall. The module
//     only appears in a genuinely quiet window; when the city is out, it steps
//     aside rather than promising a quiet pint it can't.
//   - a verified price is surfaced when we have one, never fabricated when we
//     don't. No em dashes in any copy this module builds.

import { estimateBusyness } from "@/lib/busyness";
import { isFeaturedHeritageSource, type HeritageFact } from "@/lib/heritageFacts";
import { eraStartYear, heritageSourceLabel, listedBadge } from "@/lib/historicFilter";
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import { venueMapUrl } from "@/lib/venueMapUrl";

/** The calm cohort sees a tight handful, not a wall. Between MIN and LIMIT. */
export const QUIET_PINT_LIMIT = 5;
/** Below this the module fails soft: a lone pick is Pub of the Day's job, not a
 *  "quiet pint" set. With 346 cited historic pubs this floor is only ever hit
 *  in tests or a stripped dataset. */
export const QUIET_PINT_MIN = 3;

// The structural candidate shape — deliberately the subset of a cited historic
// pub this derivation needs, so any surface with heritage-cited venues can build
// one (the /today page maps HistoricPub straight onto it; /tonight can map its
// own joined venue set the same way).
export type QuietPintCandidate = {
  /** Stable venue id, for the map deep-link and the price join. */
  venueId: string;
  name: string;
  /** Stable slug, used only as the deterministic final tiebreak. */
  slug: string;
  /** The cited one-line heritage hook shown to the reader. */
  hook: string;
  /** Retrieved heritage facts; the best non-seed one carries the attribution. */
  facts: readonly HeritageFact[];
  /** Extracted era string ("1667", "17th century") or null. Ranks age. */
  era: string | null;
  /** Statutory listed grade ("I" | "II*" | "II") or null. Ranks heritage weight. */
  listed: string | null;
};

export type QuietPintRow = {
  /** venueId — the row key and the map deep-link target. */
  id: string;
  name: string;
  /** The cited heritage one-liner. This does the selling, not marketing copy. */
  heritageLine: string;
  eraLabel: string | null;
  /** "Grade II*" when listed, else null. A quiet badge, not a claim. */
  gradeLabel: string | null;
  /** Provenance chip text, matching Pub of the Day's "Sourced" idiom. */
  provenanceLabel: string;
  /** Readable source brand for the attribution line ("Wikipedia", "On record"). */
  sourceLabel: string;
  /** Canonical source URL when the cited fact carries one, else null. */
  sourceRef: string | null;
  /** The honest quiet register, e.g. "Usually quiet on a Tuesday". */
  quietLabel: string;
  /** "£4.80" when a verified price exists for this venue, else null. */
  priceLabel: string | null;
  /** Deep link to the venue on the map ({@link venueMapUrl}). */
  mapHref: string;
};

export type QuietPintModule = {
  /** London weekday the quiet read is for, e.g. "Tuesday". */
  weekdayName: string;
  /** Up to QUIET_PINT_LIMIT rows, strongest heritage first. */
  rows: QuietPintRow[];
};

// Heritage weight by statutory grade: Grade I is rarest, an unlisted pub carries
// no grade weight. Higher sorts first.
const GRADE_WEIGHT: Record<string, number> = { I: 3, "II*": 2, II: 1 };

function gradeWeight(listed: string | null): number {
  return listed ? (GRADE_WEIGHT[listed] ?? 0) : 0;
}

// Prefer the most readable attributable source, mirroring the Pub of the Day
// ranking. Seed material is example content, never a cited claim, so it is
// excluded up front and a seed-only candidate yields null (and is skipped).
const SOURCE_PRIORITY: readonly HeritageFact["source"][] = [
  "wikipedia",
  "nhle",
  "wikidata",
  "osm",
];

function sourcePriority(source: HeritageFact["source"]): number {
  const index = SOURCE_PRIORITY.indexOf(source);
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

function bestSourcedFact(facts: readonly HeritageFact[]): HeritageFact | null {
  const sourced = facts.filter(
    (fact) =>
      isFeaturedHeritageSource(fact.source) &&
      typeof fact.fact === "string" &&
      fact.fact.trim(),
  );
  if (sourced.length === 0) return null;
  return [...sourced].sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source))[0];
}

function londonWeekdayName(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
  }).format(now);
}

function priceLabel(price: number | null | undefined): string | null {
  return typeof price === "number" && Number.isFinite(price) ? `£${price.toFixed(2)}` : null;
}

/**
 * Whether the typical-pattern hour reads quiet right now — the same gate
 * buildQuietPint uses before surfacing heritage picks. Surfaces may use this
 * without composing the full module when they only need the window.
 */
export function isQuietPintWindow(now = new Date()): boolean {
  return estimateBusyness({ now, timeZone: "Europe/London" }).level === "quiet";
}

export type BuildQuietPintInput = {
  candidates: readonly QuietPintCandidate[];
  /** venueId → verified cheapest pint in pounds. Absent = no verified price. */
  priceById?: ReadonlyMap<string, number>;
  now?: Date;
  limit?: number;
};

/**
 * Rank heritage-cited candidates that read as quiet right now, or null when
 * there is nothing honest to show: the current London hour is not a quiet
 * window, or fewer than QUIET_PINT_MIN candidates carry a cited (non-seed)
 * heritage fact.
 *
 * Ranking (heritage-cited + quiet-band + verified price):
 *   1. listed-grade weight, highest first (Grade I over II* over II over none)
 *   2. era, oldest first (an undated pub sorts last)
 *   3. a verified price present, before none
 *   4. cheaper verified price first
 *   5. slug, for a stable, locale-independent final order
 *
 * The quiet band is global to the hour (the typical-pattern estimate is the same
 * honest signal for every venue), so it gates the module rather than reordering
 * rows; every row then names the same true quiet register. Pure over the inputs.
 */
export function buildQuietPint(input: BuildQuietPintInput): QuietPintModule | null {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.floor(input.limit ?? QUIET_PINT_LIMIT));
  const priceById = input.priceById ?? new Map<string, number>();

  // Quiet window gate: only surface a "quiet pint" set when the same typical
  // pattern the plan pages show reads quiet at `now`. A recent community "quiet"
  // report counts too (its level is still "quiet"); anything busier steps aside.
  const band = estimateBusyness({ now, timeZone: "Europe/London" });
  if (band.level !== "quiet") return null;

  const weekdayName = londonWeekdayName(now);
  const quietLabel = `${band.label} on a ${weekdayName}`;

  const ranked = input.candidates
    .map((candidate) => ({ candidate, best: bestSourcedFact(candidate.facts) }))
    .filter(
      (entry): entry is { candidate: QuietPintCandidate; best: HeritageFact } =>
        entry.best !== null &&
        typeof entry.candidate.venueId === "string" &&
        entry.candidate.venueId.length > 0 &&
        typeof entry.candidate.hook === "string" &&
        entry.candidate.hook.trim().length > 0,
    )
    .sort((a, b) => {
      const byGrade = gradeWeight(b.candidate.listed) - gradeWeight(a.candidate.listed);
      if (byGrade !== 0) return byGrade;
      const byEra = eraStartYear(a.candidate.era) - eraStartYear(b.candidate.era);
      if (Number.isFinite(byEra) && byEra !== 0) return byEra;
      const aPrice = priceById.get(a.candidate.venueId);
      const bPrice = priceById.get(b.candidate.venueId);
      const aHas = typeof aPrice === "number";
      const bHas = typeof bPrice === "number";
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas && aPrice !== bPrice) return (aPrice as number) - (bPrice as number);
      return a.candidate.slug < b.candidate.slug ? -1 : a.candidate.slug > b.candidate.slug ? 1 : 0;
    });

  if (ranked.length < QUIET_PINT_MIN) return null;

  const rows: QuietPintRow[] = ranked.slice(0, limit).map(({ candidate, best }) => ({
    id: candidate.venueId,
    name: candidate.name,
    heritageLine: candidate.hook.trim(),
    eraLabel: candidate.era,
    gradeLabel: listedBadge(candidate.listed),
    provenanceLabel: PROVENANCE_LABEL.sourced,
    sourceLabel: heritageSourceLabel(best.source),
    sourceRef: typeof best.sourceRef === "string" && best.sourceRef.trim() ? best.sourceRef : null,
    quietLabel,
    priceLabel: priceLabel(priceById.get(candidate.venueId)),
    mapHref: venueMapUrl(candidate.venueId),
  }));

  return { weekdayName, rows };
}
