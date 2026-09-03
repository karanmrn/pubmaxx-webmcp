import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  venue_id: string;
  drink_category: string | null;
  price_pennies: number;
  submitted_at: string;
  actor: string | null;
  hidden_at: string | null;
};

type QueryState = {
  table: string;
  head: boolean;
  exactCount: boolean;
  eq: [string, unknown][];
  inFilters: [string, unknown[]][];
  notNull: string[];
  isNull: string[];
  limit: number | null;
  range: [number, number] | null;
};

const table: Row[] = [];
const requests: QueryState[] = [];
let failReads = false;

function matches(row: Row, state: QueryState): boolean {
  for (const column of state.notNull) {
    if ((row as unknown as Record<string, unknown>)[column] == null) return false;
  }
  for (const column of state.isNull) {
    if ((row as unknown as Record<string, unknown>)[column] != null) return false;
  }
  for (const [column, value] of state.eq) {
    if ((row as unknown as Record<string, unknown>)[column] !== value) return false;
  }
  for (const [column, values] of state.inFilters) {
    if (!values.includes((row as unknown as Record<string, unknown>)[column])) {
      return false;
    }
  }
  return true;
}

function run(state: QueryState) {
  requests.push(state);
  if (failReads) return { data: null, count: null, error: { message: "database unavailable" } };
  const matched = table
    .filter((row) => matches(row, state))
    .sort(
      (left, right) =>
        Date.parse(right.submitted_at) - Date.parse(left.submitted_at) ||
        left.id.localeCompare(right.id),
    );
  if (state.head && state.exactCount) {
    return { data: null, count: matched.length, error: null };
  }
  let page = matched;
  if (state.range) page = page.slice(state.range[0], state.range[1] + 1);
  if (state.limit !== null) page = page.slice(0, state.limit);
  return { data: page, count: null, error: null };
}

function makeQuery(name: string) {
  const state: QueryState = {
    table: name,
    head: false,
    exactCount: false,
    eq: [],
    inFilters: [],
    notNull: [],
    isNull: [],
    limit: null,
    range: null,
  };
  const query = {
    select(_columns: string, options?: { count?: string; head?: boolean }) {
      state.head = options?.head === true;
      state.exactCount = options?.count === "exact";
      return query;
    },
    not(column: string, operator: string, _value: unknown) {
      if (operator === "is") state.notNull.push(column);
      return query;
    },
    is(column: string, value: unknown) {
      if (value === null) state.isNull.push(column);
      return query;
    },
    eq(column: string, value: unknown) {
      state.eq.push([column, value]);
      return query;
    },
    in(column: string, values: unknown[]) {
      state.inFilters.push([column, values]);
      return query;
    },
    order() {
      return query;
    },
    limit(value: number) {
      state.limit = value;
      return query;
    },
    range(from: number, to: number) {
      state.range = [from, to];
      return query;
    },
    then(
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(run(state)).then(resolve, reject);
    },
  };
  return query;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ from: (name: string) => makeQuery(name) }),
}));

import {
  countCommunityPriceObservationsForActor,
  listCommunityPriceObservations,
  listCommunityPriceObservationsForPairs,
} from "@/lib/communityPriceStore";

const ACTOR = "profile:aaaaaaaa-0000-4000-8000-00000000aaaa";

function price(index: number, overrides: Partial<Row> = {}): Row {
  return {
    id: `obs-${String(index).padStart(4, "0")}`,
    venue_id: "venue-one",
    drink_category: "beer",
    price_pennies: 420,
    submitted_at: new Date(Date.parse("2026-08-16T18:00:00.000Z") - index * 1_000).toISOString(),
    actor: ACTOR,
    hidden_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  table.length = 0;
  requests.length = 0;
  failReads = false;
});

describe("countCommunityPriceObservationsForActor", () => {
  it("counts every logged price past the venue scan window", async () => {
    for (let index = 0; index < 250; index += 1) table.push(price(index));

    await expect(countCommunityPriceObservationsForActor(ACTOR)).resolves.toEqual({
      count: 250,
      degraded: false,
    });
    expect(requests.at(-1)).toMatchObject({ head: true, exactCount: true });
  });

  it("leaves a hidden row and another contributor's row out", async () => {
    table.push(price(0));
    table.push(price(1, { hidden_at: "2026-08-16T19:00:00.000Z" }));
    table.push(price(2, { actor: "profile:someone-else" }));

    await expect(countCommunityPriceObservationsForActor(ACTOR)).resolves.toEqual({
      count: 1,
      degraded: false,
    });
  });

  it("reports a failed count as degraded rather than zero", async () => {
    failReads = true;
    await expect(countCommunityPriceObservationsForActor(ACTOR)).resolves.toEqual({
      count: 0,
      degraded: true,
    });
  });
});

describe("listCommunityPriceObservations", () => {
  it("reads every row behind a trust decision, past the old venue scan cap", async () => {
    for (let index = 0; index < 250; index += 1) table.push(price(index));

    const result = await listCommunityPriceObservations("venue-one", "beer");

    expect(result.degraded).toBe(false);
    expect(result.observations).toHaveLength(250);
  });

  it("reports a failed venue read as degraded", async () => {
    failReads = true;
    await expect(
      listCommunityPriceObservations("venue-one", "beer"),
    ).resolves.toEqual({ observations: [], degraded: true });
  });
});

describe("listCommunityPriceObservationsForPairs", () => {
  it("reads every wanted pair in one scan and drops rows outside them", async () => {
    table.push(price(1, { venue_id: "venue-one", drink_category: "beer" }));
    table.push(price(2, { venue_id: "venue-two", drink_category: "wine" }));
    table.push(price(3, { venue_id: "venue-one", drink_category: "wine" }));
    table.push(price(4, { venue_id: "venue-three", drink_category: "beer" }));

    const result = await listCommunityPriceObservationsForPairs([
      { venueId: "venue-one", drinkCategory: "beer" },
      { venueId: "venue-two", drinkCategory: "wine" },
    ]);

    expect(result.degraded).toBe(false);
    expect(result.observations.map((row) => row.id).sort()).toEqual([
      "obs-0001",
      "obs-0002",
    ]);
    expect(requests).toHaveLength(1);
  });

  it("degrades rather than answering a short list past the pair cap", async () => {
    const pairs = Array.from({ length: 51 }, (_unused, index) => ({
      venueId: `venue-${index}`,
      drinkCategory: "beer" as const,
    }));

    await expect(listCommunityPriceObservationsForPairs(pairs)).resolves.toEqual({
      observations: [],
      degraded: true,
    });
    expect(requests).toHaveLength(0);
  });

  it("reports a failed pair scan as degraded", async () => {
    failReads = true;
    await expect(
      listCommunityPriceObservationsForPairs([
        { venueId: "venue-one", drinkCategory: "beer" },
      ]),
    ).resolves.toEqual({ observations: [], degraded: true });
  });
});
