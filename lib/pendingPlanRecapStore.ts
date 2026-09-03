import "server-only";

import type { PendingPlanRecap } from "@/lib/planRecap";
import { validatePendingPlanRecap } from "@/lib/planRecap";
import {
  isMissingTableSchema,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

/**
 * Owner-scoped pending Plan recap drafts. Private only: route captions and
 * completion references, never member tokens, coordinates, or voice.
 *
 * Process-memory is the keyless / test backend. Supabase backs production so a
 * refresh can resume the same draft across serverless invocations.
 */
export type PendingPlanRecapStore = {
  list(ownerId: string): Promise<PendingPlanRecap[]>;
  getByCompletion(ownerId: string, completionId: string): Promise<PendingPlanRecap | null>;
  upsert(ownerId: string, recap: PendingPlanRecap): Promise<PendingPlanRecap | null>;
  remove(ownerId: string, completionId: string): Promise<boolean>;
  clearOwner(ownerId: string): Promise<void>;
};

const TABLE = "pending_plan_recaps";

/** ownerId → completionId → draft */
const byOwner = new Map<string, Map<string, PendingPlanRecap>>();

export function __resetPendingPlanRecapStore(): void {
  byOwner.clear();
}

function ownerBucket(ownerId: string): Map<string, PendingPlanRecap> {
  let bucket = byOwner.get(ownerId);
  if (!bucket) {
    bucket = new Map();
    byOwner.set(ownerId, bucket);
  }
  return bucket;
}

function draftFromRow(row: Record<string, unknown>): PendingPlanRecap | null {
  return validatePendingPlanRecap(row.draft);
}

function schemaMissFallback<T>(fallback: () => Promise<T>): Promise<T> {
  return onMissingDurableWrite({
    storeTag: "pendingPlanRecapStore",
    migrationHint: "0077_pending_plan_recaps",
    fallback,
  });
}

export const memoryPendingPlanRecapStore: PendingPlanRecapStore = {
  async list(ownerId) {
    if (!ownerId) return [];
    return [...ownerBucket(ownerId).values()].sort((left, right) =>
      right.savedAt.localeCompare(left.savedAt),
    );
  },
  async getByCompletion(ownerId, completionId) {
    if (!ownerId || !completionId) return null;
    return ownerBucket(ownerId).get(completionId) ?? null;
  },
  async upsert(ownerId, recap) {
    if (!ownerId) return null;
    const safe = validatePendingPlanRecap({
      ...recap,
      savedAt: new Date().toISOString(),
    });
    if (!safe) return null;
    ownerBucket(ownerId).set(safe.completionId, safe);
    return safe;
  },
  async remove(ownerId, completionId) {
    if (!ownerId || !completionId) return false;
    return ownerBucket(ownerId).delete(completionId);
  },
  async clearOwner(ownerId) {
    if (!ownerId) return;
    byOwner.delete(ownerId);
  },
};

export const supabasePendingPlanRecapStore: PendingPlanRecapStore = {
  async list(ownerId) {
    if (!ownerId) return [];
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .select("draft")
      .eq("owner_id", ownerId)
      .order("saved_at", { ascending: false });
    if (error) {
      if (isMissingTableSchema(error, TABLE)) {
        return schemaMissFallback(() => memoryPendingPlanRecapStore.list(ownerId));
      }
      throw new Error(error.message);
    }
    return (data ?? [])
      .map((row) => draftFromRow(row as Record<string, unknown>))
      .filter((draft): draft is PendingPlanRecap => Boolean(draft));
  },

  async getByCompletion(ownerId, completionId) {
    if (!ownerId || !completionId) return null;
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .select("draft")
      .eq("owner_id", ownerId)
      .eq("completion_id", completionId)
      .maybeSingle();
    if (error) {
      if (isMissingTableSchema(error, TABLE)) {
        return schemaMissFallback(() =>
          memoryPendingPlanRecapStore.getByCompletion(ownerId, completionId),
        );
      }
      throw new Error(error.message);
    }
    return data ? draftFromRow(data as Record<string, unknown>) : null;
  },

  async upsert(ownerId, recap) {
    if (!ownerId) return null;
    const safe = validatePendingPlanRecap({
      ...recap,
      savedAt: new Date().toISOString(),
    });
    if (!safe) return null;
    const row = {
      owner_id: ownerId,
      completion_id: safe.completionId,
      plan_id: safe.planId,
      draft: safe,
      saved_at: safe.savedAt,
    };
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .upsert(row, { onConflict: "owner_id,completion_id" })
      .select("draft")
      .single();
    if (error) {
      if (isMissingTableSchema(error, TABLE)) {
        return schemaMissFallback(() => memoryPendingPlanRecapStore.upsert(ownerId, safe));
      }
      throw new Error(error.message);
    }
    return draftFromRow(data as Record<string, unknown>);
  },

  async remove(ownerId, completionId) {
    if (!ownerId || !completionId) return false;
    const { error, count } = await requireSupabaseAdmin()
      .from(TABLE)
      .delete({ count: "exact" })
      .eq("owner_id", ownerId)
      .eq("completion_id", completionId);
    if (error) {
      if (isMissingTableSchema(error, TABLE)) {
        return schemaMissFallback(() =>
          memoryPendingPlanRecapStore.remove(ownerId, completionId),
        );
      }
      throw new Error(error.message);
    }
    return (count ?? 0) > 0;
  },

  async clearOwner(ownerId) {
    if (!ownerId) return;
    const { error } = await requireSupabaseAdmin()
      .from(TABLE)
      .delete()
      .eq("owner_id", ownerId);
    if (error) {
      if (isMissingTableSchema(error, TABLE)) {
        await schemaMissFallback(() => memoryPendingPlanRecapStore.clearOwner(ownerId));
        return;
      }
      throw new Error(error.message);
    }
  },
};

export function pendingPlanRecapStore(): PendingPlanRecapStore {
  return selectStore(memoryPendingPlanRecapStore, supabasePendingPlanRecapStore);
}
