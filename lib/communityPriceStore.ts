// SERVER-ONLY store for community price and venue-signal submissions - the
// durable half of "tap a pub, log what you saw". Browser-safe validation and
// labels live in lib/communityPrice.ts and lib/communityVenueSignals.ts; this
// module must never be imported from a "use client" component because it pulls
// the Supabase admin client.
//
// ONE store interface, TWO implementations (process-memory + Supabase
// public.community_prices) - the exact dual-backend seam as priceConfirmStore /
// ratingsStore: Supabase when env keys exist, process-memory otherwise, chosen
// at the single communityPriceStore() seam. Until migration 0054 lands (or on a
// schema miss) the Supabase path fails soft to memory OUTSIDE production, so
// keyless dev keeps working and becomes durable the moment the table exists.
//
// OBSERVATIONS, NEVER VENUE FACTS. This store writes only its own rows and
// touches nothing in the venue dataset, scraped price CSV, or Pint Drops.
// The scraped baseline and community observations coexist, each read back with
// its own timestamp and source. An attributed contributor can replace their own
// earlier answer for one question, but cannot add a second corroborating voice.
//
// Fail-soft by contract on READS. A hiccup degrades to unavailable community
// observations while sourced venue data still renders. WRITES are honest: a
// hard durable failure comes back flagged so the route can answer 503 rather
// than pretend the tap landed.
//
// MODERATION HIDES, NEVER DELETES. A row can be flagged by a reader (`report`)
// and hidden by a moderator (`moderate`) - the observation itself is kept, with
// its report metadata, exactly as the Pint Drop path does it. Hidden rows are
// filtered on ONE read path per shape (`freshestPerCategory`'s input for prices,
// `freshestVenueSignals`' for venue signals), so a hidden observation disappears
// from the sheet, from the corroboration count, and from the map candidate or
// established answer in a single stroke: there is no second place to remember.
// Both shapes reach the same queue (`listForReview`) and the same hide/restore
// call, because a wrong step-free claim needs a way down as much as a wrong
// figure does. Reporting NEVER auto-hides here (unlike pint drops): a community
// price is the thing the map is made of, so taking one down is a human decision.
//
// TRUST IS COUNTED HERE, ENFORCED ELSEWHERE. Reads attach `corroborations` -
// how many independent submitters back the figure - derived from the per-
// (venue, category, actor) rows already stored, with no schema change and no
// extra write. The store never DECIDES anything with it: the map-side gate
// (threshold + 30-day age) lives in the one merge seam,
// components/map/communityPriceSignals.ts, and the policy constants it reads
// live in lib/communityPrice.ts.

import "server-only";

import { randomUUID } from "node:crypto";

import {
  agreesWithinTolerance,
  bestCorroboratedRow,
  countCorroborations,
  COMMUNITY_PRICE_MAX_AGE_MS,
  isCorroborated,
  isWithinMaxAge,
  marksMapProvisionally,
  roundToPennies,
  submitterBucket,
  type CommunityPrice,
  type CommunityPriceInput,
  type CommunityPriceMapCandidate,
} from "@/lib/communityPrice";
import {
  isCommunityVenueSignalKey,
  isCommunityVenueSignalValueFor,
  validateCommunityVenueSignal,
  type CommunityVenueSignal,
  type CommunityVenueSignalCandidate,
  type CommunityVenueSignalInput,
  type CommunityVenueSignalKey,
  type CommunityVenueSignalValue,
} from "@/lib/communityVenueSignals";
import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import type {
  ContributionRecord,
  ContributionRecordReadResult,
} from "@/lib/contributorLeaderboard";
import { normalizeHandle } from "@/lib/profiles";
import type { RoundPriceSource } from "@/lib/rounds";
import {
  markRoundPriceSourcePromoted,
  markRoundPriceSourceSuperseded,
  roundPriceSourceStatus,
} from "@/lib/roundsStore";
import { MAX_PROVISIONAL_BASE_VENUE_IDS } from "@/lib/ukBasePubs";
import {
  admin,
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";

export type CommunityPriceWrite = CommunityPriceInput & {
  /**
   * Stable, opaque contributor key. Public contribution routes derive it from
   * the authenticated profile id. Lets one account replace its OWN earlier
   * observation for the same drink instead of stacking duplicates.
   */
  actor?: string;
  /**
   * Server-derived public PUBMAXX handle. Optional here for legacy rows and
   * internal imports; public contribution routes require account ownership.
   */
  contributorHandle?: string;
  roundSource?: RoundPriceSource;
};

export type CommunityPriceWriteResult = {
  /** The stored observation, or null when the input fell outside the envelope. */
  price: CommunityPrice | null;
  /** Set when a durable write hard-failed - the submission was NOT recorded. */
  failed?: true;
  sourceBecameOwner?: boolean;
};

export type CommunityVenueSignalWrite = CommunityVenueSignalInput & {
  /** Same server-derived opaque contributor key community prices use. */
  actor?: string;
};

export type CommunityVenueSignalWriteResult = {
  signal: CommunityVenueSignal | null;
  failed?: true;
};

export type CommunityVenueSignalReadResult = {
  signals: CommunityVenueSignal[];
  degraded: boolean;
};

export type CommunityContributorCount = {
  /** Opaque server-side contributor key. Never expose directly in UI. */
  contributorKey: string;
  priceCount: number;
  venueSignalCount: number;
  total: number;
};

export type CommunityPriceReadResult = {
  prices: CommunityPrice[];
  degraded: boolean;
};

export type CommunityPriceCategoryIndexResult = {
  prices: CommunityPrice[];
  truncated: boolean;
  degraded: boolean;
};

export type ProvisionalVenueIdReadResult = {
  venueIds: string[];
  degraded: boolean;
};

/**
 * A reported/hidden observation as the moderator queue sees it. Carries the
 * report metadata the moderator needs to judge it and NOTHING that identifies
 * the submitter - the actor token stays inside the store, exactly as it does on
 * the public read path.
 *
 * `kind` is what the moderator is judging, because this table holds two shapes
 * and a queue row that cannot say which it is would be unreadable: a price has a
 * drink and a figure, a venue signal has a question and a categorical answer.
 * Character is the most reputation-sensitive thing a stranger can write about a
 * pub, so it goes through this queue rather than having no way down.
 */
type ModeratorObservationBase = {
  id: string;
  venueId: string;
  submittedAt: number;
  hidden: boolean;
  reportCount: number;
  reportedAt?: number;
  reportReason?: string;
  moderatorNote?: string;
};

export type ModeratorCommunityPrice = ModeratorObservationBase &
  (
    | { kind: "price"; drinkCategory: DrinkCategory; priceGbp: number }
    | {
        kind: "signal";
        signalKey: CommunityVenueSignalKey;
        signalValue: CommunityVenueSignalValue;
      }
  );

export type CommunityPriceStore = {
  /**
   * Record an observation and return it as stored. NEVER throws; a durable
   * write that hard-fails resolves with `failed: true` so the route can answer
   * 503 (house rule: degraded dependency, not a fake success).
   */
  submit(input: CommunityPriceWrite, now?: number): Promise<CommunityPriceWriteResult>;
  /** Record a categorical pub observation using the same actor semantics. */
  submitSignal(
    input: CommunityVenueSignalWrite,
    now?: number,
  ): Promise<CommunityVenueSignalWriteResult>;
  /**
   * The freshest community price per drink category at one venue, newest
   * first, each carrying its independent-submitter count (`corroborations`) so
   * the read path can apply the trust threshold. NEVER throws; `degraded`
   * distinguishes an unavailable durable read from an honest empty.
   */
  latestForVenue(venueId: string, now?: number): Promise<CommunityPriceReadResult>;
  /** Freshest report per venue-signal question with derived trust counts. */
  latestSignalsForVenue(
    venueId: string,
    now?: number,
  ): Promise<CommunityVenueSignalReadResult>;
  /**
   * Current public rows for selected categories across venues. Used by a map
   * lens that cannot discover a venue one sheet at a time. Actor tokens never
   * leave this method, and the scan is finite.
   */
  latestForCategories(
    categories: readonly DrinkCategory[],
    now?: number,
  ): Promise<CommunityPriceCategoryIndexResult>;
  /**
   * Which requested venues have a fresh beer report that has not earned price
   * authority. Returns ids only, so viewport visibility cannot leak a figure
   * into the map's price merge.
   */
  latestProvisionalVenueIds(
    venueIds: readonly string[],
    now?: number,
  ): Promise<ProvisionalVenueIdReadResult>;
  /**
   * How many (venue, drink category) pairs currently have a figure the map is
   * allowed to paint - corroborated by a second independent submitter AND
   * inside the age window. The flywheel number, read-only: it asks the SAME
   * `bestCorroboratedCandidate` + `isCorroborated` pair the per-venue read
   * uses, so it can never report a category the map would refuse. NEVER
   * throws; `degraded` marks an unavailable durable read rather than a real 0.
   */
  countCorroboratedCategories(now?: number): Promise<CorroboratedCategoryCount>;
  /**
   * Reader flag on one observation, price or venue signal. Records the reason
   * and counts the report; it NEVER hides by itself. False = unknown id. NEVER
   * throws.
   */
  report(id: string, reason?: string, actorHash?: string): Promise<boolean>;
  /**
   * Moderator decision: hide the observation from every public read, or restore
   * it. Works on either shape by id. The row is kept either way - this store has
   * no delete. False = unknown id. NEVER throws.
   */
  moderate(id: string, hidden: boolean, note?: string): Promise<boolean>;
  moderateWithState(
    id: string,
    hidden: boolean,
    note?: string,
  ): Promise<ModerationStateResult>;
  /**
   * The moderation queue: reported and/or hidden observations of either shape,
   * newest report first. NEVER throws; an unavailable durable read degrades to
   * empty.
   */
  listForReview(limit?: number): Promise<ModeratorCommunityPrice[]>;
  listForReviewWithStatus(limit?: number): Promise<CommunityPriceReviewReadResult>;
  /** Server-only roll-up seam for a future contribution leaderboard. */
  listContributorCounts(limit?: number): Promise<CommunityContributorCount[]>;
  /** Private all-time projection for contributor counting. */
  listLeaderboardContributions(): Promise<ContributionRecordReadResult>;
};

export type CorroboratedCategoryCount = {
  /** Distinct (venue, category) pairs whose map candidate is corroborated. */
  count: number;
  /** True when the scan hit its row cap, so `count` is a floor, not a total. */
  truncated: boolean;
  degraded: boolean;
};

export type CommunityPriceReviewReadResult = {
  prices: ModeratorCommunityPrice[];
  degraded: boolean;
};

export type ModerationObservationKind = "price" | "signal";

export type ModerationStateResult =
  | {
      status: "ok";
      changed: boolean;
      kind: ModerationObservationKind;
    }
  | {
      status: "not-found" | "unavailable";
      changed: false;
    };

function durableModerationKind(row: unknown): ModerationObservationKind {
  if (
    row &&
    typeof row === "object" &&
    "drink_category" in row &&
    (row as { drink_category?: unknown }).drink_category === null
  ) {
    return "signal";
  }
  return "price";
}

// Penny envelope, mirroring lib/communityPrice.ts (£1 … £30) and the DB CHECK
// in migration 0054 - defence in depth, three layers agreeing.
const MIN_PENNIES = 100;
const MAX_PENNIES = 3_000;
const MAX_VENUE_ID = 64;
// Bound process memory in a long-lived server - evict the least-recently-
// written venue past this many distinct venues.
const MAX_VENUES = 5_000;
// Cap how many raw rows one venue read pulls. Generous for the per-category
// reduction below, bounded on purpose.
const VENUE_SCAN_ROWS = 200;
// Cap the corroboration roll-up's durable scan. Deliberately bounded: this is a
// dashboard number on a cached route, not a report, and an unbounded table scan
// is not something a read path should ever be able to ask for. When the cap is
// hit the answer is reported as a floor (`truncated`), never as a total.
const CORROBORATION_SCAN_ROWS = 20_000;
const CATEGORY_INDEX_SCAN_ROWS = 20_000;
const PROVISIONAL_VENUE_SCAN_ROWS =
  MAX_PROVISIONAL_BASE_VENUE_IDS * VENUE_SCAN_ROWS;
// PostgREST silently caps any single response at the project's server-side
// max-rows setting (hosted default 1000), so one `.limit(20_000)` request can
// come back short without ever saying so. The durable scan therefore pages in
// chunks no larger than that default and derives `truncated` from the last
// page's fill, keeping the flag honest regardless of the Max Rows setting.
const CORROBORATION_SCAN_PAGE = 1_000;
let lastModerationStamp = 0;

function nextModerationStamp(): number {
  lastModerationStamp = Math.max(Date.now(), lastModerationStamp + 1);
  return lastModerationStamp;
}

/**
 * The moderation half of a stored observation, shared by every shape this table
 * holds. One definition on purpose: a row a reader can flag but nobody can hide,
 * or hide without its vote leaving the count, is the failure this seam exists to
 * prevent, and a second copy of these fields is how one shape drifts out of it.
 */
type StoredModeration = {
  /** Hidden by a moderator. Filtered out of every public read; never deleted. */
  hidden: boolean;
  /** Reader flags, for the moderation queue only - it decides nothing here. */
  reportCount: number;
  reportedAt?: number;
  reportReason?: string;
  moderatorNote?: string;
  moderatedAt?: number;
  /** Actors that have already flagged this row - one report each, durably. */
  reporters?: Set<string>;
};

type StoredPrice = CommunityPrice & {
  id: string;
  actor: string | null;
  contributorHandle: string | null;
  roundSource: RoundPriceSource | null;
} & StoredModeration;

type StoredVenueSignal = CommunityVenueSignal & {
  id: string;
  actor: string | null;
} & StoredModeration;

/** Cap a free-text moderation/report reason before it is stored or shown. */
const MAX_REASON = 280;

function cleanReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, MAX_REASON);
  return cleaned === "" ? undefined : cleaned;
}

function cleanVenueId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, MAX_VENUE_ID);
}

/** Normalise an input to storable parts, or null when out of envelope. */
function normalize(
  input: CommunityPriceWrite,
): { venueId: string; drinkCategory: DrinkCategory; pennies: number } | null {
  const venueId = cleanVenueId(input.venueId);
  if (!venueId) return null;
  if (!isDrinkCategory(input.drinkCategory)) return null;
  if (typeof input.priceGbp !== "number" || !Number.isFinite(input.priceGbp)) return null;
  const pennies = Math.round(input.priceGbp * 100);
  if (pennies < MIN_PENNIES || pennies > MAX_PENNIES) return null;
  return { venueId, drinkCategory: input.drinkCategory, pennies };
}

function cleanRoundPriceSource(
  value: RoundPriceSource | undefined,
): RoundPriceSource | null {
  if (
    !value ||
    typeof value.spendId !== "string" ||
    value.spendId.trim() === "" ||
    !Number.isInteger(value.lineIndex) ||
    value.lineIndex < 0
  ) {
    return null;
  }
  return { spendId: value.spendId, lineIndex: value.lineIndex };
}

function sameRoundPriceSource(
  left: RoundPriceSource | null,
  right: RoundPriceSource | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left?.spendId === right?.spendId &&
    left?.lineIndex === right?.lineIndex
  );
}

function toPrice(
  venueId: string,
  drinkCategory: DrinkCategory,
  pennies: number,
  submittedAt: number,
): CommunityPrice {
  return {
    venueId,
    drinkCategory,
    priceGbp: roundToPennies(pennies / 100),
    submittedAt,
    source: "community",
  };
}

function normalizeSignal(
  input: CommunityVenueSignalWrite,
): CommunityVenueSignalInput | null {
  const result = validateCommunityVenueSignal(input);
  return result.ok ? result.value : null;
}

function toVenueSignal(
  input: CommunityVenueSignalInput,
  submittedAt: number,
): CommunityVenueSignal {
  return {
    ...input,
    submittedAt,
    source: "community",
  };
}

function publishedVenueSignal(stored: StoredVenueSignal): CommunityVenueSignal {
  return {
    // Same boundary as a price: the id crosses (it identifies an observation a
    // reader may flag), the actor never does.
    id: stored.id,
    venueId: stored.venueId,
    signalKey: stored.signalKey,
    signalValue: stored.signalValue,
    submittedAt: stored.submittedAt,
    source: "community",
  };
}

function countSignalCorroborations(
  rows: readonly StoredVenueSignal[],
  reference: StoredVenueSignal,
): number {
  const submitters = new Set<string>();
  for (const row of rows) {
    if (row.signalKey !== reference.signalKey) continue;
    if (row.signalValue !== reference.signalValue) continue;
    submitters.add(submitterBucket(row.actor));
  }
  return submitters.size;
}

function bestSignalCandidate(
  rows: readonly StoredVenueSignal[],
  now: number,
): CommunityVenueSignalCandidate | null {
  let best: StoredVenueSignal | null = null;
  let bestCount = 0;
  for (const row of rows) {
    if (!isWithinMaxAge(row, now)) continue;
    const count = countSignalCorroborations(rows, row);
    if (
      !best ||
      count > bestCount ||
      (count === bestCount && row.submittedAt >= best.submittedAt)
    ) {
      best = row;
      bestCount = count;
    }
  }
  return best
    ? {
        signalValue: best.signalValue,
        submittedAt: best.submittedAt,
        corroborations: bestCount,
      }
    : null;
}

function freshestVenueSignals(
  allRows: readonly StoredVenueSignal[],
  now: number,
): CommunityVenueSignal[] {
  // THE one place a hidden signal leaves the public world, the same single
  // filter freshestPerCategory uses for prices: a hidden report cannot show on
  // the sheet, cannot corroborate an answer, and cannot be the established
  // candidate, because all three questions below read this filtered set.
  const rows = allRows.filter((row) => !row.hidden);
  const byKey = new Map<CommunityVenueSignalKey, StoredVenueSignal>();
  for (const row of rows) {
    const held = byKey.get(row.signalKey);
    if (!held || row.submittedAt >= held.submittedAt) {
      byKey.set(row.signalKey, row);
    }
  }
  return [...byKey.entries()]
    .map(([signalKey, row]) => {
      const questionRows = rows.filter((candidate) => candidate.signalKey === signalKey);
      const establishedCandidate = bestSignalCandidate(questionRows, now);
      return {
        ...publishedVenueSignal(row),
        corroborations: countSignalCorroborations(questionRows, row),
        ...(establishedCandidate ? { establishedCandidate } : {}),
      };
    })
    .sort((left, right) => right.submittedAt - left.submittedAt);
}

function contributorCountsFromRows(
  priceRows: readonly StoredPrice[],
  signalRows: readonly StoredVenueSignal[],
  limit: number,
): CommunityContributorCount[] {
  const counts = new Map<string, CommunityContributorCount>();
  const rowFor = (actor: string) => {
    const held = counts.get(actor);
    if (held) return held;
    const created: CommunityContributorCount = {
      contributorKey: actor,
      priceCount: 0,
      venueSignalCount: 0,
      total: 0,
    };
    counts.set(actor, created);
    return created;
  };
  for (const row of priceRows) {
    if (!row.actor) continue;
    const count = rowFor(row.actor);
    count.priceCount += 1;
    count.total += 1;
  }
  for (const row of signalRows) {
    if (!row.actor) continue;
    const count = rowFor(row.actor);
    count.venueSignalCount += 1;
    count.total += 1;
  }
  return [...counts.values()]
    .sort(
      (left, right) =>
        right.total - left.total ||
        left.contributorKey.localeCompare(right.contributorKey),
    )
    .slice(0, Math.max(0, limit));
}

/**
 * The category's MAP candidate, over the one cluster owner in
 * lib/communityPrice.ts: the sheet row stays freshest-wins while the map
 * follows the best-backed in-window figure until a contradiction itself reaches
 * the threshold. Null when the category has no in-window row at all.
 */
function bestCorroboratedCandidate(
  categoryRows: StoredPrice[],
  now: number,
): CommunityPriceMapCandidate | null {
  const best = bestCorroboratedRow(categoryRows, now);
  if (!best) return null;
  return {
    priceGbp: best.row.priceGbp,
    submittedAt: best.row.submittedAt,
    corroborations: best.corroborations,
  };
}

/**
 * Reduce raw observations to ONE per drink category - the freshest wins -
 * ordered newest-first, each carrying how many independent submitters agree
 * with it plus the category's best-corroborated in-window `mapCandidate`.
 * Shared by both backends so the memory store and the durable store can never
 * disagree about what "the community price" is, or about how much the map
 * should trust it. Actor tokens are counted here and dropped here; they never
 * leave the store (see `published`).
 */
function freshestPerCategory(allRows: StoredPrice[], now: number): CommunityPrice[] {
  // THE one place a hidden observation leaves the public world. Filtering here
  // rather than at each call site means a hidden row cannot show on the sheet,
  // cannot corroborate a figure, and cannot become the map candidate - the
  // three questions this function answers all read the same filtered set.
  const rows = allRows.filter((row) => !row.hidden);
  const byCategory = new Map<DrinkCategory, StoredPrice>();
  for (const row of rows) {
    const held = byCategory.get(row.drinkCategory);
    // `>=`, not `>`: two submissions CAN land in the same millisecond, and a strict
    // comparison silently made "freshest wins" mean "first of the tie wins" -
    // so the second drinker's price was dropped from the read and their tap
    // never showed. On a tie the later row in the scan wins, which is the later
    // write in the memory backend and a stable pick in the durable one (rows
    // arrive submitted_at desc, so a tied group's order is Postgres's, not
    // ours). Either answer is defensible for a true tie; being deterministic
    // and preferring the later write is the one that matches the contract.
    if (!held || row.submittedAt >= held.submittedAt) byCategory.set(row.drinkCategory, row);
  }
  return [...byCategory.entries()]
    .map(([category, row]) => {
      const categoryRows = rows.filter((r) => r.drinkCategory === category);
      const candidate = bestCorroboratedCandidate(categoryRows, now);
      return {
        ...published(row),
        corroborations: countCorroborations(categoryRows, row, now),
        ...(candidate ? { mapCandidate: candidate } : {}),
      };
    })
    .sort((a, b) => b.submittedAt - a.submittedAt);
}

/**
 * Count the (venue, category) pairs whose MAP candidate is corroborated. Asks
 * the same two questions the per-venue read already asks - the best in-window
 * agreement cluster, then the threshold - so this roll-up and the map can never
 * disagree about what counts. Grouping is by venue AND category because a pub
 * with a trusted pint and a trusted cocktail is two facts the map can paint.
 */
function countCorroboratedIn(allRows: StoredPrice[], now: number): number {
  // Same rule as freshestPerCategory: a hidden observation cannot corroborate
  // anything, so it cannot keep a (venue, category) pair in this count either -
  // otherwise the roll-up would report a figure the map itself refuses.
  const rows = allRows.filter((row) => !row.hidden);
  const groups = new Map<string, StoredPrice[]>();
  for (const row of rows) {
    // NUL separator: neither a cleaned venue id (control chars are stripped)
    // nor a category can contain it, so two keys can never collide.
    const key = `${row.venueId}\u0000${row.drinkCategory}`;
    const held = groups.get(key);
    if (held) held.push(row);
    else groups.set(key, [row]);
  }
  let count = 0;
  for (const group of groups.values()) {
    const candidate = bestCorroboratedCandidate(group, now);
    if (candidate && isCorroborated(candidate)) count += 1;
  }
  return count;
}

function categoryIndexFromRows(
  allRows: StoredPrice[],
  categories: readonly DrinkCategory[],
  now: number,
  truncated: boolean,
  degraded: boolean,
): CommunityPriceCategoryIndexResult {
  const wanted = new Set(categories);
  const groups = new Map<string, StoredPrice[]>();
  for (const row of allRows) {
    if (!wanted.has(row.drinkCategory) || !isWithinMaxAge(row, now)) continue;
    const held = groups.get(row.venueId);
    if (held) held.push(row);
    else groups.set(row.venueId, [row]);
  }
  const prices = [...groups.values()]
    .flatMap((rows) => freshestPerCategory(rows, now))
    .sort((left, right) => right.submittedAt - left.submittedAt);
  return { prices, truncated, degraded };
}

function provisionalVenueIdsFromRows(
  allRows: StoredPrice[],
  venueIds: readonly string[],
  now: number,
): string[] {
  const grouped = new Map<string, StoredPrice[]>();
  for (const row of allRows) {
    const held = grouped.get(row.venueId);
    if (held) held.push(row);
    else grouped.set(row.venueId, [row]);
  }
  const provisional: string[] = [];
  for (const venueId of venueIds) {
    const beer = freshestPerCategory(grouped.get(venueId) ?? [], now).find(
      (row) => row.drinkCategory === "beer",
    );
    if (beer && marksMapProvisionally(beer, now)) provisional.push(venueId);
  }
  return provisional;
}

/**
 * Strip the actor before a stored row leaves the store. The submitter token is
 * an internal de-duplication key, never part of the price the app reads - so
 * the boundary is spelled out here rather than relying on every caller to omit
 * it. Mirrors the durable backend, which simply never selects the column.
 */
function published(stored: StoredPrice): CommunityPrice {
  return {
    // The id DOES cross the boundary (unlike the actor): the sheet needs a
    // handle to report the row with, and it identifies an observation, not a
    // person.
    id: stored.id,
    venueId: stored.venueId,
    drinkCategory: stored.drinkCategory,
    priceGbp: stored.priceGbp,
    submittedAt: stored.submittedAt,
    source: "community",
  };
}

/** The report metadata every queue row carries, whatever shape it is. */
function moderatorBase(
  row: { id: string; venueId: string; submittedAt: number } & StoredModeration,
): ModeratorObservationBase {
  return {
    id: row.id,
    venueId: row.venueId,
    submittedAt: row.submittedAt,
    hidden: row.hidden,
    reportCount: row.reportCount,
    ...(row.reportedAt ? { reportedAt: row.reportedAt } : {}),
    ...(row.reportReason ? { reportReason: row.reportReason } : {}),
    ...(row.moderatorNote ? { moderatorNote: row.moderatorNote } : {}),
  };
}

/** Project a stored row onto the moderator DTO. Never exposes `actor`. */
function toModeratorPrice(row: StoredPrice): ModeratorCommunityPrice {
  return {
    ...moderatorBase(row),
    kind: "price",
    drinkCategory: row.drinkCategory,
    priceGbp: row.priceGbp,
  };
}

/** The same projection for a venue signal. Never exposes `actor`. */
function toModeratorSignal(row: StoredVenueSignal): ModeratorCommunityPrice {
  return {
    ...moderatorBase(row),
    kind: "signal",
    signalKey: row.signalKey,
    signalValue: row.signalValue,
  };
}

/** Bound one moderation-queue page. Generous for a solo moderator, finite. */
const REVIEW_LIMIT = 100;

// ── In-memory implementation ─────────────────────────────────────────────────
// One entry per venue, holding every observation for it. Module-level so it
// persists across requests within a process; never a browser global.
const venues = new Map<string, StoredPrice[]>();
const venueSignals = new Map<string, StoredVenueSignal[]>();

/**
 * The stored observation with this id, price or venue signal, or null. A linear
 * scan on purpose: moderation is a handful of calls a day against a
 * process-memory fallback, and a second id→row index would be one more thing
 * that can disagree with the venue maps. Both shapes are searched because the
 * durable backend moderates by id across the whole table, and a report that
 * lands there but not here would make the two backends disagree about whether a
 * wrong signal can be taken down.
 */
function findMemoryRow(id: string): StoredPrice | StoredVenueSignal | null {
  if (typeof id !== "string" || id === "") return null;
  for (const rows of venues.values()) {
    for (const row of rows) {
      if (row.id === id) return row;
    }
  }
  for (const rows of venueSignals.values()) {
    for (const row of rows) {
      if (row.id === id) return row;
    }
  }
  return null;
}

/** Evict the venue with the oldest newest-observation once past the cap. */
function evictIfNeeded(): void {
  if (venues.size <= MAX_VENUES) return;
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [key, rows] of venues) {
    const newest = rows.reduce((max, row) => Math.max(max, row.submittedAt), 0);
    if (newest < oldestAt) {
      oldestAt = newest;
      oldestKey = key;
    }
  }
  if (oldestKey) venues.delete(oldestKey);
}

function evictSignalsIfNeeded(): void {
  if (venueSignals.size <= MAX_VENUES) return;
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [key, rows] of venueSignals) {
    const newest = rows.reduce((max, row) => Math.max(max, row.submittedAt), 0);
    if (newest < oldestAt) {
      oldestAt = newest;
      oldestKey = key;
    }
  }
  if (oldestKey) venueSignals.delete(oldestKey);
}

function priceContributionRecord(
  row: StoredPrice,
  venueRows: readonly StoredPrice[],
): ContributionRecord {
  const comparable = venueRows.filter(
    (candidate) =>
      !candidate.hidden && candidate.drinkCategory === row.drinkCategory,
  );
  const corroborators = new Set(
    comparable
      .filter((candidate) =>
        agreesWithinTolerance(row.priceGbp, candidate.priceGbp),
      )
      .map((candidate) => submitterBucket(candidate.actor)),
  );
  const contradicted = comparable.some(
    (candidate) =>
      candidate.submittedAt > row.submittedAt &&
      !agreesWithinTolerance(row.priceGbp, candidate.priceGbp),
  );
  return {
    id: row.id,
    handle: row.contributorHandle ?? "",
    lane: "price",
    contributedAt: row.submittedAt,
    visible: !row.hidden,
    quality: {
      corroborated: isCorroborated({
        corroborations: corroborators.size,
      }),
      moderation: row.hidden
        ? "hidden"
        : row.moderatedAt
          ? "kept"
          : "unreviewed",
      contradicted,
    },
  };
}

export const memoryCommunityPriceStore: CommunityPriceStore = {
  async submit(input, now = Date.now()) {
    const key = normalize(input);
    if (!key) return { price: null };
    const roundSource = cleanRoundPriceSource(input.roundSource);
    const stored: StoredPrice = {
      ...toPrice(key.venueId, key.drinkCategory, key.pennies, now),
      id: randomUUID(),
      actor: input.actor ?? null,
      contributorHandle: normalizeHandle(input.contributorHandle) || null,
      roundSource,
      hidden: false,
      reportCount: 0,
    };
    const rows = venues.get(key.venueId) ?? [];
    if (roundSource) {
      if (!stored.actor) return { price: null };
      const sourceStatus = roundPriceSourceStatus(
        roundSource,
        stored.actor,
        stored.venueId,
        stored.drinkCategory,
      );
      if (sourceStatus === "promoted") {
        const owned = rows.find(
          (row) =>
            row.actor === stored.actor &&
            row.drinkCategory === stored.drinkCategory &&
            sameRoundPriceSource(row.roundSource, roundSource),
        );
        return owned
          ? { price: published(owned), sourceBecameOwner: true }
          : { price: null };
      }
      if (sourceStatus !== "ready") return { price: null };
    }
    // One live observation per (venue, category, actor): a contributor correcting
    // its own entry replaces it rather than stacking a second row, so one
    // person can't weight a venue's community price twice.
    const isOwnEarlier = (row: StoredPrice) =>
      row.drinkCategory === stored.drinkCategory &&
      row.actor !== null &&
      row.actor === stored.actor;
    const replaced = rows.find(isOwnEarlier);
    if (replaced && replaced.submittedAt > stored.submittedAt) {
      const sourceBecameOwner = sameRoundPriceSource(
        replaced.roundSource,
        roundSource,
      );
      if (roundSource && stored.actor) {
        if (sourceBecameOwner) {
          markRoundPriceSourcePromoted(roundSource, stored.actor);
        } else {
          markRoundPriceSourceSuperseded(roundSource, stored.actor);
        }
      }
      return {
        price: published(replaced),
        ...(roundSource ? { sourceBecameOwner } : {}),
      };
    }
    const kept = rows.filter((row) => !isOwnEarlier(row));
    // Moderation survives the correction. The durable backend's upsert writes
    // only the price columns, so `hidden_at` and the report metadata stay put
    // there; the memory backend has to carry them across deliberately, or a
    // hidden submitter could wash their price simply by logging it again -
    // and the two backends would disagree about whether that works.
    if (replaced) {
      if (
        replaced.roundSource &&
        !sameRoundPriceSource(replaced.roundSource, roundSource) &&
        replaced.actor
      ) {
        markRoundPriceSourceSuperseded(
          replaced.roundSource,
          replaced.actor,
        );
      }
      stored.hidden = replaced.hidden;
      stored.reportCount = replaced.reportCount;
      stored.reportedAt = replaced.reportedAt;
      stored.reportReason = replaced.reportReason;
      stored.moderatorNote = replaced.moderatorNote;
      stored.moderatedAt = replaced.moderatedAt;
      stored.reporters = replaced.reporters;
      // Keeping the id keeps a moderator's outstanding queue entry pointing at
      // a row that still exists, exactly as the durable upsert does.
      stored.id = replaced.id;
    }
    kept.push(stored);
    venues.set(key.venueId, kept);
    if (roundSource && stored.actor) {
      markRoundPriceSourcePromoted(roundSource, stored.actor);
    }
    evictIfNeeded();
    return {
      price: published(stored),
      ...(roundSource ? { sourceBecameOwner: true } : {}),
    };
  },

  async submitSignal(input, now = Date.now()) {
    const normalised = normalizeSignal(input);
    if (!normalised) return { signal: null };
    const stored: StoredVenueSignal = {
      ...toVenueSignal(normalised, now),
      id: randomUUID(),
      actor: input.actor ?? null,
      hidden: false,
      reportCount: 0,
    };
    const rows = venueSignals.get(normalised.venueId) ?? [];
    const isOwnEarlier = (row: StoredVenueSignal) =>
      row.signalKey === stored.signalKey &&
      row.actor !== null &&
      row.actor === stored.actor;
    const replaced = rows.find(isOwnEarlier);
    // Moderation survives a correction here for the same reason it does on the
    // price path: the durable upsert writes only the answer columns, so a hidden
    // contributor must not be able to wash a hidden signal by logging it again.
    if (replaced) {
      stored.id = replaced.id;
      stored.hidden = replaced.hidden;
      stored.reportCount = replaced.reportCount;
      stored.reportedAt = replaced.reportedAt;
      stored.reportReason = replaced.reportReason;
      stored.moderatorNote = replaced.moderatorNote;
      stored.reporters = replaced.reporters;
    }
    venueSignals.set(
      normalised.venueId,
      [...rows.filter((row) => !isOwnEarlier(row)), stored],
    );
    evictSignalsIfNeeded();
    return { signal: publishedVenueSignal(stored) };
  },

  async latestForVenue(venueId, now = Date.now()) {
    const key = cleanVenueId(venueId);
    if (!key) return { prices: [], degraded: false };
    return {
      prices: freshestPerCategory(venues.get(key) ?? [], now),
      degraded: false,
    };
  },

  async latestSignalsForVenue(venueId, now = Date.now()) {
    const key = cleanVenueId(venueId);
    if (!key) return { signals: [], degraded: false };
    return {
      signals: freshestVenueSignals(venueSignals.get(key) ?? [], now),
      degraded: false,
    };
  },

  async latestForCategories(categories, now = Date.now()) {
    const wanted = new Set(categories.filter(isDrinkCategory));
    if (wanted.size === 0) {
      return { prices: [], truncated: false, degraded: false };
    }
    const rows: StoredPrice[] = [];
    let truncated = false;
    for (const venueRows of venues.values()) {
      for (const row of venueRows) {
        if (!wanted.has(row.drinkCategory)) continue;
        if (rows.length >= CATEGORY_INDEX_SCAN_ROWS) {
          truncated = true;
          break;
        }
        rows.push(row);
      }
      if (truncated) break;
    }
    return categoryIndexFromRows(
      rows,
      [...wanted],
      now,
      truncated,
      false,
    );
  },

  async latestProvisionalVenueIds(venueIds, now = Date.now()) {
    const wanted = [
      ...new Set(
        venueIds
          .map(cleanVenueId)
          .filter(Boolean)
          .slice(0, MAX_PROVISIONAL_BASE_VENUE_IDS),
      ),
    ];
    if (wanted.length === 0) return { venueIds: [], degraded: false };
    return {
      venueIds: provisionalVenueIdsFromRows(
        wanted.flatMap((venueId) => venues.get(venueId) ?? []),
        wanted,
        now,
      ),
      degraded: false,
    };
  },

  async countCorroboratedCategories(now = Date.now()) {
    const rows: StoredPrice[] = [];
    for (const venueRows of venues.values()) rows.push(...venueRows);
    const scanned = rows.slice(0, CORROBORATION_SCAN_ROWS);
    return {
      count: countCorroboratedIn(scanned, now),
      truncated: rows.length > scanned.length,
      degraded: false,
    };
  },

  async report(id, reason, actorHash) {
    const row = findMemoryRow(id);
    if (!row) return false;
    // One report per actor per row, mirroring the durable unique pair: a single
    // angry reader cannot inflate the count they are asking a human to weigh.
    // An unattributed report (no actor) still lands and still counts once.
    const reporter = actorHash && actorHash !== "" ? actorHash : null;
    if (reporter) {
      row.reporters ??= new Set<string>();
      if (row.reporters.has(reporter)) return true;
      row.reporters.add(reporter);
    }
    row.reportCount += 1;
    row.reportedAt = Date.now();
    const cleaned = cleanReason(reason);
    if (cleaned) row.reportReason = cleaned;
    return true;
  },

  async moderate(id, hidden, note) {
    const row = findMemoryRow(id);
    if (!row) return false;
    row.hidden = hidden;
    row.moderatedAt = nextModerationStamp();
    const cleaned = cleanReason(note);
    if (cleaned) row.moderatorNote = cleaned;
    return true;
  },

  async moderateWithState(id, hidden, note) {
    const row = findMemoryRow(id);
    if (!row) return { status: "not-found", changed: false };
    const changed = row.hidden !== hidden;
    row.hidden = hidden;
    row.moderatedAt = nextModerationStamp();
    const cleaned = cleanReason(note);
    if (cleaned) row.moderatorNote = cleaned;
    return {
      status: "ok",
      changed,
      kind: "drinkCategory" in row ? "price" : "signal",
    };
  },

  async listForReviewWithStatus(limit = REVIEW_LIMIT) {
    const queue: ModeratorCommunityPrice[] = [];
    for (const rows of venues.values()) {
      for (const row of rows) {
        if (row.hidden || row.reportCount > 0) queue.push(toModeratorPrice(row));
      }
    }
    for (const rows of venueSignals.values()) {
      for (const row of rows) {
        if (row.hidden || row.reportCount > 0) queue.push(toModeratorSignal(row));
      }
    }
    return { prices: queue
      .sort((a, b) => (b.reportedAt ?? b.submittedAt) - (a.reportedAt ?? a.submittedAt))
      .slice(0, Math.max(0, limit)), degraded: false };
  },

  async listForReview(limit = REVIEW_LIMIT) {
    return (await this.listForReviewWithStatus(limit)).prices;
  },

  async listContributorCounts(limit = REVIEW_LIMIT) {
    const prices = [...venues.values()].flat();
    const signals = [...venueSignals.values()].flat();
    return contributorCountsFromRows(prices, signals, limit);
  },

  async listLeaderboardContributions() {
    const records: ContributionRecord[] = [];
    for (const venueRows of venues.values()) {
      for (const row of venueRows) {
        if (!row.contributorHandle) continue;
        records.push(priceContributionRecord(row, venueRows));
      }
    }
    return { status: "ready", records };
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "community-price",
  tables: "community_prices",
  migrationHint: "apply migration 0054",
});

/**
 * Guard the untyped supabase-js projection: a malformed row is SKIPPED, never
 * coerced into a price. A fabricated £0 would be worse than a missing figure.
 */
function rowsToPrices(rows: unknown, venueId: string): StoredPrice[] {
  if (!Array.isArray(rows)) return [];
  const out: StoredPrice[] = [];
  for (const r of rows) {
    if (typeof r !== "object" || r === null) continue;
    const row = r as Record<string, unknown>;
    const pennies = row.price_pennies;
    const category = row.drink_category;
    const at = row.submitted_at;
    if (typeof pennies !== "number" || !Number.isFinite(pennies)) continue;
    if (pennies < MIN_PENNIES || pennies > MAX_PENNIES) continue;
    if (!isDrinkCategory(category)) continue;
    if (typeof at !== "string" || at === "") continue;
    const submittedAt = Date.parse(at);
    if (!Number.isFinite(submittedAt)) continue;
    // A non-string actor (null, or absent on an older projection) is the
    // unattributed bucket - never coerced into a distinct submitter.
    const actor = typeof row.actor === "string" && row.actor !== "" ? row.actor : null;
    const contributorHandle =
      typeof row.contributor_handle === "string"
        ? normalizeHandle(row.contributor_handle) || null
        : null;
    // A row we cannot identify cannot be reported or moderated, but it is still
    // a real observation - it renders, it just carries no id. (Only reachable
    // before migration 0055 adds the projection.)
    const id = typeof row.id === "string" ? row.id : "";
    out.push({
      ...toPrice(venueId, category, pennies, submittedAt),
      id,
      actor,
      contributorHandle,
      roundSource: null,
      // `hidden_at` absent (older projection) reads as VISIBLE, which is what
      // the table meant before moderation existed.
      hidden: typeof row.hidden_at === "string" && row.hidden_at !== "",
      moderatedAt:
        typeof row.moderated_at === "string"
          ? Date.parse(row.moderated_at)
          : undefined,
      reportCount:
        typeof row.report_count === "number" && Number.isFinite(row.report_count)
          ? Math.max(0, Math.floor(row.report_count))
          : 0,
    });
  }
  return out;
}

function rowsToVenueSignals(
  rows: unknown,
  venueId: string,
): StoredVenueSignal[] {
  if (!Array.isArray(rows)) return [];
  const out: StoredVenueSignal[] = [];
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (!isCommunityVenueSignalKey(row.signal_key)) continue;
    if (!isCommunityVenueSignalValueFor(row.signal_key, row.signal_value)) continue;
    if (typeof row.submitted_at !== "string" || row.submitted_at === "") continue;
    const submittedAt = Date.parse(row.submitted_at);
    if (!Number.isFinite(submittedAt)) continue;
    out.push({
      ...toVenueSignal(
        {
          venueId,
          signalKey: row.signal_key,
          signalValue: row.signal_value,
        },
        submittedAt,
      ),
      id: typeof row.id === "string" ? row.id : "",
      actor:
        typeof row.actor === "string" && row.actor !== "" ? row.actor : null,
      // Same reading as a price row: an absent stamp is VISIBLE, and a hidden
      // signal is dropped by freshestVenueSignals rather than in SQL, so both
      // backends agree about what hiding removes.
      hidden: typeof row.hidden_at === "string" && row.hidden_at !== "",
      reportCount:
        typeof row.report_count === "number" &&
        Number.isFinite(row.report_count)
          ? Math.max(0, Math.floor(row.report_count))
          : 0,
    });
  }
  return out;
}

/**
 * The same guarded projection as `rowsToPrices`, but for the cross-venue
 * roll-up, so each row carries its OWN venue id instead of an assumed one. A
 * malformed row is skipped rather than coerced, exactly as above.
 */
function rowsToCountableRows(rows: unknown): StoredPrice[] {
  if (!Array.isArray(rows)) return [];
  const out: StoredPrice[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const venueId = cleanVenueId((row as Record<string, unknown>).venue_id);
    if (!venueId) continue;
    out.push(...rowsToPrices([row], venueId));
  }
  return out;
}

async function selectVenuePrices(venueId: string, now: number): Promise<CommunityPrice[]> {
  // `actor` is selected ONLY to count independent submitters in
  // freshestPerCategory; it is dropped again by `published` and never crosses
  // the store boundary. Raw tokens stay API-side (migration 0054's RLS note).
  // Hidden rows are filtered in freshestPerCategory rather than in SQL, so the
  // memory and durable backends can never disagree about what "hidden" removes
  // (sheet row, corroboration count, map candidate - all three at once).
  // This table holds venue signals too, and the row cap is a WINDOW, not a
  // filter: 200 signal rows newer than a pub's prices would push every price out
  // of the scan and report a priced pub as having none. The narrowing asks
  // `drink_category is not null` rather than `signal_key is null` because that
  // column predates the signals migration, so a deployment that has not applied
  // it yet still reads prices exactly as before.
  const { data, error } = await admin()
    .from("community_prices")
    .select("id, drink_category, price_pennies, submitted_at, actor, contributor_handle, hidden_at, moderated_at, report_count")
    .eq("venue_id", venueId)
    .not("drink_category", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(VENUE_SCAN_ROWS);
  if (error) throw new Error(error.message);
  return freshestPerCategory(rowsToPrices(data, venueId), now);
}

async function selectVenueSignals(
  venueId: string,
  now: number,
): Promise<CommunityVenueSignal[]> {
  const { data, error } = await admin()
    .from("community_prices")
    .select(
      "id, signal_key, signal_value, submitted_at, actor, hidden_at, report_count",
    )
    .eq("venue_id", venueId)
    .not("signal_key", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(VENUE_SCAN_ROWS);
  if (error) throw new Error(error.message);
  return freshestVenueSignals(rowsToVenueSignals(data, venueId), now);
}

function contributorCountRows(rows: unknown): CommunityContributorCount[] {
  if (!Array.isArray(rows)) return [];
  const counts: CommunityContributorCount[] = [];
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.contributor_key !== "string" || row.contributor_key === "") {
      continue;
    }
    const priceCount = Number(row.price_count);
    const venueSignalCount = Number(row.venue_signal_count);
    const total = Number(row.total);
    if (
      !Number.isFinite(priceCount) ||
      !Number.isFinite(venueSignalCount) ||
      !Number.isFinite(total)
    ) {
      continue;
    }
    counts.push({
      contributorKey: row.contributor_key,
      priceCount: Math.max(0, Math.floor(priceCount)),
      venueSignalCount: Math.max(0, Math.floor(venueSignalCount)),
      total: Math.max(0, Math.floor(total)),
    });
  }
  return counts;
}

export const supabaseCommunityPriceStore: CommunityPriceStore = {
  async submit(input, now = Date.now()) {
    const key = normalize(input);
    if (!key) return { price: null };
    const submittedAt = new Date(now).toISOString();
    // Legacy or imported submissions without an actor insert independently;
    // attributed ones upsert over that contributor's own earlier entry for the
    // same drink. Matches the memory store's replace-your-own rule.
    const actor = input.actor ?? null;
    const roundSource = cleanRoundPriceSource(input.roundSource);
    // Pinned to the store's public result type: `run` returns a stored price on
    // the happy path, but the schema-miss and error paths legitimately resolve
    // to `{ price: null, failed: true }`, and inference off `run` alone would
    // narrow those away.
    return guard<CommunityPriceWriteResult>({
      context: "submit",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "community-price",
          migrationHint: "apply migration 0054",
          fallback: () => memoryCommunityPriceStore.submit(input, now),
          onProduction: async () => ({ price: null, failed: true as const }),
        }),
      message: "submit failed - flagging degraded write",
      onError: () => ({ price: null, failed: true as const }),
      run: async () => {
        const row = {
          venue_id: key.venueId,
          drink_category: key.drinkCategory,
          price_pennies: key.pennies,
          actor,
          contributor_handle:
            normalizeHandle(input.contributorHandle) || null,
          round_spend_id: roundSource?.spendId ?? null,
          round_line_index: roundSource?.lineIndex ?? null,
          submitted_at: submittedAt,
        };
        // `.select("id")` so the submitter's own receipt carries the handle it
        // would need to be reported by - and so a correction (the upsert) hands
        // back the surviving row's id, not the replaced one's.
        const { data, error } = actor
          ? await admin().rpc(
              "upsert_attributed_community_price_if_newer",
              {
                p_actor: actor,
                p_contributor_handle: row.contributor_handle,
                p_drink_category: row.drink_category,
                p_price_pennies: row.price_pennies,
                p_round_line_index: row.round_line_index,
                p_round_spend_id: row.round_spend_id,
                p_submitted_at: row.submitted_at,
                p_venue_id: row.venue_id,
              },
            )
          : await admin().from("community_prices").insert(row).select("id");
        if (error) throw new Error(error.message);
        const saved =
          Array.isArray(data) && data[0] && typeof data[0] === "object"
            ? (data[0] as Record<string, unknown>)
            : {};
        const id = typeof saved.id === "string" ? saved.id : undefined;
        const savedPennies = Number(saved.price_pennies);
        const savedAt =
          typeof saved.submitted_at === "string"
            ? Date.parse(saved.submitted_at)
            : now;
        const sourceBecameOwner =
          typeof saved.source_became_owner === "boolean"
            ? saved.source_became_owner
            : undefined;
        if (roundSource && sourceBecameOwner === undefined) {
          return { price: null };
        }
        return {
          price: {
            ...toPrice(
              key.venueId,
              key.drinkCategory,
              Number.isInteger(savedPennies) ? savedPennies : key.pennies,
              Number.isFinite(savedAt) ? savedAt : now,
            ),
            ...(id ? { id } : {}),
          },
          ...(roundSource && sourceBecameOwner !== undefined
            ? { sourceBecameOwner }
            : {}),
        };
      },
    });
  },

  async submitSignal(input, now = Date.now()) {
    const normalised = normalizeSignal(input);
    if (!normalised) return { signal: null };
    const actor = input.actor ?? null;
    const submittedAt = new Date(now).toISOString();
    return guard<CommunityVenueSignalWriteResult>({
      context: "submit-signal",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "community-venue-signal",
          migrationHint: "apply migration 0060",
          fallback: () => memoryCommunityPriceStore.submitSignal(input, now),
          onProduction: async () => ({ signal: null, failed: true as const }),
        }),
      message: "signal submit failed - flagging degraded write",
      onError: () => ({ signal: null, failed: true as const }),
      run: async () => {
        const row = {
          venue_id: normalised.venueId,
          signal_key: normalised.signalKey,
          signal_value: normalised.signalValue,
          actor,
          submitted_at: submittedAt,
        };
        const { error } = actor
          ? await admin()
              .from("community_prices")
              .upsert(row, { onConflict: "venue_id,signal_key,actor" })
          : await admin().from("community_prices").insert(row);
        if (error) throw new Error(error.message);
        return { signal: toVenueSignal(normalised, now) };
      },
    });
  },

  async latestForVenue(venueId, now = Date.now()) {
    const key = cleanVenueId(venueId);
    if (!key) return { prices: [], degraded: false };
    // Explicit, like the write guard above: without it the result type is
    // inferred from `run` alone (degraded: false) and the degraded branches
    // stop type-checking.
    return guard<CommunityPriceReadResult>({
      context: "read",
      onSchemaMiss: async () => ({
        prices: (await memoryCommunityPriceStore.latestForVenue(key, now)).prices,
        degraded: true,
      }),
      message: "read failed - returning no community prices",
      onError: () => ({ prices: [], degraded: true }),
      run: async () => ({
        prices: await selectVenuePrices(key, now),
        degraded: false,
      }),
    });
  },

  async latestSignalsForVenue(venueId, now = Date.now()) {
    const key = cleanVenueId(venueId);
    if (!key) return { signals: [], degraded: false };
    return guard<CommunityVenueSignalReadResult>({
      context: "signal-read",
      onSchemaMiss: async () => ({
        signals: (
          await memoryCommunityPriceStore.latestSignalsForVenue(key, now)
        ).signals,
        degraded: true,
      }),
      message: "signal read failed - returning no venue signals",
      onError: () => ({ signals: [], degraded: true }),
      run: async () => ({
        signals: await selectVenueSignals(key, now),
        degraded: false,
      }),
    });
  },

  async latestForCategories(categories, now = Date.now()) {
    const wanted = [...new Set(categories.filter(isDrinkCategory))];
    if (wanted.length === 0) {
      return { prices: [], truncated: false, degraded: false };
    }
    return guard<CommunityPriceCategoryIndexResult>({
      context: "category-index",
      onSchemaMiss: async () => ({
        ...(await memoryCommunityPriceStore.latestForCategories(wanted, now)),
        degraded: true,
      }),
      message: "category index read failed - returning no community prices",
      onError: () => ({ prices: [], truncated: false, degraded: true }),
      run: async () => {
        const since = new Date(now - COMMUNITY_PRICE_MAX_AGE_MS).toISOString();
        const scanned: unknown[] = [];
        let lastPageFull = false;
        for (let offset = 0; offset < CATEGORY_INDEX_SCAN_ROWS; ) {
          const pageEnd = Math.min(
            offset + CORROBORATION_SCAN_PAGE,
            CATEGORY_INDEX_SCAN_ROWS,
          );
          const { data, error } = await admin()
            .from("community_prices")
            .select(
              "id, venue_id, drink_category, price_pennies, submitted_at, actor, hidden_at, report_count",
            )
            .in("drink_category", wanted)
            .gte("submitted_at", since)
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, pageEnd - 1);
          if (error) throw new Error(error.message);
          const page = Array.isArray(data) ? data : [];
          scanned.push(...page);
          lastPageFull = page.length >= pageEnd - offset;
          if (!lastPageFull) break;
          offset = pageEnd;
        }
        return categoryIndexFromRows(
          rowsToCountableRows(scanned),
          wanted,
          now,
          lastPageFull,
          false,
        );
      },
    });
  },

  async latestProvisionalVenueIds(venueIds, now = Date.now()) {
    const wanted = [
      ...new Set(
        venueIds
          .map(cleanVenueId)
          .filter(Boolean)
          .slice(0, MAX_PROVISIONAL_BASE_VENUE_IDS),
      ),
    ];
    if (wanted.length === 0) return { venueIds: [], degraded: false };
    return guard<ProvisionalVenueIdReadResult>({
      context: "provisional-venue-index",
      onSchemaMiss: async () => ({
        ...await memoryCommunityPriceStore.latestProvisionalVenueIds(
          wanted,
          now,
        ),
        degraded: true,
      }),
      message: "provisional venue read failed - returning no marks",
      onError: () => ({ venueIds: [], degraded: true }),
      run: async () => {
        const since = new Date(
          now - COMMUNITY_PRICE_MAX_AGE_MS,
        ).toISOString();
        const scanned: unknown[] = [];
        let complete = false;
        for (let offset = 0; offset < PROVISIONAL_VENUE_SCAN_ROWS; ) {
          const pageEnd = Math.min(
            offset + CORROBORATION_SCAN_PAGE,
            PROVISIONAL_VENUE_SCAN_ROWS,
          );
          const { data, error } = await admin()
            .from("community_prices")
            .select(
              "id, venue_id, drink_category, price_pennies, submitted_at, actor, hidden_at, report_count",
            )
            .in("venue_id", wanted)
            .eq("drink_category", "beer")
            .gte("submitted_at", since)
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, pageEnd - 1);
          if (error) throw new Error(error.message);
          const page = Array.isArray(data) ? data : [];
          scanned.push(...page);
          if (page.length < pageEnd - offset) {
            complete = true;
            break;
          }
          offset = pageEnd;
        }
        if (!complete) return { venueIds: [], degraded: true };
        return {
          venueIds: provisionalVenueIdsFromRows(
            rowsToCountableRows(scanned),
            wanted,
            now,
          ),
          degraded: false,
        };
      },
    });
  },

  async countCorroboratedCategories(now = Date.now()) {
    return guard<CorroboratedCategoryCount>({
      context: "corroborated-count",
      // A schema miss is not "zero corroborated prices" - it is the same
      // keyless/pre-migration world the memory store already answers for.
      onSchemaMiss: () => memoryCommunityPriceStore.countCorroboratedCategories(now),
      message: "corroborated count failed - reporting degraded",
      onError: () => ({ count: 0, truncated: false, degraded: true }),
      run: async () => {
        // Only in-window rows can back a map candidate, so the age gate is
        // pushed into the query rather than paid for in scanned rows.
        const since = new Date(now - COMMUNITY_PRICE_MAX_AGE_MS).toISOString();
        const scanned: unknown[] = [];
        let lastPageFull = false;
        for (let offset = 0; offset < CORROBORATION_SCAN_ROWS; ) {
          const pageEnd = Math.min(offset + CORROBORATION_SCAN_PAGE, CORROBORATION_SCAN_ROWS);
          const { data, error } = await admin()
            .from("community_prices")
            .select("venue_id, drink_category, price_pennies, submitted_at, actor, hidden_at")
            // Venue signals share this table and would pad the scan, turning a
            // bounded count into a `truncated` floor for no reason.
            .not("drink_category", "is", null)
            .gte("submitted_at", since)
            // The `id` tiebreak keeps the page windows disjoint when many rows
            // share one `submitted_at` instant.
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, pageEnd - 1);
          if (error) throw new Error(error.message);
          const page = Array.isArray(data) ? data : [];
          scanned.push(...page);
          lastPageFull = page.length >= pageEnd - offset;
          if (!lastPageFull) break;
          offset = pageEnd;
        }
        const rows = rowsToCountableRows(scanned);
        return {
          count: countCorroboratedIn(rows, now),
          truncated: lastPageFull,
          degraded: false,
        };
      },
    });
  },

  async report(id, reason, actorHash) {
    if (!id) return false;
    return guard<boolean>({
      context: "report",
      onSchemaMiss: () => memoryCommunityPriceStore.report(id, reason, actorHash),
      message: "report failed",
      onError: () => false,
      run: async () => {
        // Per-actor uniqueness is the DURABLE guarantee (community_price_reports'
        // unique (community_price_id, actor_hash) in migration 0055), so a
        // repeat that slips past the route's rate limiter is an idempotent
        // no-op rather than a second count. The RPC does the insert-and-count
        // in one statement; nothing here is allowed to hide the row.
        const { data, error } = await admin().rpc("report_community_price", {
          p_id: id,
          p_actor_hash: actorHash ?? null,
          p_reason: cleanReason(reason) ?? null,
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
    });
  },

  async moderate(id, hidden, note) {
    if (!id) return false;
    return guard<boolean>({
      context: "moderate",
      onSchemaMiss: () => memoryCommunityPriceStore.moderate(id, hidden, note),
      message: "moderate failed",
      onError: () => false,
      run: async () => {
        // Hide = stamp hidden_at; restore = clear it. The observation itself is
        // never deleted, so a wrong call is always reversible. A call without a
        // note leaves the previous moderator note in place, exactly as the
        // memory backend does.
        const cleaned = cleanReason(note);
        const { data, error } = await admin()
          .from("community_prices")
          .update({
            hidden_at: hidden ? new Date().toISOString() : null,
            ...(cleaned ? { moderator_note: cleaned } : {}),
            moderated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("id");
        if (error) throw new Error(error.message);
        return Array.isArray(data) && data.length > 0;
      },
    });
  },

  async moderateWithState(id, hidden, note) {
    if (!id) return { status: "not-found", changed: false };
    return guard<ModerationStateResult>({
      context: "moderate-with-state",
      onSchemaMiss: async () => ({ status: "unavailable", changed: false }),
      message: "moderate failed",
      onError: () => ({ status: "unavailable", changed: false }),
      run: async () => {
        const cleaned = cleanReason(note);
        const query = admin()
          .from("community_prices")
          .update({
            hidden_at: hidden ? new Date().toISOString() : null,
            ...(cleaned ? { moderator_note: cleaned } : {}),
            moderated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("id, drink_category");
        const { data, error } = hidden
          ? await query.is("hidden_at", null)
          : await query.not("hidden_at", "is", null);
        if (error) throw new Error(error.message);
        if (Array.isArray(data) && data.length > 0) {
          return {
            status: "ok",
            changed: true,
            kind: durableModerationKind(data[0]),
          };
        }
        const { data: existing, error: lookupError } = await admin()
          .from("community_prices")
          .select("id, drink_category")
          .eq("id", id)
          .limit(1);
        if (lookupError) throw new Error(lookupError.message);
        if (!Array.isArray(existing) || existing.length === 0) {
          return { status: "not-found", changed: false };
        }
        return {
          status: "ok",
          changed: false,
          kind: durableModerationKind(existing[0]),
        };
      },
    });
  },

  async listLeaderboardContributions() {
    return guard<ContributionRecordReadResult>({
      context: "leaderboard-contributions",
      onSchemaMiss: async () => ({
        ...(await memoryCommunityPriceStore.listLeaderboardContributions()),
        status: "degraded",
      }),
      message: "leaderboard contribution read failed",
      onError: () => ({ status: "degraded", records: [] }),
      run: async () => {
        const raw: unknown[] = [];
        for (let offset = 0; ; offset += CORROBORATION_SCAN_PAGE) {
          const { data, error } = await admin()
            .from("community_prices")
            .select(
              "id, venue_id, drink_category, price_pennies, submitted_at, actor, contributor_handle, hidden_at, moderated_at, report_count",
            )
            .not("contributor_handle", "is", null)
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, offset + CORROBORATION_SCAN_PAGE - 1);
          if (error) throw new Error(error.message);
          const page = Array.isArray(data) ? data : [];
          raw.push(...page);
          if (page.length < CORROBORATION_SCAN_PAGE) break;
        }
        const rows = rowsToCountableRows(raw);
        const byVenue = new Map<string, StoredPrice[]>();
        for (const row of rows) {
          const held = byVenue.get(row.venueId);
          if (held) held.push(row);
          else byVenue.set(row.venueId, [row]);
        }
        return {
          status: "ready",
          records: rows
            .filter((row) => row.contributorHandle !== null)
            .map((row) =>
              priceContributionRecord(
                row,
                byVenue.get(row.venueId) ?? [],
              ),
            ),
        };
      },
    });
  },

  async listForReviewWithStatus(limit = REVIEW_LIMIT) {
    return guard<CommunityPriceReviewReadResult>({
      context: "listForReview",
      onSchemaMiss: async () => ({ prices: [], degraded: true }),
      message: "review queue read failed - degraded",
      onError: () => ({ prices: [], degraded: true }),
      run: async () => {
        const { data, error } = await admin()
          .from("community_prices")
          .select(
            "id, venue_id, drink_category, price_pennies, signal_key, signal_value, submitted_at, hidden_at, report_count, reported_at, report_reason, moderator_note",
          )
          .or("report_count.gt.0,hidden_at.not.is.null")
          .order("reported_at", { ascending: false, nullsFirst: false })
          .limit(Math.max(0, limit));
        if (error) throw new Error(error.message);
        return { prices: reviewRows(data), degraded: false };
      },
    });
  },

  async listForReview(limit = REVIEW_LIMIT) {
    return (await this.listForReviewWithStatus(limit)).prices;
  },

  async listContributorCounts(limit = REVIEW_LIMIT) {
    return guard<CommunityContributorCount[]>({
      context: "contributor-counts",
      onSchemaMiss: () =>
        memoryCommunityPriceStore.listContributorCounts(limit),
      message: "contributor count read failed - returning empty",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from("community_contributor_counts")
          .select(
            "contributor_key, price_count, venue_signal_count, total",
          )
          .order("total", { ascending: false })
          .order("contributor_key", { ascending: true })
          .limit(Math.max(0, limit));
        if (error) throw new Error(error.message);
        return contributorCountRows(data);
      },
    });
  },
};

/** Narrow the untyped moderation-queue projection; a malformed row is skipped. */
function reviewRows(rows: unknown): ModeratorCommunityPrice[] {
  if (!Array.isArray(rows)) return [];
  const out: ModeratorCommunityPrice[] = [];
  for (const r of rows) {
    if (typeof r !== "object" || r === null) continue;
    const row = r as Record<string, unknown>;
    const pennies = row.price_pennies;
    if (typeof row.id !== "string" || row.id === "") continue;
    if (typeof row.venue_id !== "string" || row.venue_id === "") continue;
    const submittedAt = typeof row.submitted_at === "string" ? Date.parse(row.submitted_at) : NaN;
    if (!Number.isFinite(submittedAt)) continue;
    const reportedAt = typeof row.reported_at === "string" ? Date.parse(row.reported_at) : NaN;
    const base: ModeratorObservationBase = {
      id: row.id,
      venueId: row.venue_id,
      submittedAt,
      hidden: typeof row.hidden_at === "string" && row.hidden_at !== "",
      reportCount:
        typeof row.report_count === "number" && Number.isFinite(row.report_count)
          ? Math.max(0, Math.floor(row.report_count))
          : 0,
      ...(Number.isFinite(reportedAt) ? { reportedAt } : {}),
      ...(cleanReason(row.report_reason) ? { reportReason: cleanReason(row.report_reason) } : {}),
      ...(cleanReason(row.moderator_note)
        ? { moderatorNote: cleanReason(row.moderator_note) }
        : {}),
    };
    // The table's shape check makes these two branches exhaustive; a row that
    // matches neither is malformed and is skipped rather than guessed at.
    if (
      isDrinkCategory(row.drink_category) &&
      typeof pennies === "number" &&
      Number.isFinite(pennies)
    ) {
      out.push({
        ...base,
        kind: "price",
        drinkCategory: row.drink_category,
        priceGbp: roundToPennies(pennies / 100),
      });
      continue;
    }
    if (
      isCommunityVenueSignalKey(row.signal_key) &&
      isCommunityVenueSignalValueFor(row.signal_key, row.signal_value)
    ) {
      out.push({
        ...base,
        kind: "signal",
        signalKey: row.signal_key,
        signalValue: row.signal_value,
      });
    }
  }
  return out;
}

/** The single backend selection point (mirrors the other stores). */
export function communityPriceStore(): CommunityPriceStore {
  return selectStore(memoryCommunityPriceStore, supabaseCommunityPriceStore);
}

/**
 * Record tonight's price for a (venue, drink). NEVER throws - an out-of-
 * envelope input resolves to `{ price: null }` so the optimistic UI can stand
 * on its own, and a hard durable failure comes back flagged.
 */
export function submitCommunityPrice(
  input: CommunityPriceWrite,
  now: number = Date.now(),
): Promise<CommunityPriceWriteResult> {
  return droppingCategoryIndexMemo(() =>
    communityPriceStore().submit(input, now),
  );
}

export function submitCommunityVenueSignal(
  input: CommunityVenueSignalWrite,
  now: number = Date.now(),
): Promise<CommunityVenueSignalWriteResult> {
  return communityPriceStore().submitSignal(input, now);
}

/**
 * How many (venue, drink category) pairs the map is currently allowed to paint
 * a community price for - the contribution flywheel's real number. NEVER throws.
 */
export function countCorroboratedCommunityCategories(
  now: number = Date.now(),
): Promise<CorroboratedCategoryCount> {
  return communityPriceStore().countCorroboratedCategories(now);
}

/** The freshest community price per drink category at one venue. NEVER throws. */
export function readCommunityPrices(
  venueId: string,
  now: number = Date.now(),
): Promise<CommunityPrice[]> {
  return readCommunityPricesWithStatus(venueId, now).then((result) => result.prices);
}

export function readCommunityPricesWithStatus(
  venueId: string,
  now: number = Date.now(),
): Promise<CommunityPriceReadResult> {
  return communityPriceStore().latestForVenue(venueId, now);
}

export function readCommunityVenueSignals(
  venueId: string,
  now: number = Date.now(),
): Promise<CommunityVenueSignal[]> {
  return readCommunityVenueSignalsWithStatus(venueId, now).then(
    (result) => result.signals,
  );
}

export function readCommunityVenueSignalsWithStatus(
  venueId: string,
  now: number = Date.now(),
): Promise<CommunityVenueSignalReadResult> {
  return communityPriceStore().latestSignalsForVenue(venueId, now);
}

export function listCommunityContributorCounts(
  limit?: number,
): Promise<CommunityContributorCount[]> {
  return communityPriceStore().listContributorCounts(limit);
}

export function readProvisionalCommunityPriceVenueIds(
  venueIds: readonly string[],
  now: number = Date.now(),
): Promise<ProvisionalVenueIdReadResult> {
  return communityPriceStore().latestProvisionalVenueIds(venueIds, now);
}

// The category index is the one read here that is neither per-venue nor
// per-actor: every caller asks the same question and gets byte-identical rows,
// and answering it costs up to CATEGORY_INDEX_SCAN_ROWS / CORROBORATION_SCAN_PAGE
// sequential durable reads. Unmemoised, an anonymous GET could bill that scan
// once per visitor and once per retry, which is a cost and an availability
// hazard rather than a correctness one.
//
// So the answer is held per category set for CATEGORY_INDEX_MEMO_MS, and the
// PROMISE is what is held, not the result: a burst of concurrent activations
// collapses onto one scan instead of racing N of them. The window is orders of
// magnitude shorter than COMMUNITY_PRICE_MAX_AGE_MS, so nothing a reader sees
// gets older than the trust policy already allows. A degraded read is never
// held: a hiccup must not pin "no prices" over the map for a minute.
const CATEGORY_INDEX_MEMO_MS = 60_000;

type CategoryIndexMemo = {
  at: number;
  pending: Promise<CommunityPriceCategoryIndexResult>;
};

const categoryIndexMemo = new Map<string, CategoryIndexMemo>();

/** Current rows for selected categories across venues. NEVER throws. */
export function readCommunityPriceCategoryIndex(
  categories: readonly DrinkCategory[],
  now: number = Date.now(),
): Promise<CommunityPriceCategoryIndexResult> {
  const key = [...new Set(categories)].sort().join(",");
  const held = categoryIndexMemo.get(key);
  if (held && now - held.at < CATEGORY_INDEX_MEMO_MS) return held.pending;
  const drop = () => {
    // Only ever evict OUR OWN entry: a write that landed mid-scan has already
    // cleared the memo, and a later read may own the key by now.
    if (categoryIndexMemo.get(key)?.pending === pending) {
      categoryIndexMemo.delete(key);
    }
  };
  const pending = communityPriceStore()
    .latestForCategories(categories, now)
    .then((result) => {
      if (result.degraded) drop();
      return result;
    })
    .catch((error: unknown) => {
      drop();
      throw error;
    });
  categoryIndexMemo.set(key, { at: now, pending });
  return pending;
}

/**
 * A write is the only thing that can change the category index, so it drops the
 * memo. The drop that MATTERS is the one after the write settles: dropping only
 * before it starts leaves the window where a reader misses, scans the
 * not-yet-committed state and pins that snapshot for the rest of
 * CATEGORY_INDEX_MEMO_MS, which for a moderator hiding a price means the row
 * stays on the no-alcohol view for a minute after it left the sheet. Dropping
 * first as well is what keeps the eviction prompt, so both drops stay, and they
 * live here rather than at each call site so the ordering cannot drift apart.
 * Rejection drops too - the store's guards mean a rejection is unexpected, and
 * a write of unknown outcome must not leave a claim about the index standing.
 */
function droppingCategoryIndexMemo<T>(write: () => Promise<T>): Promise<T> {
  resetCommunityPriceCategoryIndexMemo();
  return write().then(
    (value) => {
      resetCommunityPriceCategoryIndexMemo();
      return value;
    },
    (error: unknown) => {
      resetCommunityPriceCategoryIndexMemo();
      throw error;
    },
  );
}

/** Drop the memoised category index. Test seam, and the write paths' reset. */
export function resetCommunityPriceCategoryIndexMemo(): void {
  categoryIndexMemo.clear();
}

/**
 * Reader flag on one observation. NEVER throws; false means "no such row".
 * Records the complaint - it never hides anything by itself.
 */
export function reportCommunityPrice(
  id: string,
  reason?: string,
  actorHash?: string,
): Promise<boolean> {
  return communityPriceStore().report(id, reason, actorHash);
}

/**
 * Moderator decision: hide one community price from every public read, or
 * restore it. The observation is kept either way - hide, never delete.
 */
export function moderateCommunityPrice(
  id: string,
  hidden: boolean,
  note?: string,
): Promise<boolean> {
  return droppingCategoryIndexMemo(() =>
    communityPriceStore().moderate(id, hidden, note),
  );
}

export function moderateCommunityPriceWithState(
  id: string,
  hidden: boolean,
  note?: string,
): Promise<ModerationStateResult> {
  return droppingCategoryIndexMemo(() =>
    communityPriceStore().moderateWithState(id, hidden, note),
  );
}

/** The moderation queue: reported and/or hidden observations. NEVER throws. */
export function listCommunityPricesForReview(
  limit?: number,
): Promise<ModeratorCommunityPrice[]> {
  return communityPriceStore().listForReview(limit);
}

export function listCommunityPricesForReviewWithStatus(
  limit?: number,
): Promise<CommunityPriceReviewReadResult> {
  return communityPriceStore().listForReviewWithStatus(limit);
}

export type CommunityPriceObservation = {
  id: string;
  venueId: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  submittedAt: number;
  actor: string | null;
  hidden: boolean;
  moderatedAt?: number;
};

export type CommunityPriceObservationPair = {
  venueId: string;
  drinkCategory: DrinkCategory;
};

// Cap the batched (venue, category) scan. Past this the answer would be a
// short list presented as a whole one, so the read degrades instead: a count
// that silently drops an unlock is worse than one that says it could not look.
const OBSERVATION_PAIR_SCAN_PAIRS = 50;
const OBSERVATION_PAIR_SCAN_ROWS = OBSERVATION_PAIR_SCAN_PAIRS * VENUE_SCAN_ROWS;

function observationFromStored(row: StoredPrice): CommunityPriceObservation | null {
  if (!row.id || !isDrinkCategory(row.drinkCategory)) return null;
  return {
    id: row.id,
    venueId: row.venueId,
    drinkCategory: row.drinkCategory,
    priceGbp: row.priceGbp,
    submittedAt: row.submittedAt,
    actor: row.actor,
    hidden: row.hidden,
    moderatedAt: row.moderatedAt,
  };
}

function memoryObservations(): CommunityPriceObservation[] {
  const out: CommunityPriceObservation[] = [];
  for (const rows of venues.values()) {
    for (const row of rows) {
      const observation = observationFromStored(row);
      if (observation) out.push(observation);
    }
  }
  return out;
}

const OBSERVATION_COLUMNS =
  "id, venue_id, drink_category, price_pennies, submitted_at, actor, hidden_at, moderated_at";

function storedPricesFromRows(rows: readonly unknown[]): StoredPrice[] {
  const out: StoredPrice[] = [];
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const venueId = cleanVenueId((raw as { venue_id?: unknown }).venue_id);
    if (!venueId) continue;
    out.push(...rowsToPrices([raw], venueId));
  }
  return out;
}

async function durablePriceRowById(id: string): Promise<StoredPrice[]> {
  const query = admin()
    .from("community_prices")
    .select(OBSERVATION_COLUMNS)
    .not("drink_category", "is", null)
    .eq("id", id)
    .limit(1);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return storedPricesFromRows(data);
}

function pairKey(venueId: string, drinkCategory: DrinkCategory): string {
  return `${venueId}\u0000${drinkCategory}`;
}

function wantedPairs(
  pairs: readonly CommunityPriceObservationPair[],
): Map<string, CommunityPriceObservationPair> {
  const wanted = new Map<string, CommunityPriceObservationPair>();
  for (const pair of pairs) {
    const venueId = cleanVenueId(pair.venueId);
    if (!venueId || !isDrinkCategory(pair.drinkCategory)) continue;
    wanted.set(pairKey(venueId, pair.drinkCategory), {
      venueId,
      drinkCategory: pair.drinkCategory,
    });
  }
  return wanted;
}

/**
 * One paged scan for every wanted (venue, category), rather than one round trip
 * per pair. Returns null when the scan filled its cap, because a truncated page
 * cannot answer whether a pair is still trusted.
 */
async function durablePairPriceRows(
  wanted: Map<string, CommunityPriceObservationPair>,
): Promise<StoredPrice[] | null> {
  const venueIds = [...new Set([...wanted.values()].map((pair) => pair.venueId))];
  const categories = [
    ...new Set([...wanted.values()].map((pair) => pair.drinkCategory)),
  ];
  const scanned: unknown[] = [];
  let complete = false;
  for (let offset = 0; offset < OBSERVATION_PAIR_SCAN_ROWS; ) {
    const pageEnd = Math.min(
      offset + CORROBORATION_SCAN_PAGE,
      OBSERVATION_PAIR_SCAN_ROWS,
    );
    const { data, error } = await admin()
      .from("community_prices")
      .select(OBSERVATION_COLUMNS)
      .in("venue_id", venueIds)
      .in("drink_category", categories)
      .order("submitted_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, pageEnd - 1);
    if (error) throw new Error(error.message);
    const page = Array.isArray(data) ? data : [];
    scanned.push(...page);
    if (page.length < pageEnd - offset) {
      complete = true;
      break;
    }
    offset = pageEnd;
  }
  if (!complete) return null;
  return storedPricesFromRows(scanned);
}

const observationReader = {
  async listForVenueCategory(
    venueId: string,
    drinkCategory: DrinkCategory,
  ): Promise<{ observations: CommunityPriceObservation[]; degraded: boolean }> {
    const key = cleanVenueId(venueId);
    if (!key || !isDrinkCategory(drinkCategory)) {
      return { observations: [], degraded: false };
    }
    const rows = (venues.get(key) ?? [])
      .map(observationFromStored)
      .filter((row): row is CommunityPriceObservation => row !== null)
      .filter((row) => row.drinkCategory === drinkCategory);
    return { observations: rows, degraded: false };
  },
  async listForPairs(
    pairs: readonly CommunityPriceObservationPair[],
  ): Promise<{ observations: CommunityPriceObservation[]; degraded: boolean }> {
    const wanted = wantedPairs(pairs);
    if (wanted.size === 0) return { observations: [], degraded: false };
    const out: CommunityPriceObservation[] = [];
    for (const pair of wanted.values()) {
      for (const row of venues.get(pair.venueId) ?? []) {
        const observation = observationFromStored(row);
        if (!observation) continue;
        if (observation.drinkCategory !== pair.drinkCategory) continue;
        out.push(observation);
      }
    }
    return { observations: out, degraded: false };
  },
  async countForActor(actor: string): Promise<{ count: number; degraded: boolean }> {
    if (!actor) return { count: 0, degraded: false };
    return {
      count: memoryObservations().filter((row) => row.actor === actor && !row.hidden)
        .length,
      degraded: false,
    };
  },
  async findById(
    id: string,
  ): Promise<{ observation: CommunityPriceObservation | null; degraded: boolean }> {
    if (!id) return { observation: null, degraded: false };
    return {
      observation: memoryObservations().find((row) => row.id === id) ?? null,
      degraded: false,
    };
  },
};

const observationGuard = createFailSoftGuard({
  tag: "community-price-observations",
  tables: "community_prices",
  migrationHint: "apply migration 0054",
});

const durableObservationReader = {
  async listForVenueCategory(
    venueId: string,
    drinkCategory: DrinkCategory,
  ): Promise<{ observations: CommunityPriceObservation[]; degraded: boolean }> {
    const key = cleanVenueId(venueId);
    if (!key || !isDrinkCategory(drinkCategory)) {
      return { observations: [], degraded: false };
    }
    return durableObservationReader.listForPairs([
      { venueId: key, drinkCategory },
    ]);
  },
  async listForPairs(
    pairs: readonly CommunityPriceObservationPair[],
  ): Promise<{ observations: CommunityPriceObservation[]; degraded: boolean }> {
    const wanted = wantedPairs(pairs);
    if (wanted.size === 0) return { observations: [], degraded: false };
    if (wanted.size > OBSERVATION_PAIR_SCAN_PAIRS) {
      return { observations: [], degraded: true };
    }
    return observationGuard.guard({
      context: "listForPairs",
      onSchemaMiss: () => observationReader.listForPairs([...wanted.values()]),
      message: "pair observation list failed",
      onError: () => ({ observations: [], degraded: true }),
      run: async () => {
        const rows = await durablePairPriceRows(wanted);
        if (!rows) return { observations: [], degraded: true };
        const observations = rows
          .map(observationFromStored)
          .filter((row): row is CommunityPriceObservation => row !== null)
          .filter((row) => wanted.has(pairKey(row.venueId, row.drinkCategory)));
        return { observations, degraded: false };
      },
    });
  },
  async countForActor(actor: string): Promise<{ count: number; degraded: boolean }> {
    if (!actor) return { count: 0, degraded: false };
    return observationGuard.guard({
      context: "countForActor",
      onSchemaMiss: () => observationReader.countForActor(actor),
      message: "actor observation count failed",
      onError: () => ({ count: 0, degraded: true }),
      run: async () => {
        const { count, error } = await admin()
          .from("community_prices")
          .select("id", { count: "exact", head: true })
          .not("drink_category", "is", null)
          .is("hidden_at", null)
          .eq("actor", actor);
        if (error) throw new Error(error.message);
        if (typeof count !== "number" || !Number.isFinite(count)) {
          return { count: 0, degraded: true };
        }
        return { count, degraded: false };
      },
    });
  },
  async findById(
    id: string,
  ): Promise<{ observation: CommunityPriceObservation | null; degraded: boolean }> {
    if (!id) return { observation: null, degraded: false };
    return observationGuard.guard({
      context: "findById",
      onSchemaMiss: () => observationReader.findById(id),
      message: "observation lookup failed",
      onError: () => ({ observation: null, degraded: true }),
      run: async () => {
        const [row] = await durablePriceRowById(id);
        return { observation: row ? observationFromStored(row) : null, degraded: false };
      },
    });
  },
};

function observations(): typeof observationReader {
  return selectStore(observationReader, durableObservationReader);
}

export function listCommunityPriceObservations(
  venueId: string,
  drinkCategory: DrinkCategory,
): Promise<{ observations: CommunityPriceObservation[]; degraded: boolean }> {
  return observations().listForVenueCategory(venueId, drinkCategory);
}

/**
 * Every observation for the wanted (venue, category) pairs in one bounded read.
 * `degraded` covers both a failed scan and a pair set past the cap, so a caller
 * never mistakes a short list for the whole one.
 */
export function listCommunityPriceObservationsForPairs(
  pairs: readonly CommunityPriceObservationPair[],
): Promise<{ observations: CommunityPriceObservation[]; degraded: boolean }> {
  return observations().listForPairs(pairs);
}

/**
 * How many live prices this actor has logged, all time. A count query, never
 * the length of a capped row page: a contributor past the scan window is owed
 * their real total or a degraded answer, never a silent 200. A hidden row is
 * out, the same rule every other public price read follows.
 */
export function countCommunityPriceObservationsForActor(
  actor: string,
): Promise<{ count: number; degraded: boolean }> {
  return observations().countForActor(actor);
}

export function findCommunityPriceObservation(
  id: string,
): Promise<{ observation: CommunityPriceObservation | null; degraded: boolean }> {
  return observations().findById(id);
}

/** Test-only: clear the in-memory observations between cases. */
export function __resetCommunityPrices(): void {
  venues.clear();
  venueSignals.clear();
  resetCommunityPriceCategoryIndexMemo();
  resetSchemaMissWarnings();
  lastModerationStamp = 0;
}
