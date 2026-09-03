// Structured Visit Reports store (Wayfinder 3.4) — the impure seam. ONE store
// interface, TWO implementations (process-memory + Supabase
// public.structured_visit_reports), chosen at the single visitReportsStore()
// seam, exactly like areaDemandStore / ratingsStore / priceConfirmStore.
//
// Supabase when env keys exist, process-memory otherwise. Before migrations
// 0046 and 0058 land (or on a schema-cache miss) local/preview paths fail soft
// to the in-memory store so demos keep working. Deployed production fails closed: missing-schema
// and hard write failures throw so the route answers 503 (house rule: degraded
// dependency, never a fake success). Reads remain fail-soft.
//
// Idempotent by construction: ONE report per handle per venue per night. A
// re-submission for the same (venueId, handle, visitedAt) UPDATES the existing
// row in place (same id) rather than stacking a second row.
//
// Moderation mirrors community prices: a public `report` records a
// per-actor-deduped flag but never hides a row. `listForReview()` feeds the admin
// queue and `listHidden()` the lane of already-hidden rows (a hide has to stay
// reversible from the surface that made it); only `moderate` changes visibility
// and stamps the decision.

import "server-only";

import { randomUUID } from "crypto";

import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  cleanBusyness,
  cleanNoise,
  cleanSeating,
  cleanServiceWait,
  normalizeHandle,
  toVisitReportDTO,
  type VisitReport,
  type VisitReportDTO,
  type VisitReportFields,
  type VisitReportReadStatus,
  type VisitReportStatus,
} from "@/lib/visitReports";
import type {
  ContributionRecord,
  ContributionRecordReadResult,
} from "@/lib/contributorLeaderboard";

const TABLE = "structured_visit_reports";

/** Bounded public reads: a venue read never returns more than this many rows. */
export const MAX_VENUE_REPORTS = 500;

export type VisitReportReadResult = {
  status: VisitReportReadStatus;
  reports: VisitReportDTO[];
};

export type VisitReportContributorCount = {
  status: VisitReportReadStatus;
  count: number;
};

export type VisitReportStore = {
  /**
   * Persist a validated report, upserting on (venueId, handle, visitedAt) so a
   * re-submission for the same night updates in place (one report per handle per
   * venue per night). Returns the public DTO. THROWS on a hard storage failure
   * (the route maps that to 503).
   */
  create(fields: VisitReportFields, now?: number): Promise<VisitReportDTO>;
  /** Public read: visible reports for a venue, newest-first, capped. Status says
   * whether an empty list is an answered empty venue or a failed read. */
  readForVenue(venueId: string): Promise<VisitReportReadResult>;
  /** Exact visible-report count for one contributor, without loading report
   * bodies. */
  countForContributor(handle: string): Promise<VisitReportContributorCount>;
  /** Moderator review queue: flagged, undecided reports with the full report
   * trail. Fail-soft ([] on storage error). */
  listForReview(): Promise<VisitReport[]>;
  /**
   * Moderator hidden lane: every report a moderator has hidden, newest decision
   * first, with the identity a reviewer needs to restore one. Hiding never
   * deletes, so this is the list that makes the decision reversible from the
   * admin surface rather than only over the API. Fail-soft ([] on storage error).
   */
  listHidden(): Promise<VisitReport[]>;
  /**
   * Public report: record a per-actor-deduped flag for moderator review. Returns
   * false for an unknown id. A duplicate flag by the same actor is an
   * idempotent no-op. Reporting never changes visibility.
   */
  report(id: string, reason: string | undefined, actorHash: string): Promise<boolean>;
  /** Moderator decision: set the final status and stamp the review. False =
   *  unknown id. */
  moderate(id: string, status: VisitReportStatus, note?: string): Promise<boolean>;
  /** Private all-time projection for contributor counting. */
  listLeaderboardContributions(): Promise<ContributionRecordReadResult>;
};

function nightKey(venueId: string, handle: string, visitedAt: string): string {
  return `${venueId}::${handle}::${visitedAt}`;
}

/**
 * Public-lane order: the NIGHT first, newest visit at the top, with the
 * submission time as a deterministic tie-break for two accounts of the same
 * night. A row prints its visit date and nothing else, so ordering on the
 * submission time instead would read as out of order — an older night written up
 * later would sit above a newer one with no visible reason.
 */
function byNewestVisit(a: VisitReport, b: VisitReport): number {
  return (
    b.visitedAt.localeCompare(a.visitedAt) || b.createdAt.localeCompare(a.createdAt)
  );
}

function visitContributionRecord(report: VisitReport): ContributionRecord {
  return {
    id: report.id,
    handle: report.handle,
    lane: "review",
    contributedAt: Date.parse(report.createdAt),
    visible: report.status === "visible",
    quality: {
      corroborated: null,
      moderation:
        report.status === "hidden"
          ? "hidden"
          : report.moderatedAt
            ? "kept"
            : "unreviewed",
      contradicted: null,
    },
  };
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Flat id → report map plus a night-key → id index for the idempotent upsert.
// Resets on restart — right for dev/demo/test; production uses Supabase.
const byId = new Map<string, VisitReport>();
const idByNight = new Map<string, string>();

function memoryUpsert(fields: VisitReportFields, now: number): VisitReport {
  const key = nightKey(fields.venueId, fields.handle, fields.visitedAt);
  const existingId = idByNight.get(key);
  const createdAt = new Date(now).toISOString();
  if (existingId) {
    const prev = byId.get(existingId)!;
    // Update in place: refresh the structured fields + note + timestamp, keep
    // the id and any moderation state (a re-report of the same night doesn't
    // wipe a pending hide).
    const updated: VisitReport = {
      ...prev,
      busyness: fields.busyness,
      noise: fields.noise,
      seating: fields.seating,
      serviceWait: fields.serviceWait,
      note: fields.note,
      createdAt,
    };
    byId.set(existingId, updated);
    return updated;
  }
  const report: VisitReport = {
    id: randomUUID(),
    ...fields,
    status: "visible",
    createdAt,
  };
  byId.set(report.id, report);
  idByNight.set(key, report.id);
  return report;
}

export const memoryVisitReportStore: VisitReportStore = {
  async create(fields, now = Date.now()) {
    return toVisitReportDTO(memoryUpsert(fields, now));
  },

  async readForVenue(venueId) {
    const reports = Array.from(byId.values())
      .filter((r) => r.venueId === venueId && r.status === "visible")
      .sort(byNewestVisit)
      .slice(0, MAX_VENUE_REPORTS)
      .map(toVisitReportDTO);
    return { status: "ready", reports };
  },

  async countForContributor(handle) {
    const contributor = normalizeHandle(handle);
    if (!contributor) return { status: "ready", count: 0 };
    let count = 0;
    for (const report of byId.values()) {
      if (report.handle === contributor && report.status === "visible") count += 1;
    }
    return { status: "ready", count };
  },

  async listForReview() {
    return Array.from(byId.values())
      .filter((r) => (r.reportCount ?? 0) > 0 && !r.moderatedAt)
      .sort((a, b) => (b.reportedAt ?? b.createdAt).localeCompare(a.reportedAt ?? a.createdAt));
  },

  async listHidden() {
    return Array.from(byId.values())
      .filter((r) => r.status === "hidden")
      .sort((a, b) => (b.moderatedAt ?? b.createdAt).localeCompare(a.moderatedAt ?? a.createdAt));
  },

  async report(id, reason, actorHash) {
    const hit = byId.get(id);
    if (!hit) return false;
    const actors = hit.reportActors ?? [];
    // Idempotent: a same-actor duplicate never bumps the counter twice.
    if (actors.includes(actorHash)) return true;
    const nextActors = [...actors, actorHash];
    hit.reportActors = nextActors;
    hit.reportCount = nextActors.length;
    hit.reportedAt = new Date().toISOString();
    if (reason) hit.reportReason = reason;
    // A flag AFTER a decision re-opens the row: a moderator who kept an account
    // visible must still see the next reader who objects to it. Only a row that
    // is still on public reads can be re-opened, so a hidden row stays decided.
    if (hit.status === "visible") hit.moderatedAt = undefined;
    return true;
  },

  async moderate(id, status, note) {
    const hit = byId.get(id);
    if (!hit) return false;
    hit.status = status;
    hit.moderatedAt = new Date().toISOString();
    if (note) hit.moderatorNote = note;
    return true;
  },

  async listLeaderboardContributions() {
    return {
      status: "ready",
      records: [...byId.values()].map(visitContributionRecord),
    };
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, isSchemaMiss, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "visit-reports",
  tables: TABLE,
  migrationHint: "apply migrations 0046 and 0058",
});

function admin() {
  return requireSupabaseAdmin();
}

// snake_case row <-> camelCase VisitReport, in one place.
function toRow(report: VisitReport) {
  return {
    id: report.id,
    venue_id: report.venueId,
    handle: report.handle,
    visited_at: report.visitedAt,
    busyness: report.busyness,
    noise: report.noise,
    seating: report.seating,
    service_wait: report.serviceWait,
    note: report.note,
    status: report.status,
    report_count: report.reportCount ?? 0,
    report_actors: report.reportActors ?? [],
    reported_at: report.reportedAt ?? null,
    report_reason: report.reportReason ?? null,
    moderated_at: report.moderatedAt ?? null,
    moderator_note: report.moderatorNote ?? null,
    created_at: report.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): VisitReport {
  const actors = Array.isArray(row.report_actors)
    ? (row.report_actors as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    handle: String(row.handle),
    visitedAt: String(row.visited_at),
    // Re-coerce on the way out (defence in depth): a hand-edited row can't
    // smuggle an off-allowlist value into a public read.
    busyness: cleanBusyness(row.busyness),
    noise: cleanNoise(row.noise),
    seating: cleanSeating(row.seating),
    serviceWait: cleanServiceWait(row.service_wait),
    note: typeof row.note === "string" ? row.note : "",
    status: row.status === "hidden" ? "hidden" : "visible",
    createdAt: String(row.created_at),
    reportCount: row.report_count == null ? undefined : Number(row.report_count),
    reportActors: actors.length ? actors : undefined,
    reportedAt: row.reported_at ? String(row.reported_at) : undefined,
    reportReason: row.report_reason ? String(row.report_reason) : undefined,
    moderatedAt: row.moderated_at ? String(row.moderated_at) : undefined,
    moderatorNote: row.moderator_note ? String(row.moderator_note) : undefined,
  };
}

/** Postgres unique_violation (23505): a concurrent insert raced us to the same
 *  (venue, handle, night) — fall through to an update of the existing row. */
function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

async function selectExistingId(fields: VisitReportFields): Promise<string | null> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("id")
    .eq("venue_id", fields.venueId)
    .eq("handle", fields.handle)
    .eq("visited_at", fields.visitedAt)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String((data as { id: unknown }).id) : null;
}

async function updateFields(id: string, fields: VisitReportFields, createdAt: string): Promise<void> {
  const { error } = await admin()
    .from(TABLE)
    .update({
      busyness: fields.busyness,
      noise: fields.noise,
      seating: fields.seating,
      service_wait: fields.serviceWait,
      note: fields.note,
      created_at: createdAt,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export const supabaseVisitReportStore: VisitReportStore = {
  async create(fields, now = Date.now()) {
    const createdAt = new Date(now).toISOString();
    return guard<VisitReportDTO>({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "visit-reports",
          migrationHint: "apply migrations 0046 and 0058",
          fallback: () => memoryVisitReportStore.create(fields, now),
        }),
      // No onError: a hard write failure THROWS so the route answers 503.
      run: async () => {
        // Idempotent upsert (one per night): update in place when a row for this
        // (venue, handle, night) already exists, else insert a fresh id.
        const existingId = await selectExistingId(fields);
        if (existingId) {
          await updateFields(existingId, fields, createdAt);
          return toVisitReportDTO({ id: existingId, ...fields, status: "visible", createdAt });
        }
        const report: VisitReport = { id: randomUUID(), ...fields, status: "visible", createdAt };
        const { error } = await admin().from(TABLE).insert(toRow(report));
        if (error) {
          // A race inserted the row between our select and insert — update instead.
          if (isUniqueViolation(error)) {
            const raced = await selectExistingId(fields);
            if (raced) {
              await updateFields(raced, fields, createdAt);
              return toVisitReportDTO({ id: raced, ...fields, status: "visible", createdAt });
            }
          }
          throw new Error(error.message);
        }
        return toVisitReportDTO(report);
      },
    });
  },

  async readForVenue(venueId) {
    return guard<VisitReportReadResult>({
      context: "readForVenue",
      onSchemaMiss: async () => ({
        ...(await memoryVisitReportStore.readForVenue(venueId)),
        status: "degraded",
      }),
      message: "readForVenue failed - returning no reports",
      onError: () => ({ status: "degraded", reports: [] }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("venue_id", venueId)
          .eq("status", "visible")
          // Same two-key order as the memory store (see byNewestVisit): the
          // night first, the submission time only to break a tie.
          .order("visited_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(MAX_VENUE_REPORTS);
        if (error) throw new Error(error.message);
        return {
          status: "ready",
          reports: (data ?? []).map((r) =>
            toVisitReportDTO(fromRow(r as Record<string, unknown>)),
          ),
        };
      },
    });
  },

  async countForContributor(handle) {
    const contributor = normalizeHandle(handle);
    if (!contributor) return { status: "ready", count: 0 };
    return guard<VisitReportContributorCount>({
      context: "countForContributor",
      onSchemaMiss: async () => ({
        ...(await memoryVisitReportStore.countForContributor(contributor)),
        status: "degraded",
      }),
      message: "countForContributor failed - returning unavailable count",
      onError: () => ({ status: "degraded", count: 0 }),
      run: async () => {
        const { count, error } = await admin()
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("handle", contributor)
          .eq("status", "visible");
        if (error) throw new Error(error.message);
        return {
          status: "ready",
          count: typeof count === "number" && count > 0 ? count : 0,
        };
      },
    });
  },

  async listForReview() {
    return guard<VisitReport[]>({
      context: "listForReview",
      onSchemaMiss: () => memoryVisitReportStore.listForReview(),
      message: "listForReview failed — returning empty queue",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .gt("report_count", 0)
          .is("moderated_at", null)
          .order("reported_at", { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      },
    });
  },

  async listHidden() {
    return guard<VisitReport[]>({
      context: "listHidden",
      onSchemaMiss: () => memoryVisitReportStore.listHidden(),
      message: "listHidden failed — returning empty lane",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("status", "hidden")
          .order("moderated_at", { ascending: false })
          .limit(MAX_VENUE_REPORTS);
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      },
    });
  },

  async report(id, reason, actorHash) {
    return guard<boolean>({
      context: "report",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "visit-reports",
          migrationHint: "apply migrations 0046 and 0058",
          fallback: () => memoryVisitReportStore.report(id, reason, actorHash),
        }),
      // A report that can't be recorded should surface, not fake-succeed — but a
      // read/no-row case returns false. Non-schema errors throw → route 503.
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("id, status, report_count, report_actors")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return false;
        const row = data as {
          id: unknown;
          status: unknown;
          report_count: unknown;
          report_actors: unknown;
        };
        const actors = Array.isArray(row.report_actors)
          ? (row.report_actors as unknown[]).filter((a): a is string => typeof a === "string")
          : [];
        // Idempotent: a same-actor duplicate is a no-op (row unchanged).
        if (actors.includes(actorHash)) return true;
        const nextActors = [...actors, actorHash];
        const { error: updateError } = await admin()
          .from(TABLE)
          .update({
            report_actors: nextActors,
            report_count: nextActors.length,
            reported_at: new Date().toISOString(),
            ...(reason ? { report_reason: reason } : {}),
            // Re-open the row for review (see the memory store for the rule);
            // the moderator note stays, so the prior decision is still on file.
            ...(row.status === "visible" ? { moderated_at: null } : {}),
          })
          .eq("id", id);
        if (updateError) throw new Error(updateError.message);
        return true;
      },
    });
  },

  async moderate(id, status, note) {
    return guard<boolean>({
      context: "moderate",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "visit-reports",
          migrationHint: "apply migrations 0046 and 0058",
          fallback: () => memoryVisitReportStore.moderate(id, status, note),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            status,
            moderated_at: new Date().toISOString(),
            ...(note ? { moderator_note: note } : {}),
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
        ...(await memoryVisitReportStore.listLeaderboardContributions()),
        status: "degraded",
      }),
      message: "leaderboard contribution read failed",
      onError: () => ({ status: "degraded", records: [] }),
      run: async () => {
        const records: ContributionRecord[] = [];
        const pageSize = 1_000;
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await admin()
            .from(TABLE)
            .select("*")
            .order("created_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, offset + pageSize - 1);
          if (error) throw new Error(error.message);
          const page = data ?? [];
          records.push(
            ...page.map((row) =>
              visitContributionRecord(
                fromRow(row as Record<string, unknown>),
              ),
            ),
          );
          if (page.length < pageSize) break;
        }
        return { status: "ready", records };
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function visitReportsStore(): VisitReportStore {
  return selectStore(memoryVisitReportStore, supabaseVisitReportStore);
}

/** Bound schema-miss predicate, exported for tests / callers that branch on it. */
export const isVisitReportsSchemaMiss = isSchemaMiss;

/** Test-only: clear the in-memory state + warn dedupe between cases. */
export function __resetVisitReports(): void {
  byId.clear();
  idByNight.clear();
  resetSchemaMissWarnings();
}
