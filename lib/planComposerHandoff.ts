import {
  arbitratePlanDrafts,
  type DraftArbitrationConflict,
  type DraftArbitrationProvenance,
  type DraftArbitrationUrl,
} from "@/lib/planDraftArbitration";
import type { ParsedPlanIntakeDraft } from "@/lib/planIntake";
import {
  PLAN_DRAFT_KEY,
  PLAN_DRAFT_V2_KEY,
  readPlanDraftEnvelope,
  writePlanDraftEnvelope,
  type ParsedPlanDraft,
  type StoredPlanDraft,
} from "@/lib/planDraft";
import {
  PLAN_ROUTE_DRAFT_KEY,
  PLAN_ROUTE_DRAFT_V2_KEY,
  readPlanRouteDraftEnvelope,
  writePlanRouteDraftEnvelope,
  type ParsedPlanRouteDraft,
} from "@/lib/planRouteDraft";
import {
  settlePlanningIntent,
  type PlanningIntentArea,
  type PlanningIntentSource,
  type PlanningIntentStorage,
  type PlanningIntentV1,
} from "@/lib/planningIntent";
import type { CityId } from "@/lib/cities";
import type { PlanTemplate } from "@/lib/planTemplates";
import type { RememberedArea } from "@/lib/nightPatches";

/**
 * L11 client glue between the L04 arbitration resolver and PlanComposer. It runs
 * arbitration BEFORE any product default is written, decides what accepted
 * context to show (so the composer never re-asks an already-answered area or
 * date), and keeps templates from silently overriding accepted geography. Every
 * function here is pure so the composer can compute hydration deterministically
 * across StrictMode double-invocation and duplicate tabs. The one exception is
 * `releaseAcceptedPlanContext`: releasing a held acceptance is an act, not a
 * derivation, so it writes.
 */

export type ComposerHydration = {
  /** True when persisted Plan context participates in this hydration. */
  active: boolean;
  /** Arbitration finished; the composer may now run its default-write effects. */
  defaultsMayWrite: boolean;
  title: string | null;
  creatorName: string | null;
  startsAt: string | null;
  acceptedVenueId: string | null;
  /**
   * The pub this composer is HOLDING as Stop 1, or null when it holds nothing.
   *
   * `acceptedVenueId` is not that question: arbitration also fills it from a
   * recovered Plan draft's own first stop (`plan-v2` / `plan-legacy`), which is
   * a pub the person routed to, never a pub they accepted. Everything that
   * refuses an edit - the Stop 1 lock, the route mutation, the stop rename -
   * reads THIS field, so a describe-first draft cannot silently lock its own
   * first stop and an acceptance that has lapsed cannot outlive itself.
   */
  heldVenueId: string | null;
  /** Acceptance source when the accepted Venue came from a trusted handoff. */
  acceptedSource: PlanningIntentSource | null;
  /** Exact accepted anchor for generation, when its source is known. */
  acceptedAnchor: {
    venueId: string;
    source: PlanningIntentSource;
    cityId: CityId | null;
    acceptedArea: PlanningIntentArea;
    startsAt: string | null;
    expiresAt: string | null;
  } | null;
  area: PlanningIntentArea;
  /** Show the accepted Venue/area/date summary before intake. */
  showAcceptedSummary: boolean;
  /** Area is already answered by acceptance/intake — do not re-ask it. */
  answeredArea: boolean;
  /** Date is already answered by acceptance/intake — do not re-ask it. */
  answeredDate: boolean;
  conflicts: DraftArbitrationConflict[];
  routePreview: ParsedPlanRouteDraft | null;
  routeProofPresent: boolean;
};

function isAcceptanceSource(source: DraftArbitrationProvenance): boolean {
  return source === "planning-intent"
    || source === "route-v2"
    || source === "route-legacy"
    || source === "explicit-url";
}

/** A field counts as "already answered" only when a real source, not a default, filled it. */
function isAnswered(source: DraftArbitrationProvenance): boolean {
  return source !== "default" && source !== "none";
}

export type ResolveComposerHydrationInput = {
  planDraft: ParsedPlanDraft | null;
  routeDraft: ParsedPlanRouteDraft | null;
  intakeDraft: ParsedPlanIntakeDraft | null;
  planningIntent: PlanningIntentV1 | null;
  rememberedArea: RememberedArea | null;
  url?: Partial<DraftArbitrationUrl> | null;
  lastAppliedOperationKey?: string | null;
};

export function resolveComposerHydration(input: ResolveComposerHydrationInput): ComposerHydration {
  const result = arbitratePlanDrafts({
    url: input.url ?? null,
    planDraft: input.planDraft,
    routeDraft: input.routeDraft,
    intakeDraft: input.intakeDraft,
    planningIntent: input.planningIntent,
    rememberedArea: input.rememberedArea,
    lastAppliedOperationKey: input.lastAppliedOperationKey,
  });

  const acceptedVenueId = result.acceptedVenueId.value;
  const draftAnchor = input.planDraft?.draft.acceptedAnchor?.venueId === acceptedVenueId
    ? input.planDraft.draft.acceptedAnchor
    : null;
  const acceptedSource = draftAnchor?.source ?? (result.acceptedVenueId.source === "planning-intent"
    ? input.planningIntent?.source ?? null
    : result.acceptedVenueId.source === "route-v2" || result.acceptedVenueId.source === "route-legacy"
      ? result.routePreview?.value.anchorSource ?? null
      : null);
  const acceptedAnchor = acceptedVenueId && acceptedSource
    ? draftAnchor ?? {
        venueId: acceptedVenueId,
        source: acceptedSource,
        cityId: result.acceptedVenueId.source === "planning-intent" && input.planningIntent
          ? input.planningIntent.cityId
          : null,
        acceptedArea: result.acceptedVenueId.source === "planning-intent" && input.planningIntent
          ? input.planningIntent.acceptedArea
          : result.area.value,
        startsAt: result.acceptedVenueId.source === "planning-intent" && input.planningIntent
          ? input.planningIntent.startsAt
          : result.startsAt.value,
        expiresAt: result.acceptedVenueId.source === "planning-intent" && input.planningIntent
          ? input.planningIntent.expiresAt
          : null,
      }
    : null;
  const heldVenueId = acceptedVenueId
    && (Boolean(draftAnchor) || isAcceptanceSource(result.acceptedVenueId.source))
    ? acceptedVenueId
    : null;
  const active = Boolean(
    input.planDraft
    || input.routeDraft
    || input.intakeDraft
    || input.planningIntent
    || acceptedVenueId,
  );
  return {
    active,
    defaultsMayWrite: result.hydration.defaultsMayWrite,
    title: result.title.source === "none" ? null : result.title.value,
    creatorName: result.creatorName.source === "none" ? null : result.creatorName.value,
    startsAt: result.startsAt.value,
    acceptedVenueId,
    heldVenueId,
    acceptedSource,
    acceptedAnchor,
    area: result.area.value,
    // Accepted context is visible for exactly the pub that is held, so the
    // panel, its release control and the Stop 1 lock cannot disagree.
    showAcceptedSummary: heldVenueId !== null,
    answeredArea: isAnswered(result.area.source),
    answeredDate: isAnswered(result.startsAt.source),
    conflicts: result.conflicts,
    routePreview: result.routePreview,
    routeProofPresent: result.routeProofPresent,
  };
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AcceptedContextStorages = {
  /** Where PlanningIntent lives. Defaults to this browser's own storage. */
  intent?: PlanningIntentStorage | null;
  /** The instant the drafts are read against. Defaults to now. */
  now?: number;
  /** The Plan draft envelope's storage (sessionStorage in the browser). */
  planDraft?: DraftStorage | null;
  /** The route draft's storage (localStorage in the browser). */
  routeDraft?: DraftStorage | null;
};

function bestEffortRemove(
  storage: Pick<Storage, "removeItem"> | null | undefined,
  key: string,
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // A denied storage must never block the way out of an acceptance.
  }
}

/**
 * Drop every persisted Plan draft this composer hydrates from.
 *
 * Both drafts are written under TWO keys, a canonical V2 and its V1 rollback
 * companion, and `readPlanDraftEnvelope` / `readPlanRouteDraftEnvelope` read
 * the V2 first. So a caller that removes one key of a pair has not cleared the
 * draft: the surviving half hydrates the same accepted Stop 1 back. One list,
 * one caller-visible act.
 */
export function clearPersistedPlanDrafts(
  storages: Pick<AcceptedContextStorages, "planDraft" | "routeDraft"> = {},
): void {
  bestEffortRemove(storages.planDraft, PLAN_DRAFT_KEY);
  bestEffortRemove(storages.planDraft, PLAN_DRAFT_V2_KEY);
  bestEffortRemove(storages.routeDraft, PLAN_ROUTE_DRAFT_KEY);
  bestEffortRemove(storages.routeDraft, PLAN_ROUTE_DRAFT_V2_KEY);
}

function dropPlanDraftAcceptance(
  storage: DraftStorage | null | undefined,
  now: number,
): void {
  if (!storage) return;
  try {
    const existing = readPlanDraftEnvelope(storage, now);
    if (!existing?.draft.acceptedAnchor) return;
    const withoutAcceptance: StoredPlanDraft = { ...existing.draft };
    delete withoutAcceptance.acceptedAnchor;
    if (!writePlanDraftEnvelope(withoutAcceptance, "manual", storage, now).v2) {
      bestEffortRemove(storage, PLAN_DRAFT_KEY);
      bestEffortRemove(storage, PLAN_DRAFT_V2_KEY);
    }
  } catch {
    // A denied storage must never block the way out of an acceptance.
  }
}

function dropRouteDraftAcceptance(
  storage: DraftStorage | null | undefined,
  now: number,
): void {
  if (!storage) return;
  try {
    const existing = readPlanRouteDraftEnvelope(storage, now);
    if (!existing?.value.anchorVenueId) return;
    const written = writePlanRouteDraftEnvelope({
      ...existing.value,
      anchorVenueId: null,
      anchorSource: null,
      outcome: "unanchored",
      groundingProof: null,
    }, "manual", storage, now);
    if (!written.v2) {
      bestEffortRemove(storage, PLAN_ROUTE_DRAFT_KEY);
      bestEffortRemove(storage, PLAN_ROUTE_DRAFT_V2_KEY);
    }
  } catch {
    // A denied storage must never block the way out of an acceptance.
  }
}

/**
 * Release a held acceptance: the pub stops being held, and the route stays.
 *
 * Releasing a HOLD is not discarding a ROUTE. Every Stop the person generated
 * stays exactly where it is, Stop 1 included - that row simply becomes as
 * editable as the others. What leaves with the hold is the anchor and the V2
 * grounding proof, because `POST /api/plans` refuses a proof with no anchor
 * (`PLAN_ANCHOR_REQUIRED`); a released night locks as an ordinary plan.
 *
 * What goes is the acceptance itself, and it lives in three places at once:
 * the PlanningIntent, the Plan draft's accepted anchor and the route draft's
 * anchored identity. All three go together, because dropping only the intent
 * would let the next hydration hold the same Stop 1 again, which is how
 * "released" would come back a moment later.
 */
export function releaseAcceptedPlanContext(
  storages: AcceptedContextStorages = {},
): void {
  settlePlanningIntent(
    "dismissed",
    storages.intent === undefined ? {} : { storage: storages.intent },
  );
  const now = storages.now ?? Date.now();
  dropPlanDraftAcceptance(storages.planDraft, now);
  dropRouteDraftAcceptance(storages.routeDraft, now);
}

export type ProvisionalStopSeed = {
  key: 1;
  venueId: string;
  venueName: string;
  alternatives: [];
};

type SeedStop = {
  venueId?: string | null;
  venueName?: string | null;
};

type SeedVenue = {
  id: string;
  name: string;
};

/**
 * What a surface calls the accepted Venue before the slim index has answered.
 * A raw id is never a name: `venue-uk-osm-123456` is what we call a row, and a
 * pin promoted out of the UK base layer is absent from the slim index for good,
 * so the id would have stood in that field permanently. Empty is the honest
 * value - the Stop input is the person's own to fill, and the resolve below
 * writes the real name the moment the index lands.
 */
export const UNRESOLVED_ACCEPTED_VENUE_NAME = "";

/** The neutral label a read-only summary prints while the name is unresolved. */
export const UNRESOLVED_ACCEPTED_VENUE_LABEL = "The pub you kept";

/**
 * Seed the accepted Venue as one editable Stop 1 only when no saved Route or
 * Plan stops exist. The Venue id remains the accepted id; the display name is
 * resolved from the loaded Venue index when available, and stays empty rather
 * than falling back to the id when it is not.
 */
export function seedProvisionalStop1(input: {
  acceptedVenueId: string | null | undefined;
  venues?: ReadonlyArray<SeedVenue> | null;
  recoveredRouteStops?: ReadonlyArray<SeedStop> | null;
  recoveredPlanStops?: ReadonlyArray<SeedStop> | null;
}): ProvisionalStopSeed | null {
  const venueId = typeof input.acceptedVenueId === "string"
    ? input.acceptedVenueId.trim()
    : "";
  if (!venueId) return null;
  if ((input.recoveredRouteStops?.length ?? 0) > 0 || (input.recoveredPlanStops?.length ?? 0) > 0) {
    return null;
  }
  const indexed = input.venues?.find((venue) => venue.id.trim() === venueId);
  const venueName = indexed?.name.trim() || UNRESOLVED_ACCEPTED_VENUE_NAME;
  return {
    key: 1,
    venueId,
    venueName,
    alternatives: [],
  };
}

/**
 * Locking maps the L09 server outcomes to honest recovery copy. 422 means the
 * V2 grounding proof was missing, tampered, route-mismatched, or expired; 409
 * means the same operation key was replayed with a changed payload.
 */
export function composerLockErrorFromResponse(status: number): string | null {
  if (status === 422) {
    return "Your route needs a refresh before you can lock it in. Rebuild the route and try again.";
  }
  if (status === 409) {
    return "This plan was already locked in from another tab. Reload it to keep going.";
  }
  return null;
}

export type AppliedTemplate = {
  title: string;
  conciergeQuery: string;
  /** When true the composer must not re-infer area from the seed query. */
  geographyLocked: boolean;
};

/**
 * Templates add mood/occasion context (title + concierge seed) but never
 * override accepted geography: when an area is already accepted, the composer
 * keeps it and does not re-derive one from the template's seed query text.
 */
export function applyTemplate(template: PlanTemplate, hasAcceptedGeography: boolean): AppliedTemplate {
  return {
    title: template.title,
    conciergeQuery: template.conciergeQuery,
    geographyLocked: hasAcceptedGeography,
  };
}

/** London service-time label for the accepted start, or null when unset/invalid. */
export function londonServiceDateLabel(startIso: string | null): string | null {
  if (!startIso) return null;
  const ms = Date.parse(startIso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
