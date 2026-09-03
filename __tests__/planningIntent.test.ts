import { describe, expect, it, vi } from "vitest";

import {
  canonicalizePlanningIntentVenueId,
  clearPlanningIntent,
  PLANNING_INTENT_CHANGED_EVENT,
  createPlanningIntent,
  parsePlanningIntent,
  PLANNING_INTENT_MAX_FUTURE_SKEW_MS,
  PLANNING_INTENT_MAX_RAW_BYTES,
  PLANNING_INTENT_STORAGE_KEY,
  PLANNING_INTENT_TTL_MS,
  readPlanningIntent,
  settlePlanningIntent,
  writePlanningIntent,
  type PlanningIntentInput,
  type PlanningIntentStorage,
} from "@/lib/planningIntent";

const NOW = Date.parse("2026-07-24T18:00:00.000Z");

const INPUT: PlanningIntentInput = {
  source: "near",
  cityId: "london",
  acceptedVenueId: "venue-abc123",
  acceptedArea: { kind: "night-patch", id: "soho" },
  startsAt: "2026-07-24T19:30:00.000Z",
  displayEvidence: {
    kind: "price",
    observedAt: "2026-07-24T17:45:00.000Z",
  },
};

function memoryStorage(initial?: string): PlanningIntentStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(PLANNING_INTENT_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => { values.delete(key); },
  };
}

function validRaw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    ...INPUT,
    acceptedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + PLANNING_INTENT_TTL_MS).toISOString(),
    ...overrides,
  });
}

describe("PlanningIntent V1 parser", () => {
  it("accepts the exact schema without rewriting timestamps", () => {
    expect(parsePlanningIntent(validRaw(), NOW)).toEqual({
      version: 1,
      ...INPUT,
      acceptedAt: "2026-07-24T18:00:00.000Z",
      expiresAt: "2026-07-24T20:00:00.000Z",
    });
  });

  it("accepts every source, evidence kind, tagged area, and optional null", () => {
    for (const source of ["near", "map-search", "tonight", "pal"] as const) {
      for (const kind of ["price", "whats-on", "directory"] as const) {
        expect(parsePlanningIntent(validRaw({
          source,
          acceptedArea: null,
          startsAt: null,
          displayEvidence: { kind, observedAt: null },
        }), NOW)).toMatchObject({ source, acceptedArea: null, startsAt: null });
      }
    }

    expect(parsePlanningIntent(validRaw({
      acceptedArea: { kind: "borough", name: "Westminster" },
    }), NOW)?.acceptedArea).toEqual({ kind: "borough", name: "Westminster" });
  });

  it.each([
    ["malformed JSON", "{"],
    ["array", "[]"],
    ["scalar", "1"],
    ["null", "null"],
  ])("rejects %s", (_label, raw) => {
    expect(parsePlanningIntent(raw, NOW)).toBeNull();
  });

  it("rejects unsupported versions and unknown keys at every level", () => {
    expect(parsePlanningIntent(validRaw({ version: 2 }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({ query: "soho" }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({
      acceptedArea: { kind: "night-patch", id: "soho", lat: 51.5 },
    }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({
      displayEvidence: { ...INPUT.displayEvidence, proof: "signed" },
    }), NOW)).toBeNull();
  });

  it("rejects unknown enums, cities, patches, and non-canonical borough names", () => {
    expect(parsePlanningIntent(validRaw({ source: "feed" }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({ cityId: "London" }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({ cityId: "unknown" }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({
      acceptedArea: { kind: "night-patch", id: "central" },
    }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({
      acceptedArea: { kind: "borough", name: " westminster " },
    }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({
      displayEvidence: { kind: "review", observedAt: null },
    }), NOW)).toBeNull();
  });

  it("rejects unsafe Venue values instead of storing URLs, queries, coordinates, or free text", () => {
    for (const acceptedVenueId of [
      "https://example.com/pub",
      "venue-1?q=raw",
      "51.5136,-0.1365",
      "The pub I want",
      "",
      "x".repeat(129),
    ]) {
      expect(parsePlanningIntent(validRaw({ acceptedVenueId }), NOW)).toBeNull();
    }
  });

  it("enforces the 4 KB raw UTF-8 bound before parsing", () => {
    const oversized = `${"é".repeat(PLANNING_INTENT_MAX_RAW_BYTES / 2)}x`;
    expect(new TextEncoder().encode(oversized)).toHaveLength(
      PLANNING_INTENT_MAX_RAW_BYTES + 1,
    );
    expect(parsePlanningIntent(oversized, NOW)).toBeNull();
  });

  it("requires a finite injected clock and canonical ISO timestamps", () => {
    expect(parsePlanningIntent(validRaw(), Number.NaN)).toBeNull();

    for (const [field, value] of [
      ["acceptedAt", "2026-07-24T18:00:00Z"],
      ["expiresAt", "2026-07-24 20:00:00.000Z"],
      ["startsAt", "2026-07-24T19:30:00Z"],
    ] as const) {
      expect(parsePlanningIntent(validRaw({ [field]: value }), NOW)).toBeNull();
    }
    expect(parsePlanningIntent(validRaw({
      displayEvidence: { kind: "price", observedAt: "yesterday" },
    }), NOW)).toBeNull();
  });

  it("allows only five minutes of future skew for accepted and observed evidence clocks", () => {
    const edge = new Date(NOW + PLANNING_INTENT_MAX_FUTURE_SKEW_MS).toISOString();
    expect(parsePlanningIntent(validRaw({
      acceptedAt: edge,
      expiresAt: new Date(
        NOW + PLANNING_INTENT_MAX_FUTURE_SKEW_MS + PLANNING_INTENT_TTL_MS,
      ).toISOString(),
      displayEvidence: { kind: "price", observedAt: edge },
    }), NOW)).not.toBeNull();

    const tooFar = new Date(
      NOW + PLANNING_INTENT_MAX_FUTURE_SKEW_MS + 1,
    ).toISOString();
    expect(parsePlanningIntent(validRaw({
      acceptedAt: tooFar,
      expiresAt: new Date(
        NOW + PLANNING_INTENT_MAX_FUTURE_SKEW_MS + 1 + PLANNING_INTENT_TTL_MS,
      ).toISOString(),
    }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw({
      displayEvidence: { kind: "price", observedAt: tooFar },
    }), NOW)).toBeNull();
  });

  it("requires exact two-hour TTL and treats exact expiry as expired", () => {
    expect(parsePlanningIntent(validRaw({
      expiresAt: new Date(NOW + PLANNING_INTENT_TTL_MS - 1).toISOString(),
    }), NOW)).toBeNull();
    expect(parsePlanningIntent(validRaw(), NOW + PLANNING_INTENT_TTL_MS - 1)).not.toBeNull();
    expect(parsePlanningIntent(validRaw(), NOW + PLANNING_INTENT_TTL_MS)).toBeNull();
  });
});

describe("PlanningIntent storage lifecycle", () => {
  it("canonicalises a matching Venue id without renewing acceptance", () => {
    const raw = validRaw();
    const storage = memoryStorage(raw);

    const canonical = canonicalizePlanningIntentVenueId(
      "venue-abc123",
      "venue-canonical",
      { storage, now: NOW + 60_000 },
    );

    expect(canonical).toMatchObject({
      acceptedVenueId: "venue-canonical",
      acceptedAt: "2026-07-24T18:00:00.000Z",
      expiresAt: "2026-07-24T20:00:00.000Z",
    });
    expect(readPlanningIntent({ storage, now: NOW + 60_000 })).toEqual(canonical);
  });

  it("creates and writes a canonical two-hour envelope with an injectable clock", () => {
    const storage = memoryStorage();
    const clock = vi.fn(() => NOW);
    const written = writePlanningIntent(INPUT, { storage, now: clock });

    expect(clock).toHaveBeenCalledTimes(1);
    expect(written).toEqual(createPlanningIntent(INPUT, NOW));
    expect(storage.values.get(PLANNING_INTENT_STORAGE_KEY)).toBe(
      JSON.stringify(written),
    );
  });

  it("rejects finite clocks outside the ECMAScript Date range without throwing or overwriting", () => {
    const raw = validRaw();
    const storage = memoryStorage(raw);

    expect(() => createPlanningIntent(INPUT, Number.MAX_VALUE)).not.toThrow();
    expect(createPlanningIntent(INPUT, Number.MAX_VALUE)).toBeNull();
    expect(() => writePlanningIntent(INPUT, {
      storage,
      now: Number.MAX_VALUE,
    })).not.toThrow();
    expect(writePlanningIntent(INPUT, {
      storage,
      now: Number.MAX_VALUE,
    })).toBeNull();
    expect(storage.values.get(PLANNING_INTENT_STORAGE_KEY)).toBe(raw);
  });

  it("reads without refreshing acceptedAt, expiresAt, or stored bytes", () => {
    const raw = validRaw();
    const storage = memoryStorage(raw);
    const read = readPlanningIntent({ storage, now: NOW + 60_000 });

    expect(read?.acceptedAt).toBe("2026-07-24T18:00:00.000Z");
    expect(read?.expiresAt).toBe("2026-07-24T20:00:00.000Z");
    expect(storage.values.get(PLANNING_INTENT_STORAGE_KEY)).toBe(raw);
  });

  it("clears malformed, expired, oversized, and unsupported stored values best-effort", () => {
    const badValues = [
      "{",
      validRaw({ version: 2 }),
      validRaw({ expiresAt: new Date(NOW + 1).toISOString() }),
      JSON.stringify({ pad: "x".repeat(PLANNING_INTENT_MAX_RAW_BYTES) }),
    ];

    for (const raw of badValues) {
      const storage = memoryStorage(raw);
      expect(readPlanningIntent({ storage, now: NOW + PLANNING_INTENT_TTL_MS })).toBeNull();
      expect(storage.values.has(PLANNING_INTENT_STORAGE_KEY)).toBe(false);
    }
  });

  it("can validate without mutating storage during a render snapshot", () => {
    const raw = "{";
    const storage = memoryStorage(raw);

    expect(readPlanningIntent({ storage, now: NOW, cleanupInvalid: false })).toBeNull();
    expect(storage.values.get(PLANNING_INTENT_STORAGE_KEY)).toBe(raw);
  });

  it("never throws when storage access is blocked", () => {
    const blocked: PlanningIntentStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };

    expect(() => readPlanningIntent({ storage: blocked, now: NOW })).not.toThrow();
    expect(readPlanningIntent({ storage: blocked, now: NOW })).toBeNull();
    expect(() => writePlanningIntent(INPUT, { storage: blocked, now: NOW })).not.toThrow();
    expect(writePlanningIntent(INPUT, { storage: blocked, now: NOW })).toBeNull();
    expect(() => clearPlanningIntent({ storage: blocked })).not.toThrow();
  });

  it("clears after dismissal, Plan creation, and Plan upgrade", () => {
    for (const disposition of [
      "dismissed",
      "plan-created",
      "plan-upgraded",
    ] as const) {
      const storage = memoryStorage(validRaw());
      settlePlanningIntent(disposition, { storage });
      expect(storage.values.has(PLANNING_INTENT_STORAGE_KEY)).toBe(false);
    }
  });

  it("retains the exact envelope after generation failure", () => {
    const raw = validRaw();
    const storage = memoryStorage(raw);
    settlePlanningIntent("generation-failed", { storage });
    expect(storage.values.get(PLANNING_INTENT_STORAGE_KEY)).toBe(raw);
  });

  it("fails safely with missing storage", () => {
    expect(readPlanningIntent({ storage: null, now: NOW })).toBeNull();
    expect(writePlanningIntent(INPUT, { storage: null, now: NOW })).toBeNull();
    expect(() => clearPlanningIntent({ storage: null })).not.toThrow();
  });

  it("does not replace an existing intent when a new input is invalid", () => {
    const raw = validRaw();
    const storage = memoryStorage(raw);
    const invalid = {
      ...INPUT,
      acceptedVenueId: "https://example.com/pub",
    };

    expect(writePlanningIntent(invalid, { storage, now: NOW })).toBeNull();
    expect(storage.values.get(PLANNING_INTENT_STORAGE_KEY)).toBe(raw);
  });
});

describe("PlanningIntent change announcement", () => {
  // A same-tab localStorage/sessionStorage write raises no `storage` event, so
  // a Map that only listened for one kept the previous accepted-arrival answer
  // until a full page load. The writer announces itself instead.
  function fakeWindow() {
    const events: string[] = [];
    return {
      events,
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    };
  }

  function memoryStorage(): PlanningIntentStorage {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => { map.set(key, String(value)); },
      removeItem: (key) => { map.delete(key); },
    };
  }

  it("announces a landed write and a clear, and nothing else", () => {
    const win = fakeWindow();
    vi.stubGlobal("window", win);
    vi.stubGlobal("Event", class { constructor(public type: string) {} });
    try {
      const storage = memoryStorage();

      writePlanningIntent(INPUT, { storage, now: NOW });
      expect(win.events).toEqual([PLANNING_INTENT_CHANGED_EVENT]);

      clearPlanningIntent({ storage });
      expect(win.events).toEqual([
        PLANNING_INTENT_CHANGED_EVENT,
        PLANNING_INTENT_CHANGED_EVENT,
      ]);

      // A read is not a change.
      readPlanningIntent({ storage, now: NOW });
      expect(win.events).toHaveLength(2);

      // A refused write announces nothing: nothing changed.
      writePlanningIntent(
        { ...INPUT, acceptedVenueId: "not a venue id" },
        { storage, now: NOW },
      );
      expect(win.events).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stays silent on the server, where there is no window to tell", () => {
    const storage = memoryStorage();
    expect(() => writePlanningIntent(INPUT, { storage, now: NOW })).not.toThrow();
    expect(() => clearPlanningIntent({ storage })).not.toThrow();
  });
});
