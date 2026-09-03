import { beforeEach, describe, expect, it } from "vitest";

import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import {
  PLANNING_INTENT_STORAGE_KEY,
  PLANNING_INTENT_TTL_MS,
  parsePlanningIntent,
  type PlanningIntentStorage,
} from "@/lib/planningIntent";
import { acceptNearVenue } from "@/lib/venueAcceptance";

// The Near acceptance seam is pure — inject storage + clock and read the result.
// It must never mistake a browse for an acceptance, never guess the source, and
// never claim an acceptance it could not actually persist.

const NOW = Date.parse("2026-07-24T18:00:00.000Z");
const OBSERVED = "2026-07-16T00:00:00.000Z";
const LONDON_VENUE = "the-dove-hammersmith";
const MANCHESTER_VENUE = "venue-mcr-1lwo5lo";
const SOHO = NIGHT_PATCHES.find((patch) => patch.id === "soho")!;
const CANONICAL_BOROUGH = LONDON_BOROUGHS[0];

type FakeStorage = PlanningIntentStorage & { map: Map<string, string> };

function memoryStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function throwingStorage(): PlanningIntentStorage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("QuotaExceededError");
    },
    removeItem: () => {},
  };
}

function storedIntent(storage: FakeStorage) {
  const raw = storage.map.get(PLANNING_INTENT_STORAGE_KEY);
  return raw ? parsePlanningIntent(raw, NOW) : null;
}

const baseInput = {
  venueId: LONDON_VENUE,
  area: null,
  startsAt: null,
  observedAt: OBSERVED,
  fallbackCityId: "london" as const,
};

describe("acceptNearVenue", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("writes source 'near' and the accept deep link on a patch acceptance", () => {
    const result = acceptNearVenue(
      { ...baseInput, area: { kind: "night-patch", id: SOHO.id } },
      { storage, now: NOW },
    );

    expect(result.accepted).toBe(true);
    expect(result.href).toContain("accept=1");
    expect(result.href).toContain("src=near");
    expect(result.telemetry).toEqual({
      source: "near",
      hasArea: true,
      hasDate: false,
      hasProvenance: true,
    });

    const intent = storedIntent(storage);
    expect(intent?.source).toBe("near");
    expect(intent?.acceptedVenueId).toBe(LONDON_VENUE);
    expect(intent?.acceptedArea).toEqual({ kind: "night-patch", id: SOHO.id });
    expect(intent?.startsAt).toBeNull();
    expect(intent?.displayEvidence).toEqual({ kind: "price", observedAt: OBSERVED });
    // Read never extends TTL: the envelope is exactly a two-hour window.
    expect(Date.parse(intent!.expiresAt) - Date.parse(intent!.acceptedAt)).toBe(
      PLANNING_INTENT_TTL_MS,
    );
  });

  it("records a canonical borough as the accepted area", () => {
    const result = acceptNearVenue(
      { ...baseInput, area: { kind: "borough", name: CANONICAL_BOROUGH } },
      { storage, now: NOW },
    );

    expect(result.accepted).toBe(true);
    expect(result.telemetry?.hasArea).toBe(true);
    expect(storedIntent(storage)?.acceptedArea).toEqual({
      kind: "borough",
      name: CANONICAL_BOROUGH,
    });
  });

  it("accepts with no area (located answer) — hasArea false", () => {
    const result = acceptNearVenue({ ...baseInput, area: null }, { storage, now: NOW });
    expect(result.accepted).toBe(true);
    expect(result.telemetry?.hasArea).toBe(false);
    expect(storedIntent(storage)?.acceptedArea).toBeNull();
  });

  it("marks hasProvenance false when no observation date is known", () => {
    const result = acceptNearVenue({ ...baseInput, observedAt: null }, { storage, now: NOW });
    expect(result.accepted).toBe(true);
    expect(result.telemetry?.hasProvenance).toBe(false);
    expect(storedIntent(storage)?.displayEvidence).toEqual({ kind: "price", observedAt: null });
  });

  it("reads hasDate off the persisted envelope when a date is supplied", () => {
    const startsAt = new Date(NOW + 3 * 60 * 60 * 1000).toISOString();
    const result = acceptNearVenue({ ...baseInput, startsAt }, { storage, now: NOW });
    expect(result.telemetry?.hasDate).toBe(true);
    expect(storedIntent(storage)?.startsAt).toBe(startsAt);
  });

  it("drops a non-canonical borough to null but still accepts the Venue", () => {
    const result = acceptNearVenue(
      { ...baseInput, area: { kind: "borough", name: "Notting Dale Superborough" } },
      { storage, now: NOW },
    );
    expect(result.accepted).toBe(true);
    expect(result.telemetry?.hasArea).toBe(false);
    expect(storedIntent(storage)?.acceptedArea).toBeNull();
  });

  it("drops an unknown patch id to null but still accepts the Venue", () => {
    const result = acceptNearVenue(
      { ...baseInput, area: { kind: "night-patch", id: "atlantis" } },
      { storage, now: NOW },
    );
    expect(result.accepted).toBe(true);
    expect(result.telemetry?.hasArea).toBe(false);
    expect(storedIntent(storage)?.acceptedArea).toBeNull();
  });

  it("degrades to the canonical browse link when storage throws — no acceptance, no telemetry", () => {
    const result = acceptNearVenue(
      { ...baseInput, area: { kind: "night-patch", id: SOHO.id } },
      { storage: throwingStorage(), now: NOW },
    );
    expect(result.accepted).toBe(false);
    expect(result.telemetry).toBeNull();
    // Canonical selected URL (browse) — never claims an unrecorded acceptance.
    expect(result.href).toContain("sel=the-dove-hammersmith");
    expect(result.href).not.toContain("accept=1");
  });

  it("degrades to browse when no storage is available", () => {
    const result = acceptNearVenue(baseInput, { storage: null, now: NOW });
    expect(result.accepted).toBe(false);
    expect(result.telemetry).toBeNull();
    expect(result.href).not.toContain("accept=1");
  });

  it("degrades to browse when the venue id is not a valid envelope value", () => {
    const result = acceptNearVenue(
      { ...baseInput, venueId: "bad id with spaces" },
      { storage, now: NOW },
    );
    expect(result.accepted).toBe(false);
    expect(result.telemetry).toBeNull();
    expect(storage.map.has(PLANNING_INTENT_STORAGE_KEY)).toBe(false);
  });

  it("keeps the accept link city-aware for a city-prefixed venue", () => {
    const result = acceptNearVenue(
      { ...baseInput, venueId: MANCHESTER_VENUE, fallbackCityId: "london" },
      { storage, now: NOW },
    );
    expect(result.accepted).toBe(true);
    expect(result.href).toContain("/map/manchester");
    expect(result.href).toContain("accept=1");
  });
});
