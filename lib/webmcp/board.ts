import { MAX_PLAN_STOP_COUNT } from "@/lib/planStopCount";
import { transferGeneratedRouteToDraft } from "@/lib/mapRouteTransfer";
import {
  writePlanRouteDraftEnvelope,
  type PlanRouteDraftStorage,
} from "@/lib/planRouteDraft";

export type WebMcpEvidence = WebMcpJsonValue;

export type WebMcpRouteAlternative = {
  venueId: string;
  venueName: string;
};

export type WebMcpRouteStop = {
  key: number;
  venueId: string;
  venueName: string;
  reason?: string;
  alternatives: WebMcpRouteAlternative[];
};

export type WebMcpRoute = {
  stops: WebMcpRouteStop[];
  nightContext: WebMcpJsonValue;
  routeTotals: WebMcpJsonValue;
  planningConfidence: WebMcpJsonValue;
  warnings: string[];
  provenance: WebMcpJsonValue[];
  groundingProof: string | null;
  operationKey: string | null;
  routeStale: boolean;
  originalResponse: Record<string, WebMcpJsonValue> | null;
};

export type WebMcpBoard = {
  revision: number;
  route: WebMcpRoute | null;
  searchEvidence: WebMcpEvidence | null;
  contextEvidence: WebMcpEvidence | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, maximum = 500): string | null {
  return typeof value === "string" && value.trim() && value.length <= maximum
    ? value.trim()
    : null;
}

function isJsonSafe(value: unknown, seen = new Set<object>()): value is WebMcpJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const safe = Array.isArray(value)
    ? value.every((item) => isJsonSafe(item, seen))
    : Object.entries(value).every(([, item]) => isJsonSafe(item, seen));
  seen.delete(value);
  return safe;
}

function cloneJson<T extends WebMcpJsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseAlternative(value: unknown): WebMcpRouteAlternative | null {
  if (!isRecord(value)) return null;
  const venueId = text(value.venueId, 200);
  const venueName = text(value.venueName, 200);
  return venueId && venueName ? { venueId, venueName } : null;
}

function parseStop(value: unknown, key: number): WebMcpRouteStop | null {
  if (!isRecord(value) || !Array.isArray(value.alternatives) || value.alternatives.length > 24) {
    return null;
  }
  const venueId = text(value.venueId, 200);
  const venueName = text(value.venueName, 200);
  const reason = value.reason === undefined || value.reason === null
    ? null
    : text(value.reason, 500);
  const alternatives = value.alternatives.map(parseAlternative);
  if (!venueId || !venueName || (value.reason != null && !reason) || alternatives.some((item) => !item)) {
    return null;
  }
  const uniqueAlternatives = (alternatives as WebMcpRouteAlternative[]).filter(
    (candidate, index, all) => candidate.venueId !== venueId
      && all.findIndex((item) => item.venueId === candidate.venueId) === index,
  );
  return {
    key,
    venueId,
    venueName,
    ...(reason ? { reason } : {}),
    alternatives: uniqueAlternatives,
  };
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 24) return null;
  const values = value.map((item) => text(item, 500));
  return values.some((item) => item === null) ? null : values as string[];
}

export function parseWebMcpRouteResponse(value: unknown): WebMcpRoute | null {
  if (
    !isRecord(value)
    || !isJsonSafe(value)
    || value.grounded !== true
    || !Array.isArray(value.stops)
  ) return null;
  if (value.stops.length < 1 || value.stops.length > MAX_PLAN_STOP_COUNT) return null;

  const stops = value.stops.map((stop, index) => parseStop(stop, index + 1));
  if (stops.some((stop) => stop === null)) return null;
  const parsedStops = stops as WebMcpRouteStop[];
  if (new Set(parsedStops.map((stop) => stop.venueId)).size !== parsedStops.length) return null;

  const confidence = value.planningConfidence;
  if (confidence !== null && confidence !== undefined && !isRecord(confidence)) return null;
  const confidenceWarnings = isRecord(confidence) ? stringList(confidence.warnings) : [];
  const provenance = isRecord(confidence) && Array.isArray(confidence.provenance)
    && confidence.provenance.length <= 24
    && confidence.provenance.every((item) => isJsonSafe(item))
    ? confidence.provenance.map((item) => cloneJson(item as WebMcpJsonValue))
    : isRecord(confidence)
      ? null
      : [];
  if (confidenceWarnings === null || provenance === null) return null;

  const groundingProof = text(value.groundingProof, 4_096);
  const operationKey = text(value.operationKey, 500);
  if (!groundingProof || !operationKey) return null;

  const routeTotals = value.routeTotals === undefined ? null : cloneJson(value.routeTotals as WebMcpJsonValue);
  const nightContext = value.inferredContext === undefined
    ? null
    : cloneJson(value.inferredContext as WebMcpJsonValue);
  const planningConfidence = confidence === undefined ? null : cloneJson(confidence as WebMcpJsonValue);
  const originalResponse = cloneJson(value as Record<string, WebMcpJsonValue>);

  return {
    stops: parsedStops,
    nightContext,
    routeTotals,
    planningConfidence,
    warnings: confidenceWarnings ?? [],
    provenance: provenance ?? [],
    groundingProof,
    operationKey,
    routeStale: false,
    originalResponse,
  };
}

export function writeWebMcpRouteToPlanDraft(
  route: WebMcpRoute,
  storage: PlanRouteDraftStorage | null,
  now = Date.now(),
): boolean {
  if (!storage) return false;
  if (!route.routeStale && route.originalResponse) {
    return transferGeneratedRouteToDraft(route.originalResponse, storage, "plan-generated", now);
  }
  if (!route.routeStale) return false;
  return writePlanRouteDraftEnvelope({
    anchorVenueId: null,
    anchorSource: null,
    outcome: "unanchored",
    stops: route.stops.map((stop) => ({ ...stop })),
    alternatives: [],
    nightContext: route.nightContext as never,
    routeTotals: null,
    transportBasis: null,
    planningConfidence: null,
    warnings: [],
    groundingProof: null,
    operationKey: null,
    routeRevision: null,
    routeStale: true,
  }, "plan-generated", storage, now).v2;
}

export function createWebMcpBoard(): WebMcpBoard {
  return {
    revision: 0,
    route: null,
    searchEvidence: null,
    contextEvidence: null,
  };
}

export function publishWebMcpRoute(board: WebMcpBoard, response: unknown): WebMcpBoard {
  const route = parseWebMcpRouteResponse(response);
  return route ? { ...board, revision: board.revision + 1, route } : board;
}

export function retainWebMcpSearchEvidence(
  board: WebMcpBoard,
  evidence: WebMcpEvidence,
): WebMcpBoard {
  return isJsonSafe(evidence) ? { ...board, searchEvidence: cloneJson(evidence) } : board;
}

export function retainWebMcpContextEvidence(
  board: WebMcpBoard,
  evidence: WebMcpEvidence,
): WebMcpBoard {
  return isJsonSafe(evidence) ? { ...board, contextEvidence: cloneJson(evidence) } : board;
}

export function swapWebMcpBoardStop(board: WebMcpBoard, position: number): WebMcpBoard {
  if (!board.route || !Number.isInteger(position) || position < 1 || position > board.route.stops.length) {
    return board;
  }
  const stopIndex = position - 1;
  const previous = board.route.stops[stopIndex];
  const usedVenueIds = new Set(board.route.stops.map((stop) => stop.venueId));
  const alternativeIndex = previous.alternatives.findIndex(
    (alternative) => !usedVenueIds.has(alternative.venueId),
  );
  if (alternativeIndex < 0) return board;

  const selected = previous.alternatives[alternativeIndex];
  const remaining = previous.alternatives
    .slice(alternativeIndex + 1)
    .filter((alternative) => !usedVenueIds.has(alternative.venueId));
  const replacement: WebMcpRouteStop = {
    key: position,
    venueId: selected.venueId,
    venueName: selected.venueName,
    alternatives: [...remaining, { venueId: previous.venueId, venueName: previous.venueName }],
  };
  const stops = board.route.stops.map((stop, index) => index === stopIndex ? replacement : stop);

  return {
    ...board,
    revision: board.revision + 1,
    route: {
      ...board.route,
      stops,
      routeTotals: null,
      planningConfidence: null,
      warnings: [],
      provenance: [],
      groundingProof: null,
      operationKey: null,
      routeStale: true,
      originalResponse: null,
    },
  };
}

export type WebMcpMutationStale = {
  status: "stale";
  retryable: true;
  expectedRevision: number;
  currentRevision: number;
};

export type WebMcpMutationLease = {
  isCurrent: () => boolean;
  runSideEffect: <T>(sideEffect: () => T) => { applied: true; value: T } | { applied: false };
};

export function createWebMcpMutationArbiter(getRevision: () => number) {
  let queue: Promise<void> = Promise.resolve();
  let operationToken = 0;

  function stale(expectedRevision: number): WebMcpMutationStale {
    return {
      status: "stale",
      retryable: true,
      expectedRevision,
      currentRevision: getRevision(),
    };
  }

  return {
    run<T>(
      expectedRevision: number,
      action: (lease: WebMcpMutationLease) => Promise<T> | T,
    ): Promise<{ status: "completed"; value: T } | WebMcpMutationStale> {
      const execute = async () => {
        if (getRevision() !== expectedRevision) return stale(expectedRevision);
        const token = ++operationToken;
        let sideEffectRefused = false;
        let acceptedRevision = expectedRevision;
        const lease: WebMcpMutationLease = {
          isCurrent: () => token === operationToken && getRevision() === acceptedRevision,
          runSideEffect: (sideEffect) => {
            if (!lease.isCurrent()) {
              sideEffectRefused = true;
              return { applied: false };
            }
            const value = sideEffect();
            acceptedRevision = getRevision();
            return { applied: true, value };
          },
        };
        const value = await action(lease);
        if (sideEffectRefused || getRevision() !== acceptedRevision) {
          return stale(expectedRevision);
        }
        return { status: "completed" as const, value };
      };
      const result = queue.then(execute, execute);
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
