import type { CrewMemberDTO } from "@/lib/crew";
import { cleanText } from "@/lib/textClean";
import { cleanNightContext, type NightContext } from "@/lib/nightPlanning";
import { isPlanStopCount } from "@/lib/planStopCount";

export const PLAN_TITLE_MAX = 80;
export const PLAN_STOP_MAX = 8;
export const PLAN_VENUE_ID_MAX = 80;
export const PLAN_VENUE_NAME_MAX = 120;

/** The two grounded generation outcomes a Plan can be anchored on (§3.3). */
export const PLAN_OUTCOMES = ["route", "anchor-only"] as const;
export type PlanOutcome = (typeof PLAN_OUTCOMES)[number];

/** Acceptance sources that can anchor a Plan (the four browse-to-accept surfaces). */
export const PLAN_ANCHOR_SOURCES = ["near", "map-search", "tonight", "pal"] as const;
export type PlanAnchorSource = (typeof PLAN_ANCHOR_SOURCES)[number];

export type PlanAnchorMetadata = {
  venueId: string;
  source: PlanAnchorSource;
  outcome: PlanOutcome;
};

export type PlanDTO = {
  id: string;
  title: string;
  startTime: string;
  createdAt: string;
  /** Incremented only when the canonical ordered Crawl Route is replaced. Legacy records read as revision 1. */
  routeRevision?: number | string;
  /** Defaults to draft for legacy Plan records created before Planned Night lifecycle metadata. */
  status?: PlannedNightStatus;
  /** Accepted anchor Venue kept as Stop 1. Null for legacy/manual Plans. */
  anchorVenueId?: string | null;
  /** The acceptance source that anchored the Plan. Null for legacy/manual Plans. */
  anchorSource?: PlanAnchorSource | null;
  /** Grounded generation outcome; null for legacy/manual Plans. */
  outcome?: PlanOutcome | null;
  /** Set once, immutably, on the first grounded three-Stop transition. Null while a one-Stop draft. */
  routeReadyAt?: string | null;
};

/**
 * Server-derived route readiness. A Plan is route-ready only as a grounded
 * three-Stop route whose immutable routeReadyAt has been stamped — a one-Stop
 * anchor-only draft is never route-ready.
 */
export function planRouteReady(plan: PlanDTO, stopCount: number): boolean {
  return plan.outcome === "route" && typeof plan.routeReadyAt === "string" && Boolean(plan.routeReadyAt) && isPlanStopCount(stopCount);
}

/**
 * Does this Plan actually hold a Crawl Route? A grounded anchor-only draft
 * holds one accepted pub and no route; every other Plan carrying a valid Plan
 * stop count holds one, whether or not an anchor was ever involved. This is
 * the honest question a lifecycle transition and a privacy preview ask —
 * `planRouteReady` is the narrower question of whether the grounded lane
 * stamped its immutable `routeReadyAt`.
 */
export function planHasRoute(plan: PlanDTO, stopCount: number): boolean {
  if (plan.outcome === "anchor-only") return false;
  return isPlanStopCount(stopCount);
}

/** Validate optional anchor metadata supplied on Plan creation. */
export function cleanPlanAnchor(value: unknown): PlanAnchorMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const venueId = cleanText(row.venueId, PLAN_VENUE_ID_MAX);
  const source = (PLAN_ANCHOR_SOURCES as readonly unknown[]).includes(row.source) ? row.source as PlanAnchorSource : null;
  const outcome = (PLAN_OUTCOMES as readonly unknown[]).includes(row.outcome) ? row.outcome as PlanOutcome : null;
  if (!venueId || !source || !outcome) return null;
  return { venueId, source, outcome };
}

export const PLANNED_NIGHT_STATUSES = ["draft", "ready", "active", "ending", "completed", "abandoned"] as const;
export type PlannedNightStatus = (typeof PLANNED_NIGHT_STATUSES)[number];
export const CRAWL_ENDINGS = ["food", "get_home", "keep_going"] as const;
export type CrawlEnding = (typeof CRAWL_ENDINGS)[number];
export const PLAN_ACTION_TYPES = ["arrived", "skipped", "swapped", "ending"] as const;
export type PlanActionType = (typeof PLAN_ACTION_TYPES)[number];
export type PlanMemberRole = "host" | "guest";
export type PlanActionDTO = { id: string; type: PlanActionType; stopPosition: number | null; ending: CrawlEnding | null; createdAt: string };

export type EndingEvidenceSnapshot = {
  label: string;
  confidence: "high" | "medium" | "low" | "unknown";
  source?: string;
  observedAt?: string;
  warnings?: string[];
};

/**
 * The exact option a host confirmed at the end of a Plan. `terminalVenueId`
 * remains the final canonical pub for compatibility; this additive snapshot
 * preserves the selected food, transport, or extension instead of replacing
 * it with that pub id.
 */
type EndingSelectionBase = {
  optionId: string;
  evidenceSnapshot: EndingEvidenceSnapshot;
};

export type EndingSelection =
  | (EndingSelectionBase & { kind: "food"; externalPlaceId: string })
  | (EndingSelectionBase & { kind: "get_home" })
  | (EndingSelectionBase & { kind: "keep_going"; venueId: string });

const PLAN_TRANSITIONS: Record<PlannedNightStatus, readonly PlannedNightStatus[]> = {
  draft: ["ready", "abandoned"], ready: ["draft", "active", "abandoned"], active: ["ending", "completed", "abandoned"],
  ending: ["active", "completed", "abandoned"], completed: [], abandoned: [],
};

export function canTransitionPlannedNight(from: PlannedNightStatus, to: PlannedNightStatus): boolean {
  return from === to || PLAN_TRANSITIONS[from].includes(to);
}

export type PlanStopDTO = {
  venueId: string;
  venueName: string;
  position: number;
};

export type PlanState = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  crew: CrewMemberDTO[];
  context?: NightContext | null;
  actions?: PlanActionDTO[];
  ending?: CrawlEnding | null;
};

/** A share-safe completed Planned Night record. Member identifiers stay server-only. */
export type PlanQualifyingArrivalDTO = {
  actionId: string;
  stopPosition: number;
  arrivedAt: string;
};

export type PlanCompletionDTO = {
  id: string;
  planId: string;
  ending: CrawlEnding;
  terminalVenueId: string | null;
  endingSelection?: EndingSelection | null;
  finalPintDropId: string | null;
  routeRevision: number;
  routeSnapshot: PlanStopDTO[];
  /** Null only for legacy completion rows created before the v1 arrival gate. */
  qualifyingArrival: PlanQualifyingArrivalDTO | null;
  completedAt: string;
};

const ENDING_CONFIDENCE = ["high", "medium", "low", "unknown"] as const;

export function cleanEndingSelection(value: unknown, ending?: CrawlEnding): EndingSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const kind = (CRAWL_ENDINGS as readonly unknown[]).includes(row.kind)
    ? row.kind as CrawlEnding
    : null;
  if (!kind || (ending && kind !== ending)) return null;
  const optionId = cleanText(row.optionId, 120);
  const venueId = cleanText(row.venueId, PLAN_VENUE_ID_MAX);
  const externalPlaceId = cleanText(row.externalPlaceId, 120);
  const evidence = row.evidenceSnapshot && typeof row.evidenceSnapshot === "object" && !Array.isArray(row.evidenceSnapshot)
    ? row.evidenceSnapshot as Record<string, unknown>
    : null;
  const label = cleanText(evidence?.label, 160);
  const confidence = ENDING_CONFIDENCE.includes(evidence?.confidence as (typeof ENDING_CONFIDENCE)[number])
    ? evidence?.confidence as EndingEvidenceSnapshot["confidence"]
    : null;
  if (!optionId || !label || !confidence) return null;
  const source = cleanText(evidence?.source, 240);
  const observedAt = typeof evidence?.observedAt === "string" && Number.isFinite(Date.parse(evidence.observedAt))
    ? new Date(evidence.observedAt).toISOString()
    : undefined;
  const warnings = Array.isArray(evidence?.warnings)
    ? evidence.warnings.map((warning) => cleanText(warning, 200)).filter(Boolean).slice(0, 6)
    : [];
  const evidenceSnapshot: EndingEvidenceSnapshot = {
      label,
      confidence,
      ...(source ? { source } : {}),
      ...(observedAt ? { observedAt } : {}),
      ...(warnings.length ? { warnings } : {}),
  };
  if (kind === "food") return externalPlaceId ? { kind, optionId, externalPlaceId, evidenceSnapshot } : null;
  if (kind === "keep_going") return venueId ? { kind, optionId, venueId, evidenceSnapshot } : null;
  return { kind, optionId, evidenceSnapshot };
}

export type CreatePlanInput = {
  title?: unknown;
  startTime?: unknown;
  creatorName?: unknown;
  stops?: unknown;
  context?: unknown;
};

export type CleanPlanInput = {
  title: string;
  startTime: string;
  creatorName: string;
  stops: Array<{ venueId: string; venueName: string }>;
  context: NightContext | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPlanId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function cleanCreatePlan(input: CreatePlanInput): CleanPlanInput | null {
  const creatorName = cleanText(input.creatorName, 40);
  if (!creatorName || typeof input.startTime !== "string" || !Array.isArray(input.stops)) return null;
  const startMs = Date.parse(input.startTime);
  if (!Number.isFinite(startMs)) return null;
  if (input.stops.length < 1 || input.stops.length > PLAN_STOP_MAX) return null;
  const stops = input.stops.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      venueId: cleanText(row.venueId, PLAN_VENUE_ID_MAX),
      venueName: cleanText(row.venueName, PLAN_VENUE_NAME_MAX),
    };
  });
  if (stops.some((stop) => !stop.venueId || !stop.venueName)) return null;
  if (new Set(stops.map((stop) => stop.venueId)).size !== stops.length) return null;
  const context = input.context === undefined ? null : cleanNightContext(input.context);
  if (input.context !== undefined && !context) return null;
  return {
    title: cleanText(input.title, PLAN_TITLE_MAX) || "Tonight's Plan",
    startTime: new Date(startMs).toISOString(),
    creatorName,
    stops,
    context,
  };
}
