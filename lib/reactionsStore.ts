import "server-only";

// Durable pub-native reactions on a pint drop. ONE interface, TWO implementations
// (process-memory + Supabase public.pint_drop_reactions), same seam pattern as
// the other stores.
//
// A reaction is attributed to an `actor_hash` — the salted hash of the viewer's
// anonymous device id (lib/anonId.ts + lib/supabase.ts hashActor), never a raw
// id and never a raw IP. `unique(pint_drop_id, actor_hash, reaction)` makes each
// (device, drop, reaction) at most one row, so a toggle is a pure insert-or-delete
// and counts can't be double-inflated by one device.
//
// The reactions table FK-references pint_drops(id); demo seed drops are not
// in that table, so a reaction on a seed raises a foreign-key violation. That is
// surfaced as UnknownDropError → the route answers 404 and the client keeps its
// local-only toggle for sample cards.
//
// SERVER-ONLY: this module imports @/lib/supabase (admin client, node:crypto).
// The runtime guard above blocks client imports. Browser code must import the
// safe constants and types from @/lib/reactions instead.

import {
  admin,
  isForeignKeyViolation,
  isUniqueViolation,
  selectStore,
} from "@/lib/storeBackend";

// Canonical allowlist + DTO shapes live in the browser-safe module and are
// re-exported here so server callers (route, tests) keep one import site and the
// UI ↔ validation source of truth can never drift.
export {
  REACTION_KEYS,
  isReactionKey,
  type ReactionKey,
  type ReactionSummary,
} from "@/lib/reactions";
import { isReactionKey, type ReactionKey, type ReactionSummary } from "@/lib/reactions";

export type ReactionsStore = {
  /** Toggle one reaction for an actor on a drop; returns the drop's fresh summary. */
  toggle(dropId: string, actorHash: string, reaction: ReactionKey): Promise<ReactionSummary>;
  /** Summaries for many drops at once (feed render), keyed by drop id. */
  summarize(dropIds: string[], actorHash: string): Promise<Record<string, ReactionSummary>>;
};

/** The drop id is not a real, persisted drop (e.g. a demo seed) — the caller
 *  should treat reactions on it as local-only. */
export class UnknownDropError extends Error {
  constructor(dropId: string) {
    super(`Unknown pint drop: ${dropId}`);
    this.name = "UnknownDropError";
  }
}

const TABLE = "pint_drop_reactions";

// Fold raw (reaction, actor_hash) rows for a single drop into a summary.
function summarizeRows(
  rows: { reaction: string; actor_hash: string }[],
  actorHash: string,
): ReactionSummary {
  const counts: Partial<Record<ReactionKey, number>> = {};
  const mine = new Set<ReactionKey>();
  for (const row of rows) {
    if (!isReactionKey(row.reaction)) continue; // ignore any legacy/off-allowlist value
    counts[row.reaction] = (counts[row.reaction] ?? 0) + 1;
    if (row.actor_hash === actorHash) mine.add(row.reaction);
  }
  return { counts, mine: [...mine] };
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseReactionsStore: ReactionsStore = {
  async toggle(dropId, actorHash, reaction) {
    // Is this actor's reaction already present? Select decides insert vs delete.
    const { data: existing, error: readError } = await admin()
      .from(TABLE)
      .select("id")
      .eq("pint_drop_id", dropId)
      .eq("actor_hash", actorHash)
      .eq("reaction", reaction)
      .limit(1);
    if (readError) throw new Error(readError.message);

    if ((existing ?? []).length > 0) {
      const { error } = await admin()
        .from(TABLE)
        .delete()
        .eq("pint_drop_id", dropId)
        .eq("actor_hash", actorHash)
        .eq("reaction", reaction);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin()
        .from(TABLE)
        .insert({ pint_drop_id: dropId, actor_hash: actorHash, reaction });
      if (error) {
        // A reaction on a drop that isn't in pint_drops (demo seed) - tell the
        // caller so it can 404 rather than 500.
        if (isForeignKeyViolation(error)) throw new UnknownDropError(dropId);
        // Concurrent double-insert lost the unique race (23505): the row now
        // exists, which is exactly the state a toggle-on wanted. Treat as
        // idempotent success and fall through to recompute the summary — never a
        // spurious 503 (H3).
        if (!isUniqueViolation(error)) throw new Error(error.message);
      }
    }

    // Recompute this drop's summary from the source of truth.
    const { data, error } = await admin()
      .from(TABLE)
      .select("reaction, actor_hash")
      .eq("pint_drop_id", dropId);
    if (error) throw new Error(error.message);
    return summarizeRows((data ?? []) as { reaction: string; actor_hash: string }[], actorHash);
  },

  async summarize(dropIds, actorHash) {
    const ids = dropIds.filter(Boolean);
    if (ids.length === 0) return {};
    const { data, error } = await admin()
      .from(TABLE)
      .select("pint_drop_id, reaction, actor_hash")
      .in("pint_drop_id", ids);
    if (error) throw new Error(error.message);

    // Bucket rows by drop, then fold each bucket into a summary.
    const byDrop = new Map<string, { reaction: string; actor_hash: string }[]>();
    for (const row of (data ?? []) as {
      pint_drop_id: string;
      reaction: string;
      actor_hash: string;
    }[]) {
      const bucket = byDrop.get(row.pint_drop_id) ?? [];
      bucket.push({ reaction: row.reaction, actor_hash: row.actor_hash });
      byDrop.set(row.pint_drop_id, bucket);
    }
    const out: Record<string, ReactionSummary> = {};
    for (const id of ids) out[id] = summarizeRows(byDrop.get(id) ?? [], actorHash);
    return out;
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Rows as a Set of "dropId|actorHash|reaction" keys. Resets on restart. No FK,
// so the memory store never raises UnknownDropError — dev/demo can react to any
// id, which is the right dev ergonomics.
const memoryRows = new Set<string>();

function rowKey(dropId: string, actorHash: string, reaction: string): string {
  return `${dropId}|${actorHash}|${reaction}`;
}

function memorySummarize(dropId: string, actorHash: string): ReactionSummary {
  const rows: { reaction: string; actor_hash: string }[] = [];
  const prefix = `${dropId}|`;
  for (const key of memoryRows) {
    if (!key.startsWith(prefix)) continue;
    const [, actor, reaction] = key.split("|");
    rows.push({ reaction, actor_hash: actor });
  }
  return summarizeRows(rows, actorHash);
}

export const memoryReactionsStore: ReactionsStore = {
  async toggle(dropId, actorHash, reaction) {
    const key = rowKey(dropId, actorHash, reaction);
    if (memoryRows.has(key)) memoryRows.delete(key);
    else memoryRows.add(key);
    return memorySummarize(dropId, actorHash);
  },
  async summarize(dropIds, actorHash) {
    const out: Record<string, ReactionSummary> = {};
    for (const id of dropIds.filter(Boolean)) out[id] = memorySummarize(id, actorHash);
    return out;
  },
};

/** The single backend selection point (mirrors the other stores). */
export function reactionsStore(): ReactionsStore {
  return selectStore(memoryReactionsStore, supabaseReactionsStore);
}

/** Test-only: clear the in-memory reaction set between cases. */
export function __resetMemoryReactions(): void {
  memoryRows.clear();
}

/** Test-only: seed a reaction without going through the HTTP POST gate. */
export function __addMemoryReactionForTest(
  dropId: string,
  actorHash: string,
  reaction: ReactionKey,
): void {
  memoryRows.add(rowKey(dropId, actorHash, reaction));
}
