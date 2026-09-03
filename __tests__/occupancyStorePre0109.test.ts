// The deploy window where 0107 is applied and 0109 is not.
//
// PostgREST answers a select naming an unknown column with 42703 - the TABLE is
// there, one column is not - which is a different finding from a missing table.
// Occupancy worked on 0107 alone, so it has to keep working here: a reader may
// not be told "Could not check how busy it is." and a crowd tap may not 503
// because the moderation lane has not landed yet.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseOccupancyStore, __resetMemoryOccupancyReports } from "@/lib/occupancyStore";

type Row = Record<string, unknown>;

const NOW = Date.parse("2026-08-16T18:00:00.000Z");

/** Columns migration 0107 created. Everything else is 0109's. */
const BASE_COLUMNS = new Set([
  "id",
  "venue_id",
  "reported_at",
  "level",
  "reporter_user_id",
  "source",
]);

const rows: Row[] = [];
let moderationApplied = false;
const selectsSeen: string[] = [];

const undefinedColumn = (column: string) => ({
  code: "42703",
  message: `column venue_occupancy_reports.${column} does not exist`,
});

function unknownColumns(select: string): string[] {
  return select
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !BASE_COLUMNS.has(part));
}

/**
 * A PostgREST-shaped query builder: chainable, thenable, and it refuses a
 * select naming a column this database has never had.
 */
function builder(source: Row[]) {
  const filters: ((row: Row) => boolean)[] = [];
  let selected: string | null = null;
  let limit = Infinity;
  let descBy: string | null = null;

  const settle = () => {
    if (selected !== null && !moderationApplied) {
      const missing = unknownColumns(selected);
      if (missing.length > 0) {
        return { data: null, error: undefinedColumn(missing[0]) };
      }
    }
    let data = source.filter((row) => filters.every((keep) => keep(row)));
    const column = descBy;
    if (column) {
      data = [...data].sort((a, b) =>
        String(b[column]).localeCompare(String(a[column])),
      );
    }
    return { data: data.slice(0, limit), error: null };
  };

  const api = {
    select(columns: string) {
      selected = columns;
      selectsSeen.push(columns);
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return api;
    },
    is(column: string, value: unknown) {
      filters.push((row) => (row[column] ?? null) === value);
      return api;
    },
    gte(column: string, value: string) {
      filters.push((row) => String(row[column]) >= value);
      return api;
    },
    order(column: string) {
      descBy = column;
      return api;
    },
    limit(count: number) {
      limit = count;
      return api;
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(settle()).then(resolve, reject);
    },
  };
  return api;
}

const admin = {
  from() {
    return {
      select(columns: string) {
        return builder(rows).select(columns);
      },
      insert(row: Row) {
        rows.push({ ...row, hidden_at: null, report_count: 0, report_reason: null });
        return {
          select(columns: string) {
            return builder([rows[rows.length - 1]]).select(columns);
          },
        };
      },
      update(patch: Row) {
        const touched: Row[] = [];
        return {
          eq(column: string, value: unknown) {
            for (const row of rows) {
              if (row[column] === value) {
                Object.assign(row, patch);
                touched.push(row);
              }
            }
            return {
              select(columns: string) {
                return builder(touched).select(columns);
              },
            };
          },
        };
      },
    };
  },
};

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => admin,
}));

function seed(level: string, minutesAgo: number, reporter: string, extra: Row = {}) {
  rows.push({
    id: `report-${rows.length + 1}`,
    venue_id: "venue-1",
    reported_at: new Date(NOW - minutesAgo * 60 * 1000).toISOString(),
    level,
    reporter_user_id: reporter,
    source: "crowd",
    hidden_at: null,
    report_count: 0,
    report_reason: null,
    ...extra,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  rows.length = 0;
  selectsSeen.length = 0;
  moderationApplied = false;
  __resetMemoryOccupancyReports();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("occupancy on a database that has 0107 but not 0109", () => {
  it("still answers the pub's own crowd reading rather than degrading", async () => {
    seed("full", 5, "user-a");

    const reading = await supabaseOccupancyStore.readNow("venue-1");

    expect(reading.degraded).toBe(false);
    expect(reading.state).toBe("fresh");
    expect(reading.now).toBe("full");
    expect(reading.reportersLast90).toBe(1);
    // It asked for the moderation columns once, was refused, and re-asked.
    expect(selectsSeen[0]).toContain("hidden_at");
    expect(selectsSeen[selectsSeen.length - 1]).not.toContain("hidden_at");
  });

  it("still takes a crowd tap rather than answering 503", async () => {
    const stored = await supabaseOccupancyStore.report({
      venueId: "venue-1",
      level: "some-seats",
      reporterUserId: "user-a",
    });

    expect(stored.level).toBe("some-seats");
    expect(stored.hiddenAt).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it("asks for the narrow columns only once, then stops re-asking", async () => {
    seed("empty", 3, "user-a");

    await supabaseOccupancyStore.readNow("venue-1");
    const afterFirst = selectsSeen.length;
    await supabaseOccupancyStore.readNow("venue-1");

    expect(selectsSeen.length).toBe(afterFirst + 1);
    expect(selectsSeen.slice(afterFirst).every((s) => !s.includes("hidden_at"))).toBe(
      true,
    );
  });

  it("keeps the 15-minute retake working without the hidden filter", async () => {
    const first = await supabaseOccupancyStore.report({
      venueId: "venue-1",
      level: "empty",
      reporterUserId: "user-a",
    });
    vi.setSystemTime(NOW + 5 * 60 * 1000);
    const second = await supabaseOccupancyStore.report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });

    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe("full");
  });
});

describe("occupancy once 0109 is applied", () => {
  beforeEach(() => {
    moderationApplied = true;
  });

  it("keeps a hidden row out of the row cap rather than filtering after it", async () => {
    seed("full", 2, "user-a", { hidden_at: new Date(NOW).toISOString() });
    seed("empty", 4, "user-b");

    const reading = await supabaseOccupancyStore.readNow("venue-1");

    expect(reading.now).toBe("empty");
    expect(reading.reportersLast90).toBe(1);
    expect(selectsSeen.every((s) => s.includes("hidden_at"))).toBe(true);
  });
});
