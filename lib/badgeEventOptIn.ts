export const BADGE_EVENT_OPT_INS_STORAGE_KEY = "pubmax-badge-event-opt-ins";

export type BadgeEventOptInState = {
  optedInEventIds: string[];
  optedInAtByEventId: Record<string, string>;
};

const EMPTY_OPT_INS: BadgeEventOptInState = {
  optedInEventIds: [],
  optedInAtByEventId: {},
};

function isValidIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function allowedSet(allowedEventIds: Iterable<string>): Set<string> {
  const allowed = new Set<string>();
  for (const id of allowedEventIds) {
    const key = typeof id === "string" ? id.trim() : "";
    if (key) allowed.add(key);
  }
  return allowed;
}

export function parseBadgeEventOptIns(
  raw: string | null | undefined,
  allowedEventIds: Iterable<string>,
): BadgeEventOptInState {
  if (!raw) return EMPTY_OPT_INS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_OPT_INS;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY_OPT_INS;

  const allowed = allowedSet(allowedEventIds);
  const optedInAtByEventId: Record<string, string> = {};
  for (const [rawId, optedInAt] of Object.entries(parsed as Record<string, unknown>)) {
    const eventId = rawId.trim();
    if (!eventId || !allowed.has(eventId) || !isValidIsoTime(optedInAt)) continue;
    optedInAtByEventId[eventId] = optedInAt;
  }

  const optedInEventIds = Object.keys(optedInAtByEventId).sort();
  return { optedInEventIds, optedInAtByEventId };
}

export function addBadgeEventOptIn(
  raw: string | null | undefined,
  eventId: string,
  optedInAt: string | Date,
  allowedEventIds: Iterable<string>,
): { serialized: string; state: BadgeEventOptInState } {
  const key = eventId.trim();
  const allowed = allowedSet(allowedEventIds);
  const state = parseBadgeEventOptIns(raw, allowed);

  if (!key || !allowed.has(key)) {
    return { serialized: JSON.stringify(state.optedInAtByEventId), state };
  }

  const time = optedInAt instanceof Date ? optedInAt.getTime() : Date.parse(optedInAt);
  if (!Number.isFinite(time)) {
    return { serialized: JSON.stringify(state.optedInAtByEventId), state };
  }

  const nextOptedInAtByEventId = {
    ...state.optedInAtByEventId,
    [key]: state.optedInAtByEventId[key] ?? new Date(time).toISOString(),
  };
  const nextState = {
    optedInEventIds: Object.keys(nextOptedInAtByEventId).sort(),
    optedInAtByEventId: nextOptedInAtByEventId,
  };

  return {
    serialized: JSON.stringify(nextOptedInAtByEventId),
    state: nextState,
  };
}
