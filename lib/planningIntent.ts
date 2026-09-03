import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { CITIES, type CityId } from "@/lib/cities";
import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import { safeSessionStorage } from "@/lib/safeStorage";

export const PLANNING_INTENT_STORAGE_KEY = "pubmax:planning-intent:v1";
/**
 * A same-tab write raises no `storage` event, so a reader that only listened
 * for one kept the previous answer until a full page load. Every write and
 * every clear announces itself here instead, the way the device-identity lane
 * already does (lib/deviceAccountIdentity). Listeners are browser-only; the
 * event is a no-op on the server.
 */
export const PLANNING_INTENT_CHANGED_EVENT = "pubmax:planning-intent-changed";
export const PLANNING_INTENT_MAX_RAW_BYTES = 4 * 1024;
export const PLANNING_INTENT_TTL_MS = 2 * 60 * 60 * 1000;
export const PLANNING_INTENT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const PLANNING_INTENT_SOURCES = [
  "near",
  "map-search",
  "tonight",
  "pal",
] as const;

export const PLANNING_INTENT_EVIDENCE_KINDS = [
  "price",
  "whats-on",
  "directory",
  // A listing the Out lane carried (Ticketmaster, Skiddle, Common). It is dated
  // by that read, so it may not be recorded as a what's-on observation.
  "out-listing",
] as const;

export type PlanningIntentSource = (typeof PLANNING_INTENT_SOURCES)[number];
export type PlanningIntentEvidenceKind =
  (typeof PLANNING_INTENT_EVIDENCE_KINDS)[number];

export type PlanningIntentArea =
  | { kind: "night-patch"; id: NightPatchId }
  | { kind: "borough"; name: string }
  | null;

export type PlanningIntentV1 = {
  version: 1;
  source: PlanningIntentSource;
  cityId: CityId;
  acceptedVenueId: string;
  acceptedArea: PlanningIntentArea;
  startsAt: string | null;
  displayEvidence: {
    kind: PlanningIntentEvidenceKind;
    observedAt: string | null;
  };
  acceptedAt: string;
  expiresAt: string;
};

export type PlanningIntentInput = Omit<
  PlanningIntentV1,
  "version" | "acceptedAt" | "expiresAt"
>;

export type PlanningIntentStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type PlanningIntentDisposition =
  | "plan-created"
  | "plan-upgraded"
  | "dismissed"
  | "generation-failed";

export type PlanningIntentOptions = {
  storage?: PlanningIntentStorage | null;
  now?: number | (() => number);
  /** Set false for pure render snapshots that must not clean rejected bytes. */
  cleanupInvalid?: boolean;
};

const INTENT_KEYS = [
  "version",
  "source",
  "cityId",
  "acceptedVenueId",
  "acceptedArea",
  "startsAt",
  "displayEvidence",
  "acceptedAt",
  "expiresAt",
] as const;
const NIGHT_PATCH_AREA_KEYS = ["kind", "id"] as const;
const BOROUGH_AREA_KEYS = ["kind", "name"] as const;
const EVIDENCE_KEYS = ["kind", "observedAt"] as const;
const VENUE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function announcePlanningIntentChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(PLANNING_INTENT_CHANGED_EVENT));
  } catch {
    // A browser that refuses the dispatch still holds the written envelope;
    // only the live refresh is lost, and the next read still finds it.
  }
}

function currentTime(now: PlanningIntentOptions["now"]): number {
  return typeof now === "function" ? now() : now ?? Date.now();
}

function defaultStorage(): PlanningIntentStorage | null {
  return safeSessionStorage();
}

function selectedStorage(
  options: PlanningIntentOptions,
): PlanningIntentStorage | null {
  return options.storage === undefined ? defaultStorage() : options.storage;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isCityId(value: unknown): value is CityId {
  return typeof value === "string" && Object.hasOwn(CITIES, value);
}

function isNightPatchId(value: unknown): value is NightPatchId {
  return (
    typeof value === "string" &&
    NIGHT_PATCHES.some((patch) => patch.id === value)
  );
}

function isCanonicalBorough(value: unknown): value is string {
  return typeof value === "string" && LONDON_BOROUGHS.includes(value);
}

function parseArea(value: unknown): PlanningIntentArea | undefined {
  if (value === null) return null;
  if (!isPlainRecord(value)) return undefined;
  if (
    hasExactKeys(value, NIGHT_PATCH_AREA_KEYS) &&
    value.kind === "night-patch" &&
    isNightPatchId(value.id)
  ) {
    return { kind: "night-patch", id: value.id };
  }
  if (
    hasExactKeys(value, BOROUGH_AREA_KEYS) &&
    value.kind === "borough" &&
    isCanonicalBorough(value.name)
  ) {
    return { kind: "borough", name: value.name };
  }
  return undefined;
}

function canonicalTimestamp(value: unknown): { value: string; time: number } | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) return null;
  return { value, time };
}

function optionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return canonicalTimestamp(value)?.value;
}

function rawByteLength(raw: string): number {
  return new TextEncoder().encode(raw).byteLength;
}

function bestEffortRemove(storage: PlanningIntentStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(PLANNING_INTENT_STORAGE_KEY);
  } catch {
    // Storage denial must never block the generic journey.
  }
}

/**
 * Parse one strict PlanningIntent envelope. The function is pure: callers that
 * own storage decide whether a rejected value should be removed.
 */
export function parsePlanningIntent(
  raw: string,
  now: number = Date.now(),
): PlanningIntentV1 | null {
  if (!Number.isFinite(now)) return null;
  if (rawByteLength(raw) > PLANNING_INTENT_MAX_RAW_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainRecord(value) || !hasExactKeys(value, INTENT_KEYS)) return null;
  if (value.version !== 1) return null;
  if (!isOneOf(value.source, PLANNING_INTENT_SOURCES)) return null;
  if (!isCityId(value.cityId)) return null;
  if (
    typeof value.acceptedVenueId !== "string" ||
    !VENUE_ID_PATTERN.test(value.acceptedVenueId)
  ) return null;

  const acceptedArea = parseArea(value.acceptedArea);
  if (acceptedArea === undefined) return null;

  const startsAt = optionalTimestamp(value.startsAt);
  if (startsAt === undefined) return null;

  if (!isPlainRecord(value.displayEvidence)) return null;
  if (!hasExactKeys(value.displayEvidence, EVIDENCE_KEYS)) return null;
  if (!isOneOf(value.displayEvidence.kind, PLANNING_INTENT_EVIDENCE_KINDS)) {
    return null;
  }
  const observedAt = optionalTimestamp(value.displayEvidence.observedAt);
  if (observedAt === undefined) return null;

  const acceptedAt = canonicalTimestamp(value.acceptedAt);
  const expiresAt = canonicalTimestamp(value.expiresAt);
  if (!acceptedAt || !expiresAt) return null;
  if (acceptedAt.time > now + PLANNING_INTENT_MAX_FUTURE_SKEW_MS) return null;
  if (
    observedAt !== null &&
    Date.parse(observedAt) > now + PLANNING_INTENT_MAX_FUTURE_SKEW_MS
  ) return null;
  if (expiresAt.time !== acceptedAt.time + PLANNING_INTENT_TTL_MS) return null;
  if (now >= expiresAt.time) return null;

  return {
    version: 1,
    source: value.source,
    cityId: value.cityId,
    acceptedVenueId: value.acceptedVenueId,
    acceptedArea,
    startsAt,
    displayEvidence: {
      kind: value.displayEvidence.kind,
      observedAt,
    },
    acceptedAt: acceptedAt.value,
    expiresAt: expiresAt.value,
  };
}

/** Build a canonical two-hour envelope, or null when input is not valid. */
export function createPlanningIntent(
  input: PlanningIntentInput,
  now: number = Date.now(),
): PlanningIntentV1 | null {
  if (!Number.isFinite(now)) return null;
  const acceptedAt = new Date(now);
  const expiresAt = new Date(now + PLANNING_INTENT_TTL_MS);
  if (
    !Number.isFinite(acceptedAt.getTime()) ||
    !Number.isFinite(expiresAt.getTime())
  ) return null;

  const intent: PlanningIntentV1 = {
    ...input,
    version: 1,
    acceptedAt: acceptedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  return parsePlanningIntent(JSON.stringify(intent), now);
}

/** Read without extending expiry. Rejected and expired values clear best-effort by default. */
export function readPlanningIntent(
  options: PlanningIntentOptions = {},
): PlanningIntentV1 | null {
  const storage = selectedStorage(options);
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(PLANNING_INTENT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const intent = parsePlanningIntent(raw, currentTime(options.now));
  if (!intent && options.cleanupInvalid !== false) bestEffortRemove(storage);
  return intent;
}

/** Write one newly accepted Venue. Storage failures return null and do not throw. */
export function writePlanningIntent(
  input: PlanningIntentInput,
  options: PlanningIntentOptions = {},
): PlanningIntentV1 | null {
  const storage = selectedStorage(options);
  if (!storage) return null;

  const now = currentTime(options.now);
  const intent = createPlanningIntent(input, now);
  if (!intent) return null;

  const raw = JSON.stringify(intent);
  if (rawByteLength(raw) > PLANNING_INTENT_MAX_RAW_BYTES) return null;
  try {
    storage.setItem(PLANNING_INTENT_STORAGE_KEY, raw);
    announcePlanningIntentChange();
    return intent;
  } catch {
    return null;
  }
}

export function canonicalizePlanningIntentVenueId(
  previousVenueId: string,
  canonicalVenueId: string,
  options: PlanningIntentOptions = {},
): PlanningIntentV1 | null {
  const storage = selectedStorage(options);
  if (!storage || !VENUE_ID_PATTERN.test(canonicalVenueId)) return null;
  const now = currentTime(options.now);
  const existing = readPlanningIntent({ ...options, storage, now });
  if (!existing || existing.acceptedVenueId !== previousVenueId) return null;
  const canonical = parsePlanningIntent(JSON.stringify({
    ...existing,
    acceptedVenueId: canonicalVenueId,
  }), now);
  if (!canonical) return null;
  try {
    storage.setItem(PLANNING_INTENT_STORAGE_KEY, JSON.stringify(canonical));
    announcePlanningIntentChange();
    return canonical;
  } catch {
    return null;
  }
}

export function clearPlanningIntent(
  options: Pick<PlanningIntentOptions, "storage"> = {},
): void {
  bestEffortRemove(selectedStorage(options));
  announcePlanningIntentChange();
}

/**
 * Successful Plan creation/upgrade and explicit dismissal consume the intent.
 * Generation failure deliberately retains it for recovery.
 */
export function settlePlanningIntent(
  disposition: PlanningIntentDisposition,
  options: Pick<PlanningIntentOptions, "storage"> = {},
): void {
  if (disposition === "generation-failed") return;
  clearPlanningIntent(options);
}
