import { beforeEach, describe, expect, it, vi } from "vitest";

type EventRow = {
  id: string;
  evidence_fingerprint: string;
  venue_id: string;
  category: string;
  observation_ids: string[];
  created_at: string;
  reversal_of: string | null;
};

const events: EventRow[] = [];
let reversalReadFails = false;

type QueryState = {
  eq: [string, unknown][];
  isNull: string[];
  inFilters: [string, unknown[]][];
  containsFilters: [string, unknown[]][];
  limit: number | null;
};

function matches(row: EventRow, state: QueryState): boolean {
  const record = row as unknown as Record<string, unknown>;
  for (const [column, value] of state.eq) {
    if (record[column] !== value) return false;
  }
  for (const column of state.isNull) {
    if (record[column] !== null) return false;
  }
  for (const [column, values] of state.inFilters) {
    if (!values.includes(record[column])) return false;
  }
  for (const [column, values] of state.containsFilters) {
    const held = record[column];
    if (!Array.isArray(held) || values.some((value) => !held.includes(value))) {
      return false;
    }
  }
  return true;
}

function makeQuery() {
  const state: QueryState = {
    eq: [],
    isNull: [],
    inFilters: [],
    containsFilters: [],
    limit: null,
  };
  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      state.eq.push([column, value]);
      return query;
    },
    is(column: string, value: unknown) {
      if (value === null) state.isNull.push(column);
      return query;
    },
    in(column: string, values: unknown[]) {
      state.inFilters.push([column, values]);
      return query;
    },
    contains(column: string, values: unknown[]) {
      state.containsFilters.push([column, values]);
      return query;
    },
    order() {
      return query;
    },
    limit(value: number) {
      state.limit = value;
      return query;
    },
    then(
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      const readsReversals = state.inFilters.some(([column]) => column === "reversal_of");
      if (readsReversals && reversalReadFails) {
        return Promise.resolve({
          data: null,
          error: { message: "database unavailable" },
        }).then(resolve, reject);
      }
      const matching = events.filter((row) => matches(row, state));
      return Promise.resolve({
        data: state.limit === null ? matching : matching.slice(0, state.limit),
        error: null,
      }).then(resolve, reject);
    },
  };
  return query;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
}));

import { supabasePriceTrustEventStore } from "@/lib/priceTrustEventStore";

const UNLOCK: EventRow = {
  id: "event-one",
  evidence_fingerprint: "fingerprint-one",
  venue_id: "venue-one",
  category: "beer",
  observation_ids: ["obs-a", "obs-b"],
  created_at: "2026-08-16T18:00:00.000Z",
  reversal_of: null,
};

beforeEach(() => {
  events.length = 0;
  reversalReadFails = false;
});

describe("supabasePriceTrustEventStore.liveEventsFor", () => {
  it("answers the live unlock when both reads land", async () => {
    events.push(UNLOCK);
    const live = await supabasePriceTrustEventStore.liveEventsFor("venue-one", "beer");
    expect(live.degraded).toBe(false);
    expect(live.events.map((event) => event.id)).toEqual(["event-one"]);
  });

  it("drops an unlock a reversal already covered", async () => {
    events.push(UNLOCK, {
      ...UNLOCK,
      id: "event-two",
      evidence_fingerprint: "fingerprint-two",
      observation_ids: [],
      reversal_of: "event-one",
    });
    const live = await supabasePriceTrustEventStore.liveEventsFor("venue-one", "beer");
    expect(live.degraded).toBe(false);
    expect(live.events).toEqual([]);
  });

  it("degrades when the reversal read fails instead of reporting a reversed unlock as live", async () => {
    events.push(UNLOCK);
    reversalReadFails = true;
    await expect(
      supabasePriceTrustEventStore.liveEventsFor("venue-one", "beer"),
    ).resolves.toEqual({ events: [], degraded: true });
  });

  it("skips the reversal read when no unlock matched", async () => {
    reversalReadFails = true;
    await expect(
      supabasePriceTrustEventStore.liveEventsFor("venue-one", "beer"),
    ).resolves.toEqual({ events: [], degraded: false });
  });
});

describe("supabasePriceTrustEventStore.latestReversalCovering", () => {
  it("finds the terminal reversal through a repeated cycle with equal timestamps", async () => {
    const timestamp = "2026-08-16T18:00:00.000Z";
    events.push(
      UNLOCK,
      {
        ...UNLOCK,
        id: "reversal-one",
        evidence_fingerprint: "reverse-one",
        observation_ids: [],
        created_at: timestamp,
        reversal_of: "event-one",
      },
      {
        ...UNLOCK,
        id: "event-two",
        evidence_fingerprint: "restored:fingerprint-one:reversal-one",
        created_at: timestamp,
      },
      {
        ...UNLOCK,
        id: "reversal-two",
        evidence_fingerprint: "reverse-two",
        observation_ids: [],
        created_at: timestamp,
        reversal_of: "event-two",
      },
    );

    const result = await supabasePriceTrustEventStore.latestReversalCovering("obs-a");

    expect(result.degraded).toBe(false);
    expect(result.event?.id).toBe("reversal-two");

    await expect(
      supabasePriceTrustEventStore.terminalReversalFor({
        id: UNLOCK.id,
        evidenceFingerprint: UNLOCK.evidence_fingerprint,
        venueId: UNLOCK.venue_id,
        category: "beer",
        observationIds: UNLOCK.observation_ids,
        createdAt: UNLOCK.created_at,
        reversalOf: null,
      }),
    ).resolves.toMatchObject({
      event: { id: "reversal-two" },
      degraded: false,
    });
  });

  it("degrades when the covering chain exceeds the bounded read", async () => {
    for (let index = 0; index < 101; index += 1) {
      events.push({
        ...UNLOCK,
        id: `event-${index}`,
        evidence_fingerprint: `fingerprint-${index}`,
      });
    }
    events.push({
      ...UNLOCK,
      id: "reversal-overflow",
      evidence_fingerprint: "reverse-overflow",
      observation_ids: [],
      reversal_of: "event-100",
    });

    await expect(
      supabasePriceTrustEventStore.latestReversalCovering("obs-a"),
    ).resolves.toEqual({ event: null, degraded: true });
  });
});
