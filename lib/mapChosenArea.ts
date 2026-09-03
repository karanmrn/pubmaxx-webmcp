// Remembered map area chip — separate from night-patch memory (lib/nightPatches.ts).

import type { CityId } from "@/lib/cities";
import { safeLocalStorage } from "@/lib/safeStorage";

export const MAP_CHOSEN_AREA_KEY = "pubmax:map-chosen-area:v1";
const CHANGE_EVENT = "pubmax:map-chosen-area";

export type MapChosenNamedPlaceKind = "night-area" | "locality" | "borough";
export type MapChosenAreaKind = "near-me" | "city" | MapChosenNamedPlaceKind;

type MapChosenAreaBase = {
  cityId: CityId;
  label: string;
  slug: string;
};

/** Named public places remain a real discriminated union. */
export type MapChosenNamedPlace = {
  [Kind in MapChosenNamedPlaceKind]: MapChosenAreaBase & {
    kind: Kind;
    center: [number, number];
  };
}[MapChosenNamedPlaceKind];

/**
 * A remembered map area, and the one rule that shapes it: NO VIEWER POINT is
 * ever written down. A named area is a public place on a public map, so it
 * carries its own centre; a `near-me` row is a MODE MARKER and nothing else,
 * because a stored fix replayed days later is a "you are here" claim about
 * somewhere the reader may not be, made without asking. The next visit re-runs
 * the live locate flow instead.
 */
export type MapChosenArea =
  | (MapChosenAreaBase & { kind: "near-me" })
  | (MapChosenAreaBase & { kind: "city" })
  | MapChosenNamedPlace;

/** A remembered curated Night Area. */
export type MapChosenNightArea = Extract<MapChosenArea, { kind: "night-area" }>;

/**
 * The public, named centre a search result may make the remembered map area.
 * This covers modelled Night Areas, localities and boroughs. It can never carry
 * viewer coordinates.
 */
export type MapChosenAreaSelection = Pick<
  MapChosenNamedPlace,
  "cityId" | "kind" | "label" | "slug" | "center"
>;

/** The two named-place kinds produced by Choose Area rows. */
export function mapChosenAreaPickerKind(
  slug: string,
): "night-area" | "locality" {
  return slug.startsWith("locality:") ? "locality" : "night-area";
}

/**
 * Translate a remembered place into the camera contract used on first select
 * and later restore. The caller supplies the search module's locality zoom so
 * both journeys have one value without storing presentation state.
 */
export function mapChosenAreaFlyTarget(
  area: MapChosenNamedPlace,
  localityZoom: number,
): {
  kind: "area" | "locality" | "borough";
  zoom: number | undefined;
} {
  return {
    kind: area.kind === "night-area" ? "area" : area.kind,
    zoom: area.kind === "locality" ? localityZoom : undefined,
  };
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  return safeLocalStorage();
}

function notifyChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Older environments without Event ctor still keep the storage write.
  }
}

/**
 * Rebuild a stored row field by field rather than trusting the parsed object.
 * A row written by an older build may still carry a `center` beside
 * `kind: "near-me"`; projecting the closed field set is what stops those
 * coordinates reaching a single consumer, and `readSnapshot` erases them from
 * storage itself rather than waiting for a write that may never come.
 */
function parseMapChosenArea(value: unknown): MapChosenArea | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.cityId !== "string") return null;
  if (typeof row.label !== "string") return null;
  if (typeof row.slug !== "string") return null;
  const base: MapChosenAreaBase = {
    cityId: row.cityId as CityId,
    label: row.label,
    slug: row.slug,
  };
  if (row.kind === "near-me" || row.kind === "city") {
    return { ...base, kind: row.kind };
  }
  if (
    row.kind !== "night-area" &&
    row.kind !== "locality" &&
    row.kind !== "borough"
  ) {
    return null;
  }
  const center = row.center;
  if (!Array.isArray(center) || center.length !== 2) return null;
  const [lng, lat] = center;
  if (
    typeof lng !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    return null;
  }
  return { ...base, kind: row.kind, center: [lng, lat] };
}

/** The closed field set that reaches storage. A mode marker keeps no point. */
function toStoredRow(area: MapChosenArea): Record<string, unknown> {
  const base = {
    cityId: area.cityId,
    label: area.label,
    slug: area.slug,
    kind: area.kind,
  };
  return area.kind === "near-me" || area.kind === "city"
    ? base
    : { ...base, center: area.center };
}

type SnapshotCache = { raw: string | null; value: MapChosenArea | null };
const snapshotByStorage = new WeakMap<Storage, SnapshotCache>();

function invalidateSnapshot(store: Storage): void {
  snapshotByStorage.delete(store);
}

/**
 * Bring the stored bytes into line with what a reader is allowed to see.
 *
 * Projecting a field away on read keeps it out of the product, but the point is
 * still on the device, and the write that would have overwritten it may never
 * happen. So a row whose canonical form differs from what is on disk is
 * rewritten here, and a row nothing can parse is removed: either can be an
 * older shape holding a viewer's coordinates, and this is the one place every
 * read passes through. Nothing is announced, because the ANSWER has not
 * changed - only where it is kept - and this runs inside the snapshot read that
 * feeds `useSyncExternalStore`.
 */
function settleStoredRow(
  store: Storage,
  raw: string,
  value: MapChosenArea | null,
): string | null {
  const canonical = value ? JSON.stringify(toStoredRow(value)) : null;
  if (canonical === raw) return raw;
  try {
    if (canonical === null) store.removeItem(MAP_CHOSEN_AREA_KEY);
    else store.setItem(MAP_CHOSEN_AREA_KEY, canonical);
    return canonical;
  } catch {
    // Storage refused the cleanup; the projection above still holds.
    return raw;
  }
}

function readSnapshot(store: Storage): MapChosenArea | null {
  let raw: string | null;
  try {
    raw = store.getItem(MAP_CHOSEN_AREA_KEY);
  } catch {
    return null;
  }
  const cached = snapshotByStorage.get(store);
  if (cached && cached.raw === raw) return cached.value;

  let value: MapChosenArea | null = null;
  if (raw !== null) {
    try {
      value = parseMapChosenArea(JSON.parse(raw) as unknown);
    } catch {
      value = null;
    }
  }
  // Key the cache on what is NOW on disk, so the next read is a cache hit and
  // hands back the same object identity useSyncExternalStore requires.
  const settledRaw = raw === null ? null : settleStoredRow(store, raw, value);
  snapshotByStorage.set(store, { raw: settledRaw, value });
  return value;
}

export function readMapChosenArea(storage?: Storage | null): MapChosenArea | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  return readSnapshot(store);
}

export function writeMapChosenArea(
  area: MapChosenArea,
  storage?: Storage | null,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(MAP_CHOSEN_AREA_KEY, JSON.stringify(toStoredRow(area)));
    invalidateSnapshot(store);
    notifyChange();
  } catch {
    // Storage full / private mode — degrade silently.
  }
}

/** Remember a named public area selected from map search. */
export function rememberMapChosenAreaSelection(
  selection: MapChosenAreaSelection,
  storage?: Storage | null,
): void {
  writeMapChosenArea(selection, storage);
}

export function clearMapChosenArea(storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(MAP_CHOSEN_AREA_KEY);
    invalidateSnapshot(store);
    notifyChange();
  } catch {
    // Storage disabled mid-session — nothing to clean up.
  }
}

/**
 * What a fresh Map arrival owes a remembered area.
 *
 * A remembered area is the DEFAULT arrival and never an override, so this
 * answers four ways rather than two. `skip` means somebody else owns the
 * camera - an explicit arrival (?sel=, ?q=, ?place=, ?crawl=, a planner
 * handoff) already has its own fly-to in flight, and a restored session
 * viewport is fresher evidence of where this reader was than a row they tapped
 * days ago - or there is nothing here for this city. `wait` is the one answer
 * that must NOT spend the caller's one-shot: a remembered Near me needs venues
 * to rank against, and the index settles after the first paint. `locate` is a
 * remembered Near me: the caller re-runs the LIVE locate flow, because nothing
 * about where the reader stood is stored, and a refusal leaves the default city
 * view with the area picker still one tap away. `restore` is the only answer
 * carrying a point, and that point is a named area's own published centre.
 */
export type MapChosenAreaRestore =
  | { action: "skip" }
  | { action: "wait" }
  | { action: "locate" }
  | { action: "restore"; area: MapChosenNamedPlace };

export function resolveMapChosenAreaRestore(input: {
  stored: MapChosenArea | null;
  cityId: CityId;
  explicitArrivalIntent: boolean;
  hasRestoredViewport: boolean;
  venueCount: number;
}): MapChosenAreaRestore {
  if (input.explicitArrivalIntent || input.hasRestoredViewport) {
    return { action: "skip" };
  }
  const stored = input.stored;
  if (!stored || stored.cityId !== input.cityId) return { action: "skip" };
  if (stored.kind === "city") return { action: "skip" };
  if (stored.kind === "near-me") {
    return input.venueCount === 0 ? { action: "wait" } : { action: "locate" };
  }
  return { action: "restore", area: stored };
}

export function subscribeMapChosenArea(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
