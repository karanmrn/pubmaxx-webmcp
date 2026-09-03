import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  PLANNING_INTENT_SOURCES,
  type PlanningIntentSource,
} from "@/lib/planningIntent";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";
import { isPlanStopCount } from "@/lib/planStopCount";

const PROOF_VERSION = 1;
const PROOF_V2_VERSION = 2;
const PROOF_MAX_LENGTH = 8_000;
const VENUE_ID_MAX = 120;
export const PLAN_GROUNDING_PROOF_TTL_MS = 2 * 60 * 60 * 1_000;

type GroundingPayload = {
  v: typeof PROOF_VERSION;
  venueIds: string[];
  operationDigest: string;
  issuedAt: number;
  expiresAt: number;
};

function canonicalVenueIds(values: readonly string[]): string[] | null {
  if (values.length < 3 || values.length > 100) return null;
  const ids = values.map((value) => value.trim());
  if (ids.some((value) => !value || value.length > VENUE_ID_MAX)) return null;
  return [...new Set(ids)].sort();
}

function signature(encodedPayload: string, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(`plan-grounding:v${PROOF_VERSION}:${encodedPayload}`)
    .digest();
}

function operationDigest(operationKey: string, key: Buffer): string {
  return createHmac("sha256", key)
    .update(`plan-grounding-operation:v${PROOF_VERSION}:${operationKey.trim()}`)
    .digest("hex");
}

export type PlanGroundingClaims = GroundingPayload;

/** Mint a signed proof that a set of venues came from server-side generation. */
export function mintPlanGroundingProof(
  venueIds: readonly string[],
  operationKey: string,
  now = Date.now(),
): string {
  const canonical = canonicalVenueIds(venueIds);
  if (!canonical || !operationKey.trim()) throw new Error("A grounding proof needs canonical venues and one create operation.");
  const key = trustedSigningKey();
  const payload: GroundingPayload = {
    v: PROOF_VERSION,
    venueIds: canonical,
    operationDigest: operationDigest(operationKey, key),
    issuedAt: now,
    expiresAt: now + PLAN_GROUNDING_PROOF_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, key).toString("base64url")}`;
}

/** Verify that three to six accepted stops were covered by a server-minted proof. */
export function readPlanGroundingClaims(
  proof: unknown,
  acceptedVenueIds: readonly string[],
  operationKey: string,
): PlanGroundingClaims | null {
  if (typeof proof !== "string" || !proof || proof.length > PROOF_MAX_LENGTH) return null;
  if (!operationKey.trim() || !isPlanStopCount(acceptedVenueIds.length) || new Set(acceptedVenueIds).size !== acceptedVenueIds.length) return null;
  const parts = proof.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const key = trustedSigningKey();
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0], key);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<GroundingPayload>;
    if (payload.v !== PROOF_VERSION || !Array.isArray(payload.venueIds)) return null;
    const allowed = canonicalVenueIds(payload.venueIds);
    if (!allowed || allowed.length !== payload.venueIds.length) return null;
    if (payload.operationDigest !== operationDigest(operationKey, key)) return null;
    if (typeof payload.issuedAt !== "number" || !Number.isSafeInteger(payload.issuedAt)
      || typeof payload.expiresAt !== "number" || !Number.isSafeInteger(payload.expiresAt)) return null;
    if (payload.expiresAt !== payload.issuedAt + PLAN_GROUNDING_PROOF_TTL_MS) return null;
    const allowedSet = new Set(allowed);
    return acceptedVenueIds.every((venueId) => allowedSet.has(venueId))
      ? payload as PlanGroundingClaims
      : null;
  } catch {
    return null;
  }
}

export function verifyPlanGroundingProof(
  proof: unknown,
  acceptedVenueIds: readonly string[],
  operationKey: string,
  now = Date.now(),
): boolean {
  const claims = readPlanGroundingClaims(proof, acceptedVenueIds, operationKey);
  return Boolean(claims && claims.issuedAt <= now && now <= claims.expiresAt);
}

/** Reconstruct the immutable create-time attribution on an idempotent replay. */
export function wasPlanGroundedAtCreation(
  proof: unknown,
  acceptedVenueIds: readonly string[],
  operationKey: string,
  createdAt: string,
): boolean {
  const claims = readPlanGroundingClaims(proof, acceptedVenueIds, operationKey);
  const createdAtMs = Date.parse(createdAt);
  return Boolean(
    claims
    && Number.isFinite(createdAtMs)
    && createdAtMs >= claims.issuedAt - 30_000
    && createdAtMs <= claims.expiresAt,
  );
}

/* ------------------------------------------------------------------ *
 * Grounding proof V2 - anchored, exact-order, one-or-three-to-six Stop.
 *
 * V1 above stays valid only for legacy unanchored route creation.
 * V2 binds the exact ordered Route, its approved alternatives, the anchor
 * Venue, and the acceptance source, so a client cannot reorder Stops, swap
 * the anchor, or forge an anchored outcome.
 * ------------------------------------------------------------------ */

export type PlanGroundingOutcome = "route" | "anchor-only";
export type PlanGroundingAnchorSource = PlanningIntentSource;

type GroundingPayloadV2 = {
  v: typeof PROOF_V2_VERSION;
  routeVenueIds: string[];
  allowedVenueIds: string[];
  anchorVenueId: string | null;
  anchorSource: PlanGroundingAnchorSource | null;
  outcome: PlanGroundingOutcome;
  operationDigest: string;
  issuedAt: number;
  expiresAt: number;
};

export type PlanGroundingClaimsV2 = GroundingPayloadV2;

export type MintPlanGroundingProofV2Input = {
  routeVenueIds: readonly string[];
  allowedVenueIds?: readonly string[];
  anchorVenueId: string | null;
  anchorSource: PlanGroundingAnchorSource | null;
  outcome: PlanGroundingOutcome;
  operationKey: string;
};

export type PlanGroundingRejectionV2 =
  | "missing"
  | "malformed"
  | "tampered"
  | "operation-mismatch"
  | "route-mismatch"
  | "expired";

export type PlanGroundingVerdictV2 =
  | {
      ok: true;
      outcome: PlanGroundingOutcome;
      anchored: boolean;
      anchorVenueId: string | null;
      anchorSource: PlanGroundingAnchorSource | null;
      routeVenueIds: string[];
      allowedVenueIds: string[];
      issuedAt: number;
      expiresAt: number;
    }
  | { ok: false; reason: PlanGroundingRejectionV2 };

function signatureV2(encodedPayload: string, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(`plan-grounding:v${PROOF_V2_VERSION}:${encodedPayload}`)
    .digest();
}

function operationDigestV2(operationKey: string, key: Buffer): string {
  return createHmac("sha256", key)
    .update(`plan-grounding-operation:v${PROOF_V2_VERSION}:${operationKey.trim()}`)
    .digest("hex");
}

function orderedVenueIds(values: readonly string[]): string[] | null {
  if (values.length !== 1 && !isPlanStopCount(values.length)) return null;
  const ids = values.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (ids.some((value) => !value || value.length > VENUE_ID_MAX)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}

function sortedAllowedVenueIds(
  values: readonly string[],
  routeVenueIds: readonly string[],
): string[] | null {
  const ids = values.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (ids.some((value) => !value || value.length > VENUE_ID_MAX)) return null;
  if (ids.length > 100) return null;
  const unique = [...new Set(ids)];
  // Every Stop the Route selected must remain inside the allowed set.
  if (!routeVenueIds.every((venueId) => unique.includes(venueId))) return null;
  return unique.sort();
}

function anchorIsConsistent(payload: {
  routeVenueIds: readonly string[];
  anchorVenueId: string | null;
  anchorSource: PlanGroundingAnchorSource | null;
  outcome: PlanGroundingOutcome;
}): boolean {
  const { routeVenueIds, anchorVenueId, anchorSource, outcome } = payload;
  if (outcome === "anchor-only") {
    // One grounded Stop is always its own anchor with a known source.
    return (
      routeVenueIds.length === 1
      && anchorVenueId !== null
      && anchorVenueId === routeVenueIds[0]
      && anchorSource !== null
    );
  }
  // outcome === "route"
  if (!isPlanStopCount(routeVenueIds.length)) return false;
  if (anchorVenueId === null) return anchorSource === null;
  return anchorVenueId === routeVenueIds[0] && anchorSource !== null;
}

/** Mint a signed V2 proof binding exact ordered Stops, allowed set, and anchor. */
export function mintPlanGroundingProofV2(
  input: MintPlanGroundingProofV2Input,
  now = Date.now(),
): string {
  const routeVenueIds = orderedVenueIds(input.routeVenueIds);
  if (!routeVenueIds || !input.operationKey.trim()) {
    throw new Error("A V2 grounding proof needs one or three to six ordered venues and a create operation.");
  }
  const allowedVenueIds = sortedAllowedVenueIds(
    input.allowedVenueIds ?? routeVenueIds,
    routeVenueIds,
  );
  if (!allowedVenueIds) {
    throw new Error("A V2 grounding proof needs an allowed set covering every Route Stop.");
  }
  const anchorSource = input.anchorSource === null
    || PLANNING_INTENT_SOURCES.includes(input.anchorSource)
    ? input.anchorSource
    : null;
  if (
    (input.outcome !== "route" && input.outcome !== "anchor-only")
    || !anchorIsConsistent({
      routeVenueIds,
      anchorVenueId: input.anchorVenueId,
      anchorSource,
      outcome: input.outcome,
    })
  ) {
    throw new Error("A V2 grounding proof needs a consistent anchor, source, and outcome.");
  }

  const key = trustedSigningKey();
  const payload: GroundingPayloadV2 = {
    v: PROOF_V2_VERSION,
    routeVenueIds,
    allowedVenueIds,
    anchorVenueId: input.anchorVenueId,
    anchorSource,
    outcome: input.outcome,
    operationDigest: operationDigestV2(input.operationKey, key),
    issuedAt: now,
    expiresAt: now + PLAN_GROUNDING_PROOF_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signatureV2(encoded, key).toString("base64url")}`;
}

/** Read signature-verified V2 claims without checking operation, order, or expiry. */
export function readPlanGroundingClaimsV2(proof: unknown): PlanGroundingClaimsV2 | null {
  if (typeof proof !== "string" || !proof || proof.length > PROOF_MAX_LENGTH) return null;
  const parts = proof.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const key = trustedSigningKey();
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signatureV2(parts[0], key);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as Partial<GroundingPayloadV2>;
    if (payload.v !== PROOF_V2_VERSION) return null;
    if (!Array.isArray(payload.routeVenueIds) || !Array.isArray(payload.allowedVenueIds)) return null;
    const routeVenueIds = orderedVenueIds(payload.routeVenueIds);
    if (!routeVenueIds || routeVenueIds.length !== payload.routeVenueIds.length) return null;
    const allowedVenueIds = sortedAllowedVenueIds(payload.allowedVenueIds, routeVenueIds);
    if (!allowedVenueIds || allowedVenueIds.length !== payload.allowedVenueIds.length) return null;
    if (payload.outcome !== "route" && payload.outcome !== "anchor-only") return null;
    const anchorVenueId = payload.anchorVenueId === null || typeof payload.anchorVenueId === "string"
      ? payload.anchorVenueId ?? null
      : undefined;
    if (anchorVenueId === undefined) return null;
    const anchorSource = payload.anchorSource === null
      ? null
      : PLANNING_INTENT_SOURCES.includes(payload.anchorSource as PlanningIntentSource)
        ? (payload.anchorSource as PlanGroundingAnchorSource)
        : undefined;
    if (anchorSource === undefined) return null;
    if (!anchorIsConsistent({ routeVenueIds, anchorVenueId, anchorSource, outcome: payload.outcome })) {
      return null;
    }
    if (typeof payload.operationDigest !== "string" || !payload.operationDigest) return null;
    if (
      typeof payload.issuedAt !== "number" || !Number.isSafeInteger(payload.issuedAt)
      || typeof payload.expiresAt !== "number" || !Number.isSafeInteger(payload.expiresAt)
    ) return null;
    if (payload.expiresAt !== payload.issuedAt + PLAN_GROUNDING_PROOF_TTL_MS) return null;
    return {
      v: PROOF_V2_VERSION,
      routeVenueIds,
      allowedVenueIds,
      anchorVenueId,
      anchorSource,
      outcome: payload.outcome,
      operationDigest: payload.operationDigest,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Verify a V2 proof against the exact ordered Stops a client is trying to lock.
 * The discriminated result lets a route map every failure onto an explicit 422,
 * while the store layer decides idempotent replay versus conflict from
 * `operationDigest` and the resolved outcome.
 */
export function verifyAnchoredPlanGroundingProofV2(
  proof: unknown,
  acceptedVenueIds: readonly string[],
  operationKey: string,
  now = Date.now(),
): PlanGroundingVerdictV2 {
  if (proof === null || proof === undefined || proof === "") return { ok: false, reason: "missing" };
  if (typeof proof !== "string" || proof.length > PROOF_MAX_LENGTH) return { ok: false, reason: "malformed" };
  if (!operationKey.trim()) return { ok: false, reason: "operation-mismatch" };

  const parts = proof.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };

  let key: Buffer;
  try {
    key = trustedSigningKey();
  } catch {
    return { ok: false, reason: "tampered" };
  }
  const supplied = Buffer.from(parts[1], "base64url");
  const expected = signatureV2(parts[0], key);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, reason: "tampered" };
  }

  const claims = readPlanGroundingClaimsV2(proof);
  if (!claims) return { ok: false, reason: "malformed" };
  if (claims.operationDigest !== operationDigestV2(operationKey, key)) {
    return { ok: false, reason: "operation-mismatch" };
  }
  if (!sameOrder(acceptedVenueIds, claims.routeVenueIds)) {
    return { ok: false, reason: "route-mismatch" };
  }
  if (!(claims.issuedAt <= now && now <= claims.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  const anchored = claims.anchorVenueId !== null && acceptedVenueIds[0] === claims.anchorVenueId;
  return {
    ok: true,
    outcome: claims.outcome,
    anchored,
    anchorVenueId: claims.anchorVenueId,
    anchorSource: claims.anchorSource,
    routeVenueIds: claims.routeVenueIds,
    allowedVenueIds: claims.allowedVenueIds,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  };
}
