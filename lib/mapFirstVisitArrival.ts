// First-visit map arrival card — show once per device after pins reveal.
// Pure policy: eligibility, planner-param suppression, dismiss storage, and
// the consent gate the analytics prompt must wait behind.

import {
  PLAN_DESCRIBE_PARAM,
  PLAN_OCCASION_PARAM,
  PLAN_QUERY_PARAM,
} from "@/lib/planOccasion";
import { searchHasExplicitMapIntent } from "@/lib/explicitMapIntent";
import { safeLocalStorage } from "@/lib/safeStorage";

export const MAP_FIRST_VISIT_ARRIVAL_KEY = "pubmax:map-first-visit-arrival:v1";
const CHANGE_EVENT = "pubmax:map-first-visit-arrival";

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

/** Planner handoff params must not meet a first-visit card over the map. */
export function searchHasPlanHandoffParams(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return (
    params.has(PLAN_QUERY_PARAM) ||
    params.has(PLAN_OCCASION_PARAM) ||
    params.has(PLAN_DESCRIBE_PARAM)
  );
}

export function searchSuppressesMapFirstVisitArrival(search: string): boolean {
  return (
    searchHasExplicitMapIntent(search) || searchHasPlanHandoffParams(search)
  );
}

export function hasDismissedMapFirstVisitArrival(
  storage?: Storage | null,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return true;
  try {
    return store.getItem(MAP_FIRST_VISIT_ARRIVAL_KEY) === "dismissed";
  } catch {
    return true;
  }
}

export function dismissMapFirstVisitArrival(storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(MAP_FIRST_VISIT_ARRIVAL_KEY, "dismissed");
    notifyChange();
  } catch {
    // Storage full / private mode — degrade silently.
  }
}

export function shouldShowMapFirstVisitArrival(params: {
  pinsRevealed: boolean;
  search: string;
  /**
   * A recovery toast (basemap, pub list, pin paint) is on the surface. The map
   * keeps search plus ONE toast, and this card is 256px of opaque panel over
   * the toast's own band, so a failure the reader can act on wins outright.
   * The card is not dismissed by this, only withheld: it returns when the
   * toast clears and the visit is still a first one.
   */
  recoveryToastActive?: boolean;
  storage?: Storage | null;
}): boolean {
  if (!params.pinsRevealed) return false;
  if (params.recoveryToastActive) return false;
  if (hasDismissedMapFirstVisitArrival(params.storage)) return false;
  if (searchSuppressesMapFirstVisitArrival(params.search)) return false;
  return true;
}

let arrivalCardVisible = false;

/** The mounted card reports visibility so consent can wait behind it. */
export function setMapFirstVisitArrivalCardVisible(visible: boolean): void {
  if (arrivalCardVisible === visible) return;
  arrivalCardVisible = visible;
  notifyChange();
}

export function mapFirstVisitArrivalBlocksConsent(): boolean {
  return arrivalCardVisible;
}

export function subscribeMapFirstVisitArrival(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
