// Seed-borough coverage status for the price flywheel (PLG Wave 2).
// Status copy only: never a leaderboard, never a stranger feed, never a claim
// that a failed read means the borough is empty.

/** Soft-launch patches we densify before marketing elsewhere. */
export const SEED_BOROUGH_CAMPAIGN = [
  { slug: "westminster", name: "Soho / Westminster", mapQuery: "Soho" },
  { slug: "camden", name: "Camden", mapQuery: "Camden" },
  { slug: "lambeth", name: "Clapham / Lambeth", mapQuery: "Clapham" },
  { slug: "hackney", name: "Shoreditch / Hackney", mapQuery: "Shoreditch" },
  { slug: "islington", name: "Islington", mapQuery: "Islington" },
] as const;

/** Corroborated beer pints this month before the line reads as met. */
export const SEED_BOROUGH_MONTHLY_TARGET = 20;

export type BoroughCoverageReadStatus = "ready" | "partial" | "degraded" | "unknown";

export type BoroughCoverageInput = {
  slug: string;
  name: string;
  mapQuery: string;
  /** Distinct corroborated beer (venue, category) pairs attributed to the borough. */
  corroboratedPintCount: number;
  target?: number;
  status: BoroughCoverageReadStatus;
};

/**
 * One honest status sentence. A failed or unknown read names the uncertainty;
 * it never reports a zero as proof the borough has no prices.
 */
export function boroughCoverageStatusCopy(input: BoroughCoverageInput): string {
  const target = input.target ?? SEED_BOROUGH_MONTHLY_TARGET;
  if (input.status === "degraded" || input.status === "unknown") {
    return `${input.name}: we could not count corroborated pints just now.`;
  }
  const count = Math.max(0, Math.floor(input.corroboratedPintCount));
  const remaining = Math.max(0, target - count);
  const partialNote = input.status === "partial" ? " At least, that is: the count may run higher." : "";
  if (remaining === 0) {
    return `${input.name} has met its ${target} corroborated pints for this month.${partialNote}`;
  }
  const pintWord = remaining === 1 ? "pint" : "pints";
  return `${input.name} needs ${remaining} more corroborated ${pintWord} this month.${partialNote}`;
}

/** Map href that opens the patch browse without inventing a selected pub. */
export function boroughCoverageMapHref(mapQuery: string): string {
  return `/map?q=${encodeURIComponent(mapQuery)}`;
}
