import type { PlanningConfidence, PlanningEvidenceSource, PlanRouteTotals } from "@/lib/planIntelligence";
import { cleanNightContext, type NightContext } from "@/lib/nightPlanning";
import {
  PLANNING_INTENT_SOURCES,
  type PlanningIntentSource,
} from "@/lib/planningIntent";
import { DAY_MS } from "@/lib/dayMs";
import { isPlanStopCount } from "@/lib/planStopCount";

export const PLAN_ROUTE_DRAFT_KEY = "pubmaxx:plan-route-draft:v1";
export const PLAN_ROUTE_DRAFT_V2_KEY = "pubmax:plan-route-draft:v2";
export const PLAN_ROUTE_DRAFT_STORAGE_VERSION = 2 as const;
export const PLAN_ROUTE_DRAFT_MAX_RAW_BYTES = 40 * 1024;
export const PLAN_ROUTE_DRAFT_TTL_MS = DAY_MS;
export const PLAN_ROUTE_DRAFT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const PLAN_ROUTE_DRAFT_ORIGINS = [
  "manual",
  "plan-generated",
  "map-generated",
  "planning-intent",
] as const;
export const PLAN_ROUTE_DRAFT_OUTCOMES = [
  "route",
  "anchor-only",
  "unanchored",
] as const;

export type PlanRouteDraftOrigin = (typeof PLAN_ROUTE_DRAFT_ORIGINS)[number];
export type PlanRouteDraftOutcome = (typeof PLAN_ROUTE_DRAFT_OUTCOMES)[number];
export type RouteRevision = string | number;

export type StoredRouteAlternative = {
  venueId: string;
  venueName: string;
};

export type StoredRouteStop = {
  key: number;
  venueId: string;
  venueName: string;
  reason?: string;
  alternatives: StoredRouteAlternative[];
};

export type StoredRouteAlternatives = StoredRouteAlternative[];

export type PlanRouteDraftEnvelopeV2 = {
  storageVersion: typeof PLAN_ROUTE_DRAFT_STORAGE_VERSION;
  savedAt: string;
  expiresAt: string;
  origin: PlanRouteDraftOrigin;
  anchorVenueId: string | null;
  anchorSource: PlanningIntentSource | null;
  outcome: PlanRouteDraftOutcome;
  stops: StoredRouteStop[];
  alternatives: StoredRouteAlternatives;
  nightContext: NightContext | null;
  routeTotals: PlanRouteTotals | null;
  transportBasis: string | null;
  planningConfidence: PlanningConfidence | null;
  warnings: string[];
  groundingProof: string | null;
  operationKey: string | null;
  routeRevision: RouteRevision | null;
  routeStale: boolean;
};

export type ParsedPlanRouteDraft = {
  storageVersion: 1 | typeof PLAN_ROUTE_DRAFT_STORAGE_VERSION;
  savedAt: string | null;
  expiresAt: string | null;
  origin: PlanRouteDraftOrigin;
  value: Omit<PlanRouteDraftEnvelopeV2, "storageVersion" | "savedAt" | "expiresAt" | "origin">;
  legacy: boolean;
};

export type PlanRouteDraftStorage = Pick<Storage, "getItem" | "setItem">;

export type PlanRouteDraftWriteResult = {
  v1: boolean;
  v2: boolean;
  envelope: PlanRouteDraftEnvelopeV2 | null;
};

const ENVELOPE_KEYS = [
  "storageVersion",
  "savedAt",
  "expiresAt",
  "origin",
  "anchorVenueId",
  "anchorSource",
  "outcome",
  "stops",
  "alternatives",
  "nightContext",
  "routeTotals",
  "transportBasis",
  "planningConfidence",
  "warnings",
  "groundingProof",
  "operationKey",
  "routeRevision",
  "routeStale",
] as const;
const STOP_KEYS = ["key", "venueId", "venueName", "reason", "alternatives"] as const;
const ALTERNATIVE_KEYS = ["venueId", "venueName"] as const;
const ROUTE_TOTAL_KEYS = [
  "stopCount",
  "straightLineWalkingKm",
  "estimatedWalkingMinutes",
  "distanceBasis",
] as const;
const CONFIDENCE_KEYS = [
  "level",
  "score",
  "routeReady",
  "missingEvidence",
  "warnings",
  "provenance",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

function nullableText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  return text(value, max) ?? undefined;
}

function canonicalTimestamp(value: unknown): { value: string; time: number } | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) return null;
  return { value, time };
}

function revision(value: unknown): RouteRevision | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() && value.length <= 120) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  return undefined;
}

function cleanStringList(value: unknown, maxItems = 12, maxLength = 240): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const values = value.map((item) => text(item, maxLength));
  return values.some((item) => item === null) ? null : values as string[];
}

function cleanAlternative(value: unknown, exactKeys: boolean): StoredRouteAlternative | null {
  if (!isRecord(value) || (exactKeys && !hasExactKeys(value, ALTERNATIVE_KEYS))) return null;
  const venueId = text(value.venueId, 200);
  const venueName = text(value.venueName ?? value.name, 200);
  return venueId && venueName ? { venueId, venueName } : null;
}

function cleanAlternatives(value: unknown, exactKeys: boolean): StoredRouteAlternatives | null {
  if (!Array.isArray(value) || value.length > 24) return null;
  const values = value.map((item) => cleanAlternative(item, exactKeys));
  if (values.some((item) => item === null)) return null;
  const unique = (values as StoredRouteAlternative[]).filter((item, index, all) => (
    all.findIndex((candidate) => candidate.venueId === item.venueId) === index
  ));
  return unique;
}

function cleanStops(value: unknown, exactKeys: boolean): StoredRouteStop[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const stops = value.map((candidate, index) => {
    if (!isRecord(candidate)) return null;
    if (exactKeys) {
      const keys = Object.keys(candidate);
      if (
        keys.some((key) => !STOP_KEYS.includes(key as (typeof STOP_KEYS)[number]))
        || !["key", "venueId", "venueName", "alternatives"].every((key) => keys.includes(key))
        || candidate.key !== index + 1
      ) return null;
    }
    const venueId = text(candidate.venueId, 200);
    const venueName = text(candidate.venueName ?? candidate.name, 200);
    const alternatives = cleanAlternatives(candidate.alternatives ?? candidate.options ?? [], exactKeys);
    if (!venueId || !venueName || !alternatives) return null;
    const reason = nullableText(candidate.reason ?? null, 500);
    if (reason === undefined) return null;
    return {
      key: index + 1,
      venueId,
      venueName,
      ...(reason ? { reason } : {}),
      alternatives: alternatives.filter((alternative) => alternative.venueId !== venueId),
    };
  });
  return stops.some((stop) => stop === null) ? null : stops as StoredRouteStop[];
}

function cleanRouteTotals(value: unknown): PlanRouteTotals | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ROUTE_TOTAL_KEYS)) return undefined;
  if (!Number.isInteger(value.stopCount) || Number(value.stopCount) < 1 || Number(value.stopCount) > 12) return undefined;
  if (typeof value.straightLineWalkingKm !== "number" || !Number.isFinite(value.straightLineWalkingKm) || value.straightLineWalkingKm < 0) return undefined;
  if (!Number.isInteger(value.estimatedWalkingMinutes) || Number(value.estimatedWalkingMinutes) < 0) return undefined;
  if (value.distanceBasis !== "straight-line" && value.distanceBasis !== "routed") return undefined;
  return {
    stopCount: Number(value.stopCount),
    straightLineWalkingKm: value.straightLineWalkingKm,
    estimatedWalkingMinutes: Number(value.estimatedWalkingMinutes),
    distanceBasis: value.distanceBasis,
  };
}

function cleanProvenance(value: unknown): PlanningEvidenceSource[] | null {
  if (!Array.isArray(value) || value.length > 24) return null;
  const result = value.map((candidate) => {
    if (!isRecord(candidate)) return null;
    const keys = Object.keys(candidate);
    if (keys.some((key) => !["kind", "label", "asOf"].includes(key))) return null;
    if (!["venue_dataset", "night_area_review", "night_signal"].includes(String(candidate.kind))) return null;
    const label = text(candidate.label, 200);
    const asOf = candidate.asOf === undefined || candidate.asOf === null
      ? candidate.asOf
      : canonicalTimestamp(candidate.asOf)?.value;
    if (!label || (candidate.asOf !== undefined && asOf === undefined)) return null;
    return {
      kind: candidate.kind as PlanningEvidenceSource["kind"],
      label,
      ...(asOf !== undefined ? { asOf } : {}),
    };
  });
  return result.some((item) => item === null) ? null : result as PlanningEvidenceSource[];
}

function cleanPlanningConfidence(value: unknown): PlanningConfidence | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, CONFIDENCE_KEYS)) return undefined;
  if (!["high", "medium", "low"].includes(String(value.level))) return undefined;
  if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) return undefined;
  if (typeof value.routeReady !== "boolean") return undefined;
  const missingEvidence = cleanStringList(value.missingEvidence);
  const warnings = cleanStringList(value.warnings);
  const provenance = cleanProvenance(value.provenance);
  if (!missingEvidence || !warnings || !provenance) return undefined;
  return {
    level: value.level as PlanningConfidence["level"],
    score: value.score,
    routeReady: value.routeReady,
    missingEvidence,
    warnings,
    provenance,
  };
}

function decodeProofPayload(proof: string): Record<string, unknown> | null {
  const encoded = proof.split(".")[0];
  if (!encoded) return null;
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(new TextDecoder().decode(
      Uint8Array.from(globalThis.atob(padded), (character) => character.charCodeAt(0)),
    )) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Client inspection only: signature trust remains server-owned. */
function proofState(
  proof: unknown,
  operationKey: string | null,
  now: number,
): { groundingProof: string | null; stale: boolean } {
  if (proof === null || proof === undefined || proof === "") return { groundingProof: null, stale: false };
  if (typeof proof !== "string" || proof.length > 8_000 || !operationKey) {
    return { groundingProof: null, stale: true };
  }
  const payload = decodeProofPayload(proof);
  if (!payload || !Number.isSafeInteger(payload.expiresAt) || now > Number(payload.expiresAt)) {
    return { groundingProof: null, stale: true };
  }
  return { groundingProof: proof, stale: false };
}

type CleanedRouteFields = Pick<
  ParsedPlanRouteDraft["value"],
  | "stops"
  | "alternatives"
  | "nightContext"
  | "routeTotals"
  | "transportBasis"
  | "planningConfidence"
  | "warnings"
  | "operationKey"
  | "routeRevision"
>;

type CleanedRouteIdentity = Pick<
  ParsedPlanRouteDraft["value"],
  "anchorVenueId" | "anchorSource" | "outcome"
> & { anchored: boolean };

function cleanRouteFields(
  value: Record<string, unknown>,
  exactKeys: boolean,
): CleanedRouteFields | null {
  const stops = cleanStops(value.stops, exactKeys);
  const alternatives = cleanAlternatives(value.alternatives ?? [], exactKeys);
  const nightContext = value.nightContext === null ? null : cleanNightContext(value.nightContext);
  const routeTotals = cleanRouteTotals(value.routeTotals ?? null);
  const planningConfidence = cleanPlanningConfidence(value.planningConfidence ?? null);
  const transportBasis = nullableText(value.transportBasis ?? null, 200);
  const warnings = cleanStringList(value.warnings ?? []);
  const operationKey = nullableText(value.operationKey ?? value.createOperationKey ?? null, 120);
  const routeRevision = revision(value.routeRevision ?? null);
  if (
    !stops
    || !alternatives
    || (value.nightContext !== null && nightContext === null)
    || routeTotals === undefined
    || planningConfidence === undefined
    || transportBasis === undefined
    || !warnings
    || operationKey === undefined
    || routeRevision === undefined
  ) return null;
  return {
    stops,
    alternatives,
    nightContext,
    routeTotals,
    transportBasis,
    planningConfidence,
    warnings,
    operationKey,
    routeRevision,
  };
}

function cleanRouteIdentity(
  value: Record<string, unknown>,
  stops: StoredRouteStop[],
): CleanedRouteIdentity | null {
  const anchorVenueId = nullableText(value.anchorVenueId ?? null, 200);
  const anchorSource = value.anchorSource === null || value.anchorSource === undefined
    ? null
    : (PLANNING_INTENT_SOURCES as readonly unknown[]).includes(value.anchorSource)
      ? value.anchorSource as PlanningIntentSource
      : undefined;
  const outcome = value.outcome === undefined
    ? "unanchored"
    : (PLAN_ROUTE_DRAFT_OUTCOMES as readonly unknown[]).includes(value.outcome)
      ? value.outcome as PlanRouteDraftOutcome
      : undefined;
  if (anchorVenueId === undefined || anchorSource === undefined || outcome === undefined) return null;
  const anchored = outcome === "route" || outcome === "anchor-only";
  if (
    (outcome === "route" && !isPlanStopCount(stops.length))
    || (outcome === "anchor-only" && stops.length !== 1)
    || (anchored && (!anchorVenueId || !anchorSource || stops[0]?.venueId !== anchorVenueId))
    || (!anchored && (anchorVenueId !== null || anchorSource !== null))
  ) return null;
  return { anchorVenueId, anchorSource, outcome, anchored };
}

function cleanEnvelopeValue(
  value: Record<string, unknown>,
  now: number,
  exactKeys: boolean,
): ParsedPlanRouteDraft["value"] | null {
  const fields = cleanRouteFields(value, exactKeys);
  if (!fields) return null;
  const identity = cleanRouteIdentity(value, fields.stops);
  if (!identity) return null;
  const inspectedProof = proofState(value.groundingProof, fields.operationKey, now);
  return {
    anchorVenueId: identity.anchorVenueId,
    anchorSource: identity.anchorSource,
    outcome: identity.outcome,
    ...fields,
    groundingProof: inspectedProof.groundingProof,
    routeStale: value.routeStale === true
      || inspectedProof.stale
      || (identity.anchored && inspectedProof.groundingProof === null),
  };
}

export function parsePlanRouteDraftV2(
  raw: string | null,
  now = Date.now(),
): ParsedPlanRouteDraft | null {
  if (!raw || !Number.isFinite(now) || byteLength(raw) > PLAN_ROUTE_DRAFT_MAX_RAW_BYTES) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !hasExactKeys(value, ENVELOPE_KEYS)) return null;
    if (value.storageVersion !== PLAN_ROUTE_DRAFT_STORAGE_VERSION) return null;
    if (!(PLAN_ROUTE_DRAFT_ORIGINS as readonly unknown[]).includes(value.origin)) return null;
    const savedAt = canonicalTimestamp(value.savedAt);
    const expiresAt = canonicalTimestamp(value.expiresAt);
    if (!savedAt || !expiresAt) return null;
    if (savedAt.time > now + PLAN_ROUTE_DRAFT_MAX_FUTURE_SKEW_MS) return null;
    if (expiresAt.time !== savedAt.time + PLAN_ROUTE_DRAFT_TTL_MS || now >= expiresAt.time) return null;
    const parsed = cleanEnvelopeValue(value, now, true);
    if (!parsed) return null;
    return {
      storageVersion: PLAN_ROUTE_DRAFT_STORAGE_VERSION,
      savedAt: savedAt.value,
      expiresAt: expiresAt.value,
      origin: value.origin as PlanRouteDraftOrigin,
      value: parsed,
      legacy: false,
    };
  } catch {
    return null;
  }
}

/** Parse an unversioned Route draft without inventing savedAt. */
export function parseLegacyPlanRouteDraft(
  raw: string | null,
  now = Date.now(),
): ParsedPlanRouteDraft | null {
  if (!raw || !Number.isFinite(now) || byteLength(raw) > PLAN_ROUTE_DRAFT_MAX_RAW_BYTES) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const parsed = cleanEnvelopeValue(value, now, false);
    return parsed
      ? {
          storageVersion: 1,
          savedAt: null,
          expiresAt: null,
          origin: "manual",
          value: parsed,
          legacy: true,
        }
      : null;
  } catch {
    return null;
  }
}

export function parsePlanRouteDraftEnvelope(
  rawV2: string | null,
  rawV1: string | null,
  now = Date.now(),
): ParsedPlanRouteDraft | null {
  return parsePlanRouteDraftV2(rawV2, now) ?? parseLegacyPlanRouteDraft(rawV1, now);
}

export function readPlanRouteDraftEnvelope(
  storage: PlanRouteDraftStorage | null,
  now = Date.now(),
): ParsedPlanRouteDraft | null {
  if (!storage) return null;
  try {
    return parsePlanRouteDraftEnvelope(
      storage.getItem(PLAN_ROUTE_DRAFT_V2_KEY),
      storage.getItem(PLAN_ROUTE_DRAFT_KEY),
      now,
    );
  } catch {
    return null;
  }
}

function legacyValue(value: ParsedPlanRouteDraft["value"]): Record<string, unknown> {
  return {
    stops: value.stops,
    nightContext: value.nightContext,
    routeRevision: value.routeRevision,
    routeStale: value.routeStale,
    groundingProof: value.groundingProof,
    createOperationKey: value.operationKey,
  };
}

/** Explicit writes dual-write V1 and V2; readers remain rollback-safe. */
export function writePlanRouteDraftEnvelope(
  value: ParsedPlanRouteDraft["value"],
  origin: PlanRouteDraftOrigin,
  storage: PlanRouteDraftStorage | null,
  now = Date.now(),
): PlanRouteDraftWriteResult {
  const savedAt = new Date(now);
  const expiresAt = new Date(now + PLAN_ROUTE_DRAFT_TTL_MS);
  const candidate = cleanEnvelopeValue(value as unknown as Record<string, unknown>, now, false);
  if (
    !storage
    || !candidate
    || !(PLAN_ROUTE_DRAFT_ORIGINS as readonly unknown[]).includes(origin)
    || !Number.isFinite(savedAt.getTime())
    || !Number.isFinite(expiresAt.getTime())
  ) return { v1: false, v2: false, envelope: null };

  const envelope: PlanRouteDraftEnvelopeV2 = {
    storageVersion: PLAN_ROUTE_DRAFT_STORAGE_VERSION,
    savedAt: savedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    origin,
    ...candidate,
  };
  const rawV1 = JSON.stringify(legacyValue(candidate));
  const rawV2 = JSON.stringify(envelope);
  if (byteLength(rawV1) > PLAN_ROUTE_DRAFT_MAX_RAW_BYTES || byteLength(rawV2) > PLAN_ROUTE_DRAFT_MAX_RAW_BYTES) {
    return { v1: false, v2: false, envelope: null };
  }

  let v1 = false;
  let v2 = false;
  try {
    storage.setItem(PLAN_ROUTE_DRAFT_KEY, rawV1);
    v1 = true;
  } catch {
    // Try the canonical write even when rollback storage is blocked.
  }
  try {
    storage.setItem(PLAN_ROUTE_DRAFT_V2_KEY, rawV2);
    v2 = true;
  } catch {
    // Existing values remain untouched when storage is blocked or full.
  }
  return { v1, v2, envelope: v2 ? envelope : null };
}
