"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  validateCommunityPrice,
  type CommunityPrice,
  type CommunityPriceAttribution,
  type CommunityPriceMapCandidate,
} from "@/lib/communityPrice";
import {
  isCommunityVenueSignalKey,
  isCommunityVenueSignalValueFor,
  validateCommunityVenueSignal,
  type CommunityVenueSignal,
  type CommunityVenueSignalCandidate,
  type CommunityVenueSignalKey,
  type CommunityVenueSignalValue,
} from "@/lib/communityVenueSignals";
import type { DrinkCategory } from "@/lib/drinks";
import type {
  CategoryPriceIndexStatus,
  NoAlcoholIndexStatus,
  VenuePriceReadStatus,
} from "@/lib/mapExperienceLens";
import type { PriceSubmitFailureReason } from "@/lib/analyticsEvents";
import type { AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { postCommunityContribution } from "@/lib/communityContributionClient";
import { normalizeHandle } from "@/lib/profiles";
import {
  isUkBaseId,
  MAX_PROVISIONAL_BASE_VENUE_IDS,
} from "@/lib/ukBasePubs";

// Client-side owner of /api/price-submit: the freshest community price per
// (venue, drink category), the optimistic restamp, and the submit call.
//
// The restamp is the whole point of the loop - the map change YOU caused,
// visible immediately. So a submission lands in local state BEFORE the network
// round-trip, and PubMap folds this map into the venueSignals it already hands
// to the pins, the venue list, and the sheet. One merge, every surface
// restamps; the map canvas needs no change at all.
//
// Honest optimism: an optimistic entry is stamped with the device clock and
// replaced by the server's authoritative record when the POST lands. A REJECTED
// submission is rolled back to whatever was showing before, so a bounced price
// never lingers on the map as if it were real.
//
// The restamp is the SHEET's, not necessarily the map's. Since the trust wave a
// price only recolours pins once a second independent submitter agrees, and
// only the server can count that, so an optimistic entry claims the cautious
// `corroborations: 1` and the POST response supplies the real number. Claiming
// more locally would flash a pin colour the server is about to take back.

export type CommunitySubmissionFailure = {
  ok: false;
  error: string;
  reason: PriceSubmitFailureReason;
  status?: "sign_in_required" | "onboarding_required";
};

export type CommunityPriceSubmitResult =
  | { ok: true; attribution: CommunityPriceAttribution; price: CommunityPrice | null }
  // `reason` is the coarse funnel bucket for the failure - the analytics enum,
  // not a second copy of the sentence. `error` stays the human sentence and is
  // never sent anywhere.
  | CommunitySubmissionFailure;

export type CommunityVenueSignalSubmitResult =
  | { ok: true }
  | CommunitySubmissionFailure;

export function rejectedCommunitySubmission(
  status: number,
  error: unknown,
  fallback: string,
  gateStatus?: string,
): CommunitySubmissionFailure {
  const contributionStatus =
    gateStatus === "sign_in_required" ||
    gateStatus === "onboarding_required"
      ? gateStatus
      : status === 401
        ? "sign_in_required"
        : status === 409
          ? "onboarding_required"
          : null;
  return {
    ok: false,
    error: errorMessageFrom({ error }, fallback),
    reason: "rejected",
    ...(contributionStatus ? { status: contributionStatus } : {}),
  };
}

export type CommunityPricesState = {
  /** Freshest community price per drink category, by venue id. Ungated on
   *  purpose - this is what the venue sheet renders, so every submission shows
   *  there, dated, whether or not it has earned the map. */
  byVenueId: Map<string, CommunityPrice[]>;
  /** Community-observed pub signals loaded by the same per-venue request. */
  signalsByVenueId: Map<string, CommunityVenueSignal[]>;
  /** The freshest BEER price at a venue - the pin's CANDIDATE, not its verdict.
   *  Pins and the list are pint-priced surfaces, so other categories never
   *  reach them; they render on the sheet's own dated rows instead. Whether a
   *  candidate actually restamps is decided by the trust gate in
   *  mergeCommunityPriceSignals, the single seam onto the map. */
  freshestByVenueId: Map<string, CommunityPrice>;
  /**
   * State of the cross-venue no-alcohol price read. "partial" and "degraded"
   * are two different findings and must never be merged: a truncated scan
   * ANSWERED, with trusted rows already painted, so telling the reader we could
   * not check would contradict the figures in front of them.
   */
  noAlcoholIndexStatus: NoAlcoholIndexStatus;
  /** Load soft-drink and alcohol-free rows across venues once per session. */
  loadNoAlcoholIndex: () => void;
  /** Load one selected drink category across venues once per session. */
  loadDrinkCategoryIndex: (category: DrinkCategory) => void;
  /**
   * State of each cross-venue selected-drink read, on the same three-way scale
   * the no-alcohol index reports: a truncated-but-successful scan is "partial"
   * and keeps its trusted figures, a failed one is "degraded" and may never be
   * presented as "no prices logged here".
   */
  drinkCategoryIndexStatus: ReadonlyMap<DrinkCategory, CategoryPriceIndexStatus>;
  /** Visibility marks found for UK base pubs read in this session. */
  provisionalBaseVenueIds: ReadonlySet<string>;
  /** Read unseen IDs among these on-screen base pubs. */
  loadProvisionalBaseVenues: (venueIds: readonly string[]) => void;
  /** Fetch the community prices on record for one venue (fail-soft, once per id). */
  loadVenue: (venueId: string) => void;
  /**
   * Where each per-venue read got to. A sheet may only say a pub has nothing
   * logged once its own read ANSWERED: before that the honest line is that we
   * are still looking, and a failed read is a fact about us, not the pub.
   */
  venuePriceStatus: ReadonlyMap<string, VenuePriceReadStatus>;
  /** Log tonight's price. Restamps optimistically, rolls back on rejection. */
  submit: (input: {
    venueId: string;
    drinkCategory: DrinkCategory;
    priceGbp: string | number;
    pintPhoto?: File | null;
  }, auth: AccountAuthSnapshot) => Promise<CommunityPriceSubmitResult>;
  /** Log one categorical pub observation through the same write seam. */
  submitVenueSignal: (input: {
    venueId: string;
    signalKey: CommunityVenueSignalKey;
    signalValue: CommunityVenueSignalValue;
  }, auth: AccountAuthSnapshot) => Promise<CommunityVenueSignalSubmitResult>;
  /** True while a submission is in flight (one at a time by construction). */
  submitting: boolean;
  /**
   * Flag one observation for a human to look at. Unlike the Pint Drop report,
   * this does NOT remove the row locally: a community price is not hidden until
   * a moderator hides it (a client-side vanish would promise a takedown that
   * has not happened). The row is marked reported instead, so the reader can
   * see their tap landed.
   */
  reportPrice: (id: string) => void;
  /** Observation ids this device has already flagged this session. */
  reportedIds: ReadonlySet<string>;
  /** Error shown when a report could not be recorded. */
  reportErrors?: ReadonlyMap<string, string>;
};

/** Freshest-wins merge of one observation into a venue's per-category list. */
export function upsertPrice(rows: CommunityPrice[], next: CommunityPrice): CommunityPrice[] {
  const current = rows.find((row) => row.drinkCategory === next.drinkCategory);
  const freshest =
    current && current.submittedAt > next.submittedAt ? current : next;
  const others = rows.filter((row) => row.drinkCategory !== next.drinkCategory);
  return [freshest, ...others].sort((a, b) => b.submittedAt - a.submittedAt);
}

/**
 * Unconditional replace of one category's row — for adopting the server's
 * authoritative POST response. upsertPrice's keep-newer rule guards the GET
 * merge against stale reads, but it would also let a device clock that ran
 * ahead of the server keep the optimistic stamp forever; the server record
 * for a category always wins here.
 */
export function replacePrice(rows: CommunityPrice[], next: CommunityPrice): CommunityPrice[] {
  const others = rows.filter((row) => row.drinkCategory !== next.drinkCategory);
  return [next, ...others].sort((a, b) => b.submittedAt - a.submittedAt);
}

export function readCommunityPriceAttribution(
  value: unknown,
): CommunityPriceAttribution {
  if (!value || typeof value !== "object") return { status: "anonymous" };
  const attribution = value as { status?: unknown; handle?: unknown };
  if (attribution.status !== "credited" || typeof attribution.handle !== "string") {
    return { status: "anonymous" };
  }
  const handle = normalizeHandle(attribution.handle);
  return handle
    ? { status: "credited", handle }
    : { status: "anonymous" };
}

/**
 * Narrow an untrusted candidate object to one the map may consult. The same
 * caution as `corroborations` below: a malformed candidate reads as absent,
 * and an absent candidate falls back to the row itself, which cannot claim
 * more trust than the row carries.
 */
function readMapCandidate(value: unknown): CommunityPriceMapCandidate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CommunityPriceMapCandidate>;
  if (typeof candidate.priceGbp !== "number" || !Number.isFinite(candidate.priceGbp)) {
    return undefined;
  }
  if (typeof candidate.submittedAt !== "number" || !Number.isFinite(candidate.submittedAt)) {
    return undefined;
  }
  return {
    priceGbp: candidate.priceGbp,
    submittedAt: candidate.submittedAt,
    corroborations:
      typeof candidate.corroborations === "number" && Number.isFinite(candidate.corroborations)
        ? Math.max(1, Math.floor(candidate.corroborations))
        : 1,
  };
}

/** Narrow an untrusted API payload to the prices we can honestly render. */
function readPrices(value: unknown): CommunityPrice[] | null {
  if (!value || typeof value !== "object") return null;
  const rows = (value as { prices?: unknown }).prices;
  if (!Array.isArray(rows)) return null;
  const out: CommunityPrice[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const price = row as Partial<CommunityPrice>;
    if (typeof price.priceGbp !== "number" || !Number.isFinite(price.priceGbp)) continue;
    if (typeof price.submittedAt !== "number" || !Number.isFinite(price.submittedAt)) continue;
    if (typeof price.drinkCategory !== "string" || typeof price.venueId !== "string") continue;
    out.push({
      // Present from the server, absent on an older payload - and an absent id
      // simply means the row carries no report affordance, never that a
      // fabricated one is invented for it.
      ...(typeof price.id === "string" && price.id !== "" ? { id: price.id } : {}),
      venueId: price.venueId,
      drinkCategory: price.drinkCategory as DrinkCategory,
      priceGbp: price.priceGbp,
      submittedAt: price.submittedAt,
      source: "community",
      // The trust count is the server's to state. A missing or nonsensical
      // value reads as the cautious 1, never as "corroborated" - a payload we
      // can't trust must not be able to talk its way onto the map.
      corroborations:
        typeof price.corroborations === "number" && Number.isFinite(price.corroborations)
          ? Math.max(1, Math.floor(price.corroborations))
          : 1,
      mapCandidate: readMapCandidate(price.mapCandidate),
    });
  }
  return rows.length > 0 && out.length === 0 ? null : out;
}

function readSignalCandidate(
  signalKey: CommunityVenueSignalKey,
  value: unknown,
): CommunityVenueSignalCandidate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CommunityVenueSignalCandidate>;
  if (!isCommunityVenueSignalValueFor(signalKey, candidate.signalValue)) {
    return undefined;
  }
  if (
    typeof candidate.submittedAt !== "number" ||
    !Number.isFinite(candidate.submittedAt)
  ) {
    return undefined;
  }
  return {
    signalValue: candidate.signalValue,
    submittedAt: candidate.submittedAt,
    corroborations:
      typeof candidate.corroborations === "number" &&
      Number.isFinite(candidate.corroborations)
        ? Math.max(1, Math.floor(candidate.corroborations))
        : 1,
  };
}

function readSignals(value: unknown): CommunityVenueSignal[] | null {
  if (!value || typeof value !== "object") return null;
  const rows = (value as { signals?: unknown }).signals;
  // ABSENT is not INVALID. A deployment mid-rollout answers this venue with
  // `prices` alone, and treating a missing key as unreadable threw away prices
  // that were perfectly good - the sheet lost the figures over a question the
  // older server was never asked. Present-but-unparseable is still invalid.
  if (rows === undefined || rows === null) return [];
  if (!Array.isArray(rows)) return null;
  const signals: CommunityVenueSignal[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<CommunityVenueSignal>;
    if (!isCommunityVenueSignalKey(row.signalKey)) continue;
    if (!isCommunityVenueSignalValueFor(row.signalKey, row.signalValue)) continue;
    if (typeof row.venueId !== "string" || row.venueId === "") continue;
    if (
      typeof row.submittedAt !== "number" ||
      !Number.isFinite(row.submittedAt)
    ) {
      continue;
    }
    signals.push({
      // Present from the server, absent on an optimistic row: without an id the
      // observation simply carries no report handle, never a made-up one.
      ...(typeof row.id === "string" && row.id !== "" ? { id: row.id } : {}),
      venueId: row.venueId,
      signalKey: row.signalKey,
      signalValue: row.signalValue,
      submittedAt: row.submittedAt,
      source: "community",
      corroborations:
        typeof row.corroborations === "number" &&
        Number.isFinite(row.corroborations)
          ? Math.max(1, Math.floor(row.corroborations))
          : 1,
      establishedCandidate: readSignalCandidate(
        row.signalKey,
        row.establishedCandidate,
      ),
    });
  }
  return rows.length > 0 && signals.length === 0 ? null : signals;
}

export type VenuePriceLoad =
  | { status: "ready"; prices: CommunityPrice[] }
  | { status: "degraded"; prices: CommunityPrice[] }
  | { status: "invalid"; prices: [] };

export function readVenuePriceLoad(value: unknown): VenuePriceLoad {
  const prices = readPrices(value);
  if (!prices) return { status: "invalid", prices: [] };
  if ((value as { degraded?: unknown }).degraded === true) {
    return { status: "degraded", prices };
  }
  return { status: "ready", prices };
}

export type VenueSignalLoad =
  | { status: "ready"; signals: CommunityVenueSignal[] }
  | { status: "degraded"; signals: CommunityVenueSignal[] }
  | { status: "invalid"; signals: [] };

export function readVenueSignalLoad(value: unknown): VenueSignalLoad {
  const signals = readSignals(value);
  if (!signals) return { status: "invalid", signals: [] };
  if ((value as { degraded?: unknown }).degraded === true) {
    return { status: "degraded", signals };
  }
  return { status: "ready", signals };
}

export type CategoryPriceIndexLoad =
  | { status: "ready"; prices: CommunityPrice[]; truncated: boolean }
  | { status: "degraded"; prices: CommunityPrice[]; truncated: boolean }
  | { status: "invalid"; prices: []; truncated: false };

export function readCategoryPriceIndexLoad(
  value: unknown,
): CategoryPriceIndexLoad {
  const prices = readPrices(value);
  if (!prices) return { status: "invalid", prices: [], truncated: false };
  const truncated =
    typeof value === "object" &&
    value !== null &&
    (value as { truncated?: unknown }).truncated === true;
  if ((value as { degraded?: unknown }).degraded === true) {
    return { status: "degraded", prices, truncated };
  }
  return { status: "ready", prices, truncated };
}

export type ProvisionalVenueIdsLoad =
  | { status: "ready"; venueIds: string[] }
  | { status: "degraded"; venueIds: string[] }
  | { status: "invalid"; venueIds: [] };

/**
 * How long to stand down after the provisional-base budget refuses a read.
 * Matches the server window (app/api/price-submit/route.ts), because the
 * durable limiter RECORDS a hit even when it refuses one: a client that retries
 * inside the window keeps its own bucket saturated and never gets back in.
 */
export const PROVISIONAL_BASE_BACKOFF_MS = 60_000;
const PROVISIONAL_BASE_BACKOFF_MAX_MS = 300_000;

/**
 * The backoff a response earns, or null when it is not a refusal to budget.
 * Separated from `readProvisionalVenueIdsLoad` because 429 is a fact about the
 * transport, not the body: a limited read has no body worth parsing, and
 * flattening it into the same "unreadable" lane as a dropped connection is what
 * turns one refusal into a session-long lockout.
 */
export function provisionalBaseBackoffMs(
  status: number,
  retryAfter: string | null,
  now: number = Date.now(),
): number | null {
  if (status !== 429) return null;
  const header = (retryAfter ?? "").trim();
  const bounded = (ms: number) =>
    Math.min(Math.max(ms, 1_000), PROVISIONAL_BASE_BACKOFF_MAX_MS);
  if (header !== "") {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return bounded(seconds * 1_000);
    const retryAt = Date.parse(header);
    if (Number.isFinite(retryAt)) return bounded(retryAt - now);
  }
  return PROVISIONAL_BASE_BACKOFF_MS;
}

export function planProvisionalBaseVenueRead(
  venueIds: readonly string[],
  alreadyRead: ReadonlySet<string>,
): { visible: string[]; unread: string[] } {
  const visible = [
    ...new Set(venueIds.filter((venueId) => isUkBaseId(venueId))),
  ].sort();
  return {
    visible,
    unread: visible.filter((venueId) => !alreadyRead.has(venueId)),
  };
}

export function readProvisionalVenueIdsLoad(
  value: unknown,
  requestedVenueIds: ReadonlySet<string>,
): ProvisionalVenueIdsLoad {
  if (!value || typeof value !== "object") {
    return { status: "invalid", venueIds: [] };
  }
  const rows = (value as { venueIds?: unknown }).venueIds;
  if (!Array.isArray(rows)) return { status: "invalid", venueIds: [] };
  const venueIds = [
    ...new Set(
      rows.filter(
        (venueId): venueId is string =>
          typeof venueId === "string" &&
          isUkBaseId(venueId) &&
          requestedVenueIds.has(venueId),
      ),
    ),
  ];
  return (value as { degraded?: unknown }).degraded === true
    ? { status: "degraded", venueIds }
    : { status: "ready", venueIds };
}

function sameObservation(left: CommunityPrice, right: CommunityPrice): boolean {
  return (
    left.venueId === right.venueId &&
    left.drinkCategory === right.drinkCategory &&
    left.priceGbp === right.priceGbp &&
    left.submittedAt === right.submittedAt &&
    left.source === right.source
  );
}

export function rollbackOptimisticPrice(
  current: CommunityPrice[] | undefined,
  optimistic: CommunityPrice,
  loaded: CommunityPrice[] | undefined,
  loadedIsKnown: boolean,
): CommunityPrice[] | undefined {
  const withoutOptimistic = (current ?? []).filter(
    (row) => !sameObservation(row, optimistic),
  );
  const restored = (loaded ?? []).reduce(upsertPrice, withoutOptimistic);
  if (restored.length > 0) return restored;
  return loadedIsKnown ? [] : undefined;
}

export function upsertVenueSignal(
  rows: CommunityVenueSignal[],
  next: CommunityVenueSignal,
): CommunityVenueSignal[] {
  const current = rows.find((row) => row.signalKey === next.signalKey);
  const freshest =
    current && current.submittedAt > next.submittedAt ? current : next;
  return [
    freshest,
    ...rows.filter((row) => row.signalKey !== next.signalKey),
  ].sort((left, right) => right.submittedAt - left.submittedAt);
}

function replaceVenueSignal(
  rows: CommunityVenueSignal[],
  next: CommunityVenueSignal,
): CommunityVenueSignal[] {
  return [
    next,
    ...rows.filter((row) => row.signalKey !== next.signalKey),
  ].sort((left, right) => right.submittedAt - left.submittedAt);
}

function sameVenueSignal(
  left: CommunityVenueSignal,
  right: CommunityVenueSignal,
): boolean {
  return (
    left.venueId === right.venueId &&
    left.signalKey === right.signalKey &&
    left.signalValue === right.signalValue &&
    left.submittedAt === right.submittedAt
  );
}

export function rollbackOptimisticVenueSignal(
  current: CommunityVenueSignal[] | undefined,
  optimistic: CommunityVenueSignal,
  loaded: CommunityVenueSignal[] | undefined,
  loadedIsKnown: boolean,
): CommunityVenueSignal[] | undefined {
  const withoutOptimistic = (current ?? []).filter(
    (row) => !sameVenueSignal(row, optimistic),
  );
  const restored = (loaded ?? []).reduce(
    upsertVenueSignal,
    withoutOptimistic,
  );
  if (restored.length > 0) return restored;
  return loadedIsKnown ? [] : undefined;
}

/** The freshest observation in a venue's per-category list, any drink. */
export function freshestCommunityPrice(
  rows: readonly CommunityPrice[] | undefined,
): CommunityPrice | null {
  if (!rows) return null;
  return rows.reduce<CommunityPrice | null>(
    (best, row) => (best === null || row.submittedAt > best.submittedAt ? row : best),
    null,
  );
}

/**
 * The freshest BEER observation - the only category allowed to restamp a pin.
 * Pin colours (priceBucket) and the hover price line are pint-oriented, so a
 * £18 cocktail must never recolour a pin or read as the pub's pint price.
 */
export function freshestPintPrice(
  rows: readonly CommunityPrice[] | undefined,
): CommunityPrice | null {
  return freshestCommunityPrice(rows?.filter((row) => row.drinkCategory === "beer"));
}

export function useCommunityPrices(): CommunityPricesState {
  const [byVenueId, setByVenueId] = useState<Map<string, CommunityPrice[]>>(() => new Map());
  const [signalsByVenueId, setSignalsByVenueId] = useState<
    Map<string, CommunityVenueSignal[]>
  >(() => new Map());
  const [submitting, setSubmitting] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<string>>(() => new Set());
  const [reportErrors, setReportErrors] = useState<Map<string, string>>(() => new Map());
  const [provisionalBaseVenueIds, setProvisionalBaseVenueIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [noAlcoholIndexStatus, setNoAlcoholIndexStatus] = useState<
    CommunityPricesState["noAlcoholIndexStatus"]
  >("idle");
  // Venues already fetched this session - the sheet re-mounts on every
  // selection and must not re-hit the API for a venue it already read.
  const loaded = useRef<Set<string>>(new Set());
  const loadedRows = useRef<Map<string, CommunityPrice[]>>(new Map());
  const loadedSignalRows = useRef<Map<string, CommunityVenueSignal[]>>(
    new Map(),
  );
  const [venuePriceStatus, setVenuePriceStatus] = useState<
    Map<string, VenuePriceReadStatus>
  >(() => new Map());
  const markVenueRead = useCallback(
    (venueId: string, status: VenuePriceReadStatus) => {
      setVenuePriceStatus((current) => {
        if (current.get(venueId) === status) return current;
        const next = new Map(current);
        next.set(venueId, status);
        return next;
      });
    },
    [],
  );
  const [drinkCategoryIndexStatus, setDrinkCategoryIndexStatus] = useState<
    Map<DrinkCategory, CategoryPriceIndexStatus>
  >(() => new Map());
  const noAlcoholIndexLoaded = useRef(false);
  const drinkCategoryIndexesLoaded = useRef<Set<DrinkCategory>>(new Set());
  const markDrinkCategoryIndex = useCallback(
    (category: DrinkCategory, status: CategoryPriceIndexStatus) => {
      setDrinkCategoryIndexStatus((current) => {
        if (current.get(category) === status) return current;
        const next = new Map(current);
        next.set(category, status);
        return next;
      });
    },
    [],
  );
  const provisionalBaseSignature = useRef("");
  const provisionalBaseKnown = useRef<Set<string>>(new Set());
  const provisionalBasePending = useRef<Set<string>>(new Set());
  const provisionalBaseMarked = useRef<Set<string>>(new Set());
  const provisionalBaseBackoffUntil = useRef(0);

  const loadVenue = useCallback(
    (venueId: string) => {
      if (!venueId || loaded.current.has(venueId)) return;
      loaded.current.add(venueId);
      markVenueRead(venueId, "loading");
      void (async () => {
        try {
          const res = await fetch(`/api/price-submit?venueId=${encodeURIComponent(venueId)}`);
          if (!res.ok) {
            discardBody(res);
            loaded.current.delete(venueId);
            markVenueRead(venueId, "degraded");
            return;
          }
          const payload = await res.json();
          const result = readVenuePriceLoad(payload);
          const signalResult = readVenueSignalLoad(payload);
          if (result.status === "invalid" || signalResult.status === "invalid") {
            loaded.current.delete(venueId);
            markVenueRead(venueId, "degraded");
            return;
          }
          const { prices } = result;
          const { signals } = signalResult;
          const degraded =
            result.status === "degraded" ||
            signalResult.status === "degraded";
          if (degraded) loaded.current.delete(venueId);
          markVenueRead(
            venueId,
            degraded ? "degraded" : "ready",
          );
          if (
            degraded &&
            prices.length === 0 &&
            signals.length === 0
          ) {
            return;
          }
          loadedRows.current.set(
            venueId,
            prices.reduce(upsertPrice, loadedRows.current.get(venueId) ?? []),
          );
          setByVenueId((current) => {
            if (prices.length === 0 && current.has(venueId)) return current;
            const next = new Map(current);
            // Server rows are the record; a locally-optimistic entry for a
            // category the server hasn't seen yet is kept rather than dropped.
            const merged = prices.reduce(upsertPrice, next.get(venueId) ?? []);
            next.set(venueId, merged);
            return next;
          });
          loadedSignalRows.current.set(
            venueId,
            signals.reduce(
              upsertVenueSignal,
              loadedSignalRows.current.get(venueId) ?? [],
            ),
          );
          setSignalsByVenueId((current) => {
            if (signals.length === 0 && current.has(venueId)) return current;
            const next = new Map(current);
            next.set(
              venueId,
              signals.reduce(
                upsertVenueSignal,
                next.get(venueId) ?? [],
              ),
            );
            return next;
          });
        } catch {
          // Fail-soft: no community prices, the sourced baseline still renders.
          // Allow a later selection to retry this venue.
          loaded.current.delete(venueId);
          markVenueRead(venueId, "degraded");
        }
      })();
    },
    [markVenueRead],
  );

  const loadNoAlcoholIndex = useCallback(() => {
    if (noAlcoholIndexLoaded.current) return;
    noAlcoholIndexLoaded.current = true;
    setNoAlcoholIndexStatus("loading");
    void (async () => {
      try {
        const response = await fetch("/api/price-submit?lens=no-alcohol");
        if (!response.ok) {
          discardBody(response);
          throw new Error("category index unavailable");
        }
        const result = readCategoryPriceIndexLoad(await response.json());
        if (result.status === "invalid") {
          noAlcoholIndexLoaded.current = false;
          setNoAlcoholIndexStatus("degraded");
          return;
        }
        for (const row of result.prices) {
          loadedRows.current.set(
            row.venueId,
            upsertPrice(loadedRows.current.get(row.venueId) ?? [], row),
          );
        }
        setByVenueId((current) => {
          if (result.prices.length === 0) return current;
          const next = new Map(current);
          for (const row of result.prices) {
            next.set(
              row.venueId,
              upsertPrice(next.get(row.venueId) ?? [], row),
            );
          }
          return next;
        });
        setNoAlcoholIndexStatus(
          result.status === "degraded"
            ? "degraded"
            : result.truncated
              ? "partial"
              : "ready",
        );
      } catch {
        noAlcoholIndexLoaded.current = false;
        setNoAlcoholIndexStatus("degraded");
      }
    })();
  }, []);

  const loadDrinkCategoryIndex = useCallback(
    (category: DrinkCategory) => {
      if (drinkCategoryIndexesLoaded.current.has(category)) return;
      drinkCategoryIndexesLoaded.current.add(category);
      markDrinkCategoryIndex(category, "loading");
      void (async () => {
        try {
          const response = await fetch(
            `/api/price-submit?drinkCategory=${encodeURIComponent(category)}`,
          );
          if (!response.ok) {
            discardBody(response);
            throw new Error("category index unavailable");
          }
          const result = readCategoryPriceIndexLoad(await response.json());
          if (result.status === "invalid") {
            drinkCategoryIndexesLoaded.current.delete(category);
            markDrinkCategoryIndex(category, "degraded");
            return;
          }
          for (const row of result.prices) {
            loadedRows.current.set(
              row.venueId,
              upsertPrice(loadedRows.current.get(row.venueId) ?? [], row),
            );
          }
          setByVenueId((current) => {
            if (result.prices.length === 0) return current;
            const next = new Map(current);
            for (const row of result.prices) {
              next.set(
                row.venueId,
                upsertPrice(next.get(row.venueId) ?? [], row),
              );
            }
            return next;
          });
          if (result.status === "degraded") {
            drinkCategoryIndexesLoaded.current.delete(category);
          }
          markDrinkCategoryIndex(
            category,
            result.status === "degraded"
              ? "degraded"
              : result.truncated
                ? "partial"
                : "ready",
          );
        } catch {
          drinkCategoryIndexesLoaded.current.delete(category);
          markDrinkCategoryIndex(category, "degraded");
        }
      })();
    },
    [markDrinkCategoryIndex],
  );

  const loadProvisionalBaseVenues = useCallback(
    (venueIds: readonly string[]) => {
      // Standing down after a refusal is the whole point of the backoff, so it
      // gates ahead of the viewport signature: panning is exactly what would
      // otherwise re-fire the refused chunks and keep the window saturated.
      // When it lapses the signature goes with it, so a camera that never moved
      // still gets its one read rather than being deduped out of existence.
      const startedAt = Date.now();
      if (startedAt < provisionalBaseBackoffUntil.current) return;
      if (provisionalBaseBackoffUntil.current !== 0) {
        provisionalBaseBackoffUntil.current = 0;
        provisionalBaseSignature.current = "";
      }
      const knownOrPending = new Set([
        ...provisionalBaseKnown.current,
        ...provisionalBasePending.current,
      ]);
      const { visible, unread } = planProvisionalBaseVenueRead(
        venueIds,
        knownOrPending,
      );
      const signature = visible.join("\u0000");
      if (signature === provisionalBaseSignature.current) return;
      provisionalBaseSignature.current = signature;
      if (unread.length === 0) return;
      for (const venueId of unread) {
        provisionalBasePending.current.add(venueId);
      }
      const chunks: string[][] = [];
      for (
        let index = 0;
        index < unread.length;
        index += MAX_PROVISIONAL_BASE_VENUE_IDS
      ) {
        chunks.push(
          unread.slice(index, index + MAX_PROVISIONAL_BASE_VENUE_IDS),
        );
      }
      void (async () => {
        let changed = false;
        let incomplete = false;
        let backoffMs: number | null = null;
        // ONE chunk in flight at a time. A dense central viewport carries
        // hundreds of base pubs, so firing every chunk at once turns a single
        // settled camera into a burst against an unauthenticated read whose
        // per-actor budget is sized for a session's browsing, not one frame of
        // it. Sequential costs a beat on a badge and caps the burst at one.
        for (const chunk of chunks) {
          let load: ProvisionalVenueIdsLoad;
          try {
            const query = new URLSearchParams({ scope: "provisional-base" });
            for (const venueId of chunk) query.append("venueId", venueId);
            const response = await fetch(
              `/api/price-submit?${query.toString()}`,
            );
            backoffMs = provisionalBaseBackoffMs(
              response.status,
              response.headers.get("Retry-After"),
            );
            // The budget is spent, and the rest of this viewport's chunks would
            // only deepen the hole. Stop, and let the backoff hold the retry.
            if (backoffMs !== null) break;
            if (!response.ok) {
              discardBody(response);
              throw new Error("provisional base read unavailable");
            }
            load = readProvisionalVenueIdsLoad(
              await response.json(),
              new Set(chunk),
            );
          } catch {
            load = { status: "invalid", venueIds: [] };
          }
          for (const venueId of chunk) {
            provisionalBasePending.current.delete(venueId);
          }
          if (load.status !== "ready") {
            // A degraded or unreadable answer is not "no marks here". Leaving
            // these ids unknown is what lets a later settle ask again, per
            // chunk, rather than a single bad chunk discarding the ones that
            // did answer.
            incomplete = true;
            continue;
          }
          for (const venueId of chunk) {
            provisionalBaseKnown.current.add(venueId);
          }
          for (const venueId of load.venueIds) {
            if (provisionalBaseMarked.current.has(venueId)) continue;
            provisionalBaseMarked.current.add(venueId);
            changed = true;
          }
        }
        // Whatever the loop broke out of, nothing is still in flight. Ids that
        // never got an answer stay UNKNOWN rather than pending, so a later read
        // can still ask for them.
        for (const venueId of unread) {
          provisionalBasePending.current.delete(venueId);
        }
        // Negative reads extend the cache without republishing the base
        // source. An identical Set with a new identity would restart its
        // viewport stream and turn one settled read into a feedback loop.
        if (changed) {
          setProvisionalBaseVenueIds(new Set(provisionalBaseMarked.current));
        }
        if (backoffMs !== null) {
          // Keep the signature: it is the dedupe guard, and dropping it here is
          // precisely what would let the next settle re-fire the refused chunks.
          provisionalBaseBackoffUntil.current = Date.now() + backoffMs;
          return;
        }
        if (incomplete && provisionalBaseSignature.current === signature) {
          provisionalBaseSignature.current = "";
        }
      })();
    },
    [],
  );

  const submit = useCallback<CommunityPricesState["submit"]>(
    async (input, auth) => {
      // Run the SAME validator the route runs, so an out-of-bounds price is
      // refused in-place with the identical sentence and never leaves the phone.
      const parsed = validateCommunityPrice(input);
      if (!parsed.ok) return { ok: false, error: parsed.error, reason: "invalid" };
      const { venueId, drinkCategory, priceGbp } = parsed.value;
      const pintPhoto = input.pintPhoto ?? null;

      const submittedAt = Date.now();
      const optimistic: CommunityPrice = {
        venueId,
        drinkCategory,
        priceGbp,
        submittedAt,
        source: "community",
        corroborations: 1,
      };
      setByVenueId((current) => {
        const previous = current.get(venueId);
        const category = previous?.find(
          (row) => row.drinkCategory === drinkCategory,
        );
        const next = new Map(current);
        next.set(
          venueId,
          upsertPrice(previous ?? [], {
            ...optimistic,
            mapCandidate: category?.mapCandidate,
          }),
        );
        return next;
      });

      const rollback = () => {
        setByVenueId((current) => {
          const next = new Map(current);
          const restored = rollbackOptimisticPrice(
            current.get(venueId),
            optimistic,
            loadedRows.current.get(venueId),
            loadedRows.current.has(venueId),
          );
          if (restored === undefined) next.delete(venueId);
          else next.set(venueId, restored);
          return next;
        });
      };

      setSubmitting(true);
      try {
        const res = await postCommunityContribution(
          auth,
          {
            venueId,
            drinkCategory,
            priceGbp,
          },
          pintPhoto ? { pintPhoto } : undefined,
        );
        const data = (await res.json().catch(() => null)) as
          | {
              price?: CommunityPrice;
              attribution?: unknown;
              error?: unknown;
              status?: string;
            }
          | null;
        if (!res.ok) {
          rollback();
          return rejectedCommunitySubmission(
            res.status,
            data?.error,
            "Could not log that price right now.",
            data?.status,
          );
        }
        // Adopt the server's authoritative record: its timestamp, so the dated
        // badge is the record's day rather than the device's guess at it, and
        // its corroboration count, which is the only thing that can promote
        // this price from the sheet onto the map. Narrowed by the same reader
        // the GET uses, so there is one trust boundary for both. A forced
        // replace, not the keep-newer merge: a device clock ahead of the
        // server would otherwise out-rank the record and keep the optimistic
        // stamp forever.
        const [stored] = readPrices({ prices: [data?.price] }) ?? [];
        if (stored) {
          loadedRows.current.set(
            venueId,
            replacePrice(loadedRows.current.get(venueId) ?? [], stored),
          );
          setByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, replacePrice(next.get(venueId) ?? [], stored));
            return next;
          });
        }
        return {
          ok: true,
          attribution: readCommunityPriceAttribution(data?.attribution),
          price: stored ?? null,
        };
      } catch {
        rollback();
        return {
          ok: false,
          error: "No signal for that one. Try again in a moment.",
          reason: "offline",
        };
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const submitVenueSignal = useCallback<
    CommunityPricesState["submitVenueSignal"]
  >(
    async (input, auth) => {
      if (submitting) {
        return {
          ok: false,
          error: "Finish this log first.",
          reason: "rejected",
        };
      }
      const parsed = validateCommunityVenueSignal(input);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error, reason: "invalid" };
      }
      const { venueId, signalKey, signalValue } = parsed.value;
      const submittedAt = Date.now();
      const optimistic: CommunityVenueSignal = {
        venueId,
        signalKey,
        signalValue,
        submittedAt,
        source: "community",
        corroborations: 1,
      };
      setSignalsByVenueId((current) => {
        const previous = current.get(venueId);
        const question = previous?.find(
          (row) => row.signalKey === signalKey,
        );
        const next = new Map(current);
        next.set(
          venueId,
          upsertVenueSignal(previous ?? [], {
            ...optimistic,
            establishedCandidate: question?.establishedCandidate,
          }),
        );
        return next;
      });

      const rollback = () => {
        setSignalsByVenueId((current) => {
          const next = new Map(current);
          const restored = rollbackOptimisticVenueSignal(
            current.get(venueId),
            optimistic,
            loadedSignalRows.current.get(venueId),
            loadedSignalRows.current.has(venueId),
          );
          if (restored === undefined) next.delete(venueId);
          else next.set(venueId, restored);
          return next;
        });
      };

      setSubmitting(true);
      try {
        const response = await postCommunityContribution(auth, {
          kind: "venue-signal",
          venueId,
          signalKey,
          signalValue,
        });
        const data = (await response.json().catch(() => null)) as
          | { signal?: CommunityVenueSignal; error?: unknown; status?: string }
          | null;
        if (!response.ok) {
          rollback();
          return rejectedCommunitySubmission(
            response.status,
            data?.error,
            "Could not log that pub note right now.",
            data?.status,
          );
        }
        const [stored] =
          readSignals({ signals: [data?.signal] }) ?? [];
        if (stored) {
          loadedSignalRows.current.set(
            venueId,
            replaceVenueSignal(
              loadedSignalRows.current.get(venueId) ?? [],
              stored,
            ),
          );
          setSignalsByVenueId((current) => {
            const next = new Map(current);
            next.set(
              venueId,
              replaceVenueSignal(next.get(venueId) ?? [], stored),
            );
            return next;
          });
        }
        return { ok: true };
      } catch {
        rollback();
        return {
          ok: false,
          error: "No signal for that one. Try again in a moment.",
          reason: "offline",
        };
      } finally {
        setSubmitting(false);
      }
    },
    [submitting],
  );

  const reportPrice = useCallback((id: string) => {
    if (!id || reportedIds.has(id)) return;
    setReportErrors((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    void (async () => {
      try {
        const res = await fetch("/api/price-submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "report", id }),
        });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          setReportErrors((current) => {
            const next = new Map(current);
            next.set(
              id,
              offlineOrMessage(errorMessageFrom(body, "Could not report that price. Try again."))
            );
            return next;
          });
          return;
        }
        // Acknowledgement is not removal: the figure stays on the sheet until
        // a moderator hides it, but only after the server records the report.
        setReportedIds((current) => {
          const next = new Set(current);
          next.add(id);
          return next;
        });
      } catch {
        setReportErrors((current) => {
          const next = new Map(current);
          next.set(
            id,
            offlineOrMessage("Could not report that price. Try again.")
          );
          return next;
        });
      }
    })();
  }, [reportedIds]);

  // The freshest beer observation per venue - what a pin can carry. Derived,
  // never stored, so it can't drift from the per-category lists.
  const freshestByVenueId = useMemo(() => {
    const freshest = new Map<string, CommunityPrice>();
    for (const [venueId, rows] of byVenueId) {
      const top = freshestPintPrice(rows);
      if (top) freshest.set(venueId, top);
    }
    return freshest;
  }, [byVenueId]);

  return {
    byVenueId,
    signalsByVenueId,
    freshestByVenueId,
    noAlcoholIndexStatus,
    loadNoAlcoholIndex,
    loadDrinkCategoryIndex,
    drinkCategoryIndexStatus,
    provisionalBaseVenueIds,
    loadProvisionalBaseVenues,
    loadVenue,
    venuePriceStatus,
    submit,
    submitVenueSignal,
    submitting,
    reportPrice,
    reportedIds,
    reportErrors,
  };
}
