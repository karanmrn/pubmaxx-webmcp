"use client";

import {
  FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
import PlanIntake from "@/components/plan/PlanIntake";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import PlanCultureOpener from "@/components/plan/PlanCultureOpener";
import { discardBody } from "@/lib/responseBody";
import { laneSourceFromSearch, trackEvent, trackMeaningfulCoreAction } from "@/lib/analytics";
import { ASK_PLAN_DRAFT_STORAGE_KEY, type AskPlanDraft } from "@/lib/ask/types";
import {
  parsePlanDescribeFromSearch,
  parsePlanHandoffQueryFromSearch,
  shouldAutoGeneratePalHandoffPlan,
} from "@/lib/planOccasion";
import { recordPlanNudgeTrigger } from "@/lib/identityNudge";
import { CREW_NAME_MAX, creatorNameFromAuthUser } from "@/lib/crew";
import { cleanCultureOpener, type CultureOpenerDTO } from "@/lib/cultureCrawl";
import { readLastCrew, subscribeLastCrew } from "@/lib/lastCrew";
import { getNightArea, isNightAreaRouteReady, NIGHT_AREAS, type NightArea } from "@/lib/nightAreas";
import { nearestNightPatch } from "@/lib/nearestNightPatch";
import {
  readRememberedArea,
  resolveNightPatch,
  type NightPatch,
} from "@/lib/nightPatches";
import { PLAN_TEMPLATES, type PlanTemplate } from "@/lib/planTemplates";
import {
  planVenueOptions,
  type PlanVenueOption,
} from "@/lib/planVenueOptions";
import { cleanNightContext, type NightContext } from "@/lib/nightPlanning";
import { CITIES, DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { isPlanStopCount, normalizePlanStopCount, PLAN_STOP_COUNTS, type PlanStopCount } from "@/lib/planStopCount";
import { planHasRoute, type PlanState } from "@/lib/plan";
import { parsePlanDraft, PLAN_DRAFT_KEY, readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { readPlanRouteDraftEnvelope } from "@/lib/planRouteDraft";
import {
  PLANNING_INTENT_SOURCES,
  readPlanningIntent,
  settlePlanningIntent,
  type PlanningIntentArea,
  type PlanningIntentSource,
} from "@/lib/planningIntent";
import {
  clearPersistedPlanDrafts,
  composerLockErrorFromResponse,
  londonServiceDateLabel,
  releaseAcceptedPlanContext,
  resolveComposerHydration,
  seedProvisionalStop1,
  UNRESOLVED_ACCEPTED_VENUE_LABEL,
  UNRESOLVED_ACCEPTED_VENUE_NAME,
  type ComposerHydration,
} from "@/lib/planComposerHandoff";
import {
  composerGeolocationMaySeedIntake,
  mergeSubmittedNightContext,
  mergePlanTemplateFields,
  nightAreaFromPlanQuery,
  reconcileGeneratedNightContext,
  syncPlanIntakeAreaFromQuery,
} from "@/lib/planComposerChipFill";
import { writePlanCapability } from "@/lib/planSessionCapability";
import { markPalRouteActivation } from "@/lib/pubPal";
import { clearPersistentPlanMutationKey, persistentPlanMutationKey } from "@/lib/planMutationKey";
import { writeDeviceNightContext } from "@/lib/nightProfileClient";
import { errorMessageFrom, readApiJson } from "@/lib/apiErrorMessage";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import {
  buildPlanGenerationIntakeBody,
  clearPlanIntakeDraft,
  canSeedPlanIntakeArea,
  createPlanIntakeDraft,
  londonDateTimeInputFromIso,
  londonDateTimeInputToIso,
  nightAreaForPlanIntakePatch,
  planIntakeHandoff,
  planIntakeNightContextPatch,
  readPlanIntakeDraft,
  readPlanIntakeDraftWithMetadata,
  reopenPlanIntakeStep,
  resolveFutureLondonStartIso,
  resolvePlanIntakeAreaSeed,
  skipRemainingPlanIntake,
  writePlanIntakeDraft,
  type PlanIntakeDraft,
} from "@/lib/planIntake";

export type RouteRevision = string | number;
export type RouteAlternative = { venueId: string; venueName: string };
export type DraftStop = {
  key: number;
  venueId: string;
  venueName: string;
  reason?: string;
  alternatives: RouteAlternative[];
};

export type ComposerRouteMutation = {
  accepted: boolean;
  stops: DraftStop[];
  groundingProof: string | null;
  createOperationKey: string | null;
  planAnchor: GeneratedPlanAnchor | null;
  routeStale: boolean;
};

export function composerRouteMutation(input: {
  currentStops: DraftStop[];
  nextStops: DraftStop[];
  heldVenueId?: string | null;
  groundingProof: string | null;
  createOperationKey: string | null;
  planAnchor: GeneratedPlanAnchor | null;
  routeStale: boolean;
}): ComposerRouteMutation {
  const heldVenueId = input.heldVenueId ?? null;
  if (heldVenueId && input.nextStops[0]?.venueId !== heldVenueId) {
    return {
      accepted: false,
      stops: input.currentStops,
      groundingProof: input.groundingProof,
      createOperationKey: input.createOperationKey,
      planAnchor: input.planAnchor,
      routeStale: input.routeStale,
    };
  }
  const identityChanged = input.currentStops.length !== input.nextStops.length
    || input.currentStops.some((stop, index) => stop.venueId !== input.nextStops[index]?.venueId);
  return {
    accepted: true,
    stops: input.nextStops,
    groundingProof: identityChanged ? null : input.groundingProof,
    createOperationKey: identityChanged ? null : input.createOperationKey,
    planAnchor: input.planAnchor,
    routeStale: identityChanged || input.routeStale,
  };
}

export function editedPlanStop(input: {
  stop: DraftStop;
  venueName: string;
  venues: readonly PlanVenueOption[];
  heldVenueId?: string | null;
}): { stop: DraftStop; preservesAcceptedAuthority: boolean } {
  const match = input.venues.find((venue) => venue.name.toLocaleLowerCase() === input.venueName.trim().toLocaleLowerCase());
  const accepted = input.stop.key === 1
    && Boolean(input.heldVenueId)
    && input.stop.venueId === input.heldVenueId;
  const preservesAcceptedAuthority = accepted && (!match || match.id === input.heldVenueId);
  return {
    stop: {
      ...input.stop,
      venueName: input.venueName,
      venueId: preservesAcceptedAuthority ? input.stop.venueId : match?.id ?? "",
      alternatives: [],
    },
    preservesAcceptedAuthority,
  };
}
export const PLAN_ROUTE_DRAFT_KEY = "pubmaxx:plan-route-draft:v1";

export type StoredRouteDraft = {
  stops: DraftStop[];
  nightContext: NightContext | null;
  routeRevision: RouteRevision | null;
  routeStale: boolean;
  groundingProof: string | null;
  createOperationKey: string | null;
  planAnchor: GeneratedPlanAnchor | null;
};

export type ServerPlanCreationAttribution = {
  created: boolean;
  grounded: boolean;
};

export type GeneratedPlanAnchor = {
  venueId: string;
  source: PlanningIntentSource;
  outcome: "route" | "anchor-only";
};

function cleanGeneratedPlanAnchor(value: unknown): GeneratedPlanAnchor | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { venueId?: unknown; source?: unknown; outcome?: unknown };
  const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
  if (!venueId || venueId.length > 128) return null;
  if (
    typeof row.source !== "string"
    || !(PLANNING_INTENT_SOURCES as readonly string[]).includes(row.source)
  ) return null;
  if (row.outcome !== "route" && row.outcome !== "anchor-only") return null;
  return {
    venueId,
    source: row.source as PlanningIntentSource,
    outcome: row.outcome,
  };
}

/** Read only explicit server-returned anchor metadata. */
export function generatedPlanAnchorFromResponse(value: unknown): GeneratedPlanAnchor | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    anchored?: unknown;
    anchorVenueId?: unknown;
    anchorSource?: unknown;
    outcome?: unknown;
  };
  if (row.anchored !== true) return null;
  return cleanGeneratedPlanAnchor({
    venueId: row.anchorVenueId,
    source: row.anchorSource,
    outcome: row.outcome,
  });
}

/** Validate attribution returned by POST /api/plans; never source it from draft storage. */
export function serverPlanCreationAttribution(value: unknown): ServerPlanCreationAttribution | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { created?: unknown; grounded?: unknown };
  if (typeof row.created !== "boolean" || typeof row.grounded !== "boolean") return null;
  return { created: row.created, grounded: row.grounded };
}

/** Rebuild the exact server-attributed event on originals and idempotent replays. */
export function planAcceptanceTelemetry(value: unknown, stops: number): { stops: number; grounded: boolean } | null {
  const attribution = serverPlanCreationAttribution(value);
  if (!attribution || !Number.isInteger(stops) || stops < 1 || stops > 50) return null;
  return { stops, grounded: attribution.grounded };
}

/** Rebuild the signed one-Stop save event from server attribution and the submitted anchor. */
export function planDraftSavedTelemetry(
  value: unknown,
  anchor: GeneratedPlanAnchor | null,
  stops: ReadonlyArray<{ venueId: string }>,
): {
  stops: 1;
  grounded: true;
  anchored: true;
  routeReady: false;
  source: PlanningIntentSource;
} | null {
  const attribution = serverPlanCreationAttribution(value);
  if (
    !attribution?.grounded
    || anchor?.outcome !== "anchor-only"
    || stops.length !== 1
    || stops[0]?.venueId !== anchor.venueId
  ) return null;
  return {
    stops: 1,
    grounded: true,
    anchored: true,
    routeReady: false,
    source: anchor.source,
  };
}

/** A created Plan consumes acceptance only when the accepted Venue remains Stop 1. */
export function planCreationConsumesPlanningIntent(
  intent: { acceptedVenueId: string } | null,
  stops: ReadonlyArray<{ venueId: string }>,
): boolean {
  return Boolean(intent && stops[0]?.venueId === intent.acceptedVenueId);
}

/**
 * A created Plan leaves draft the moment it really holds a route. The
 * describe-first journey carries no anchor at all, so its Stops are the only
 * evidence there is; a one-Stop anchor-only draft stays a draft.
 */
export function createdPlanNeedsReadyTransition(state: PlanState): boolean {
  return (state.plan.status ?? "draft") === "draft" && planHasRoute(state.plan, state.stops.length);
}

/**
 * What a just-created Plan still owes its own record, or null when it owes
 * nothing. Creation can come back without the Night Context it was given (the
 * store's context-free fallback while migration 0106 is unapplied), and this
 * is the only place that ever writes one, so a Plan that came back without it
 * gets it here rather than losing it for good.
 */
export function createdPlanMetadataPatch(
  state: PlanState,
  nightContext: NightContext | null,
): { status?: "ready"; context?: NightContext } | null {
  const needsReady = createdPlanNeedsReadyTransition(state);
  const needsContext = Boolean(nightContext) && !state.context;
  if (!needsReady && !needsContext) return null;
  return {
    ...(needsReady ? { status: "ready" as const } : {}),
    ...(nightContext ? { context: nightContext } : {}),
  };
}

function settleConsumedPlanningIntent(stops: ReadonlyArray<{ venueId: string }>): void {
  if (planCreationConsumesPlanningIntent(readPlanningIntent(), stops)) {
    settlePlanningIntent("plan-created");
  }
}

function responseEventToken(
  value: unknown,
  key: "planDraftSaved" | "planAccepted" | "meaningfulCoreAction",
): string | null {
  if (!value || typeof value !== "object") return null;
  const tokens = (value as { eventTokens?: unknown }).eventTokens;
  if (!tokens || typeof tokens !== "object") return null;
  const token = (tokens as Record<string, unknown>)[key];
  return typeof token === "string" && token.length <= 2_000 ? token : null;
}

/** Trust only the generator's explicit server-owned grounding assertion. */
export function isGroundedGeneratedRoute(value: unknown, stops: readonly DraftStop[]): boolean {
  if (
    !value
    || typeof value !== "object"
    || (value as { grounded?: unknown }).grounded !== true
    || typeof (value as { groundingProof?: unknown }).groundingProof !== "string"
    || !(value as { groundingProof: string }).groundingProof
  ) return false;
  if (isPlanStopCount(stops.length)) return true;
  const anchor = generatedPlanAnchorFromResponse(value);
  return Boolean(
    anchor?.outcome === "anchor-only"
    && stops.length === 1
    && stops[0]?.venueId === anchor.venueId,
  );
}

function cleanRouteRevision(value: unknown): RouteRevision | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return null;
}

/** Read the revision wherever the canonical PlanState places it. */
export function routeRevisionFromState(value: unknown): RouteRevision | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { routeRevision?: unknown; revision?: unknown; plan?: unknown };
  const direct = cleanRouteRevision(row.routeRevision ?? row.revision);
  if (direct !== null) return direct;
  if (row.plan && typeof row.plan === "object") {
    const plan = row.plan as { routeRevision?: unknown; revision?: unknown };
    return cleanRouteRevision(plan.routeRevision ?? plan.revision);
  }
  return null;
}

function cleanRouteAlternative(value: unknown): RouteAlternative | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { venueId?: unknown; venueName?: unknown; name?: unknown };
  const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
  const venueName = typeof row.venueName === "string"
    ? row.venueName.trim()
    : typeof row.name === "string" ? row.name.trim() : "";
  return venueId && venueName ? { venueId, venueName } : null;
}

function routeAlternatives(value: unknown): RouteAlternative[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const cleaned = cleanRouteAlternative(candidate);
    return cleaned ? [cleaned] : [];
  });
}

/** Keep the generator's alternatives attached to their stop for preview swaps. */
export function routeStopsFromGenerated(value: unknown, alternativePool?: unknown): DraftStop[] {
  if (!Array.isArray(value)) return [];
  const candidates = value.slice(0, 6);
  const currentVenueIds = new Set(candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as { venueId?: unknown };
    return typeof row.venueId === "string" && row.venueId.trim() ? [row.venueId.trim()] : [];
  }));
  const pool = routeAlternatives(alternativePool).filter((alternative, index, all) => (
    !currentVenueIds.has(alternative.venueId)
    && all.findIndex((candidate) => candidate.venueId === alternative.venueId) === index
  ));
  return candidates.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as {
      venueId?: unknown;
      venueName?: unknown;
      name?: unknown;
      reason?: unknown;
      alternatives?: unknown;
      options?: unknown;
    };
    const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
    const venueName = typeof row.venueName === "string"
      ? row.venueName.trim()
      : typeof row.name === "string" ? row.name.trim() : "";
    if (!venueId || !venueName) return [];
    const nested = routeAlternatives(row.alternatives ?? row.options);
    const alternatives = [...nested, ...pool].filter((alternative, alternativeIndex, all) => (
      !currentVenueIds.has(alternative.venueId)
      && all.findIndex((candidate) => candidate.venueId === alternative.venueId) === alternativeIndex
    ));
    return [{
      key: index + 1,
      venueId,
      venueName,
      ...(typeof row.reason === "string" && row.reason.trim() ? { reason: row.reason.trim() } : {}),
      alternatives,
    }];
  });
}

/** Cycle to the next grounded alternative and keep the old venue swappable. */
export function swapDraftStop(stop: DraftStop, excludedVenueIds: ReadonlySet<string> = new Set()): DraftStop {
  const nextIndex = stop.alternatives.findIndex((alternative) => !excludedVenueIds.has(alternative.venueId));
  if (nextIndex < 0) return stop;
  const next = stop.alternatives[nextIndex];
  const remaining = stop.alternatives.filter((_, index) => index !== nextIndex);
  if (!next) return stop;
  return {
    ...stop,
    venueId: next.venueId,
    venueName: next.venueName,
    alternatives: [
      ...remaining,
      { venueId: stop.venueId, venueName: stop.venueName },
    ],
  };
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function nightContextChanged(before: NightContext | null, after: NightContext | null): boolean {
  if (!before || !after) return before !== after;
  return before.nightArea !== after.nightArea
    || before.daypart !== after.daypart
    || before.partyType !== after.partyType
    || before.groupSize !== after.groupSize
    || before.budget !== after.budget
    || before.budgetLimitPence !== after.budgetLimitPence
    || before.zeroProof !== after.zeroProof
    || before.wetherspoonsPreferred !== after.wetherspoonsPreferred
    || normalizePlanStopCount(before.stopCount) !== normalizePlanStopCount(after.stopCount)
    || !sameList(before.atmosphere, after.atmosphere)
    || !sameList(before.foodNeeds, after.foodNeeds)
    || !sameList(before.accessibility, after.accessibility)
    || !sameList(before.transportConstraints, after.transportConstraints);
}

export function applyPlanStopCount(
  draft: PlanIntakeDraft,
  context: NightContext | null,
  stopCount: PlanStopCount,
): { draft: PlanIntakeDraft; context: NightContext | null } {
  return {
    draft: normalizePlanStopCount(draft.answers.stopCount) === stopCount
      ? draft
      : { ...draft, answers: { ...draft.answers, stopCount } },
    context: !context || normalizePlanStopCount(context.stopCount) === stopCount
      ? context
      : { ...context, stopCount },
  };
}

export function parsePlanRouteDraft(raw: string | null): StoredRouteDraft | null {
  if (!raw || raw.length > 30_000) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredRouteDraft>;
    const stops = routeStopsFromGenerated(value.stops);
    if (!stops.length) return null;
    return {
      stops,
      nightContext: cleanNightContext(value.nightContext) ?? null,
      routeRevision: cleanRouteRevision(value.routeRevision),
      routeStale: value.routeStale === true,
      groundingProof: typeof value.groundingProof === "string" && value.groundingProof.length <= 8_000
        ? value.groundingProof
        : null,
      createOperationKey: typeof value.createOperationKey === "string" && value.createOperationKey.length <= 120
        ? value.createOperationKey
        : null,
      planAnchor: cleanGeneratedPlanAnchor(value.planAnchor),
    };
  } catch {
    return null;
  }
}

export type NightAreaSelectorGroup = {
  label: "Crawl-ready" | "Not crawl-ready yet";
  disabled: boolean;
  areas: NightArea[];
};

export function nightAreaSelectorGroups(now = new Date()): NightAreaSelectorGroup[] {
  return [
    {
      label: "Crawl-ready",
      disabled: false,
      areas: NIGHT_AREAS.filter((area) => isNightAreaRouteReady(area, now)),
    },
    {
      label: "Not crawl-ready yet",
      disabled: false,
      areas: NIGHT_AREAS.filter((area) => !isNightAreaRouteReady(area, now)),
    },
  ];
}

export function nightAreaOptionLabel(area: NightArea, disabled: boolean): string {
  return disabled || !isNightAreaRouteReady(area) ? `${area.name} - not crawl-ready yet` : area.name;
}

export function nightAreaMapHref(area: NightArea): string {
  return `/map?q=${encodeURIComponent(area.name)}`;
}

export const PLAN_INTAKE_CONFLICT_SERVER =
  "Plan intake skipped steps conflict with supplied answers.";
export const PLAN_INTAKE_CONFLICT_READER =
  "The earlier route is still here - start again or keep it";
export const PLAN_INTAKE_CONFLICT_NO_ROUTE =
  "That answer clashed with an earlier step - start again from the first question";
export function releasedAcceptanceStatus(input: {
  venueName: string | null;
  routeStale: boolean;
  staleStatus?: string | null;
}): string {
  if (input.routeStale) {
    const stale = input.staleStatus?.trim();
    return stale || "The route needs refreshing before it can be locked.";
  }
  const pub = input.venueName?.trim() || "this pub";
  return `Released ${pub}. Stop 1 is yours to change.`;
}

export function errorMessageFromBody(body: unknown, fallback: string): string {
  // Concierge / plan generate scarcity must stay the server's sentence. Never
  // replace a grounded 422 with a softer invented route or a generic shrug.
  if (!body || typeof body !== "object") return errorMessageFrom(body, fallback);
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const structuredError = error as { code?: unknown; message?: unknown };
    if (
      structuredError.code === "NIGHT_AREA_ROUTE_NOT_READY" ||
      structuredError.code === "DISTRICT_ROUTE_NOT_READY"
    ) {
      const payload = body as {
        nightArea?: { id?: unknown };
        district?: { id?: unknown };
      };
      const areaId = payload.nightArea?.id ?? payload.district?.id;
      const area = NIGHT_AREAS.find((candidate) => candidate.slug === areaId);
      const areaName = area?.name ?? "This area";
      return `${areaName} is not ready for route planning yet. We're still checking this area before planning a crawl. Choose another area to continue.`;
    }
    if (
      structuredError.code === "PLAN_INTAKE_MALFORMED"
      && structuredError.message === PLAN_INTAKE_CONFLICT_SERVER
    ) {
      return PLAN_INTAKE_CONFLICT_READER;
    }
  }
  const raw = errorMessageFrom(body, fallback);
  return raw === PLAN_INTAKE_CONFLICT_SERVER ? PLAN_INTAKE_CONFLICT_READER : raw;
}

/**
 * An anchor conflict answers HTTP 200 with no Stops, so the empty-route branch
 * would otherwise print "No venues matched that ask" over the server's own
 * sentence about the accepted pub. The server sentence is the only one that
 * names what is actually in the way, so it wins whenever the outcome says so.
 */
export function anchorConflictMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as { outcome?: unknown; message?: unknown };
  if (payload.outcome !== "anchor-conflict") return null;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  return message || "We could not build a route from that pub right now. Try a different pub.";
}

export function planGenerationFailureStatus(
  message: string,
  hasPreviousRoute: boolean,
): string {
  if (
    message === PLAN_INTAKE_CONFLICT_SERVER
    || message === PLAN_INTAKE_CONFLICT_READER
    || message === PLAN_INTAKE_CONFLICT_NO_ROUTE
  ) {
    return hasPreviousRoute ? PLAN_INTAKE_CONFLICT_READER : PLAN_INTAKE_CONFLICT_NO_ROUTE;
  }
  return hasPreviousRoute ? `The previous route is still here. ${message}` : message;
}

export function acceptedPlanAreaLabel(area: Exclude<PlanningIntentArea, null>): string {
  if (area.kind === "borough") return area.name;
  const slug = nightAreaForPlanIntakePatch(area.id);
  if (slug) return getNightArea(slug).name;
  return resolveNightPatch(area.id)?.label ?? area.id;
}

export function acceptedStop1SwapLabel(venueName: string): string {
  return `${venueName} is the accepted Stop 1. Swap is not available.`;
}

export function acceptedStop1RemoveLabel(venueName: string): string {
  return `${venueName} is the accepted Stop 1. Remove is not available.`;
}

export function planComposerShowsDescribeFirst(input: {
  heldVenueId: string | null;
  completed: boolean;
  entryMode: "describe" | "wizard";
}): boolean {
  return !input.heldVenueId && !input.completed && input.entryMode === "describe";
}

export function planComposerShowsIntake(input: {
  heldVenueId: string | null;
  completed: boolean;
  entryMode: "describe" | "wizard";
}): boolean {
  if (input.heldVenueId && !input.completed) return false;
  return input.completed || input.entryMode === "wizard";
}

export function focusPlanRouteStatus(root: ParentNode | Document = document): void {
  const status = root.querySelector("#plan-route-status");
  if (!(status instanceof HTMLElement)) return;
  status.tabIndex = -1;
  status.focus();
}

/** Reduced motion means no glide, never no move: the viewport still lands on
 *  the route, it just jumps there. */
export function planRouteRevealBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

/**
 * Take the reader to the route they asked for. On a phone a generated route
 * lands below the fold (the context editor sits between the ask and the
 * preview), so a chip tap looked like nothing happened. Scrolls the route
 * status to the top of the viewport and moves focus onto it, so the preview
 * is seen and announced without a manual scroll.
 */
export function revealPlanRouteStatus(
  root: ParentNode | Document = document,
  reducedMotion?: boolean,
): void {
  const status = root.querySelector("#plan-route-status");
  if (!(status instanceof HTMLElement)) return;
  const reduce =
    reducedMotion ??
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  status.scrollIntoView?.({ behavior: planRouteRevealBehavior(reduce), block: "start" });
  status.tabIndex = -1;
  status.focus({ preventScroll: true });
}

export type PlanLockValidationInput = {
  title: string;
  creatorName: string;
  startTime: string;
  completeStopCount: number;
  visibleStopCount: number;
  groundingProof?: string | null;
  singleStopVenueId?: string | null;
  planAnchor?: GeneratedPlanAnchor | null;
};

export function isMatchingAnchorOnlyPlan(input: {
  groundingProof?: string | null;
  completeStopCount: number;
  singleStopVenueId?: string | null;
  planAnchor?: GeneratedPlanAnchor | null;
}): boolean {
  return Boolean(
    input.groundingProof
    && input.completeStopCount === 1
    && input.singleStopVenueId
    && input.planAnchor?.outcome === "anchor-only"
    && input.planAnchor.venueId === input.singleStopVenueId,
  );
}

export function composerCreatePayload(input: {
  title: string;
  creatorName: string;
  startTime: string;
  cityId?: CityId | null;
  stops: ReadonlyArray<{ venueId: string; venueName: string }>;
  groundingProof?: string | null;
  planAnchor?: GeneratedPlanAnchor | null;
  context?: NightContext | null;
}): Record<string, unknown> {
  return {
    title: input.title,
    creatorName: input.creatorName,
    startTime: input.startTime,
    ...(input.cityId ? { cityId: input.cityId } : {}),
    stops: input.stops.map(({ venueId, venueName }) => ({ venueId, venueName })),
    ...(input.groundingProof ? { groundingProof: input.groundingProof } : {}),
    ...(input.planAnchor ? { anchor: input.planAnchor } : {}),
    ...(input.context ? { context: input.context } : {}),
  };
}

export function planComposerVenueIndexPath(cityId?: CityId | null): string {
  return CITIES[cityId ?? DEFAULT_CITY_ID].slimVenuesPath;
}

export function planLockValidationError({
  title,
  creatorName,
  startTime,
  completeStopCount,
  visibleStopCount,
  groundingProof = null,
  singleStopVenueId = null,
  planAnchor = null,
}: PlanLockValidationInput): { message: string; focus: "name" | null } | null {
  if (!title.trim()) {
    return { message: "Give this plan a title before locking it in.", focus: null };
  }
  if (completeStopCount !== visibleStopCount) {
    return { message: "Choose a venue for every visible stop.", focus: null };
  }
  const missingName = !creatorName.trim();
  const missingTime = !startTime;
  const missingStops = completeStopCount === 0;
  if (!missingName && !missingTime && !missingStops) {
    const generatedOneStop = Boolean(groundingProof) && completeStopCount === 1;
    if (
      generatedOneStop
      && !isMatchingAnchorOnlyPlan({
        groundingProof,
        completeStopCount,
        singleStopVenueId,
        planAnchor,
      })
    ) {
      return {
        message: "Sort this pub again before locking it in.",
        focus: null,
      };
    }
    return null;
  }
  if (missingName && !missingTime && !missingStops) {
    return { message: "Add your name.", focus: "name" };
  }
  return {
    message: "Add your name, a start time, and choose at least one venue from the list.",
    focus: missingName ? "name" : null,
  };
}

type NightAreaCoverageTone = "ready" | "review" | "capture" | "discovery" | "paused";

export type NightAreaCoverageSummary = {
  label: string;
  detail: string;
  tone: NightAreaCoverageTone;
};

const GATE_LABELS: Partial<Record<NightArea["missingEvidence"][number], string>> = {
  venue_density: "venue density",
  identity_conflict: "venue identity checks",
  opening_hours: "opening hours",
  price_coverage: "price coverage",
  amenity_coverage: "amenity coverage",
  transport_anchor: "a transport anchor",
  route_feasibility: "route feasibility",
  terminal_get_home: "the route home",
  terminal_food: "a food ending",
  stale_review: "a fresh review",
  unreviewed_source: "reviewed sources",
};

function formatGateCode(code: NightArea["missingEvidence"][number]): string {
  return GATE_LABELS[code] ?? code.replaceAll("_", " ");
}

export function nightAreaCoverageSummary(
  area: NightArea,
  now = new Date(),
): NightAreaCoverageSummary {
  if (isNightAreaRouteReady(area, now)) {
    return {
      label: "Route-ready",
      detail: "Crawls can be planned here now.",
      tone: "ready",
    };
  }

  const missing = area.missingEvidence.slice(0, 2).map(formatGateCode);
  const remaining = area.missingEvidence.length - missing.length;
  const missingEvidenceDetail = missing.length > 0
    ? `missing ${missing.join(" and ")}${remaining > 0 ? ` + ${remaining} more` : ""}.`
    : "We're still checking this area before route planning opens.";

  switch (area.coverageStatus) {
    case "captured":
      return { label: "Not all checked", detail: `Some checks complete. ${missingEvidenceDetail[0]?.toUpperCase()}${missingEvidenceDetail.slice(1)}`, tone: "capture" };
    case "discovered":
      return { label: "Rough guess", detail: "We haven't checked this area yet. The route stays yours to change.", tone: "discovery" };
    case "reviewed":
      return { label: "Not all checked", detail: `Checked with gaps. ${missingEvidenceDetail[0]?.toUpperCase()}${missingEvidenceDetail.slice(1)}`, tone: "review" };
    case "paused":
      return { label: "Gone stale", detail: "Prices here have gone stale. You can still plan, but check each stop.", tone: "paused" };
    default:
      return { label: "Not all checked", detail: `Checks in progress. ${missingEvidenceDetail[0]?.toUpperCase()}${missingEvidenceDetail.slice(1)}`, tone: "review" };
  }
}

function formatCoverageDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

/** Keep the review window visible anywhere coverage is presented. */
export function nightAreaCoverageMeta(area: NightArea, now = new Date()): string {
  const reviewed = formatCoverageDate(area.lastReviewedAt);
  const expires = formatCoverageDate(area.reviewExpiresAt);
  if (!reviewed) return "Not checked yet.";
  if (!expires) return `Last checked ${reviewed}.`;
  const expiry = Date.parse(area.reviewExpiresAt ?? "");
  if (Number.isFinite(expiry) && expiry <= now.getTime()) {
    return `Last checked ${reviewed} · review expired ${expires}.`;
  }
  return `Last checked ${reviewed} · review through ${expires}.`;
}

function nextEvening(): string {
  const date = new Date();
  date.setMinutes(Math.ceil((date.getMinutes() + 15) / 15) * 15, 0, 0);
  if (date.getHours() < 17) date.setHours(18, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function unsupportedPatchForCurrentGenerator(
  draft: PlanIntakeDraft,
  contextPatch: Partial<NightContext>,
): NightPatch | null {
  if (!draft.answers.area || contextPatch.nightArea) return null;
  return resolveNightPatch(draft.answers.area);
}

function canSortPlan(
  query: string,
  contextPatch: Partial<NightContext>,
  currentContext: NightContext | null,
  unsupportedPatch: NightPatch | null,
): boolean {
  if (unsupportedPatch) return false;
  return [query.trim(), contextPatch.nightArea, currentContext].some(Boolean);
}

function conciergeStatusText(
  sorting: boolean,
  unsupportedPatch: NightPatch | null,
  note: string,
): string {
  if (sorting) return "Planning your outing, checking confidence and picking stops we can back up.";
  if (unsupportedPatch) {
    return `${unsupportedPatch.label} is saved. Exact Plan generation is not available for this patch yet. Pick another area to build the route now.`;
  }
  return note;
}

/**
 * L11 accepted-context panel: a summary of the Venue, area, and date the person
 * already accepted, plus any arbitration conflicts we resolved in their favour.
 * Rendered only when the handoff is active.
 *
 * The area and the date stay editable below, and the accepted pub does not:
 * while the acceptance is held, Stop 1 IS that pub, because the grounding proof
 * is about it. So the panel says exactly that, and carries the one way out.
 * Without the release control the acceptance could not be put down for the
 * whole PlanningIntent TTL, and the panel's own sentence said otherwise.
 */
export function AcceptedContextPanel({
  handoff,
  acceptedVenueName = null,
  onRelease,
}: {
  handoff: ComposerHydration;
  acceptedVenueName?: string | null;
  onRelease?: () => void;
}) {
  // Never the raw id: it is our name for a row, and a pin promoted out of the
  // UK base layer never reaches the slim index, so the id would have stood here
  // for good. A neutral label says the same true thing and reads as English.
  const venueName = acceptedVenueName ?? handoff.routePreview?.value.stops
    .find((stop) => stop.venueId === handoff.heldVenueId)?.venueName
    ?? UNRESOLVED_ACCEPTED_VENUE_LABEL;
  const whenLabel = londonServiceDateLabel(handoff.startsAt);
  return (
    <>
      {handoff.showAcceptedSummary && (
        <section className="planComposer__accepted" aria-label="Accepted plan context">
          <span className="planPage__eyebrow">Carried over from what you accepted</span>
          <dl className="planComposer__acceptedList">
            {handoff.heldVenueId && (
              <div><dt>Venue</dt><dd>{venueName}</dd></div>
            )}
            {handoff.area && (
              <div><dt>Area</dt><dd>{acceptedPlanAreaLabel(handoff.area)}</dd></div>
            )}
            {whenLabel && (
              <div><dt>When</dt><dd>{whenLabel}</dd></div>
            )}
          </dl>
          <p className="planComposer__acceptedNote">
            You can change the area and the date below. Stop 1 stays this pub until you release it. Releasing keeps every stop.
          </p>
          {onRelease && handoff.heldVenueId ? (
            <button
              className="planComposer__acceptedRelease"
              type="button"
              onClick={onRelease}
            >Release this pub</button>
          ) : null}
        </section>
      )}
      {handoff.conflicts.length > 0 && (
        <ul className="planComposer__conflicts" aria-label="Plan changes we kept safe">
          {handoff.conflicts.map((conflict, index) => (
            <li key={`${conflict.code}-${index}`}>{conflict.message}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The lock-failure banner. Copy for anchored 422 (proof invalid/expired) and 409
 * (replay-conflict) is mapped by composerLockErrorFromResponse before it reaches
 * `message`; this is the exact element the form renders it in.
 */
export function PlanComposerErrorNotice({ message }: { message: string }) {
  return <p className="planComposer__error" role="alert">{message}</p>;
}

type ComposerDraftFields = {
  title: string;
  creatorName: string;
  startTime: string | (() => string);
  conciergeQuery: string;
};

/**
 * Prefer arbitrated accepted context when the handoff is present. The ?? chain
 * keeps generic Plan values when no accepted context exists.
 * `startTime` keeps the bare `nextEvening` function reference (not a call) so
 * `useState` still lazily initialises it when neither source has a value.
 */
function initialComposerDraftFields(
  handoff: ComposerHydration | null,
  recoveredDraft: ReturnType<typeof parsePlanDraft>,
): ComposerDraftFields {
  return {
    title: handoff?.title ?? recoveredDraft?.title ?? "Tonight, sorted",
    creatorName: handoff?.creatorName ?? recoveredDraft?.creatorName ?? "",
    startTime: handoff?.startsAt ?? recoveredDraft?.startTime ?? nextEvening,
    conciergeQuery: recoveredDraft?.conciergeQuery ?? "",
  };
}

function initialComposerStops(
  recoveredRouteDraft: StoredRouteDraft | null,
  recoveredDraft: ReturnType<typeof parsePlanDraft>,
  handoff: ComposerHydration | null,
): DraftStop[] {
  const recoveredPlanStops = recoveredDraft?.stops.map((stop) => ({
      ...stop,
      alternatives: [],
    })) ?? [];
  if (recoveredRouteDraft?.stops.length) return recoveredRouteDraft.stops;
  if (recoveredPlanStops.length) return recoveredPlanStops;
  const provisional = seedProvisionalStop1({
    acceptedVenueId: handoff?.heldVenueId,
    recoveredRouteStops: recoveredRouteDraft?.stops,
    recoveredPlanStops,
  });
  return provisional ? [provisional] : [];
}

type ComposerRouteDraftFields = {
  nightContext: NightContext | null;
  routeRevision: RouteRevision | null;
  routeStale: boolean;
  groundingProof: string | null;
  createOperationKey: string | null;
  planAnchor: GeneratedPlanAnchor | null;
  routeStatus: string;
};

function initialComposerRouteDraft(
  recoveredRouteDraft: StoredRouteDraft | null,
): ComposerRouteDraftFields {
  return {
    nightContext: recoveredRouteDraft?.nightContext ?? null,
    routeRevision: recoveredRouteDraft?.routeRevision ?? null,
    routeStale: recoveredRouteDraft?.routeStale ?? false,
    groundingProof: recoveredRouteDraft?.groundingProof ?? null,
    createOperationKey: recoveredRouteDraft?.createOperationKey ?? null,
    planAnchor: recoveredRouteDraft?.planAnchor ?? null,
    routeStatus: recoveredRouteDraft
      ? recoveredRouteDraft.routeStale
        ? "Recovered a route that needs refreshing before it can be locked."
        : "Recovered your route preview. Nothing is published until you lock it in."
      : "",
  };
}


type UrlPrefill = {
  /** Any prefill the address carries: `occasion`, `describe` or `query`. */
  ask: string | null;
  /** The Pub Pal handoff `query` alone, which is the narrower question. */
  handoffAsk: string | null;
};

const NO_URL_PREFILL: UrlPrefill = { ask: null, handoffAsk: null };

/**
 * The ask a `/plan` URL carries, both the wide answer and the narrow one.
 *
 * Only read once the page can persist: the server knows no address, so a read
 * during the hydration render would paint a field the server left empty and
 * mismatch it. `PlanComposerForm` is remounted under a fresh key the moment
 * hydration lands. On a client-side navigation the render-phase read can still
 * see the previous route, so `PlanComposerForm` re-reads in `useLayoutEffect`
 * after the router commits the new address. Nothing but `window.location` is
 * touched.
 */
function describeAskFromLocation(): UrlPrefill {
  if (typeof window === "undefined") return NO_URL_PREFILL;
  try {
    const { search } = window.location;
    return {
      ask: parsePlanDescribeFromSearch(search),
      handoffAsk: parsePlanHandoffQueryFromSearch(search),
    };
  } catch {
    return NO_URL_PREFILL;
  }
}

// The form owns several independent draft and route transitions; keep this
// warning visible in reviews without turning its state machine into wrappers.
// eslint-disable-next-line complexity
function PlanComposerForm({
  recoveredDraft,
  recoveredRouteDraft,
  recoveredIntake,
  hasDurableIntakeDraft,
  handoff: hydratedHandoff,
  canPersist,
}: {
  recoveredDraft: ReturnType<typeof parsePlanDraft>;
  recoveredRouteDraft: StoredRouteDraft | null;
  recoveredIntake: PlanIntakeDraft;
  hasDurableIntakeDraft: boolean;
  handoff: ComposerHydration | null;
  canPersist: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const areaGroups = nightAreaSelectorGroups();
  const readyAreas = areaGroups[0]?.areas ?? [];
  const areasInProgress = areaGroups[1]?.areas ?? [];
  // Releasing the accepted pub retires the whole handoff for this composer, so
  // every reader of it below - the panel, the seeded Stop 1's protection, the
  // anchored generation body and the draft the effects persist - stops holding
  // an acceptance in the same beat.
  const [acceptanceReleased, setAcceptanceReleased] = useState(false);
  const handoff = acceptanceReleased ? null : hydratedHandoff;
  const heldVenueId = handoff?.heldVenueId ?? null;
  const draftFields = initialComposerDraftFields(handoff, recoveredDraft);
  const [title, setTitle] = useState(draftFields.title);
  const [creatorName, setCreatorName] = useState(draftFields.creatorName);
  const [startTime, setStartTime] = useState(draftFields.startTime);
  const [stops, setStops] = useState<DraftStop[]>(
    initialComposerStops(recoveredRouteDraft, recoveredDraft, handoff),
  );
  const [venues, setVenues] = useState<PlanVenueOption[]>([]);
  const pathname = usePathname();
  const [urlPrefill] = useState(() =>
    canPersist ? describeAskFromLocation() : NO_URL_PREFILL,
  );
  const urlAsk = urlPrefill.ask;
  // Describe-first is the default open. A returning visitor with real,
  // unfinished wizard progress lands back on the wizard instead, so their
  // answers so far are not hidden behind the question they already passed.
  // ONLY the Pub Pal handoff overrides that: it is a fresh ask the drinker
  // just chose, and describe-first is the only surface that can show it. A
  // chip link (`occasion`, `describe`) does not, so those keep the rule.
  const initialEntryMode: "describe" | "wizard" =
    hasDurableIntakeDraft && !recoveredIntake.completed && !urlPrefill.handoffAsk
      ? "wizard"
      : "describe";
  // A URL ask is never dropped in silence. Where describe-first cannot render
  // it - a held acceptance opens the full composer instead - it lands in that
  // surface's own field, and it WINS there: the drinker chose this ask just
  // now, where a recovered concierge line is whatever they left behind.
  const askNeedsConciergeField =
    Boolean(urlAsk)
    && !planComposerShowsDescribeFirst({
      heldVenueId,
      completed: recoveredIntake.completed,
      entryMode: initialEntryMode,
    });
  const [conciergeQuery, setConciergeQuery] = useState(
    (askNeedsConciergeField ? urlAsk ?? "" : "") || draftFields.conciergeQuery,
  );
  const [planIntake, setPlanIntake] = useState(recoveredIntake);
  const initialPlanIntakeRef = useRef(recoveredIntake);
  const [entryMode, setEntryMode] = useState<"describe" | "wizard">(initialEntryMode);
  const [askDraftQuery, setAskDraftQuery] = useState(urlAsk ?? "");
  const askDraftConsumedRef = useRef(false);
  // An ask the address carries is applied ONCE. This effect re-runs whenever
  // the surface it has to write into can change - releasing a held acceptance
  // flips `heldVenueId` - and a second application would overwrite whatever
  // the drinker has typed since with the line the URL opened on.
  const appliedUrlAskRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!canPersist) return;
    const fresh = describeAskFromLocation();
    if (!fresh.ask) return;
    if (appliedUrlAskRef.current === fresh.ask) return;
    const ask = fresh.ask;
    appliedUrlAskRef.current = ask;
    const opensDescribeFirstForHandoff =
      Boolean(fresh.handoffAsk) && hasDurableIntakeDraft && !recoveredIntake.completed;
    const entryForSurface: "describe" | "wizard" =
      hasDurableIntakeDraft && !recoveredIntake.completed && !fresh.handoffAsk
        ? "wizard"
        : "describe";
    const askNeedsConciergeSurface = !planComposerShowsDescribeFirst({
      heldVenueId,
      completed: recoveredIntake.completed,
      entryMode: entryForSurface,
    });
    // Deferred out of the effect body (react-hooks/set-state-in-effect). The
    // draft restore below is scheduled from a PASSIVE effect, so its microtask
    // is queued after this one and the URL ask still lands first.
    void Promise.resolve().then(() => {
      setAskDraftQuery(ask);
      if (opensDescribeFirstForHandoff) setEntryMode("describe");
      if (askNeedsConciergeSurface) setConciergeQuery(ask);
    });
  }, [canPersist, pathname, heldVenueId, recoveredIntake.completed, hasDurableIntakeDraft]);
  useEffect(() => {
    // The URL ask is already in state; this effect exists to SPEND the draft,
    // which is a storage write and so waits for a browser that can persist.
    if (!canPersist) return;
    if (askDraftConsumedRef.current) return;
    askDraftConsumedRef.current = true;
    void Promise.resolve().then(() => {
      try {
        // The ask draft is one-shot, so it is SPENT whichever prefill wins: a
        // URL that carries its own describe used to leave the draft behind for
        // the next /plan visit to open on somebody's earlier ask.
        let raw: string | null = null;
        try {
          const askDraftStore = safeSessionStorage();
          raw = askDraftStore?.getItem(ASK_PLAN_DRAFT_STORAGE_KEY) ?? null;
          if (raw) askDraftStore?.removeItem(ASK_PLAN_DRAFT_STORAGE_KEY);
        } catch {
          raw = null;
        }
        // The address is re-read HERE rather than closed over: this effect is
        // scheduled by the mount render, which on a client-side navigation
        // still saw the previous route, so a captured ask would read as none
        // and hand the field back to the draft the URL just beat.
        const askOnScreen = describeAskFromLocation().ask ?? appliedUrlAskRef.current;
        if (askOnScreen || !raw) return;
        const parsed = JSON.parse(raw) as AskPlanDraft;
        const query = typeof parsed?.query === "string" ? parsed.query.trim().slice(0, 500) : "";
        if (!query) return;
        setAskDraftQuery(query);
      } catch {
        /* private mode or bad JSON */
      }
    });
  }, [canPersist]);
  const palHandoffAutoGenerateStartedRef = useRef(false);
  // D3: a generated route must be SEEN. The reveal is requested by the
  // generation success path and runs in an effect, because on a describe-first
  // chip tap the route status element only mounts with the same commit that
  // carries the new stops.
  const [routeRevealTick, setRouteRevealTick] = useState(0);
  useEffect(() => {
    if (routeRevealTick === 0) return;
    revealPlanRouteStatus();
  }, [routeRevealTick]);

  const signedInCreatorNameSeededRef = useRef(false);
  useEffect(() => {
    if (!user || signedInCreatorNameSeededRef.current) return;
    signedInCreatorNameSeededRef.current = true;
    setCreatorName((current) => {
      if (current.trim()) return current;
      const seeded = creatorNameFromAuthUser(user);
      return seeded || current;
    });
  }, [user]);
  useEffect(() => {
    if (!canPersist) return;
    if (!shouldAutoGeneratePalHandoffPlan(urlPrefill.handoffAsk)) return;
    if (palHandoffAutoGenerateStartedRef.current) return;
    palHandoffAutoGenerateStartedRef.current = true;
    // Defer until the URL ask prefill lands in describe-first or the concierge field.
    void Promise.resolve().then(() => {
      const handoffAsk = describeAskFromLocation().handoffAsk ?? urlPrefill.handoffAsk;
      if (!handoffAsk?.trim()) return;
      submitFromEntry(
        handoffAsk.trim(),
        undefined,
        skipRemainingPlanIntake(createPlanIntakeDraft()),
      );
    });
    // submitFromEntry is intentionally excluded: it is recreated on render,
    // while this effect must run only when the URL handoff changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPersist, urlPrefill.handoffAsk]);
  const [conciergeNote, setConciergeNote] = useState("");
  const routeDraftFields = initialComposerRouteDraft(recoveredRouteDraft);
  const [nightContext, setNightContext] = useState<NightContext | null>(routeDraftFields.nightContext);
  const [explicitNightContext, setExplicitNightContext] = useState<Partial<NightContext>>({});
  const [routeRevision, setRouteRevision] = useState<RouteRevision | null>(routeDraftFields.routeRevision);
  const [routeStale, setRouteStale] = useState(routeDraftFields.routeStale);
  const [groundingProof, setGroundingProof] = useState(routeDraftFields.groundingProof);
  const [createOperationKey, setCreateOperationKey] = useState(routeDraftFields.createOperationKey);
  const [planAnchor, setPlanAnchor] = useState(routeDraftFields.planAnchor);
  const [sorting, setSorting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [routeStatus, setRouteStatus] = useState(routeDraftFields.routeStatus);
  // Culture Crawl opener for the CURRENT generated route only. It is never
  // saved with the plan: it is a thing to see beside the route, not a Stop.
  const [cultureOpener, setCultureOpener] = useState<CultureOpenerDTO | null>(null);
  const usualLot = useSyncExternalStore(subscribeLastCrew, readLastCrew, () => null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const completeStops = useMemo(
    () => stops.filter((stop) => stop.venueName.trim() && stop.venueId.trim()),
    [stops],
  );
  const conciergeIntake = useMemo(
    () => syncPlanIntakeAreaFromQuery(planIntake, conciergeQuery),
    [conciergeQuery, planIntake],
  );
  const intakeContextPatch = useMemo(
    () => planIntakeNightContextPatch(conciergeIntake),
    [conciergeIntake],
  );
  const unsupportedIntakePatch = unsupportedPatchForCurrentGenerator(conciergeIntake, intakeContextPatch);
  const queryUnsupportedPatch = useMemo(() => {
    const queryArea = nightAreaFromPlanQuery(conciergeQuery);
    return queryArea.kind === "unsupported-patch"
      ? resolveNightPatch(queryArea.patchId)
      : null;
  }, [conciergeQuery]);
  const activeUnsupportedPatch = unsupportedIntakePatch ?? queryUnsupportedPatch;
  const canSortWithCurrentGenerator = canSortPlan(
    conciergeQuery,
    intakeContextPatch,
    nightContext,
    activeUnsupportedPatch,
  );
  const conciergeStatus = conciergeStatusText(sorting, activeUnsupportedPatch, conciergeNote);
  const composerVisible =
    planIntake.completed
    || stops.length > 0
    || Boolean(recoveredDraft || recoveredRouteDraft || heldVenueId);
  // An unresolved Stop 1 carries an empty name on purpose, and an empty string
  // is not nullish, so it must be dropped here or the summary prints a blank
  // row instead of falling through to the neutral label.
  const acceptedVenueName = heldVenueId
    ? venues.find((venue) => venue.id === heldVenueId)?.name.trim()
      || stops.find((stop) => stop.venueId === heldVenueId)?.venueName.trim()
      || null
    : null;
  // The Venue index this composer reads, and the area seed below, are both
  // arrival-time reads of what was hydrated. They stay on the hydrated handoff
  // rather than the live one, so releasing the pub neither refetches an index
  // nor re-asks the browser for a location.
  const acceptedCityId = hydratedHandoff?.acceptedAnchor?.cityId ?? DEFAULT_CITY_ID;
  const completeStopIds = completeStops.map((stop) => stop.venueId);
  const matchingAnchorOnlyPlan = isMatchingAnchorOnlyPlan({
    groundingProof,
    completeStopCount: completeStops.length,
    singleStopVenueId: completeStops[0]?.venueId,
    planAnchor,
  });
  const startTimeIsValid = Boolean(
    resolveFutureLondonStartIso(
      startTime,
      planIntake.answers.exactStartIso,
      new Date(),
    ),
  );
  const lockValidation = planLockValidationError({
    title,
    creatorName,
    startTime,
    completeStopCount: completeStops.length,
    visibleStopCount: stops.length,
    groundingProof,
    singleStopVenueId: completeStops.length === 1 ? completeStops[0]?.venueId : null,
    planAnchor,
  });
  const canLockPlan =
    composerVisible &&
    !submitting &&
    !sorting &&
    !routeStale &&
    lockValidation === null &&
    startTimeIsValid &&
    new Set(completeStopIds).size === completeStopIds.length &&
    (
      !nightContext
      || matchingAnchorOnlyPlan
      || completeStops.length === normalizePlanStopCount(nightContext.stopCount)
    );

  useEffect(() => {
    let active = true;
    fetch(planComposerVenueIndexPath(acceptedCityId))
      .then((response) => response.json())
      .then((rows: unknown) => {
        if (!active) return;
        const nextVenues = planVenueOptions(rows);
        setVenues(nextVenues);
        const acceptedVenueId = hydratedHandoff?.heldVenueId;
        if (!acceptedVenueId) return;
        const accepted = nextVenues.find((venue) => venue.id === acceptedVenueId);
        if (!accepted) return;
        setStops((current) => current.map((stop, index) => (
          index === 0
          && stop.venueId === acceptedVenueId
          && stop.venueName.trim() === UNRESOLVED_ACCEPTED_VENUE_NAME
            ? { ...stop, venueName: accepted.name }
            : stop
        )));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [acceptedCityId, hydratedHandoff?.heldVenueId]);

  useEffect(() => {
    if (recoveredDraft) trackEvent("draft_recovered", { kind: "plan", surface: "plan" });
  }, [recoveredDraft]);

  useEffect(() => {
    if (!canPersist) return;
    const acceptedAnchor = handoff?.acceptedAnchor;
    const persistedAcceptedAnchor = acceptedAnchor?.expiresAt
      && stops[0]?.venueId === acceptedAnchor.venueId
      ? { ...acceptedAnchor, expiresAt: acceptedAnchor.expiresAt }
      : null;
    writePlanDraftEnvelope({
      title,
      creatorName,
      startTime,
      conciergeQuery,
      stops,
      ...(persistedAcceptedAnchor ? { acceptedAnchor: persistedAcceptedAnchor } : {}),
    }, persistedAcceptedAnchor ? "planning-intent" : "manual", safeSessionStorage());
  }, [canPersist, conciergeQuery, creatorName, handoff?.acceptedAnchor, startTime, stops, title]);

  useEffect(() => {
    if (!canPersist) return;
    if (!nightContext && routeRevision === null && !stops.some((stop) => stop.alternatives.length > 0)) return;
    try {
      safeLocalStorage()?.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({
        stops,
        nightContext,
        routeRevision,
        routeStale,
        groundingProof,
        createOperationKey,
        planAnchor,
      } satisfies StoredRouteDraft));
    } catch {
      // A blocked localStorage should not make the route editor unusable.
    }
  }, [canPersist, createOperationKey, groundingProof, nightContext, planAnchor, routeRevision, routeStale, stops]);

  useEffect(() => {
    if (planIntake === initialPlanIntakeRef.current) return;
    writePlanIntakeDraft(planIntake);
  }, [planIntake]);

  useEffect(() => {
    if (hasDurableIntakeDraft) return;
    let cancelled = false;
    function seedArea(patchId: string | null): void {
      const seed = resolvePlanIntakeAreaSeed(patchId, readRememberedArea());
      if (!seed) return;
      setPlanIntake((current) => {
        if (cancelled || !canSeedPlanIntakeArea(current)) return current;
        return createPlanIntakeDraft(seed);
      });
    }
    function seedRememberedSoon(): void {
      queueMicrotask(() => {
        if (!cancelled) seedArea(null);
      });
    }
    // L11: an accepted night-patch area answers the area step up front, so the
    // composer never re-asks a geography the person already accepted.
    if (hydratedHandoff?.area?.kind === "night-patch") {
      seedArea(hydratedHandoff.area.id);
      return () => { cancelled = true; };
    }
    if (!composerGeolocationMaySeedIntake({
      showsDescribeFirst: planComposerShowsDescribeFirst({
        heldVenueId,
        completed: planIntake.completed,
        entryMode,
      }),
      hasQueryText: Boolean(conciergeQuery.trim() || askDraftQuery.trim()),
    })) {
      return () => { cancelled = true; };
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      seedRememberedSoon();
      return () => { cancelled = true; };
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (cancelled) return;
        const patch = nearestNightPatch(coords.latitude, coords.longitude);
        seedArea(patch?.id ?? null);
      },
      () => seedRememberedSoon(),
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10_000 },
    );
    return () => { cancelled = true; };
  }, [
    hasDurableIntakeDraft,
    hydratedHandoff,
    heldVenueId,
    planIntake.completed,
    entryMode,
    conciergeQuery,
    askDraftQuery,
  ]);

  function updatePlanIntake(next: PlanIntakeDraft) {
    const reconciled = next.answers.stopCount === undefined
      ? { draft: next, context: nightContext }
      : applyPlanStopCount(next, nightContext, next.answers.stopCount);
    const answersChanged = JSON.stringify(planIntakeHandoff(planIntake))
      !== JSON.stringify(planIntakeHandoff(reconciled.draft));
    if (answersChanged && nightContext) {
      setRouteStale(true);
      setRouteStatus("Route needs refreshing after those planning details changed.");
    }
    const exactStartInput = next.answers.exactStartIso
      ? londonDateTimeInputFromIso(next.answers.exactStartIso)
      : null;
    if (exactStartInput) setStartTime(exactStartInput);
    // A step change through the wizard itself (including "Tune details"
    // reopening a settled step) always means the wizard is the active
    // surface, so the describe-first question never reappears mid-edit.
    if (!reconciled.draft.completed) setEntryMode("wizard");
    if (next.answers.stopCount !== undefined) {
      setExplicitNightContext((current) => ({ ...current, stopCount: next.answers.stopCount }));
      setNightContext(reconciled.context);
    }
    setPlanIntake(reconciled.draft);
  }

  function adoptDescribePrefillQuery(value: string) {
    setConciergeQuery((current) => {
      const next = value.trim();
      if (!next) return current;
      if (appliedUrlAskRef.current === next) return next;
      if (!current.trim()) return next;
      return current;
    });
  }

  function submitFromEntry(
    query: string,
    requestedStopCount?: PlanStopCount,
    intakeBase: PlanIntakeDraft = planIntake,
  ) {
    // Computed once and threaded through explicitly: setPlanIntake has not
    // re-rendered yet when sortWithConcierge runs below, so reading the
    // planIntake state variable here would still see the pre-skip draft and
    // send a body the server flags as PLAN_INTAKE_MALFORMED.
    const areaSynced = syncPlanIntakeAreaFromQuery(intakeBase, query);
    const skippedIntake = skipRemainingPlanIntake({
      ...areaSynced,
      answers: {
        ...areaSynced.answers,
        ...(requestedStopCount !== undefined ? { stopCount: requestedStopCount } : {}),
      },
    });
    setConciergeQuery(query);
    updatePlanIntake(skippedIntake);
    sortWithConcierge(
      query,
      skippedIntake,
      requestedStopCount === undefined ? undefined : { stopCount: requestedStopCount },
    );
  }

  function updatePlanStartTime(value: string) {
    setStartTime(value);
    const exactStartIso = londonDateTimeInputToIso(value, new Date());
    if (planIntake.answers.timeWindow) {
      const next = {
        ...planIntake,
        answers: { ...planIntake.answers, exactStartIso },
      };
      updatePlanIntake(exactStartIso ? next : reopenPlanIntakeStep(next, "time-window"));
      if (nightContext) {
        setRouteStale(true);
        setRouteStatus("Route needs refreshing after the exact start time changed.");
      }
      return;
    }
    if (nightContext) {
      setRouteStale(true);
      setRouteStatus("Route needs refreshing after the exact start time changed.");
    }
  }

  function applyStopIdentityMutation(nextStops: DraftStop[], status: string): boolean {
    const mutation = composerRouteMutation({
      currentStops: stops,
      nextStops,
      heldVenueId,
      groundingProof,
      createOperationKey,
      planAnchor,
      routeStale,
    });
    if (!mutation.accepted) {
      setRouteStatus("The accepted pub stays as Stop 1. Refresh the route to change the other stops.");
      return false;
    }
    setStops(mutation.stops);
    setGroundingProof(mutation.groundingProof);
    setCreateOperationKey(mutation.createOperationKey);
    setPlanAnchor(mutation.planAnchor);
    setRouteStale(mutation.routeStale);
    if (mutation.routeStale) setRouteStatus(status);
    return true;
  }

  function releaseAcceptance() {
    focusPlanRouteStatus();
    releaseAcceptedPlanContext({
      planDraft: canPersist ? safeSessionStorage() : null,
      routeDraft: canPersist ? safeLocalStorage() : null,
    });
    setPlanAnchor(null);
    setGroundingProof(null);
    setAcceptanceReleased(true);
    setRouteStatus(releasedAcceptanceStatus({
      venueName: acceptedVenueName,
      routeStale,
      staleStatus: routeStatus,
    }));
  }

  function chooseVenue(key: number, venueName: string) {
    const selected = stops.find((stop) => stop.key === key);
    if (!selected) return;
    const edited = editedPlanStop({ stop: selected, venueName, venues, heldVenueId });
    applyStopIdentityMutation(
      stops.map((stop) => stop.key === key ? edited.stop : stop),
      "Stop edited in the route preview. Refresh the route before locking.",
    );
  }

  function updateNightContext(patch: Partial<NightContext>) {
    if (!nightContext) return;
    const next = { ...nightContext, ...patch };
    if (nightContextChanged(nightContext, next)) {
      setRouteStale(true);
      setRouteStatus("Route needs refreshing after that context change.");
    }
    const reconciled = next.stopCount === undefined
      ? { draft: planIntake, context: next }
      : applyPlanStopCount(planIntake, next, next.stopCount);
    setNightContext(reconciled.context);
    setPlanIntake(reconciled.draft);
    setExplicitNightContext((current) => ({ ...current, ...patch }));
    if (!user) writeDeviceNightContext(reconciled.context ?? next);
  }

  function swapStop(key: number) {
    const current = stops.find((stop) => stop.key === key);
    if (!current?.alternatives.length) return;
    const usedByOtherStops = new Set(stops.filter((stop) => stop.key !== key).map((stop) => stop.venueId));
    const next = swapDraftStop(current, usedByOtherStops);
    if (next === current) {
      setRouteStatus("No other pub we can vouch for near that stop yet.");
      return;
    }
    applyStopIdentityMutation(
      stops.map((stop) => stop.key === key ? next : stop),
      `Stop ${stops.findIndex((stop) => stop.key === key) + 1} swapped to ${next.venueName}. Refresh the route before locking.`,
    );
  }

  async function sortWithConcierge(
    queryOverride?: string,
    intakeOverride?: PlanIntakeDraft,
    explicitContextOverride?: Partial<NightContext>,
  ) {
    // Both overrides (from the describe-first entry surface) are threaded
    // through explicitly before React re-renders, so state reads here cannot
    // send the pre-skip intake to the server.
    const query = queryOverride ?? conciergeQuery;
    const queryArea = nightAreaFromPlanQuery(query);
    const explicitContextBase = explicitContextOverride
      ? { ...explicitNightContext, ...explicitContextOverride }
      : explicitNightContext;
    const explicitContext = Object.prototype.hasOwnProperty.call(explicitContextBase, "nightArea")
      ? explicitContextBase
      : nightContext?.nightArea
        ? { ...explicitContextBase, nightArea: nightContext.nightArea }
        : explicitContextBase;
    if (queryArea.kind !== "none") {
      setExplicitNightContext((current) => ({
        ...current,
        nightArea: queryArea.kind === "unsupported-patch" ? null : queryArea.slug,
      }));
    }
    const intake = syncPlanIntakeAreaFromQuery(intakeOverride ?? planIntake, query);
    if (queryOverride === undefined && intake !== planIntake) {
      updatePlanIntake(intake);
    }
    const intakeContextForSort = planIntakeNightContextPatch(intake);
    const intakeUnsupportedPatch = unsupportedPatchForCurrentGenerator(
      intake,
      intakeContextForSort,
    );
    const queryUnsupportedPatchForSort =
      queryArea.kind === "unsupported-patch"
        ? resolveNightPatch(queryArea.patchId)
        : null;
    const blockedUnsupportedPatch = intakeUnsupportedPatch ?? queryUnsupportedPatchForSort;
    if (queryOverride === undefined && !canSortWithCurrentGenerator) return;
    if (blockedUnsupportedPatch) {
      setConciergeNote(conciergeStatusText(false, blockedUnsupportedPatch, ""));
      return;
    }
    const submittedContext = mergeSubmittedNightContext(
      explicitContext,
      intakeContextForSort,
      queryArea,
    );
    setSorting(true);
    setError("");
    setRouteStatus("Refreshing the route, rechecking every stop against your updated night.");
    try {
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPlanGenerationIntakeBody(
          intake,
          query,
          nightContext,
          submittedContext,
          handoff?.acceptedAnchor,
        )),
      });
      const body = await readApiJson(response) as {
        stops?: unknown;
        alternatives?: unknown;
        cultureOpener?: unknown;
        inferredContext?: NightContext;
        groundingProof?: unknown;
        operationKey?: unknown;
        anchored?: unknown;
        anchorVenueId?: unknown;
        anchorSource?: unknown;
        outcome?: unknown;
        message?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok) throw new Error(errorMessageFromBody(body, "PUBMAXX could not sort this one."));
      if (!body) throw new Error("PUBMAXX could not sort this one.");
      const anchorConflict = anchorConflictMessage(body);
      if (anchorConflict) {
        // Answered 200 with no Stops on purpose: the kept pub is what is in the
        // way, and only the server knows which check refused it.
        setConciergeNote(anchorConflict);
        return;
      }
      const suggested = routeStopsFromGenerated(body.stops, body.alternatives);
      if (!suggested.length) {
        // Zero matches is guidance, not failure (friction sweep follow-up 9):
        // the polite status slot, never the red error banner.
        setConciergeNote("No venues matched that ask. Try a nearby area or a broader mood.");
        return;
      }
      setStops(suggested);
      setCultureOpener(cleanCultureOpener(body.cultureOpener));
      const grounded = isGroundedGeneratedRoute(body, suggested);
      if (body.inferredContext) {
        const inferredContext = body.inferredContext as NightContext;
        const reconciled = reconcileGeneratedNightContext(
          inferredContext,
          submittedContext,
          suggested.length,
        );
        setNightContext(reconciled);
        if (!user) writeDeviceNightContext(reconciled);
      }
      setRouteRevision(routeRevisionFromState(body));
      setRouteStale(false);
      setGroundingProof(typeof body.groundingProof === "string" ? body.groundingProof : null);
      setCreateOperationKey(typeof body.operationKey === "string" ? body.operationKey : null);
      setPlanAnchor(generatedPlanAnchorFromResponse(body));
      markPalRouteActivation();
      trackEvent("plan_generated", { stops: suggested.length, grounded });
      setConciergeNote(`${suggested.length} stops we can stand behind, shaped by the outing you set below.`);
      setRouteStatus("Route refreshed. Review the preview, then lock it in when it feels right.");
      setRouteRevealTick((tick) => tick + 1);
      if (body.inferredContext) {
        trackEvent("night_description_submitted", { area: body.inferredContext.nightArea ?? "", daypart: body.inferredContext.daypart });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The concierge could not sort this one.";
      // planGenerationFailureStatus is the ONE owner of this sentence, so the
      // error notice cannot tell a reader with no route on screen that "the
      // earlier route is still here".
      const failureStatus = planGenerationFailureStatus(message, stops.length > 0);
      setError(failureStatus);
      setRouteStale(true);
      setRouteStatus(failureStatus);
    } finally {
      setSorting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = planLockValidationError({
      title,
      creatorName,
      startTime,
      completeStopCount: completeStops.length,
      visibleStopCount: stops.length,
      groundingProof,
      singleStopVenueId: completeStops.length === 1 ? completeStops[0]?.venueId : null,
      planAnchor,
    });
    if (validationError) {
      setError(validationError.message);
      if (validationError.focus === "name") nameInputRef.current?.focus();
      return;
    }
    if (new Set(completeStops.map((stop) => stop.venueId)).size !== completeStops.length) {
      setError("Choose distinct venues for every stop.");
      return;
    }
    if (
      nightContext
      && !matchingAnchorOnlyPlan
      && completeStops.length !== normalizePlanStopCount(nightContext.stopCount)
    ) {
      setError(`A generated crawl needs exactly ${normalizePlanStopCount(nightContext.stopCount)} stops we can stand behind before you lock it in.`);
      return;
    }
    if (routeStale) {
      setError("Refresh the route before locking it in. Your previous preview is still safe.");
      setRouteStatus("The route is still a preview because its context changed. Refresh it before locking.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const exactStartIso = resolveFutureLondonStartIso(
        startTime,
        planIntake.answers.exactStartIso,
        new Date(),
      );
      if (!exactStartIso) throw new Error("Choose a valid future London start time.");
      const createPayload = composerCreatePayload({
        title,
        creatorName,
        startTime: exactStartIso,
        cityId: acceptedCityId,
        stops: completeStops,
        groundingProof,
        planAnchor,
        context: nightContext,
      });
      const operationKey = createOperationKey ?? await persistentPlanMutationKey("create", createPayload);
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": operationKey },
        body: JSON.stringify(createPayload),
      });
      const body = await response.json();
      if (!response.ok || !body?.plan?.plan?.id) {
        // Surface anchored-lock failures honestly: 422 for invalid or expired
        // proof, and 409 for replay conflict.
        const mapped = hydratedHandoff ? composerLockErrorFromResponse(response.status) : null;
        throw new Error(mapped || errorMessageFrom(body, "The plan could not be created."));
      }
      const planId = body.plan.plan.id as string;
      const attribution = serverPlanCreationAttribution(body);
      if (!attribution) throw new Error("We could not check the route details. Reload the plan before continuing.");
      settleConsumedPlanningIntent(completeStops);
      const { grounded } = attribution;
      const acceptanceTelemetry = planAcceptanceTelemetry(body, completeStops.length);
      const draftSavedTelemetry = planDraftSavedTelemetry(body, planAnchor, completeStops);
      const draftSavedToken = responseEventToken(body, "planDraftSaved");
      const acceptedToken = responseEventToken(body, "planAccepted");
      const meaningfulToken = responseEventToken(body, "meaningfulCoreAction");
      if (draftSavedTelemetry && draftSavedToken) {
        trackEvent("plan_draft_saved", draftSavedTelemetry, { deliveryToken: draftSavedToken });
      }
      if (acceptanceTelemetry && acceptedToken && meaningfulToken) {
        trackEvent("plan_accepted", acceptanceTelemetry, { deliveryToken: acceptedToken });
        trackMeaningfulCoreAction("plan_accepted", meaningfulToken);
      }
      // lane_to_plan only counts creations with lane provenance (?src=…, set
      // by lane surfaces such as the W1 Tonight lane). window.location is read
      // at submit time — not via useSearchParams — so this client component
      // needs no Suspense boundary on the server-rendered /plan page. Without
      // a known src the event stays silent: honest zero > invented signal.
      const laneSource = laneSourceFromSearch(window.location.search);
      if (attribution.created && laneSource) {
        trackEvent("lane_to_plan", { source: laneSource, stops: completeStops.length });
      }
      if (attribution.created) trackEvent("plan_created", { count: completeStops.length });
      // First high-intent action → arm the signed-out account nudge (self-gates
      // on auth/cooldown; browsing was never gated). In the native shell this
      // wins over the push prompt, which defers via isIdentityNudgePending().
      if (attribution.created) recordPlanNudgeTrigger(planId);
      if (body.memberToken) {
        writePlanCapability(planId, { token: body.memberToken, collaborationAuthorized: true, role: "host" });
        const metadataPatch = createdPlanMetadataPatch(body.plan as PlanState, nightContext);
        if (metadataPatch) {
          const metadataResponse = await fetch(`/api/plans/${planId}`, {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${body.memberToken}`,
            },
            body: JSON.stringify(metadataPatch),
          });
          if (!metadataResponse.ok) {
            discardBody(metadataResponse);
            throw new Error("The route was created, but its details could not be saved. Try again.");
          }
        }
      }
      trackEvent("plan_saved", { stops: completeStops.length, grounded });
      trackMeaningfulCoreAction("plan_saved");
      clearPersistedPlanDrafts({ planDraft: safeSessionStorage(), routeDraft: safeLocalStorage() });
      clearPlanIntakeDraft();
      clearPersistentPlanMutationKey("create", operationKey);
      router.push(`/plan/${planId}#share`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The plan could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form id="plan-composer" className="planComposer" onSubmit={submit} noValidate>
      {handoff && (
        <AcceptedContextPanel
          handoff={handoff}
          acceptedVenueName={acceptedVenueName}
          onRelease={releaseAcceptance}
        />
      )}
      {planComposerShowsDescribeFirst({
        heldVenueId,
        completed: planIntake.completed,
        entryMode,
      }) ? (
        <PlanDescribeFirst
          initialQuery={askDraftQuery}
          onSubmit={submitFromEntry}
          onQueryChange={setConciergeQuery}
          onPrefillQueryChange={adoptDescribePrefillQuery}
          onGuideMeInstead={() => setEntryMode("wizard")}
        />
      ) : planComposerShowsIntake({
        heldVenueId,
        completed: planIntake.completed,
        entryMode,
      }) ? (
        <PlanIntake
          draft={planIntake}
          onChange={updatePlanIntake}
        />
      ) : null}
      {composerVisible ? (
        <>
      <section className="planComposer__concierge" aria-labelledby="plan-concierge-title" aria-busy={sorting}>
        <div>
          <span className="planPage__eyebrow">Describe your outing</span>
          <h2 id="plan-concierge-title">Say what you need. Get a route you can stand behind.</h2>
        </div>
        <div className="planComposer__conciergeInput">
          <label className="planComposer__srOnly" htmlFor="plan-concierge-query">Describe the outing</label>
          <input id="plan-concierge-query" aria-describedby="plan-concierge-status" value={conciergeQuery} onChange={(event) => setConciergeQuery(event.target.value)} placeholder="Add a mood, occasion or anything we missed" maxLength={500} />
          <button type="button" onClick={() => sortWithConcierge()} disabled={sorting || !canSortWithCurrentGenerator} aria-busy={sorting}>{sorting ? "Planning…" : "Make a plan"}</button>
        </div>
        <p id="plan-concierge-status" className="planComposer__conciergeStatus" role="status" aria-live="polite">
          {conciergeStatus}
        </p>
        {routeStale ? (
          <div className="planComposer__routeStale" role="group" aria-labelledby="plan-route-stale-title">
            <div>
              <strong id="plan-route-stale-title">This route needs a refresh</strong>
              <span>You&rsquo;ve changed the night since we sorted it, so this preview may not fit any more.</span>
            </div>
            <button
              type="button"
              className="planComposer__regenerate"
              onClick={() => sortWithConcierge()}
              disabled={sorting || !canSortWithCurrentGenerator}
              aria-busy={sorting}
            >
              {sorting ? "Refreshing…" : "Regenerate route"}
            </button>
          </div>
        ) : null}
        {nightContext ? (
          <fieldset className="planComposer__context">
            <legend>What PUBMAXX understood. Edit anything.</legend>
            <p id="plan-context-note" className="planComposer__contextNote">We only call an area crawl-ready when its prices are fresh and checked. An area that is not ready yet may not give a route.</p>
            <label htmlFor="plan-context-area">Area<select id="plan-context-area" aria-describedby="plan-context-note plan-route-status" value={nightContext.nightArea ?? ""} onChange={(event) => updateNightContext({ nightArea: event.target.value as NightContext["nightArea"] })}>
              {areaGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.areas.map((area) => (
                    <option key={area.slug} value={area.slug}>
                      {nightAreaOptionLabel(area, group.disabled)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select></label>
            <label htmlFor="plan-context-time">Time<select id="plan-context-time" aria-describedby="plan-route-status" value={nightContext.daypart} onChange={(event) => updateNightContext({ daypart: event.target.value as NightContext["daypart"] })}>
              <option value="daytime">Daytime</option><option value="after_work">After work</option><option value="evening">Evening</option><option value="late_night">Late night</option><option value="get_home">Get home</option>
            </select></label>
            <label htmlFor="plan-context-group">Group<select id="plan-context-group" aria-describedby="plan-route-status" value={nightContext.partyType} onChange={(event) => updateNightContext({ partyType: event.target.value as NightContext["partyType"] })}>
              <option value="solo">Solo</option><option value="friends">Friends</option><option value="work">Work</option>
            </select></label>
            <label htmlFor="plan-context-people">People<input id="plan-context-people" aria-describedby="plan-route-status" type="number" min="1" max="30" value={nightContext.groupSize ?? ""} onChange={(event) => updateNightContext({ groupSize: event.target.value ? Number(event.target.value) : null })} /></label>
            <label htmlFor="plan-context-stops">Stops<select id="plan-context-stops" aria-describedby="plan-route-status" value={normalizePlanStopCount(nightContext.stopCount)} onChange={(event) => updateNightContext({ stopCount: normalizePlanStopCount(Number(event.target.value)) })}>{PLAN_STOP_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
            <label htmlFor="plan-context-budget">Budget<select id="plan-context-budget" aria-describedby="plan-route-status" value={nightContext.budget} onChange={(event) => updateNightContext({ budget: event.target.value as NightContext["budget"] })}>
              <option value="value">Value</option><option value="standard">Standard</option><option value="treat">Treat</option>
            </select></label>
            <label htmlFor="plan-context-budget-limit">Max per person<input id="plan-context-budget-limit" aria-describedby="plan-route-status" type="number" inputMode="decimal" min="5" max="500" step="1" value={nightContext.budgetLimitPence === null ? "" : nightContext.budgetLimitPence / 100} onChange={(event) => updateNightContext({ budgetLimitPence: event.target.value ? Math.round(Number(event.target.value) * 100) : null })} /></label>
            <label htmlFor="plan-context-zero-proof">Drinks<select id="plan-context-zero-proof" aria-describedby="plan-route-status" value={nightContext.zeroProof ? "zero-proof" : "any"} onChange={(event) => updateNightContext({ zeroProof: event.target.value === "zero-proof" })}>
              {/* "0.0 options" read as broken number formatting, not as a drink.
                  The option names the drink the way the rest of the app does. */}
              <option value="any">Any drinks</option><option value="zero-proof">Alcohol-free</option>
            </select></label>
          </fieldset>
        ) : null}
      </section>
      <section className="planComposer__templates" aria-labelledby="plan-templates-title">
        <h2 id="plan-templates-title">Need a starting point?</h2>
        <p className="planComposer__templatesLead">
          Optional occasion prompts fill the description. Still editable.
        </p>
        {usualLot ? (
          <div className="planComposer__usualLot" data-testid="plan-usual-lot">
            <p>
              Usual lot: <strong>{usualLot.names.join(", ")}</strong>
            </p>
            <button
              type="button"
              className="planComposer__template"
              onClick={() => {
                setTitle("Usual lot · tonight");
                setConciergeNote(`Re-invite ${usualLot.names.join(", ")} after you lock it in.`);
              }}
            >
              Plan with the usual lot
            </button>
          </div>
        ) : null}
        <div className="planComposer__templateRow">
          {PLAN_TEMPLATES.map((template: PlanTemplate) => (
            <button
              key={template.id}
              type="button"
              className="planComposer__template"
              title={template.blurb}
              onClick={() => {
                const merged = mergePlanTemplateFields({
                  title,
                  conciergeQuery,
                  conciergeNote,
                  template,
                  hasAcceptedGeography: Boolean(
                    handoff?.answeredArea
                    || planIntake.answers.area
                    || nightContext?.nightArea
                    || explicitNightContext.nightArea,
                  ),
                });
                setTitle(merged.title);
                setConciergeQuery(merged.conciergeQuery);
                setConciergeNote(merged.conciergeNote);
              }}
            >
              {template.label}
            </button>
          ))}
        </div>
      </section>
      <section className="planComposer__coverage" aria-labelledby="plan-coverage-title">
        <details>
          <summary>
            <span id="plan-coverage-title">Area coverage</span>
            <span className="planComposer__coverageMeta">
              {readyAreas.length} of {readyAreas.length + areasInProgress.length} crawl-ready
            </span>
          </summary>
          <p className="planComposer__coverageIntro">
            We only call an area crawl-ready when its prices are fresh and checked. The rest are yours to browse.
          </p>
          <div className="planComposer__coverageGroups">
            <section aria-labelledby="plan-coverage-ready">
              <h3 id="plan-coverage-ready">Crawl-ready</h3>
              <ul>
                {readyAreas.map((area) => {
                  const summary = nightAreaCoverageSummary(area);
                  return (
                    <li key={area.slug} data-tone={summary.tone} data-coverage-status={area.coverageStatus}>
                      <div>
                        <strong>{area.name}</strong>
                        <small>{summary.detail}</small>
                        <small className="planComposer__coverageMetaLine">{nightAreaCoverageMeta(area)}</small>
                      </div>
                      <div className="planComposer__coverageActions">
                        <span>{summary.label}</span>
                        <Link className="planComposer__coverageMapLink" href={nightAreaMapHref(area)} aria-label={`Explore ${area.name} pubs on the map`}>Explore map</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section aria-labelledby="plan-coverage-progress">
              <h3 id="plan-coverage-progress">Not crawl-ready yet</h3>
              <ul>
                {areasInProgress.map((area) => {
                  const summary = nightAreaCoverageSummary(area);
                  return (
                    <li key={area.slug} data-tone={summary.tone} data-coverage-status={area.coverageStatus}>
                      <div>
                        <strong>{area.name}</strong>
                        <small>{summary.detail}</small>
                        <small className="planComposer__coverageMetaLine">{nightAreaCoverageMeta(area)}</small>
                      </div>
                      <div className="planComposer__coverageActions">
                        <span>{summary.label}</span>
                        <Link className="planComposer__coverageMapLink" href={nightAreaMapHref(area)} aria-label={`Explore ${area.name} pubs on the map`}>Explore map</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </details>
      </section>
      <div className="planComposer__field planComposer__field--wide">
        <label htmlFor="plan-title">Name the night</label>
        <input id="plan-title" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="planComposer__field">
        <label htmlFor="plan-name">Your name</label>
        <input id="plan-name" ref={nameInputRef} autoComplete="name" maxLength={CREW_NAME_MAX} required value={creatorName} onChange={(event) => setCreatorName(event.target.value)} placeholder="Karan" />
      </div>
      <div className="planComposer__field">
        <label htmlFor="plan-time">First pint</label>
        <input id="plan-time" type="datetime-local" required value={startTime} onChange={(event) => updatePlanStartTime(event.target.value)} />
      </div>

      <fieldset className="planComposer__stops">
        <legend>The crawl <span className="planComposer__previewLabel">{routeRevision === null ? "Preview" : `Preview · revision ${routeRevision}`}</span></legend>
        <p id="plan-route-status" className="planComposer__routeStatus" role="status" aria-live="polite" tabIndex={-1}>
          {routeStatus || (routeStale ? "The route needs refreshing before it can be locked." : "Review the route preview. It stays private until you lock it in.")}
        </p>
        <PlanCultureOpener opener={cultureOpener} />
        {stops.map((stop, index) => (
          <div className="planComposer__stop" key={stop.key}>
            <span className="planComposer__number" aria-hidden="true">{index + 1}</span>
            <div>
              <label htmlFor={`venue-name-${stop.key}`}>Venue name</label>
              <input id={`venue-name-${stop.key}`} list="plan-venue-options" value={stop.venueName} onChange={(event) => chooseVenue(stop.key, event.target.value)} placeholder="Start typing a pub" />
              {stop.reason ? <small className="planComposer__stopReason">{stop.reason}</small> : null}
            </div>
            <div className="planComposer__stopActions">
              <button
                className="planComposer__swap"
                type="button"
                onClick={() => swapStop(stop.key)}
                disabled={Boolean(
                  (index === 0 && heldVenueId === stop.venueId)
                  || stop.alternatives.length === 0
                )}
                aria-label={index === 0 && heldVenueId === stop.venueId
                  ? acceptedStop1SwapLabel(stop.venueName)
                  : stop.alternatives.length > 0
                    ? `Swap stop ${index + 1}, currently ${stop.venueName}`
                    : `No alternatives for stop ${index + 1}`}
              >
                Swap{stop.alternatives.length > 0 ? ` · ${stop.alternatives.length}` : ""}
              </button>
              {stops.length > 1 ? (
                <button
                  className="planComposer__remove"
                  type="button"
                  onClick={() => applyStopIdentityMutation(
                    stops.filter((item) => item.key !== stop.key),
                    `Stop ${index + 1} removed. Refresh the route before locking.`,
                  )}
                  disabled={index === 0 && heldVenueId === stop.venueId}
                  aria-label={index === 0 && heldVenueId === stop.venueId
                    ? acceptedStop1RemoveLabel(stop.venueName)
                    : `Remove stop ${index + 1}`}
                >Remove</button>
              ) : null}
            </div>
          </div>
        ))}
        <datalist id="plan-venue-options">
          {venues.map((venue) => <option key={venue.id} value={venue.name}>{venue.address}</option>)}
        </datalist>
        <button
          className="planComposer__add"
          type="button"
          disabled={stops.length >= 6}
          onClick={() => {
            if (stops.length >= 6) return;
            applyStopIdentityMutation(
              [...stops, { key: Math.max(0, ...stops.map((stop) => stop.key)) + 1, venueId: "", venueName: "", alternatives: [] }],
              "Stop added. Refresh the route before locking.",
            );
          }}
        >Add another stop</button>
      </fieldset>

      {error ? <PlanComposerErrorNotice message={error} /> : null}
      <button className="planComposer__submit" type="submit" disabled={!canLockPlan}>{submitting ? "Locking it in…" : "Lock it in"}</button>
      <p className="planComposer__trust">Anyone with the link can see the plan. Joining only asks for a name.</p>
        </>
      ) : null}
    </form>
  );
}

export default function PlanComposer() {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // L11: resolve persisted state through arbitration before the form writes a
  // product default. A generic Plan with no recovered context gets no panel.
  const handoff = useMemo<ComposerHydration | null>(() => {
    if (!hydrated) return null;
    try {
      const resolved = resolveComposerHydration({
        planDraft: readPlanDraftEnvelope(safeSessionStorage()),
        routeDraft: readPlanRouteDraftEnvelope(safeLocalStorage()),
        intakeDraft: readPlanIntakeDraftWithMetadata(),
        planningIntent: readPlanningIntent(),
        rememberedArea: readRememberedArea(),
      });
      return resolved.active ? resolved : null;
    } catch {
      return null;
    }
  }, [hydrated]);
  const recoveredDraft = useMemo(() => {
    if (!hydrated) return null;
    try { return parsePlanDraft(safeSessionStorage()?.getItem(PLAN_DRAFT_KEY) ?? null); } catch { return null; }
  }, [hydrated]);
  const recoveredRouteDraft = useMemo(() => {
    if (!hydrated) return null;
    try { return parsePlanRouteDraft(safeLocalStorage()?.getItem(PLAN_ROUTE_DRAFT_KEY) ?? null); } catch { return null; }
  }, [hydrated]);
  const recoveredIntake = useMemo(() => {
    if (!hydrated) return { draft: createPlanIntakeDraft(), hasDurableDraft: false };
    const durableDraft = readPlanIntakeDraft();
    return {
      draft: durableDraft ?? createPlanIntakeDraft(),
      hasDurableDraft: Boolean(durableDraft),
    };
  }, [hydrated]);
  return (
    <PlanComposerForm
      key={hydrated ? "hydrated" : "server"}
      recoveredDraft={recoveredDraft}
      recoveredRouteDraft={recoveredRouteDraft}
      recoveredIntake={recoveredIntake.draft}
      hasDurableIntakeDraft={recoveredIntake.hasDurableDraft}
      handoff={handoff}
      canPersist={hydrated}
    />
  );
}
