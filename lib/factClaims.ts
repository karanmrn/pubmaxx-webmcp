// Generic fact-claim conflict model (Wayfinder 3.3). Generalizes the
// corroboration/conflict shape of lib/nightSignalClaims.ts from night signals to
// ANY venue fact — prices and hours first — so one honest engine decides what a
// venue surface serves and, crucially, when it must NOT silently pick.
//
// A FactClaim<T> is one field's worth of evidence for a single VALUE: the value,
// the sources standing behind it (each with an authority class + observedAt),
// and a derived verification level + confidence. Several claims can exist for the
// same field (a scraped £6.40 and a freshly-vouched £6.90) — that is a conflict.
//
// resolveClaims() picks the serving value by a strict, documented order:
//
//     authority  >  freshness  >  corroboration  >  confidence
//
// and returns BOTH the winner AND any live conflict (disagreeing claims still in
// contention within a recency window). The house rule is non-negotiable: an
// unresolved conflict is EXPOSED, never hidden behind the winner. No IO, no
// Date.now() default — callers pass `now`, so the maths is hermetic and testable.

// Where a value came from, strongest first. `official` is the venue/operator's
// own current statement or a first-party licensed source; `scraped` is an
// on-record dataset/third-party observation; `community` is a user report or
// vouch; `operator` is a verified venue operator's REVIEWED proposal
// (correction/event/offer) materialised through the admin acceptance seam
// (lib/operatorProposals.ts, Wayfinder 3.5). It sits at the BOTTOM of the rank
// on purpose: an operator's accepted claim is attributed, additive evidence that
// must NEVER silently outrank the trusted observed corpus. A disagreement is
// EXPOSED as a live conflict, exactly as a declared-but-not-yet fact would be.
// Renamed from the reserved `operator-future` slot (#483): the only consumer was
// this module, so the token change is additive; the rank-0 semantics are unchanged.
export type FactAuthority = "official" | "scraped" | "community" | "operator";

export const FACT_AUTHORITY_RANK: Record<FactAuthority, number> = {
  official: 3,
  scraped: 2,
  community: 1,
  operator: 0,
};

// Mirrors nightSignalClaims' verification vocabulary. `corroborated` = two or
// more INDEPENDENT sources agree on the value; `manual_review` = a human stood
// behind it; `single_source` = one source, unreviewed. Ranked so more
// corroboration wins the third tiebreak (corroborated beats a lone human review
// beats a lone unreviewed source).
export type FactVerification = "single_source" | "corroborated" | "manual_review";

export const FACT_VERIFICATION_RANK: Record<FactVerification, number> = {
  corroborated: 2,
  manual_review: 1,
  single_source: 0,
};

// One source standing behind one value.
export type FactSource<T> = {
  authority: FactAuthority;
  value: T;
  /**
   * Epoch ms the source observed the value. Use 0 for an undated, standing
   * "on record" source (a dataset baseline with no observation date): it is
   * never counted as "recent", but still serves when it wins by authority.
   */
  observedAt: number;
  /** Stable identity used for independence (distinct authority|publisher). */
  publisher?: string;
  /** Per-source confidence in [0,1]. Absent → the neutral default (0.5). */
  confidence?: number;
  /** A human explicitly reviewed/stood behind this source. */
  reviewed?: boolean;
};

// One claim = one value, plus every source that agrees on it, with the
// verification level + confidence + freshness derived from those sources.
export type FactClaim<T> = {
  fieldId: string;
  value: T;
  sources: FactSource<T>[];
  /** Strongest authority among the backing sources. */
  authority: FactAuthority;
  /** Freshest observedAt among the backing sources. */
  observedAt: number;
  verification: FactVerification;
  /** Aggregate confidence: the strongest single backing (max source). */
  confidence: number;
};

// A live disagreement: two or more distinct values still in contention.
export type FactConflict<T> = {
  fieldId: string;
  /** Distinct live values, winner first. Always length >= 2. */
  values: T[];
  /** The live claims (winner + any recent disagreeing claim). */
  claims: FactClaim<T>[];
};

export type FactResolution<T> = {
  fieldId: string;
  /** The value served now, chosen by authority > freshness > corroboration > confidence. */
  winner: FactClaim<T>;
  /** A live conflict to expose, or null when the field resolves cleanly. */
  conflict: FactConflict<T> | null;
};

const DEFAULT_CONFIDENCE = 0.5;

function sourceConfidence(source: FactSource<unknown>): number {
  return typeof source.confidence === "number" && Number.isFinite(source.confidence)
    ? source.confidence
    : DEFAULT_CONFIDENCE;
}

// Two sources are independent when they differ in (authority, publisher). A
// scraped dataset row and a community vouch are independent; two vouches from the
// same community publisher are not.
function independentSourceCount<T>(sources: readonly FactSource<T>[]): number {
  const seen = new Set<string>();
  for (const s of sources) {
    seen.add(`${s.authority}|${s.publisher ?? ""}`);
  }
  return seen.size;
}

function deriveVerification<T>(sources: readonly FactSource<T>[]): FactVerification {
  if (independentSourceCount(sources) >= 2) return "corroborated";
  if (sources.some((s) => s.reviewed === true)) return "manual_review";
  return "single_source";
}

/**
 * Group sources by equal value into distinct FactClaims, deriving each claim's
 * authority, freshness, verification and confidence. `isEqual` defines value
 * identity (defaults to Object.is; the price adapter compares in pennies). Pure.
 */
export function buildFactClaims<T>(
  fieldId: string,
  sources: readonly FactSource<T>[],
  isEqual: (a: T, b: T) => boolean = Object.is,
): FactClaim<T>[] {
  const groups: FactSource<T>[][] = [];
  for (const source of sources) {
    const group = groups.find((g) => isEqual(g[0].value, source.value));
    if (group) group.push(source);
    else groups.push([source]);
  }
  return groups.map((group) => {
    let authority = group[0].authority;
    let observedAt = group[0].observedAt;
    let confidence = sourceConfidence(group[0]);
    for (const source of group) {
      if (FACT_AUTHORITY_RANK[source.authority] > FACT_AUTHORITY_RANK[authority]) {
        authority = source.authority;
      }
      if (source.observedAt > observedAt) observedAt = source.observedAt;
      const c = sourceConfidence(source);
      if (c > confidence) confidence = c;
    }
    return {
      fieldId,
      value: group[0].value,
      sources: group,
      authority,
      observedAt,
      verification: deriveVerification(group),
      confidence,
    };
  });
}

// Serving order, top to bottom: authority, then freshness, then corroboration,
// then confidence. Returns > 0 when `a` should serve over `b`. A claim with an
// undated (observedAt 0) source sorts oldest on the freshness axis.
function compareClaims<T>(a: FactClaim<T>, b: FactClaim<T>): number {
  const authority = FACT_AUTHORITY_RANK[a.authority] - FACT_AUTHORITY_RANK[b.authority];
  if (authority !== 0) return authority;
  if (a.observedAt !== b.observedAt) return a.observedAt - b.observedAt;
  const verification = FACT_VERIFICATION_RANK[a.verification] - FACT_VERIFICATION_RANK[b.verification];
  if (verification !== 0) return verification;
  return a.confidence - b.confidence;
}

export type ResolveOptions<T> = {
  now: number;
  /** A disagreement is "live" while a losing claim was observed within this window. */
  conflictWindowMs: number;
  isEqual?: (a: T, b: T) => boolean;
};

function isRecent(observedAt: number, now: number, windowMs: number): boolean {
  return observedAt > 0 && now - observedAt <= windowMs && observedAt <= now;
}

/**
 * Resolve competing claims for one field. Picks the winner by the documented
 * order and, separately, surfaces any live conflict: distinct values still in
 * contention, where "in contention" means the claim is the winner OR was
 * observed within `conflictWindowMs`. A stale disagreement (an old losing claim)
 * is history, not a live conflict, and resolves cleanly. Returns null only when
 * there are no claims at all.
 */
export function resolveClaims<T>(
  claims: readonly FactClaim<T>[],
  opts: ResolveOptions<T>,
): FactResolution<T> | null {
  if (claims.length === 0) return null;
  const isEqual = opts.isEqual ?? Object.is;

  // First claim wins ties (compareClaims returns 0), keeping resolution stable.
  let winner = claims[0];
  for (let i = 1; i < claims.length; i += 1) {
    if (compareClaims(claims[i], winner) > 0) winner = claims[i];
  }

  const live = claims.filter(
    (claim) => claim === winner || isRecent(claim.observedAt, opts.now, opts.conflictWindowMs),
  );

  // Distinct live values, winner first.
  const values: T[] = [winner.value];
  for (const claim of live) {
    if (!values.some((v) => isEqual(v, claim.value))) values.push(claim.value);
  }

  const conflict: FactConflict<T> | null =
    values.length >= 2 ? { fieldId: winner.fieldId, values, claims: live } : null;

  return { fieldId: winner.fieldId, winner, conflict };
}

/**
 * The ONE bridge that turns an admin-ACCEPTED operator proposal into a
 * `FactSource` (Wayfinder 3.5). Authority is `operator` — rank 0 — so the
 * materialised claim is attributed, reviewed evidence that a venue surface folds
 * into `buildFactClaims`/`resolveClaims` WITHOUT ever silently outranking the
 * trusted observed corpus; a disagreement surfaces as a conflict, never an
 * overwrite. `reviewed: true` records that a human (the owner/moderator) stood
 * behind it at acceptance. Pure: the caller supplies the value, the acceptance
 * time, and a stable publisher (e.g. `operator:<accountId>`). This lives here,
 * NOT in lib/operatorProposals.ts, so the proposal store stays free of any fact
 * import and the fence (proposal store cannot touch trusted data) holds by
 * construction — only the admin acceptance path reaches for this function.
 */
export function acceptedProposalFactSource<T>(input: {
  value: T;
  acceptedAt: number;
  publisher: string;
}): FactSource<T> {
  return {
    authority: "operator",
    value: input.value,
    observedAt: input.acceptedAt,
    publisher: input.publisher,
    reviewed: true,
  };
}
