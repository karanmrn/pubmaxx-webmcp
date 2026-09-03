import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  venue_id: string;
  condition: string;
  reason: string;
  contributor_handle: string;
  actor_hash: string;
  submitted_at: string;
  status: "visible" | "hidden";
  moderated_at?: string;
  moderator_note?: string;
};

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  failReads: false,
  failWrites: false,
  schemaMiss: false,
  conflictTarget: "",
}));

vi.mock("@/lib/supabase", () => {
  function makeQuery() {
    let countMode = false;
    let upserted: Row | null = null;
    const filters: Array<{ column: string; value: unknown }> = [];

    function filtered(): Row[] {
      return db.rows.filter((row) =>
        filters.every(
          ({ column, value }) =>
            row[column as keyof Row] === value,
        ),
      );
    }

    const query = {
      upsert(
        raw: Omit<Row, "id" | "status">,
        options: { onConflict: string },
      ) {
        db.conflictTarget = options.onConflict;
        const existing = db.rows.find(
          (row) =>
            row.venue_id === raw.venue_id &&
            row.condition === raw.condition &&
            row.contributor_handle === raw.contributor_handle,
        );
        upserted = {
          ...raw,
          id: existing?.id ?? `recommendation-${db.rows.length + 1}`,
          status: existing?.status ?? "visible",
          ...(existing?.moderated_at
            ? { moderated_at: existing.moderated_at }
            : {}),
          ...(existing?.moderator_note
            ? { moderator_note: existing.moderator_note }
            : {}),
        };
        if (existing) {
          db.rows.splice(db.rows.indexOf(existing), 1, upserted);
        } else {
          db.rows.push(upserted);
        }
        return query;
      },
      select(
        _columns: string,
        options?: { count?: string; head?: boolean },
      ) {
        countMode = options?.count === "exact";
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return query;
      },
      then(
        resolve: (result: {
          count: number | null;
          error: { message: string } | null;
        }) => unknown,
      ) {
        if (countMode && db.failReads) {
          return Promise.resolve({
            count: null,
            error: { message: "database unavailable" },
          }).then(resolve);
        }
        return Promise.resolve({
          count: filtered().length,
          error: null,
        }).then(resolve);
      },
      order(column: keyof Row, options: { ascending: boolean }) {
        db.rows.sort((left, right) => {
          const compared = String(left[column]).localeCompare(
            String(right[column]),
          );
          return options.ascending ? compared : -compared;
        });
        return query;
      },
      limit(limit: number) {
        if (db.failReads) {
          return Promise.resolve({
            data: null,
            error: { message: "database unavailable" },
          });
        }
        return Promise.resolve({
          data: filtered().slice(0, limit),
          error: null,
        });
      },
      single() {
        if (db.schemaMiss) {
          return Promise.resolve({
            data: null,
            error: {
              message:
                "Could not find the table 'public.weather_recommendations'",
            },
          });
        }
        if (db.failWrites) {
          return Promise.resolve({
            data: null,
            error: { message: "write unavailable" },
          });
        }
        return Promise.resolve({ data: upserted, error: null });
      },
    };
    return query;
  }

  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => makeQuery() }),
  };
});

import {
  __resetWeatherRecommendations,
  memoryWeatherRecommendationStore,
  supabaseWeatherRecommendationStore,
  type WeatherRecommendationWrite,
} from "@/lib/weatherRecommendationStore";

function input(
  overrides: Partial<WeatherRecommendationWrite> = {},
): WeatherRecommendationWrite {
  return {
    venueId: "venue-1",
    condition: "warm" as const,
    reason: "The back garden catches the evening light.",
    contributorHandle: "night_owl",
    actorHash: "server-actor-a",
    ...overrides,
  };
}

beforeEach(() => {
  db.rows = [];
  db.failReads = false;
  db.failWrites = false;
  db.schemaMiss = false;
  db.conflictTarget = "";
  __resetWeatherRecommendations();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("supabaseWeatherRecommendationStore", () => {
  it("upserts, lists, and counts through the durable contract", async () => {
    const first = await supabaseWeatherRecommendationStore.create(input(), 1_000);
    const updated = await supabaseWeatherRecommendationStore.create(
      input({
        reason: "The later reason stays attached to the same opinion.",
        actorHash: "server-actor-b",
      }),
      2_000,
    );
    await supabaseWeatherRecommendationStore.create(
      input({
        venueId: "venue-2",
        condition: "cold",
        reason: "The fire makes a cold evening work.",
      }),
      3_000,
    );

    expect(updated.id).toBe(first.id);
    expect(db.conflictTarget).toBe(
      "venue_id,condition,contributor_handle",
    );
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0]?.actor_hash).toBe("server-actor-b");
    expect(
      await supabaseWeatherRecommendationStore.listForVenue("venue-1"),
    ).toEqual({
      status: "ready",
      recommendations: [updated],
    });
    expect(
      await supabaseWeatherRecommendationStore.countForContributor(
        "NIGHT_OWL",
      ),
    ).toEqual({ status: "ready", count: 2 });
    expect(JSON.stringify(updated)).not.toContain("actor");
  });

  it("returns only the newest 20 durable rows", async () => {
    db.rows = Array.from({ length: 25 }, (_, index) => ({
      id: `recommendation-${index}`,
      venue_id: "venue-1",
      condition: "warm",
      reason: "A useful reason for this weather.",
      contributor_handle: `person_${index}`,
      actor_hash: `server-actor-${index}`,
      submitted_at: new Date(index * 1_000).toISOString(),
      status: "visible",
    }));

    const read =
      await supabaseWeatherRecommendationStore.listForVenue("venue-1");

    expect(read.recommendations).toHaveLength(20);
    expect(read.recommendations[0]?.contributorHandle).toBe("person_24");
    expect(read.recommendations.at(-1)?.contributorHandle).toBe("person_5");
    expect(JSON.stringify(read)).not.toContain("server-actor");
  });

  it("keeps hard durable read failures distinct from empty results", async () => {
    db.failReads = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      await supabaseWeatherRecommendationStore.listForVenue("venue-1"),
    ).toEqual({ status: "degraded", recommendations: [] });
    expect(
      await supabaseWeatherRecommendationStore.countForContributor(
        "night_owl",
      ),
    ).toEqual({ status: "degraded", count: 0 });
  });

  it("throws on a hard durable write failure", async () => {
    db.failWrites = true;
    await expect(
      supabaseWeatherRecommendationStore.create(input()),
    ).rejects.toThrow("write unavailable");
  });

  it("uses memory only for a missing schema outside production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    db.schemaMiss = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const created = await supabaseWeatherRecommendationStore.create(input());

    expect(created.contributorHandle).toBe("night_owl");
    expect(
      await memoryWeatherRecommendationStore.listForVenue("venue-1"),
    ).toMatchObject({
      status: "ready",
      recommendations: [
        expect.objectContaining({ contributorHandle: "night_owl" }),
      ],
    });
  });
});
