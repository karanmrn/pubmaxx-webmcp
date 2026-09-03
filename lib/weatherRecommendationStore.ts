// Dual-backend store for authored weather Recommendations.
//
// Public rows carry a contributor handle because attribution is part of the
// opinion. The server-derived actor hash is a separate private field used for
// abuse controls and audit provenance. It never crosses this module's public
// projection. One contributor owns one row per venue and weather condition, so
// editing a reason cannot inflate contributor-record counts.

import "server-only";

import { randomUUID } from "node:crypto";

import { isDeployedProduction } from "@/lib/deploymentEnv";
import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  validateWeatherRecommendation,
  type WeatherRecommendation,
  type WeatherRecommendationInput,
} from "@/lib/weatherRecommendations";
import { normalizeHandle } from "@/lib/profiles";
import type {
  ContributionRecord,
  ContributionRecordReadResult,
} from "@/lib/contributorLeaderboard";

const TABLE = "weather_recommendations";

export const MAX_WEATHER_RECOMMENDATIONS_PER_VENUE = 20;

export type WeatherRecommendationWrite = WeatherRecommendationInput & {
  actorHash: string;
};

export type WeatherRecommendationReadResult = {
  status: "ready" | "degraded";
  recommendations: WeatherRecommendation[];
};

export type WeatherRecommendationContributorCountResult = {
  status: "ready" | "degraded";
  count: number;
};

export type WeatherRecommendationStore = {
  create(
    input: WeatherRecommendationWrite,
    now?: number,
  ): Promise<WeatherRecommendation>;
  listForVenue(venueId: string): Promise<WeatherRecommendationReadResult>;
  countForContributor(
    contributorHandle: string,
  ): Promise<WeatherRecommendationContributorCountResult>;
  moderate(
    id: string,
    status: "visible" | "hidden",
    note?: string,
  ): Promise<boolean>;
  listLeaderboardContributions(): Promise<ContributionRecordReadResult>;
};

type StoredWeatherRecommendation = WeatherRecommendation & {
  actorHash: string;
  status: "visible" | "hidden";
  moderatedAt?: number;
  moderatorNote?: string;
};

type NormalizedWeatherRecommendationWrite = WeatherRecommendationInput & {
  actorHash: string;
};

function naturalKey(
  row: Pick<
    WeatherRecommendationInput,
    "venueId" | "condition" | "contributorHandle"
  >,
): string {
  return `${row.venueId}::${row.condition}::${row.contributorHandle}`;
}

function validWrite(
  input: WeatherRecommendationWrite,
): NormalizedWeatherRecommendationWrite {
  const validation = validateWeatherRecommendation(input);
  const actorHash =
    typeof input.actorHash === "string" ? input.actorHash.trim().slice(0, 160) : "";
  if (!validation.ok) throw new Error(validation.error);
  if (!actorHash) throw new Error("Account key is missing.");
  return { ...validation.value, actorHash };
}

function published(
  row: StoredWeatherRecommendation,
): WeatherRecommendation {
  return {
    id: row.id,
    venueId: row.venueId,
    condition: row.condition,
    reason: row.reason,
    contributorHandle: row.contributorHandle,
    submittedAt: row.submittedAt,
    source: "community",
  };
}

function recommendationContributionRecord(
  row: StoredWeatherRecommendation,
): ContributionRecord {
  return {
    id: row.id,
    handle: row.contributorHandle,
    lane: "recommendation",
    contributedAt: row.submittedAt,
    visible: row.status === "visible",
    quality: {
      corroborated: null,
      moderation:
        row.status === "hidden"
          ? "hidden"
          : row.moderatedAt
            ? "kept"
            : "unreviewed",
      contradicted: null,
    },
  };
}

type WeatherRecommendationMemoryState = {
  rows: Map<string, StoredWeatherRecommendation>;
  idsByNaturalKey: Map<string, string>;
};

const MEMORY_STATE_KEY = "__pubmaxWeatherRecommendationMemory" as const;
const sharedProcess = globalThis as typeof globalThis & {
  [MEMORY_STATE_KEY]?: WeatherRecommendationMemoryState;
};

// Process-level memory store for keyless development and tests. The global
// owner matters in Next dev: webpack may reload a route module after a write,
// but that must not make the drinker's saved recommendation disappear.
const memoryState =
  sharedProcess[MEMORY_STATE_KEY] ??
  (sharedProcess[MEMORY_STATE_KEY] = {
    rows: new Map<string, StoredWeatherRecommendation>(),
    idsByNaturalKey: new Map<string, string>(),
  });
const memoryRows = memoryState.rows;
const memoryIdsByNaturalKey = memoryState.idsByNaturalKey;

export const memoryWeatherRecommendationStore: WeatherRecommendationStore = {
  async create(raw, now = Date.now()) {
    const input = validWrite(raw);
    const key = naturalKey(input);
    const id = memoryIdsByNaturalKey.get(key) ?? randomUUID();
    const previous = memoryRows.get(id);
    const row: StoredWeatherRecommendation = {
      id,
      venueId: input.venueId,
      condition: input.condition,
      reason: input.reason,
      contributorHandle: input.contributorHandle,
      actorHash: input.actorHash,
      status: previous?.status ?? "visible",
      ...(previous?.moderatedAt
        ? { moderatedAt: previous.moderatedAt }
        : {}),
      ...(previous?.moderatorNote
        ? { moderatorNote: previous.moderatorNote }
        : {}),
      submittedAt: now,
      source: "community",
    };
    memoryRows.set(id, row);
    memoryIdsByNaturalKey.set(key, id);
    return published(row);
  },

  async listForVenue(venueId) {
    const recommendations = [...memoryRows.values()]
      .filter((row) => row.venueId === venueId && row.status === "visible")
      .sort((left, right) => right.submittedAt - left.submittedAt)
      .slice(0, MAX_WEATHER_RECOMMENDATIONS_PER_VENUE)
      .map(published);
    return { status: "ready", recommendations };
  },

  async countForContributor(contributorHandle) {
    const handle = normalizeHandle(contributorHandle);
    if (!handle) return { status: "ready", count: 0 };
    const count = [...memoryRows.values()].filter(
      (row) =>
        row.contributorHandle === handle && row.status === "visible",
    ).length;
    return { status: "ready", count };
  },

  async moderate(id, status, note) {
    const row = memoryRows.get(id);
    if (!row) return false;
    row.status = status;
    row.moderatedAt = Date.now();
    const cleaned = typeof note === "string" ? note.trim().slice(0, 280) : "";
    if (cleaned) row.moderatorNote = cleaned;
    return true;
  },

  async listLeaderboardContributions() {
    return {
      status: "ready",
      records: [...memoryRows.values()].map(
        recommendationContributionRecord,
      ),
    };
  },
};

type WeatherRecommendationRow = {
  id: unknown;
  venue_id: unknown;
  condition: unknown;
  reason: unknown;
  contributor_handle: unknown;
  submitted_at: unknown;
  actor_hash?: unknown;
  status?: unknown;
  moderated_at?: unknown;
  moderator_note?: unknown;
};

function storedFromRow(
  row: WeatherRecommendationRow,
): StoredWeatherRecommendation | null {
  const validation = validateWeatherRecommendation({
    venueId: row.venue_id,
    condition: row.condition,
    reason: row.reason,
    contributorHandle: row.contributor_handle,
  });
  const id = typeof row.id === "string" ? row.id : "";
  const submittedAt =
    typeof row.submitted_at === "string" ? Date.parse(row.submitted_at) : Number.NaN;
  if (!validation.ok || !id || !Number.isFinite(submittedAt)) return null;
  return {
    id,
    ...validation.value,
    submittedAt,
    source: "community",
    actorHash: typeof row.actor_hash === "string" ? row.actor_hash : "",
    status: row.status === "hidden" ? "hidden" : "visible",
    ...(typeof row.moderated_at === "string" &&
    Number.isFinite(Date.parse(row.moderated_at))
      ? { moderatedAt: Date.parse(row.moderated_at) }
      : {}),
    ...(typeof row.moderator_note === "string" && row.moderator_note
      ? { moderatorNote: row.moderator_note }
      : {}),
  };
}

function fromRow(row: WeatherRecommendationRow): WeatherRecommendation | null {
  const stored = storedFromRow(row);
  return stored ? published(stored) : null;
}

const { guard, resetWarnings } = createFailSoftGuard({
  tag: "weather-recommendations",
  tables: TABLE,
  migrationHint: "apply migration 0058",
});

function degradedRead(): WeatherRecommendationReadResult {
  return { status: "degraded", recommendations: [] };
}

function degradedCount(): WeatherRecommendationContributorCountResult {
  return { status: "degraded", count: 0 };
}

export const supabaseWeatherRecommendationStore: WeatherRecommendationStore = {
  async create(raw, now = Date.now()) {
    const input = validWrite(raw);
    const submittedAt = new Date(now).toISOString();
    return guard<WeatherRecommendation>({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "weather-recommendations",
          migrationHint: "apply migration 0058",
          fallback: () => memoryWeatherRecommendationStore.create(input, now),
        }),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from(TABLE)
          .upsert(
            {
              venue_id: input.venueId,
              condition: input.condition,
              reason: input.reason,
              contributor_handle: input.contributorHandle,
              actor_hash: input.actorHash,
              submitted_at: submittedAt,
            },
            { onConflict: "venue_id,condition,contributor_handle" },
          )
          .select(
            "id, venue_id, condition, reason, contributor_handle, submitted_at, status, moderated_at, moderator_note",
          )
          .single();
        if (error) throw new Error(error.message);
        const recommendation = fromRow(data as WeatherRecommendationRow);
        if (!recommendation) {
          throw new Error("Weather recommendation store returned an invalid row.");
        }
        return recommendation;
      },
    });
  },

  async listForVenue(venueId) {
    return guard<WeatherRecommendationReadResult>({
      context: "listForVenue",
      onSchemaMiss: () =>
        isDeployedProduction()
          ? Promise.resolve(degradedRead())
          : memoryWeatherRecommendationStore.listForVenue(venueId),
      message: "listForVenue failed, returning a degraded read",
      onError: degradedRead,
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from(TABLE)
          .select(
            "id, venue_id, condition, reason, contributor_handle, submitted_at, status, moderated_at, moderator_note",
          )
          .eq("venue_id", venueId)
          .eq("status", "visible")
          .order("submitted_at", { ascending: false })
          .limit(MAX_WEATHER_RECOMMENDATIONS_PER_VENUE);
        if (error) throw new Error(error.message);
        const recommendations = ((data ?? []) as WeatherRecommendationRow[])
          .map(fromRow)
          .filter(
            (row): row is WeatherRecommendation => row !== null,
          );
        return { status: "ready", recommendations };
      },
    });
  },

  async countForContributor(contributorHandle) {
    const handle = normalizeHandle(contributorHandle);
    if (!handle) return { status: "ready", count: 0 };
    return guard<WeatherRecommendationContributorCountResult>({
      context: "countForContributor",
      onSchemaMiss: () =>
        isDeployedProduction()
          ? Promise.resolve(degradedCount())
          : memoryWeatherRecommendationStore.countForContributor(handle),
      message: "countForContributor failed, returning a degraded count",
      onError: degradedCount,
      run: async () => {
        const { count, error } = await requireSupabaseAdmin()
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("contributor_handle", handle)
          .eq("status", "visible");
        if (error) throw new Error(error.message);
        return { status: "ready", count: count ?? 0 };
      },
    });
  },

  async moderate(id, status, note) {
    if (!id) return false;
    return guard<boolean>({
      context: "moderate",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "weather-recommendations",
          migrationHint: "apply migration 0059",
          fallback: () =>
            memoryWeatherRecommendationStore.moderate(id, status, note),
        }),
      run: async () => {
        const cleaned =
          typeof note === "string" ? note.trim().slice(0, 280) : "";
        const { data, error } = await requireSupabaseAdmin()
          .from(TABLE)
          .update({
            status,
            moderated_at: new Date().toISOString(),
            ...(cleaned ? { moderator_note: cleaned } : {}),
          })
          .eq("id", id)
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },

  async listLeaderboardContributions() {
    return guard<ContributionRecordReadResult>({
      context: "leaderboard-contributions",
      onSchemaMiss: async () => ({
        ...(await memoryWeatherRecommendationStore.listLeaderboardContributions()),
        status: "degraded",
      }),
      message: "leaderboard contribution read failed",
      onError: () => ({ status: "degraded", records: [] }),
      run: async () => {
        const records: ContributionRecord[] = [];
        const pageSize = 1_000;
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await requireSupabaseAdmin()
            .from(TABLE)
            .select(
              "id, venue_id, condition, reason, contributor_handle, actor_hash, submitted_at, status, moderated_at, moderator_note",
            )
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, offset + pageSize - 1);
          if (error) throw new Error(error.message);
          const page = (data ?? []) as WeatherRecommendationRow[];
          for (const row of page) {
            const stored = storedFromRow(row);
            if (stored) records.push(recommendationContributionRecord(stored));
          }
          if (page.length < pageSize) break;
        }
        return { status: "ready", records };
      },
    });
  },
};

export function weatherRecommendationStore(): WeatherRecommendationStore {
  return selectStore(
    memoryWeatherRecommendationStore,
    supabaseWeatherRecommendationStore,
  );
}

export function submitWeatherRecommendation(
  input: WeatherRecommendationWrite,
  now?: number,
): Promise<WeatherRecommendation> {
  return weatherRecommendationStore().create(input, now);
}

export function readWeatherRecommendations(
  venueId: string,
): Promise<WeatherRecommendationReadResult> {
  return weatherRecommendationStore().listForVenue(venueId);
}

export function __resetWeatherRecommendations(): void {
  memoryRows.clear();
  memoryIdsByNaturalKey.clear();
  resetWarnings();
}
