// Price trust event store — dual backend (memory + Supabase).
//
// Events are append-only. Uniqueness is the evidence fingerprint. Credits
// bind to auth user ids. A reversal is a new row; visible credit is derived
// by excluding events that have a reversal pointing at them.

import "server-only";

import { randomUUID } from "node:crypto";

import type { DrinkCategory } from "@/lib/drinks";
import { isDrinkCategory } from "@/lib/drinks";
import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";

const EVENTS_TABLE = "price_trust_events";
const CREDITS_TABLE = "price_trust_credits";
const QUEUE_TABLE = "price_trust_reconciliation_queue";
const EVENTS_MIGRATION_HINT = "apply migration 0108";
const QUEUE_MIGRATION_HINT = "apply migration 0126";
const STORE_TAG = "price-trust-events";
const REVERSAL_CHAIN_READ_LIMIT = 100;
const RECONCILIATION_READ_LIMIT = 100;

export type PriceTrustEvent = {
  id: string;
  evidenceFingerprint: string;
  venueId: string;
  category: DrinkCategory;
  observationIds: string[];
  createdAt: string;
  reversalOf: string | null;
};

export type PriceTrustCredit = {
  userId: string;
  trustEventId: string;
};

export type PriceTrustReconciliationTask = {
  venueId: string;
  category: DrinkCategory;
  version: number;
  enqueuedAt: string;
};

export type RecordUnlockInput = {
  fingerprint: string;
  venueId: string;
  category: DrinkCategory;
  observationIds: readonly string[];
  userIds: readonly string[];
  reversalOf?: string | null;
  now?: number;
};

export type RecordUnlockResult = {
  event: PriceTrustEvent | null;
  created: boolean;
  failed?: true;
};

export type VisibleImpact = {
  lifetimeTrustUnlocks: number;
  eventIds: string[];
  events: PriceTrustEvent[];
  degraded: boolean;
};

export type PriceTrustEventStore = {
  recordUnlock(input: RecordUnlockInput): Promise<RecordUnlockResult>;
  ensureCredits(
    eventId: string,
    userIds: readonly string[],
  ): Promise<{ failed?: true }>;
  enqueueReconciliation(
    venueId: string,
    category: DrinkCategory,
    now?: number,
  ): Promise<{ task: PriceTrustReconciliationTask | null; failed?: true }>;
  listPendingReconciliations(limit?: number): Promise<{
    tasks: PriceTrustReconciliationTask[];
    degraded: boolean;
  }>;
  ackReconciliation(
    task: PriceTrustReconciliationTask,
  ): Promise<{ acknowledged: boolean; failed?: true }>;
  liveEventsFor(
    venueId: string,
    category: DrinkCategory,
  ): Promise<{ events: PriceTrustEvent[]; degraded: boolean }>;
  liveEventsCovering(observationId: string): Promise<{
    events: PriceTrustEvent[];
    degraded: boolean;
  }>;
  latestReversalCovering(observationId: string): Promise<{
    event: PriceTrustEvent | null;
    degraded: boolean;
  }>;
  terminalReversalFor(event: PriceTrustEvent): Promise<{
    event: PriceTrustEvent | null;
    degraded: boolean;
  }>;
  readVisibleImpact(userId: string): Promise<VisibleImpact>;
};

function cleanText(value: unknown, max = 128): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, max);
}

function cleanUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanIds(values: readonly unknown[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = cleanText(value, 64);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.sort();
}

type MemoryState = {
  events: PriceTrustEvent[];
  credits: PriceTrustCredit[];
  reconciliationQueue: Map<string, PriceTrustReconciliationTask>;
  nextReconciliationVersion: number;
};

const memory: MemoryState = {
  events: [],
  credits: [],
  reconciliationQueue: new Map(),
  nextReconciliationVersion: 0,
};

function reconciliationKey(venueId: string, category: DrinkCategory): string {
  return `${venueId}\0${category}`;
}

function reconciliationLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(RECONCILIATION_READ_LIMIT, Math.floor(value!)));
}

function cleanReconciliationTask(
  task: PriceTrustReconciliationTask,
): PriceTrustReconciliationTask | null {
  const venueId = cleanText(task.venueId, 64);
  if (
    !venueId ||
    !isDrinkCategory(task.category) ||
    !Number.isSafeInteger(task.version) ||
    task.version < 1 ||
    !task.enqueuedAt
  ) {
    return null;
  }
  return { ...task, venueId };
}

function isReversed(eventId: string, events: readonly PriceTrustEvent[]): boolean {
  return events.some((event) => event.reversalOf === eventId);
}

function terminalReversal(
  positives: readonly PriceTrustEvent[],
  reversals: readonly PriceTrustEvent[],
): { event: PriceTrustEvent | null; degraded: boolean } {
  const consumedReversalIds = new Set<string>();
  for (const reversal of reversals) {
    if (
      positives.some((event) =>
        event.evidenceFingerprint.startsWith("restored:") &&
        event.evidenceFingerprint.endsWith(`:${reversal.id}`),
      )
    ) {
      consumedReversalIds.add(reversal.id);
    }
  }
  const terminal = reversals.filter(
    (event) => !consumedReversalIds.has(event.id),
  );
  if (terminal.length > 1) return { event: null, degraded: true };
  return { event: terminal[0] ?? null, degraded: false };
}

function terminalReversalForRoot(
  root: PriceTrustEvent,
  events: readonly PriceTrustEvent[],
): { event: PriceTrustEvent | null; degraded: boolean } {
  let current = root;
  const seen = new Set([root.id]);
  for (let depth = 0; depth < REVERSAL_CHAIN_READ_LIMIT; depth += 1) {
    const reversals = events.filter(
      (candidate) => candidate.reversalOf === current.id,
    );
    if (reversals.length > 1) return { event: null, degraded: true };
    const reversal = reversals[0];
    if (!reversal) return { event: null, degraded: false };
    if (seen.has(reversal.id)) return { event: null, degraded: true };
    seen.add(reversal.id);

    const restoredFingerprint =
      `restored:${root.evidenceFingerprint}:${reversal.id}`;
    const restored = events.filter(
      (candidate) =>
        candidate.reversalOf === null &&
        candidate.evidenceFingerprint === restoredFingerprint,
    );
    if (restored.length > 1) return { event: null, degraded: true };
    if (restored.length === 0) return { event: reversal, degraded: false };
    if (
      restored[0].venueId !== root.venueId ||
      restored[0].category !== root.category ||
      seen.has(restored[0].id)
    ) {
      return { event: null, degraded: true };
    }
    current = restored[0];
    seen.add(current.id);
  }
  return { event: null, degraded: true };
}

function stampEvent(input: RecordUnlockInput, nowMs: number): PriceTrustEvent {
  return {
    id: randomUUID(),
    evidenceFingerprint: cleanText(input.fingerprint, 128),
    venueId: cleanText(input.venueId, 64),
    category: input.category,
    observationIds: cleanIds(input.observationIds),
    createdAt: new Date(nowMs).toISOString(),
    reversalOf: input.reversalOf ? cleanText(input.reversalOf, 64) : null,
  };
}

export const memoryPriceTrustEventStore: PriceTrustEventStore = {
  async recordUnlock(input) {
    const fingerprint = cleanText(input.fingerprint, 128);
    const venueId = cleanText(input.venueId, 64);
    if (!fingerprint || !venueId || !isDrinkCategory(input.category)) {
      return { event: null, created: false };
    }
    const existing = memory.events.find(
      (event) => event.evidenceFingerprint === fingerprint,
    );
    const event = existing ?? stampEvent({ ...input, fingerprint, venueId }, input.now ?? Date.now());
    const created = !existing;
    if (created) memory.events.push(event);
    const credits = await memoryPriceTrustEventStore.ensureCredits(
      event.id,
      input.userIds,
    );
    return credits.failed ? { event, created, failed: true } : { event, created };
  },

  async ensureCredits(eventId, userIds) {
    const key = cleanText(eventId, 64);
    if (!key || !memory.events.some((event) => event.id === key)) {
      return { failed: true };
    }
    for (const raw of userIds) {
      const userId = cleanUserId(raw);
      if (!userId) continue;
      const held = memory.credits.some(
        (credit) => credit.userId === userId && credit.trustEventId === key,
      );
      if (!held) memory.credits.push({ userId, trustEventId: key });
    }
    return {};
  },

  async enqueueReconciliation(venueId, category, now = Date.now()) {
    const key = cleanText(venueId, 64);
    if (!key || !isDrinkCategory(category)) {
      return { task: null, failed: true };
    }
    const queueKey = reconciliationKey(key, category);
    const task: PriceTrustReconciliationTask = {
      venueId: key,
      category,
      version: (memory.nextReconciliationVersion += 1),
      enqueuedAt: new Date(now).toISOString(),
    };
    memory.reconciliationQueue.set(queueKey, task);
    return { task };
  },

  async listPendingReconciliations(limit) {
    const tasks = [...memory.reconciliationQueue.values()]
      .sort(
        (left, right) =>
          left.enqueuedAt.localeCompare(right.enqueuedAt) ||
          left.venueId.localeCompare(right.venueId) ||
          left.category.localeCompare(right.category),
      )
      .slice(0, reconciliationLimit(limit));
    return { tasks, degraded: false };
  },

  async ackReconciliation(rawTask) {
    const task = cleanReconciliationTask(rawTask);
    if (!task) return { acknowledged: false, failed: true };
    const key = reconciliationKey(task.venueId, task.category);
    const held = memory.reconciliationQueue.get(key);
    if (!held) return { acknowledged: true };
    if (held.version !== task.version) return { acknowledged: false };
    memory.reconciliationQueue.delete(key);
    return { acknowledged: true };
  },

  async liveEventsFor(venueId, category) {
    const key = cleanText(venueId, 64);
    const events = memory.events.filter(
      (event) =>
        event.venueId === key &&
        event.category === category &&
        event.reversalOf === null &&
        !isReversed(event.id, memory.events),
    );
    return { events, degraded: false };
  },

  async liveEventsCovering(observationId) {
    const id = cleanText(observationId, 64);
    const events = memory.events.filter(
      (event) =>
        event.reversalOf === null &&
        event.observationIds.includes(id) &&
        !isReversed(event.id, memory.events),
    );
    return { events, degraded: false };
  },

  async latestReversalCovering(observationId) {
    const id = cleanText(observationId, 64);
    const positives = memory.events.filter(
      (event) => event.reversalOf === null && event.observationIds.includes(id),
    );
    const positiveIds = new Set(positives.map((event) => event.id));
    const reversals = memory.events.filter(
      (candidate) =>
        candidate.reversalOf !== null && positiveIds.has(candidate.reversalOf),
    );
    return terminalReversal(positives, reversals);
  },

  async terminalReversalFor(root) {
    const held = memory.events.find(
      (event) =>
        event.id === root.id &&
        event.evidenceFingerprint === root.evidenceFingerprint &&
        event.reversalOf === null,
    );
    if (!held) {
      return { event: null, degraded: true };
    }
    return terminalReversalForRoot(held, memory.events);
  },

  async readVisibleImpact(userId) {
    const key = cleanUserId(userId);
    if (!key) {
      return { lifetimeTrustUnlocks: 0, eventIds: [], events: [], degraded: false };
    }
    const eventIds = memory.credits
      .filter((credit) => credit.userId === key)
      .map((credit) => credit.trustEventId)
      .filter((eventId) => !isReversed(eventId, memory.events));
    const unique = [...new Set(eventIds)];
    const events = memory.events.filter((event) => unique.includes(event.id));
    return {
      lifetimeTrustUnlocks: unique.length,
      eventIds: unique,
      events,
      degraded: false,
    };
  },
};

const guard = createFailSoftGuard({
  tag: STORE_TAG,
  tables: [EVENTS_TABLE, CREDITS_TABLE],
  migrationHint: EVENTS_MIGRATION_HINT,
});

const queueGuard = createFailSoftGuard({
  tag: STORE_TAG,
  tables: QUEUE_TABLE,
  migrationHint: QUEUE_MIGRATION_HINT,
});

type EventRow = {
  id?: unknown;
  evidence_fingerprint?: unknown;
  venue_id?: unknown;
  category?: unknown;
  observation_ids?: unknown;
  created_at?: unknown;
  reversal_of?: unknown;
};

type ReconciliationRow = {
  venue_id?: unknown;
  category?: unknown;
  version?: unknown;
  enqueued_at?: unknown;
};

function fromEventRow(row: EventRow): PriceTrustEvent | null {
  const id = cleanText(row.id, 64);
  const evidenceFingerprint = cleanText(row.evidence_fingerprint, 128);
  const venueId = cleanText(row.venue_id, 64);
  const category = isDrinkCategory(row.category) ? row.category : null;
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";
  const observationIds = Array.isArray(row.observation_ids)
    ? cleanIds(row.observation_ids)
    : [];
  if (!id || !evidenceFingerprint || !venueId || !category || !createdAt) {
    return null;
  }
  return {
    id,
    evidenceFingerprint,
    venueId,
    category,
    observationIds,
    createdAt,
    reversalOf:
      typeof row.reversal_of === "string" && row.reversal_of
        ? row.reversal_of
        : null,
  };
}

function fromReconciliationRow(
  row: ReconciliationRow,
): PriceTrustReconciliationTask | null {
  const venueId = cleanText(row.venue_id, 64);
  const category = isDrinkCategory(row.category) ? row.category : null;
  const version = Number(row.version);
  const enqueuedAt = typeof row.enqueued_at === "string" ? row.enqueued_at : "";
  if (
    !venueId ||
    !category ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !enqueuedAt
  ) {
    return null;
  }
  return { venueId, category, version, enqueuedAt };
}

async function selectEventByFingerprint(
  fingerprint: string,
): Promise<PriceTrustEvent | null> {
  const { data, error } = await admin()
    .from(EVENTS_TABLE)
    .select(
      "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
    )
    .eq("evidence_fingerprint", fingerprint)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromEventRow(data as EventRow) : null;
}

async function insertCredits(eventId: string, userIds: readonly string[]): Promise<void> {
  const rows = [...new Set(userIds.map(cleanUserId).filter(Boolean))].map(
    (userId) => ({ user_id: userId, trust_event_id: eventId }),
  );
  if (rows.length === 0) return;
  const { error } = await admin()
    .from(CREDITS_TABLE)
    .upsert(rows, { onConflict: "user_id,trust_event_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export const supabasePriceTrustEventStore: PriceTrustEventStore = {
  async ensureCredits(eventId, userIds) {
    const key = cleanText(eventId, 64);
    if (!key) return { failed: true };
    return guard.guard({
      context: "ensureCredits",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: EVENTS_MIGRATION_HINT,
          fallback: () => memoryPriceTrustEventStore.ensureCredits(key, userIds),
        }),
      message: "trust credit write failed",
      onError: () => ({ failed: true as const }),
      run: async () => {
        await insertCredits(key, userIds);
        return {};
      },
    });
  },

  async enqueueReconciliation(venueId, category, now = Date.now()) {
    const key = cleanText(venueId, 64);
    if (!key || !isDrinkCategory(category)) {
      return { task: null, failed: true };
    }
    return queueGuard.guard({
      context: "enqueueReconciliation",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: QUEUE_MIGRATION_HINT,
          fallback: () =>
            memoryPriceTrustEventStore.enqueueReconciliation(key, category, now),
        }),
      message: "trust reconciliation enqueue failed",
      onError: () => ({ task: null, failed: true as const }),
      run: async () => {
        const { data, error } = await admin().rpc(
          "enqueue_price_trust_reconciliation",
          { p_venue_id: key, p_category: category },
        );
        if (error) throw new Error(error.message);
        const rows = Array.isArray(data) ? data : [];
        const task = rows[0]
          ? fromReconciliationRow(rows[0] as ReconciliationRow)
          : null;
        return task
          ? { task }
          : { task: null, failed: true as const };
      },
    });
  },

  async listPendingReconciliations(limit) {
    const bounded = reconciliationLimit(limit);
    return queueGuard.guard({
      context: "listPendingReconciliations",
      onSchemaMiss: () =>
        memoryPriceTrustEventStore.listPendingReconciliations(bounded),
      message: "trust reconciliation list failed",
      onError: () => ({ tasks: [], degraded: true }),
      run: async () => {
        const { data, error } = await admin()
          .from(QUEUE_TABLE)
          .select("venue_id, category, version, enqueued_at")
          .order("enqueued_at", { ascending: true })
          .order("venue_id", { ascending: true })
          .order("category", { ascending: true })
          .limit(bounded);
        if (error) throw new Error(error.message);
        const tasks = (data ?? [])
          .map((row) => fromReconciliationRow(row as ReconciliationRow))
          .filter((task): task is PriceTrustReconciliationTask => task !== null);
        return tasks.length === (data?.length ?? 0)
          ? { tasks, degraded: false }
          : { tasks: [], degraded: true };
      },
    });
  },

  async ackReconciliation(rawTask) {
    const task = cleanReconciliationTask(rawTask);
    if (!task) return { acknowledged: false, failed: true };
    return queueGuard.guard({
      context: "ackReconciliation",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: QUEUE_MIGRATION_HINT,
          fallback: () => memoryPriceTrustEventStore.ackReconciliation(task),
        }),
      message: "trust reconciliation acknowledgement failed",
      onError: () => ({ acknowledged: false, failed: true as const }),
      run: async () => {
        const deleted = await admin()
          .from(QUEUE_TABLE)
          .delete()
          .eq("venue_id", task.venueId)
          .eq("category", task.category)
          .eq("version", task.version)
          .select("version")
          .maybeSingle();
        if (deleted.error) throw new Error(deleted.error.message);
        if (deleted.data) return { acknowledged: true };
        const current = await admin()
          .from(QUEUE_TABLE)
          .select("version")
          .eq("venue_id", task.venueId)
          .eq("category", task.category)
          .maybeSingle();
        if (current.error) throw new Error(current.error.message);
        return { acknowledged: current.data == null };
      },
    });
  },

  async latestReversalCovering(observationId) {
    const id = cleanText(observationId, 64);
    if (!id) return { event: null, degraded: false };
    return guard.guard({
      context: "latestReversalCovering",
      onSchemaMiss: () => memoryPriceTrustEventStore.latestReversalCovering(id),
      message: "trust reversal read failed",
      onError: () => ({ event: null, degraded: true }),
      run: async () => {
        const originals = await admin()
          .from(EVENTS_TABLE)
          .select(
            "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
          )
          .contains("observation_ids", [id])
          .is("reversal_of", null)
          .limit(REVERSAL_CHAIN_READ_LIMIT + 1);
        if (originals.error) throw new Error(originals.error.message);
        if ((originals.data?.length ?? 0) > REVERSAL_CHAIN_READ_LIMIT) {
          return { event: null, degraded: true };
        }
        const positives = (originals.data ?? [])
          .map((row) => fromEventRow(row as EventRow))
          .filter((row): row is PriceTrustEvent => row !== null);
        if (positives.length !== (originals.data?.length ?? 0)) {
          return { event: null, degraded: true };
        }
        const ids = positives.map((event) => event.id);
        if (ids.length === 0) return { event: null, degraded: false };
        const reversalRows = await admin()
          .from(EVENTS_TABLE)
          .select(
            "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
          )
          .in("reversal_of", ids)
          .limit(REVERSAL_CHAIN_READ_LIMIT + 1);
        if (reversalRows.error) throw new Error(reversalRows.error.message);
        if ((reversalRows.data?.length ?? 0) > REVERSAL_CHAIN_READ_LIMIT) {
          return { event: null, degraded: true };
        }
        const reversals = (reversalRows.data ?? [])
          .map((row) => fromEventRow(row as EventRow))
          .filter((row): row is PriceTrustEvent => row !== null);
        if (reversals.length !== (reversalRows.data?.length ?? 0)) {
          return { event: null, degraded: true };
        }
        return terminalReversal(positives, reversals);
      },
    });
  },

  async terminalReversalFor(root) {
    const id = cleanText(root.id, 64);
    const fingerprint = cleanText(root.evidenceFingerprint, 128);
    const venueId = cleanText(root.venueId, 64);
    if (
      !id ||
      !fingerprint ||
      !venueId ||
      !isDrinkCategory(root.category)
    ) {
      return { event: null, degraded: true };
    }
    const cleanRoot: PriceTrustEvent = {
      ...root,
      id,
      evidenceFingerprint: fingerprint,
      venueId,
    };
    return guard.guard({
      context: "terminalReversalFor",
      onSchemaMiss: () =>
        memoryPriceTrustEventStore.terminalReversalFor(cleanRoot),
      message: "trust reversal chain read failed",
      onError: () => ({ event: null, degraded: true }),
      run: async () => {
        const rootRows = await admin()
          .from(EVENTS_TABLE)
          .select(
            "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
          )
          .eq("evidence_fingerprint", fingerprint)
          .is("reversal_of", null)
          .limit(2);
        if (rootRows.error) throw new Error(rootRows.error.message);
        if ((rootRows.data?.length ?? 0) !== 1) {
          return { event: null, degraded: true };
        }
        const selectedRoot = fromEventRow(rootRows.data![0] as EventRow);
        if (
          !selectedRoot ||
          selectedRoot.id !== id ||
          selectedRoot.venueId !== venueId ||
          selectedRoot.category !== root.category
        ) {
          return { event: null, degraded: true };
        }

        let current = selectedRoot;
        const seen = new Set([current.id]);
        for (let depth = 0; depth < REVERSAL_CHAIN_READ_LIMIT; depth += 1) {
          const reversalRows = await admin()
            .from(EVENTS_TABLE)
            .select(
              "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
            )
            .in("reversal_of", [current.id])
            .limit(2);
          if (reversalRows.error) throw new Error(reversalRows.error.message);
          if ((reversalRows.data?.length ?? 0) > 1) {
            return { event: null, degraded: true };
          }
          if ((reversalRows.data?.length ?? 0) === 0) {
            return { event: null, degraded: false };
          }
          const reversal = fromEventRow(reversalRows.data![0] as EventRow);
          if (!reversal || seen.has(reversal.id)) {
            return { event: null, degraded: true };
          }
          seen.add(reversal.id);

          const restoredFingerprint =
            `restored:${fingerprint}:${reversal.id}`;
          const restoredRows = await admin()
            .from(EVENTS_TABLE)
            .select(
              "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
            )
            .eq("evidence_fingerprint", restoredFingerprint)
            .is("reversal_of", null)
            .limit(2);
          if (restoredRows.error) throw new Error(restoredRows.error.message);
          if ((restoredRows.data?.length ?? 0) > 1) {
            return { event: null, degraded: true };
          }
          if ((restoredRows.data?.length ?? 0) === 0) {
            return { event: reversal, degraded: false };
          }
          const restored = fromEventRow(restoredRows.data![0] as EventRow);
          if (
            !restored ||
            restored.venueId !== venueId ||
            restored.category !== root.category ||
            seen.has(restored.id)
          ) {
            return { event: null, degraded: true };
          }
          current = restored;
          seen.add(current.id);
        }
        return { event: null, degraded: true };
      },
    });
  },
  async recordUnlock(input) {
    const fingerprint = cleanText(input.fingerprint, 128);
    const venueId = cleanText(input.venueId, 64);
    if (!fingerprint || !venueId || !isDrinkCategory(input.category)) {
      return { event: null, created: false };
    }
    return guard.guard({
      context: "recordUnlock",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: EVENTS_MIGRATION_HINT,
          fallback: () => memoryPriceTrustEventStore.recordUnlock(input),
        }),
      message: "trust event write failed",
      onError: () => ({ event: null, created: false, failed: true as const }),
      run: async () => {
        const nowMs = input.now ?? Date.now();
        const inserted = stampEvent(
          { ...input, fingerprint, venueId },
          nowMs,
        );
        const { data, error } = await admin()
          .from(EVENTS_TABLE)
          .upsert(
            {
              id: inserted.id,
              evidence_fingerprint: inserted.evidenceFingerprint,
              venue_id: inserted.venueId,
              category: inserted.category,
              observation_ids: inserted.observationIds,
              created_at: inserted.createdAt,
              reversal_of: inserted.reversalOf,
            },
            { onConflict: "evidence_fingerprint", ignoreDuplicates: true },
          )
          .select(
            "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
          )
          .maybeSingle();
        if (error) throw new Error(error.message);
        const event =
          (data ? fromEventRow(data as EventRow) : null) ??
          (await selectEventByFingerprint(fingerprint));
        if (!event) return { event: null, created: false, failed: true as const };
        const credits = await supabasePriceTrustEventStore.ensureCredits(
          event.id,
          input.userIds,
        );
        return credits.failed
          ? { event, created: data != null, failed: true as const }
          : { event, created: data != null };
      },
    });
  },

  async liveEventsFor(venueId, category) {
    const key = cleanText(venueId, 64);
    if (!key || !isDrinkCategory(category)) {
      return { events: [], degraded: false };
    }
    return guard.guard({
      context: "liveEventsFor",
      onSchemaMiss: () => memoryPriceTrustEventStore.liveEventsFor(key, category),
      message: "trust event read failed",
      onError: () => ({ events: [], degraded: true }),
      run: async () => {
        const { data, error } = await admin()
          .from(EVENTS_TABLE)
          .select(
            "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
          )
          .eq("venue_id", key)
          .eq("category", category)
          .is("reversal_of", null);
        if (error) throw new Error(error.message);
        const events = (data ?? [])
          .map((row) => fromEventRow(row as EventRow))
          .filter((row): row is PriceTrustEvent => row !== null);
        const ids = events.map((event) => event.id);
        if (ids.length === 0) return { events, degraded: false };
        const reversals = await admin()
          .from(EVENTS_TABLE)
          .select("reversal_of")
          .in("reversal_of", ids);
        if (reversals.error) throw new Error(reversals.error.message);
        const reversed = new Set(
          (reversals.data ?? []).map((row) =>
            String((row as { reversal_of?: unknown }).reversal_of),
          ),
        );
        return {
          events: events.filter((event) => !reversed.has(event.id)),
          degraded: false,
        };
      },
    });
  },

  async liveEventsCovering(observationId) {
    const id = cleanText(observationId, 64);
    if (!id) return { events: [], degraded: false };
    return guard.guard({
      context: "liveEventsCovering",
      onSchemaMiss: () => memoryPriceTrustEventStore.liveEventsCovering(id),
      message: "trust event cover read failed",
      onError: () => ({ events: [], degraded: true }),
      run: async () => {
        const { data, error } = await admin()
          .from(EVENTS_TABLE)
          .select(
            "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
          )
          .contains("observation_ids", [id])
          .is("reversal_of", null);
        if (error) throw new Error(error.message);
        const events = (data ?? [])
          .map((row) => fromEventRow(row as EventRow))
          .filter((row): row is PriceTrustEvent => row !== null);
        const ids = events.map((event) => event.id);
        if (ids.length === 0) return { events, degraded: false };
        const reversals = await admin()
          .from(EVENTS_TABLE)
          .select("reversal_of")
          .in("reversal_of", ids);
        if (reversals.error) throw new Error(reversals.error.message);
        const reversed = new Set(
          (reversals.data ?? []).map((row) =>
            String((row as { reversal_of?: unknown }).reversal_of),
          ),
        );
        return {
          events: events.filter((event) => !reversed.has(event.id)),
          degraded: false,
        };
      },
    });
  },

  async readVisibleImpact(userId) {
    const key = cleanUserId(userId);
    if (!key) {
      return { lifetimeTrustUnlocks: 0, eventIds: [], events: [], degraded: false };
    }
    return guard.guard({
      context: "readVisibleImpact",
      onSchemaMiss: () => memoryPriceTrustEventStore.readVisibleImpact(key),
      message: "trust credit read failed",
      onError: () => ({
        lifetimeTrustUnlocks: 0,
        eventIds: [],
        events: [],
        degraded: true,
      }),
      run: async () => {
        const { data, error } = await admin()
          .from(CREDITS_TABLE)
          .select("trust_event_id")
          .eq("user_id", key);
        if (error) throw new Error(error.message);
        const eventIds = [
          ...new Set(
            (data ?? [])
              .map((row) => cleanText((row as { trust_event_id?: unknown }).trust_event_id, 64))
              .filter(Boolean),
          ),
        ];
        if (eventIds.length === 0) {
          return { lifetimeTrustUnlocks: 0, eventIds: [], events: [], degraded: false };
        }
        const eventsResult = await admin()
          .from(EVENTS_TABLE)
          .select(
            "id, evidence_fingerprint, venue_id, category, observation_ids, created_at, reversal_of",
          )
          .in("id", eventIds);
        if (eventsResult.error) throw new Error(eventsResult.error.message);
        const events = (eventsResult.data ?? [])
          .map((row) => fromEventRow(row as EventRow))
          .filter((row): row is PriceTrustEvent => row !== null);
        const reversals = await admin()
          .from(EVENTS_TABLE)
          .select("reversal_of")
          .in("reversal_of", eventIds);
        if (reversals.error) throw new Error(reversals.error.message);
        const reversed = new Set(
          (reversals.data ?? []).map((row) =>
            String((row as { reversal_of?: unknown }).reversal_of),
          ),
        );
        const live = events.filter((event) => !reversed.has(event.id));
        return {
          lifetimeTrustUnlocks: live.length,
          eventIds: live.map((event) => event.id),
          events: live,
          degraded: false,
        };
      },
    });
  },
};

export const priceTrustEventStore = createDualBackendStore(
  memoryPriceTrustEventStore,
  supabasePriceTrustEventStore,
);

export function __resetMemoryPriceTrustEvents(): void {
  memory.events.length = 0;
  memory.credits.length = 0;
  memory.reconciliationQueue.clear();
  memory.nextReconciliationVersion = 0;
  guard.resetWarnings();
  queueGuard.resetWarnings();
}
