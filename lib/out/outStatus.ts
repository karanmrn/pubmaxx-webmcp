import type { OutResponse, OutStatus } from "@/lib/out/types";
import type { OutVenueMatchStatus } from "@/lib/out/venueMatch";

export const OUT_READY_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=900";
export const OUT_UNSETTLED_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=0";

/**
 * How long the edge may keep this answer.
 *
 * A ready answer is a settled fact about the day and holds for its full window.
 * A degraded or not-configured answer is a fact about US at one instant - one
 * upstream blip would otherwise pin "Some listings could not be checked." on
 * the CDN for a quarter of an hour after the provider recovered - so it is held
 * briefly and re-asked.
 */
export function outCacheControl(
  status: OutStatus,
  venueMatch: OutVenueMatchStatus,
): string {
  return status === "ready" && venueMatch === "ready"
    ? OUT_READY_CACHE_CONTROL
    : OUT_UNSETTLED_CACHE_CONTROL;
}

export const OUT_READ_FAILED_LINE = "Could not check listings.";
export const OUT_DEGRADED_LINE = "Some listings could not be checked.";
export const OUT_EMPTY_LINE = "No listings for this day yet.";
/**
 * A lane nobody asked, said to a drinker rather than to us.
 *
 * "Listings are not switched on yet." described our own configuration, which
 * never belongs in a drinker's copy. This says what the reader gets and keeps
 * the state distinguishable from OUT_EMPTY_LINE: it is about US having nothing
 * to show, never a claim that the city is quiet, which we did not look at.
 */
export const OUT_NOT_CONFIGURED_LINE = "We don\u2019t have listings to show yet.";

/**
 * The one way onward from an /out lane with nothing in it.
 *
 * Nothing here is a dead end, and the two ways out are the two honest ones: a
 * lane that answered with nothing still has the pubs behind it, and a lane we
 * could not read is worth asking again.
 */
export const OUT_MAP_WAY = { href: "/map", label: "Open the map" } as const;
export const OUT_RETRY_LABEL = "Try again";

export type OutEmptyWay = "map" | "retry";

/**
 * What the surface may show for the day currently on screen.
 *
 * An answer is held WITH the day it is about, and there is no answer at all
 * until the first read lands. Both cases are PENDING: the previous day's cards
 * may not render under a newly pressed chip, and a reader opening the page must
 * not meet the heading and the day chips over a blank area either.
 */
export function outAnswerView<T>(
  held: { day: string; body: T | null; failed: boolean } | null,
  day: string,
): { body: T | null; failed: boolean; pending: boolean } {
  const current = held !== null && held.day === day ? held : null;
  return {
    body: current?.body ?? null,
    failed: current?.failed ?? false,
    pending: current === null,
  };
}

export type OutListingsBody = Pick<OutResponse, "status" | "events" | "reason"> &
  Partial<Pick<OutResponse, "listingsStatus" | "listingsReason" | "venueMatch">>;

/**
 * The listings lane's own health, for every surface that shows only listings.
 *
 * `/api/out` widens the top-level status with the OPEN-PLANS read, so a plans
 * RPC that is unavailable (no Supabase, or migration 0110 not yet applied)
 * marks an answer whose event providers both read fine. The lane's own field is
 * the honest one; a body from before that field existed falls back to the
 * top-level status, which was that answer's whole truth at the time.
 */
export function outListingsHealth(body: OutListingsBody): {
  status: OutStatus;
  reason: string | undefined;
} {
  if (body.listingsStatus) {
    return { status: body.listingsStatus, reason: body.listingsReason };
  }
  return { status: body.status, reason: body.reason };
}

/**
 * What /out says above the list, in order.
 *
 * The one rule: a read that did not answer is NEVER worded as an empty market.
 * A degraded answer with zero rows says only that some listings could not be
 * checked - printing "No listings for this day yet." beside it tells a reader
 * the city is quiet when what actually happened is that we could not look.
 */
export function outStatusLines(input: {
  body: OutListingsBody | null;
  failed: boolean;
}): string[] {
  const lines: string[] = [];
  if (input.failed) lines.push(OUT_READ_FAILED_LINE);
  const body = input.body;
  if (!body) {
    // A pressed chip with no answer yet is a skeleton, not a sentence. The
    // surface must not word that wait as an empty market either.
    return lines;
  }
  const listings = outListingsHealth(body);
  if (listings.status === "degraded") {
    lines.push(listings.reason ?? OUT_DEGRADED_LINE);
    return lines;
  }
  // A lane nobody asked is not a city with nothing on. Say the listings are off
  // rather than wording an unasked question as an empty market.
  if (listings.status === "not-configured") {
    lines.push(listings.reason ?? OUT_NOT_CONFIGURED_LINE);
    return lines;
  }
  if (input.failed) return lines;
  if (body.events.length === 0) {
    lines.push(OUT_EMPTY_LINE);
  }
  return lines;
}

/**
 * What an /out lane with no rows owes its reader: the sentence it already has,
 * and which of the two ways onward belongs under it. `null` means the lane has
 * something to show, or has not answered yet, and owes neither - a wait is a
 * skeleton, and a list needs no way out of itself.
 *
 * A read we could not run is asked again; anything else sends the reader to the
 * map, because whatever is listed tonight, the pubs are always there.
 */
export function outEmptyLane(input: {
  body: OutListingsBody | null;
  failed: boolean;
  pending: boolean;
}): { lines: string[]; way: OutEmptyWay } | null {
  if (input.pending) return null;
  if (input.body && input.body.events.length > 0) return null;
  const lines = outStatusLines({ body: input.body, failed: input.failed });
  if (lines.length === 0) return null;
  const unreadable =
    input.failed || (input.body ? outListingsHealth(input.body).status === "degraded" : false);
  return { lines, way: unreadable ? "retry" : "map" };
}
