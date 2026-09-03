import type { OutOpenPlan } from "@/lib/out";
import type { OutSourceCredit } from "@/lib/out/attribution";
import type { OutVenueMatchStatus } from "@/lib/out/venueMatch";
import type { WhatsOnRow } from "@/lib/whatsOn";

export const MAX_OUT_EVENTS = 100;
export const OUT_UNMATCHED_PLACES_SHOWN = 6;
export const OUT_DAYS = ["today", "tomorrow", "weekend"] as const;
export type OutDay = (typeof OUT_DAYS)[number];

export type OutQuery = {
  city: string;
  day: OutDay;
};

/**
 * What a public caller is told about one lane.
 *
 * `status` is the reader-visible fact and the whole of it. The upstream error
 * text stays in the server log: this body is public and CDN-cacheable, and an
 * upstream diagnostic string is not something a stranger is owed.
 */
export type OutProviderStatus = "ready" | "degraded" | "not-configured";

export type OutProviderReport = {
  name: string;
  configured: boolean;
  rows: number;
  status: OutProviderStatus;
};

/**
 * A lane that was never ASKED cannot produce a ready answer, and a missing key
 * is never an empty-market claim - so "not-configured" is a body status of its
 * own, weaker than degraded (which means we looked and could not see).
 */
export type OutStatus = "ready" | "degraded" | "not-configured";
export type OutOpenPlansStatus = "ready" | "degraded" | "preview";

export type OutResponse = {
  /**
   * The WHOLE answer's health: the listings lane and the open-plans read
   * together. It is what decides how long the edge may keep this body, and a
   * failed open-plans read belongs in it.
   */
  status: OutStatus;
  /**
   * The LISTINGS lane's own health, untouched by the open-plans read.
   *
   * A surface that shows listings and no open plans asks THIS one: with the
   * plans RPC unavailable, the top-level status is degraded while both event
   * providers read fine, and "Some listings could not be checked." over a
   * complete list is a claim about a read that ran.
   */
  listingsStatus: OutStatus;
  /** Why the LISTINGS lane is degraded, in words a reader can act on. */
  listingsReason?: string;
  events: WhatsOnRow[];
  openPlans: OutOpenPlan[] | null;
  openPlansStatus?: OutOpenPlansStatus;
  attribution: OutSourceCredit[];
  observedAt: Record<string, string>;
  providers: OutProviderReport[];
  /** Number of window-filtered rows without a venueId, before the serve cap. */
  unmatchedCount?: number;
  unmatchedPlaces?: string[];
  /** Number of distinct unmatched place names, before the serve cap. */
  unmatchedPlaceCount?: number;
  unmatchedSources?: string[];
  /** Why a degraded answer is degraded, in words a reader can act on. */
  reason?: string;
  /**
   * Whether the request-time venue match RAN over these rows.
   *
   * `unavailable` means the slim index could not be read, so a row with no
   * venueId may well be at a listed pub; the surface words that apart from
   * "not listed yet". Absent on a body from before the field, which was
   * served by a lane that matched nothing and claimed nothing.
   */
  venueMatch: OutVenueMatchStatus;
};
