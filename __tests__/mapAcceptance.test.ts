import { beforeEach, describe, it, expect, vi } from "vitest";

import {
  acceptMapVenue,
  announceAcceptedArrivalUrlChange,
  buildMapAcceptanceIntentInput,
  canonicalizeAcceptedArrivalSelection,
  initialAcceptanceSource,
  invalidateAcceptedArrivalSource,
  isPlanningIntentSource,
  readAcceptedArrivalSource,
  scheduleAcceptedArrivalExpiry,
} from "@/lib/mapAcceptance";
import {
  createPlanningIntent,
  parsePlanningIntent,
  PLANNING_INTENT_CHANGED_EVENT,
  PLANNING_INTENT_TTL_MS,
  PLANNING_INTENT_STORAGE_KEY,
  type PlanningIntentStorage,
} from "@/lib/planningIntent";

const NOW = Date.parse("2026-07-24T18:00:00.000Z");
const ACCEPTED_VENUE = "venue-abc";

type FakeStorage = PlanningIntentStorage & {
  map: Map<string, string>;
  reads: number;
};

function memoryStorage(): FakeStorage {
  const map = new Map<string, string>();
  const storage: FakeStorage = {
    map,
    reads: 0,
    getItem: (key) => {
      storage.reads += 1;
      return map.has(key) ? map.get(key)! : null;
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return storage;
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
  return raw ? parsePlanningIntent(raw, NOW + 1_000) : null;
}

function seedIntent(
  storage: FakeStorage,
  input: Parameters<typeof createPlanningIntent>[0],
): void {
  const intent = createPlanningIntent(input, NOW);
  expect(intent).not.toBeNull();
  storage.map.set(PLANNING_INTENT_STORAGE_KEY, JSON.stringify(intent));
}

describe("isPlanningIntentSource", () => {
  it("accepts the four valid sources and rejects everything else", () => {
    for (const source of ["near", "map-search", "tonight", "pal"]) {
      expect(isPlanningIntentSource(source)).toBe(true);
    }
    expect(isPlanningIntentSource("direct-plan")).toBe(false);
    expect(isPlanningIntentSource("mobile-route-preview")).toBe(false);
    expect(isPlanningIntentSource("")).toBe(false);
    expect(isPlanningIntentSource(null)).toBe(false);
    expect(isPlanningIntentSource(undefined)).toBe(false);
  });
});

describe("initialAcceptanceSource", () => {
  it("reads a valid source only from a genuine accepted-handoff arrival", () => {
    expect(initialAcceptanceSource("?sel=v1&accept=1&src=near")).toBe("near");
    expect(initialAcceptanceSource("?accept=1&src=tonight")).toBe("tonight");
  });

  it("returns null without accept=1, or with an unknown/missing source", () => {
    expect(initialAcceptanceSource("?sel=v1&src=near")).toBeNull(); // browse deep link
    expect(initialAcceptanceSource("?accept=1")).toBeNull();
    expect(initialAcceptanceSource("?accept=1&src=direct-plan")).toBeNull();
    expect(initialAcceptanceSource("?accept=0&src=near")).toBeNull();
    expect(initialAcceptanceSource("")).toBeNull();
  });
});

describe("buildMapAcceptanceIntentInput", () => {
  it("builds a minimal honest envelope that parses as a valid PlanningIntent", () => {
    const input = buildMapAcceptanceIntentInput({
      source: "map-search",
      cityId: "london",
      acceptedVenueId: "venue-abc",
    });
    expect(input).toEqual({
      source: "map-search",
      cityId: "london",
      acceptedVenueId: "venue-abc",
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    // Round-trips through the real contract (2h envelope, canonical timestamps).
    const now = Date.parse("2026-07-24T18:00:00.000Z");
    const intent = createPlanningIntent(input, now);
    expect(intent).not.toBeNull();
    expect(intent?.source).toBe("map-search");
    expect(intent?.acceptedVenueId).toBe("venue-abc");
    expect(intent?.expiresAt).toBe("2026-07-24T20:00:00.000Z");
  });
});

describe("acceptMapVenue", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("returns Plan destination and exact acceptance telemetry only after persistence", () => {
    const result = acceptMapVenue(
      {
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        search: "?sel=venue-abc",
      },
      { storage, now: NOW },
    );

    expect(result).toEqual({
      accepted: true,
      destination: "/plan",
      telemetry: {
        source: "map-search",
        hasArea: false,
        hasDate: false,
        hasProvenance: false,
      },
    });
    expect(storedIntent(storage)).toMatchObject({
      source: "map-search",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
  });

  it.each([
    ["denies storage", { storage: null }],
    ["handles a thrown storage write", { storage: throwingStorage() }],
  ])("returns no destination when it %s", (_label, options) => {
    const result = acceptMapVenue(
      {
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        search: "?sel=venue-abc",
      },
      { ...options, now: NOW },
    );

    expect(result).toEqual({
      accepted: false,
      destination: null,
      telemetry: null,
    });
  });

  it.each([
    ["near" as const, { kind: "price" as const, observedAt: "2026-07-24T17:00:00.000Z" }],
    ["tonight" as const, { kind: "whats-on" as const, observedAt: "2026-07-24T16:00:00.000Z" }],
    ["pal" as const, { kind: "directory" as const, observedAt: "2026-07-24T15:00:00.000Z" }],
  ])("preserves richer %s intent on a matching accepted arrival", (source, evidence) => {
    const startsAt = "2026-07-24T20:00:00.000Z";
    seedIntent(storage, {
      source,
      cityId: "london",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: { kind: "borough", name: "Camden" },
      startsAt,
      displayEvidence: evidence,
    });

    const result = acceptMapVenue(
      {
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        search: `?sel=${ACCEPTED_VENUE}&accept=1&src=${source}`,
      },
      { storage, now: NOW },
    );

    expect(result).toEqual({
      accepted: true,
      destination: "/plan",
      telemetry: {
        source,
        hasArea: true,
        hasDate: true,
        hasProvenance: true,
      },
    });
    expect(storedIntent(storage)).toMatchObject({
      source,
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: { kind: "borough", name: "Camden" },
      startsAt,
      displayEvidence: evidence,
    });
    expect(storage.reads).toBe(1);
  });

  it("keeps trusted Near provenance, which only the stored intent can name", () => {
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: { kind: "borough", name: "Camden" },
      startsAt: "2026-07-24T20:00:00.000Z",
      displayEvidence: {
        kind: "price",
        observedAt: "2026-07-24T17:00:00.000Z",
      },
    });

    const result = acceptMapVenue(
      {
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        search: `?sel=${ACCEPTED_VENUE}&accept=1&src=near`,
      },
      { storage, now: NOW },
    );

    expect(result.telemetry).toEqual({
      source: "near",
      hasArea: true,
      hasDate: true,
      hasProvenance: true,
    });
    expect(storedIntent(storage)).toMatchObject({
      source: "near",
      acceptedArea: { kind: "borough", name: "Camden" },
      displayEvidence: {
        kind: "price",
        observedAt: "2026-07-24T17:00:00.000Z",
      },
    });
  });

  it("writes a minimal directory intent for a generic Map selection", () => {
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: { kind: "borough", name: "Camden" },
      startsAt: "2026-07-24T20:00:00.000Z",
      displayEvidence: {
        kind: "price",
        observedAt: "2026-07-24T17:00:00.000Z",
      },
    });

    const result = acceptMapVenue(
      {
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        search: `?sel=${ACCEPTED_VENUE}`,
      },
      { storage, now: NOW },
    );

    expect(result.telemetry).toEqual({
      source: "map-search",
      hasArea: false,
      hasDate: false,
      hasProvenance: false,
    });
    expect(storedIntent(storage)).toMatchObject({
      source: "map-search",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    expect(storage.reads).toBe(0);
  });

  it("downgrades a crafted accepted URL with no stored intent to Map search", () => {
    const result = acceptMapVenue(
      {
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        search: `?sel=${ACCEPTED_VENUE}&accept=1&src=near`,
      },
      { storage, now: NOW },
    );

    expect(result.telemetry).toEqual({
      source: "map-search",
      hasArea: false,
      hasDate: false,
      hasProvenance: false,
    });
    expect(storedIntent(storage)).toMatchObject({
      source: "map-search",
      acceptedVenueId: ACCEPTED_VENUE,
      displayEvidence: { kind: "directory", observedAt: null },
    });
  });

  it.each([
    ["source", "tonight" as const, ACCEPTED_VENUE],
    ["Venue", "near" as const, "venue-different"],
  ])("downgrades an accepted URL when stored intent has a different %s", (_label, source, acceptedVenueId) => {
    seedIntent(storage, {
      source,
      cityId: "london",
      acceptedVenueId,
      acceptedArea: { kind: "borough", name: "Camden" },
      startsAt: "2026-07-24T20:00:00.000Z",
      displayEvidence: {
        kind: "price",
        observedAt: "2026-07-24T17:00:00.000Z",
      },
    });

    const result = acceptMapVenue(
      {
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        search: `?sel=${ACCEPTED_VENUE}&accept=1&src=near`,
      },
      { storage, now: NOW },
    );

    expect(result.telemetry?.source).toBe("map-search");
    expect(storedIntent(storage)?.source).toBe("map-search");
  });

  it("downgrades an accepted URL when its matching stored intent expired", () => {
    const intent = createPlanningIntent(
      {
        source: "near",
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        acceptedArea: { kind: "borough", name: "Camden" },
        startsAt: null,
        displayEvidence: {
          kind: "directory",
          observedAt: null,
        },
      },
      NOW - PLANNING_INTENT_TTL_MS,
    );
    expect(intent).not.toBeNull();
    storage.map.set(PLANNING_INTENT_STORAGE_KEY, JSON.stringify(intent));

    const result = acceptMapVenue(
      {
        cityId: "london",
        acceptedVenueId: ACCEPTED_VENUE,
        search: `?sel=${ACCEPTED_VENUE}&accept=1&src=near`,
      },
      { storage, now: NOW },
    );

    expect(result.telemetry?.source).toBe("map-search");
    expect(storedIntent(storage)?.source).toBe("map-search");
  });
});

describe("readAcceptedArrivalSource", () => {
  const query = {
    search: `?sel=${ACCEPTED_VENUE}&accept=1&src=near`,
    selectedVenueId: ACCEPTED_VENUE,
    cityId: "london" as const,
  };

  beforeEach(() => {
    invalidateAcceptedArrivalSource();
  });

  it("parses the envelope once for one unchanged question", () => {
    // useSyncExternalStore asks its snapshot on every render, so an unmemoised
    // reader ran a storage read plus a JSON.parse per PubMap render.
    const storage = memoryStorage();
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: { kind: "borough", name: "Camden" },
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });

    expect(readAcceptedArrivalSource(query, { storage, now: NOW })).toBe("near");
    const readsAfterFirst = storage.reads;
    for (let index = 0; index < 20; index += 1) {
      expect(readAcceptedArrivalSource(query, { storage, now: NOW })).toBe("near");
    }

    expect(storage.reads).toBe(readsAfterFirst);
  });

  it("asks again for a different Venue, and after an invalidation", () => {
    const storage = memoryStorage();
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });

    expect(readAcceptedArrivalSource(query, { storage, now: NOW })).toBe("near");
    const readsAfterFirst = storage.reads;

    // A different question is a different key, so it is never answered from
    // the previous Venue's cached answer.
    expect(readAcceptedArrivalSource({
      ...query,
      selectedVenueId: "venue-other",
      search: "?sel=venue-other&accept=1&src=near",
    }, { storage, now: NOW })).toBeNull();
    expect(storage.reads).toBeGreaterThan(readsAfterFirst);

    // The same question after a write, a clear, another tab or a history move.
    const readsBeforeInvalidate = storage.reads;
    invalidateAcceptedArrivalSource();
    expect(readAcceptedArrivalSource(query, { storage, now: NOW })).toBe("near");
    expect(storage.reads).toBeGreaterThan(readsBeforeInvalidate);
  });

  it("expires a cached accepted arrival at the intent deadline", () => {
    const storage = memoryStorage();
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });

    expect(readAcceptedArrivalSource(query, { storage, now: NOW })).toBe("near");
    const readsBeforeExpiry = storage.reads;
    expect(readAcceptedArrivalSource(query, {
      storage,
      now: NOW + PLANNING_INTENT_TTL_MS,
    })).toBeNull();
    expect(storage.reads).toBeGreaterThan(readsBeforeExpiry);
  });

  it("notifies an open Map at the accepted-arrival deadline", () => {
    const storage = memoryStorage();
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: ACCEPTED_VENUE,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    const onExpire = vi.fn();
    let scheduled: (() => void) | null = null;
    let delay = -1;
    const timer = 1 as unknown as ReturnType<typeof setTimeout>;
    const clearTimeout = vi.fn();

    const cancel = scheduleAcceptedArrivalExpiry(query, onExpire, {
      storage,
      now: NOW,
      setTimeout: (callback, nextDelay) => {
        scheduled = callback;
        delay = nextDelay;
        return timer;
      },
      clearTimeout,
    });

    expect(delay).toBe(PLANNING_INTENT_TTL_MS);
    expect(scheduled).not.toBeNull();
    (scheduled as unknown as () => void)();
    expect(onExpire).toHaveBeenCalledOnce();
    cancel();
    expect(clearTimeout).toHaveBeenCalledWith(timer);
  });

  it("never cleans a rejected envelope away, because a render is a look", () => {
    const storage = memoryStorage();
    storage.map.set(PLANNING_INTENT_STORAGE_KEY, "{not json");

    expect(readAcceptedArrivalSource(query, { storage, now: NOW })).toBeNull();
    expect(storage.map.has(PLANNING_INTENT_STORAGE_KEY)).toBe(true);
  });
});

describe("canonicalizeAcceptedArrivalSelection", () => {
  it("moves URL and intent authority together without renewing acceptance", () => {
    const storage = memoryStorage();
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: "venue-alias",
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });

    const url = canonicalizeAcceptedArrivalSelection({
      pathname: "/map",
      search: "?sel=venue-alias&accept=1&src=near",
      requestedVenueId: "venue-alias",
      canonicalVenueId: "venue-canonical",
    }, { storage, now: NOW + 60_000 });

    expect(url).toBe("/map?sel=venue-canonical&accept=1&src=near");
    const raw = storage.map.get(PLANNING_INTENT_STORAGE_KEY);
    expect(raw ? JSON.parse(raw) : null).toMatchObject({
      acceptedVenueId: "venue-canonical",
      acceptedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + PLANNING_INTENT_TTL_MS).toISOString(),
    });
  });

  it("answers for the canonical sel it moved to, and no longer for the stale one", () => {
    const storage = memoryStorage();
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: "venue-alias",
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });

    const url = canonicalizeAcceptedArrivalSelection({
      pathname: "/map",
      search: "?sel=venue-alias&accept=1&src=near",
      requestedVenueId: "venue-alias",
      canonicalVenueId: "venue-canonical",
    }, { storage, now: NOW + 60_000 });
    expect(url).toBe("/map?sel=venue-canonical&accept=1&src=near");

    invalidateAcceptedArrivalSource();
    expect(readAcceptedArrivalSource({
      search: "?sel=venue-canonical&accept=1&src=near",
      selectedVenueId: "venue-canonical",
      cityId: "london",
    }, { storage, now: NOW + 60_000 })).toBe("near");

    invalidateAcceptedArrivalSource();
    expect(readAcceptedArrivalSource({
      search: "?sel=venue-alias&accept=1&src=near",
      selectedVenueId: "venue-alias",
      cityId: "london",
    }, { storage, now: NOW + 60_000 })).toBeNull();
  });

  it("announces the URL move on the channel the accepted-arrival lane listens to", () => {
    const dispatched: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        return true;
      },
    });
    try {
      announceAcceptedArrivalUrlChange();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(dispatched).toEqual([PLANNING_INTENT_CHANGED_EVENT]);
  });

  it("canonicalises an unverified accepted arrival as browsing, keeping no acceptance", () => {
    const storage = memoryStorage();

    const url = canonicalizeAcceptedArrivalSelection({
      pathname: "/map",
      search: "?sel=venue-alias&accept=1&src=near&pubs=all",
      requestedVenueId: "venue-alias",
      canonicalVenueId: "venue-canonical",
    }, { storage, now: NOW + 60_000 });

    expect(url).toBe("/map?sel=venue-canonical&pubs=all");
    expect(storage.map.has(PLANNING_INTENT_STORAGE_KEY)).toBe(false);
  });

  it("leaves the accepted URL unchanged when intent persistence fails", () => {
    const storage = memoryStorage();
    seedIntent(storage, {
      source: "near",
      cityId: "london",
      acceptedVenueId: "venue-alias",
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    storage.setItem = () => { throw new DOMException("QuotaExceededError"); };

    expect(canonicalizeAcceptedArrivalSelection({
      pathname: "/map",
      search: "?sel=venue-alias&accept=1&src=near",
      requestedVenueId: "venue-alias",
      canonicalVenueId: "venue-canonical",
    }, { storage, now: NOW + 60_000 })).toBeNull();
    expect(JSON.parse(storage.map.get(PLANNING_INTENT_STORAGE_KEY)!)).toMatchObject({
      acceptedVenueId: "venue-alias",
    });
  });
});
