export const NIGHT_SIGNAL_SNAPSHOT_VERSION = 1 as const;

export const NIGHT_SIGNAL_KINDS = ["event", "price", "access", "opening", "transport"] as const;
export type NightSignalKind = (typeof NIGHT_SIGNAL_KINDS)[number];
export type NightSignalReviewState = "pending" | "approved" | "rejected";
export type NightSignalVerification = "single_source" | "corroborated" | "manual_review";
export type NightSignalRouteEffect = "none" | "boost" | "avoid";
export type NightSignalReviewAuthority = "operations" | "editorial" | "automated";

export type NightSignalEntity = {
  type: "venue" | "night_area" | "transport";
  id: string;
};

export type NightSignalSource = {
  sourceUrl: string;
  publisher: string;
  publishedAt: string;
};

/**
 * A scheduled, provenance-backed evidence claim. Route requests only consume
 * these reviewed snapshots; they never search a third party while a user waits.
 */
export type NightSignalClaim = NightSignalSource & {
  id: string;
  kind: NightSignalKind;
  entity: NightSignalEntity;
  claim: string;
  observedAt: string;
  expiresAt: string;
  confidence: number;
  reviewState: NightSignalReviewState;
  verification: NightSignalVerification;
  routeEffect: NightSignalRouteEffect;
  corroboratingSources: NightSignalSource[];
  reviewedAt: string | null;
  reviewAuthority: NightSignalReviewAuthority | null;
};

export type NightSignalSnapshot = {
  version: typeof NIGHT_SIGNAL_SNAPSHOT_VERSION;
  generatedAt: string;
  claims: NightSignalClaim[];
};

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value.trim()
    : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function httpUrl(value: unknown): string | null {
  const raw = text(value, 2_000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function source(value: unknown): NightSignalSource | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const sourceUrl = httpUrl(row.sourceUrl);
  const publisher = text(row.publisher, 160);
  const publishedAt = iso(row.publishedAt);
  return sourceUrl && publisher && publishedAt ? { sourceUrl, publisher, publishedAt } : null;
}

export function validateNightSignalClaim(value: unknown): NightSignalClaim | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id, 120);
  const claim = text(row.claim, 500);
  const primary = source(row);
  const observedAt = iso(row.observedAt);
  const expiresAt = iso(row.expiresAt);
  const reviewedAt = row.reviewedAt === null ? null : iso(row.reviewedAt);
  const reviewAuthority = row.reviewAuthority === null ? null
    : ["operations", "editorial", "automated"].includes(String(row.reviewAuthority))
      ? row.reviewAuthority as NightSignalReviewAuthority
      : null;
  const entityRow = row.entity && typeof row.entity === "object" ? row.entity as Record<string, unknown> : null;
  const entityType = entityRow?.type;
  const entityId = text(entityRow?.id, 120);
  const kind = NIGHT_SIGNAL_KINDS.includes(row.kind as NightSignalKind) ? row.kind as NightSignalKind : null;
  const reviewState = ["pending", "approved", "rejected"].includes(String(row.reviewState)) ? row.reviewState as NightSignalReviewState : null;
  const verification = ["single_source", "corroborated", "manual_review"].includes(String(row.verification)) ? row.verification as NightSignalVerification : null;
  const routeEffect = ["none", "boost", "avoid"].includes(String(row.routeEffect)) ? row.routeEffect as NightSignalRouteEffect : null;
  const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence) && row.confidence >= 0 && row.confidence <= 1 ? row.confidence : null;
  const corroboratingRows = Array.isArray(row.corroboratingSources) ? row.corroboratingSources : null;
  const parsedCorroboratingSources = corroboratingRows
    ? corroboratingRows.map(source).filter((item): item is NightSignalSource => item !== null)
    : [];
  const corroboratingSources = [...new Map(parsedCorroboratingSources.map((item) => [
    `${item.sourceUrl}|${item.publisher.toLocaleLowerCase("en-GB")}`,
    item,
  ])).values()];
  if (!id || !claim || !primary || !observedAt || !expiresAt || !entityId || !kind || !reviewState || !verification || !routeEffect || confidence === null) return null;
  if (!corroboratingRows || corroboratingRows.length > 5 || parsedCorroboratingSources.length !== corroboratingRows.length || corroboratingSources.length !== parsedCorroboratingSources.length) return null;
  if (entityType !== "venue" && entityType !== "night_area" && entityType !== "transport") return null;
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) return null;
  if (Date.parse(primary.publishedAt) > Date.parse(observedAt)) return null;
  if (corroboratingSources.some((item) => Date.parse(item.publishedAt) > Date.parse(observedAt))) return null;
  if (reviewState === "approved" && (!reviewedAt || !reviewAuthority)) return null;
  if (reviewedAt && Date.parse(reviewedAt) < Date.parse(observedAt)) return null;
  const independentCorroboration = corroboratingSources.some((item) =>
    new URL(item.sourceUrl).hostname !== new URL(primary.sourceUrl).hostname
      && item.publisher.toLocaleLowerCase("en-GB") !== primary.publisher.toLocaleLowerCase("en-GB"),
  );
  if (corroboratingSources.length > 0 && !independentCorroboration) return null;
  if (verification === "corroborated" && !independentCorroboration) return null;
  if (routeEffect !== "none" && verification === "single_source") return null;
  if (routeEffect !== "none" && verification === "manual_review" && reviewAuthority !== "operations" && reviewAuthority !== "editorial") return null;
  return {
    id, kind, entity: { type: entityType, id: entityId }, claim,
    ...primary, observedAt, expiresAt, confidence, reviewState, verification,
    routeEffect, corroboratingSources, reviewedAt, reviewAuthority,
  };
}

export function validateNightSignalSnapshot(value: unknown): NightSignalSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const generatedAt = iso(row.generatedAt);
  if (row.version !== NIGHT_SIGNAL_SNAPSHOT_VERSION || !generatedAt || !Array.isArray(row.claims)) return null;
  const claims = row.claims.map(validateNightSignalClaim);
  if (claims.some((claim) => claim === null)) return null;
  const safe = claims as NightSignalClaim[];
  if (new Set(safe.map((claim) => claim.id)).size !== safe.length) return null;
  if (safe.some((claim) => claim.reviewedAt && Date.parse(claim.reviewedAt) > Date.parse(generatedAt))) return null;
  return { version: NIGHT_SIGNAL_SNAPSHOT_VERSION, generatedAt, claims: safe };
}

export function activeNightSignalClaims(value: unknown, now = Date.now()): NightSignalClaim[] {
  const snapshot = validateNightSignalSnapshot(value);
  if (!snapshot || Date.parse(snapshot.generatedAt) > now) return [];
  return snapshot.claims.filter((claim) =>
    claim.reviewState === "approved"
      && Date.parse(claim.expiresAt) > now
      && Date.parse(claim.observedAt) <= now
      && Boolean(claim.reviewedAt && Date.parse(claim.reviewedAt) <= now),
  );
}

/** Material ranking changes need corroboration or an explicit human review. */
export function canAffectRoute(claim: NightSignalClaim): boolean {
  return claim.reviewState === "approved"
    && claim.routeEffect !== "none"
    && (claim.verification === "corroborated"
      || (claim.verification === "manual_review" && (claim.reviewAuthority === "operations" || claim.reviewAuthority === "editorial")));
}

export function claimsForEntity(claims: readonly NightSignalClaim[], type: NightSignalEntity["type"], id: string): NightSignalClaim[] {
  return claims.filter((claim) => claim.entity.type === type && claim.entity.id === id);
}
