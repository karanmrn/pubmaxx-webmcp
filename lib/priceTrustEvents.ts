// Price trust events: one durable unlock for the first qualifying cluster.
//
// Trust itself lives in lib/communityPrice.ts. This module only names the
// first independent observation set that crosses that gate, hashes it, and
// says who may be credited. It adds no second threshold, age window, or
// agreement rule.

import "server-only";

import { createHash } from "node:crypto";

import {
  agreesWithinTolerance,
  bestCorroboratedRow,
  COMMUNITY_PRICE_CORROBORATION_THRESHOLD,
  isCorroborated,
  isWithinMaxAge,
  submitterBucket,
} from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

export type TrustObservation = {
  id: string;
  venueId: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  submittedAt: number;
  actor: string | null;
  hidden?: boolean;
};

export type QualifyingCluster = {
  observationIds: string[];
  actors: string[];
};

function visibleRows(rows: readonly TrustObservation[]): TrustObservation[] {
  return rows.filter((row) => !row.hidden && row.id);
}

/**
 * The earliest independent observations that first satisfy the community-price
 * trust gate. A later agreeing report is not in this set.
 */
export function firstQualifyingCluster(
  observations: readonly TrustObservation[],
  now: number = Date.now(),
): QualifyingCluster | null {
  const rows = visibleRows(observations);
  const best = bestCorroboratedRow(rows, now);
  if (!best) return null;
  const candidate = best.row;
  if (
    !isCorroborated({ corroborations: best.corroborations }) ||
    !isWithinMaxAge(candidate, now)
  ) {
    return null;
  }

  const agreeing = [...rows]
    .filter(
      (row) =>
        isWithinMaxAge(row, now) &&
        row.drinkCategory === candidate.drinkCategory &&
        agreesWithinTolerance(candidate.priceGbp, row.priceGbp),
    )
    .sort(
      (left, right) =>
        left.submittedAt - right.submittedAt || left.id.localeCompare(right.id),
    );

  const seen = new Set<string>();
  const cluster: TrustObservation[] = [];
  for (const row of agreeing) {
    const bucket = submitterBucket(row.actor);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    cluster.push(row);
    if (cluster.length >= COMMUNITY_PRICE_CORROBORATION_THRESHOLD) break;
  }
  if (cluster.length < COMMUNITY_PRICE_CORROBORATION_THRESHOLD) return null;

  const observationIds = cluster.map((row) => row.id).sort();
  const actors = cluster
    .map((row) => row.actor)
    .filter((actor): actor is string => typeof actor === "string" && actor !== "");
  return { observationIds, actors };
}

export function categoryIsTrusted(
  observations: readonly TrustObservation[],
  now: number = Date.now(),
): boolean {
  return firstQualifyingCluster(observations, now) !== null;
}

export function trustEventFingerprint(
  venueId: string,
  category: DrinkCategory,
  observationIds: readonly string[],
): string {
  const ids = [...observationIds].sort();
  return createHash("sha256")
    .update(`${venueId}\u0000${category}\u0000${ids.join("\u0000")}`)
    .digest("hex");
}

export function reversalFingerprint(originalFingerprint: string): string {
  return createHash("sha256")
    .update(`reversal\u0000${originalFingerprint}`)
    .digest("hex");
}

/** Credit binds to the account behind a profile actor, never handle text. */
export function profileIdFromActor(actor: string): string | null {
  if (!actor.startsWith("profile:")) return null;
  const id = actor.slice("profile:".length).trim();
  return id || null;
}
