import "server-only";

// Shared dual-backend seam utilities for *Store modules: backend selection,
// PostgREST schema-miss detection, deduped memory-fallback warnings, and an
// optional try/catch wrapper for fail-soft reads. Adopt incrementally — each
// store keeps its own interface, empty sentinels, and domain logic.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDeployedProduction } from "@/lib/deploymentEnv";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

/** Normalise unknown thrown values to a log-safe string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Single seam: durable Supabase when env keys exist, process-memory otherwise. */
export function selectStore<T>(memory: T, supabase: T): T {
  return isSupabaseConfigured() ? supabase : memory;
}

/**
 * Factory for a plain-dual-backend store: curries `selectStore` into the
 * zero-arg getter every such store already hand-writes as
 * `export function xStore() { return selectStore(memoryX, supabaseX); }`.
 * Saves that one boilerplate line per store; decides nothing selectStore
 * did not already decide.
 *
 * Scope is deliberately narrow, matching selectStore: no error catching, no
 * table-name inference, no query generation, no authorization. A store with
 * extra write-path policy (schema-miss guards, admin checks) keeps composing
 * runStoreOp / createFailSoftGuard directly around its own memory/supabase
 * implementations - this factory only replaces the final selection wrapper.
 */
export function createDualBackendStore<T>(memory: T, supabase: T): () => T {
  return () => selectStore(memory, supabase);
}

/**
 * Missing-table handling for write paths in dual-backend stores. Keyless local
 * development and preview deployments may keep using the process-memory
 * implementation while a migration is being prepared. A deployed production
 * instance must never acknowledge that ephemeral write as persisted.
 */
export function onMissingDurableWrite<T>(opts: {
  storeTag: string;
  migrationHint: string;
  fallback: () => Promise<T>;
  /** Optional result-style failure for stores whose public contract never throws. */
  onProduction?: (error: Error) => Promise<T>;
}): Promise<T> {
  if (isDeployedProduction()) {
    const error = new Error(
      `[${opts.storeTag}] durable schema missing in production; refusing process-memory write fallback (${opts.migrationHint})`,
    );
    if (opts.onProduction) return opts.onProduction(error);
    return Promise.reject(error);
  }
  return opts.fallback();
}

/**
 * The repeated `function admin() { return requireSupabaseAdmin(); }` wrapper
 * every Supabase-backed store implementation calls at each operation — a thin,
 * lazy indirection so the client is resolved per-call (not captured at module
 * load, before env vars / mocks are in place). Shared here so stores don't each
 * redeclare an identical one-liner.
 */
export function admin(): SupabaseClient {
  return requireSupabaseAdmin();
}

/** Postgres unique_violation (23505): a duplicate insert racing an existing
 *  row — the idempotent-success case for toggle/insert-if-absent writes. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

/** Postgres foreign_key_violation (23503): the referenced row doesn't exist
 *  (e.g. a reaction/comment on a demo seed not present in pint_drops). */
export function isForeignKeyViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23503";
}

/**
 * PostgREST / Postgres signals that a public table is absent (migration not
 * applied, or schema cache stale). Accepts one table name or many (OR'd).
 */
export function isMissingTableSchema(
  err: unknown,
  tables: string | readonly string[],
): boolean {
  const group = (Array.isArray(tables) ? tables : [tables]).join("|");
  return new RegExp(
    `Could not find the table 'public\\.(${group})'|relation "public\\.(${group})" does not exist|schema cache`,
    "i",
  ).test(errorMessage(err));
}

/** Curry a schema-miss predicate for a store's table(s). */
export function missingTables(...tables: string[]): (err: unknown) => boolean {
  return (err) => isMissingTableSchema(err, tables);
}

export type SchemaMissWarner = (context: string, err: unknown) => void;

/**
 * Deduped console.warn when a Supabase table is missing and the caller's
 * schema-miss policy is invoked. That policy may use memory outside production
 * or fail closed in production, so the log must not promise a fallback.
 */
export function createSchemaMissWarner(
  storeTag: string,
  migrationHint: string,
): { warn: SchemaMissWarner; resetWarnings: () => void } {
  const seen = new Set<string>();
  return {
    warn(context, err) {
      if (seen.has(context)) return;
      seen.add(context);
      console.warn(
        `[${storeTag}] ${context} durable table missing — applying schema-miss policy (${migrationHint}):`,
        errorMessage(err),
      );
    },
    resetWarnings() {
      seen.clear();
    },
  };
}

export type RunStoreOpOptions<T> = {
  /** Label for logs and deduped schema-miss warns (e.g. "read", "confirm"). */
  context: string;
  run: () => Promise<T>;
  /** When set, schema-miss routes here instead of onError / rethrow. */
  onSchemaMiss?: () => Promise<T>;
  isSchemaMiss?: (err: unknown) => boolean;
  warnSchemaMiss?: SchemaMissWarner;
  /** Fail-soft path for non-schema errors. When omitted, non-schema errors rethrow. */
  onError?: (err: unknown) => T | Promise<T>;
  /** When onError is used, optional `[tag] message` log line before the fallback. */
  logError?: { tag: string; message: string };
};

/**
 * Wrap a Supabase store operation: try `run`, on schema-miss optionally warn +
 * delegate to memory, on other errors optionally log + return a soft fallback,
 * otherwise rethrow (for write paths that must surface failure).
 */
export async function runStoreOp<T>(opts: RunStoreOpOptions<T>): Promise<T> {
  try {
    return await opts.run();
  } catch (err) {
    if (opts.isSchemaMiss?.(err) && opts.onSchemaMiss) {
      opts.warnSchemaMiss?.(opts.context, err);
      return opts.onSchemaMiss();
    }
    if (opts.onError) {
      if (opts.logError) {
        console.error(
          `[${opts.logError.tag}] ${opts.logError.message}:`,
          errorMessage(err),
        );
      }
      return opts.onError(err);
    }
    throw err;
  }
}

/** A single fail-soft operation for a guard: everything a store op still varies. */
export type GuardedOp<T> = {
  /** Label for logs and deduped schema-miss warns (e.g. "confirm", "read"). */
  context: string;
  run: () => Promise<T>;
  /** When set, schema-miss warns (deduped) then routes here instead of rethrow. */
  onSchemaMiss?: () => Promise<T>;
  /** Fail-soft path for non-schema errors. When omitted, non-schema errors rethrow. */
  onError?: (err: unknown) => T | Promise<T>;
  /** Optional `[tag] <message>` log line before an onError fallback (tag bound). */
  message?: string;
};

export type FailSoftGuard = {
  /**
   * Run a Supabase op with this guard's bound schema-miss predicate + deduped
   * warner + log tag. Behaviour-identical to calling `runStoreOp` with those
   * three fields spelled out on every call — it just stops each op repeating them.
   */
  guard<T>(op: GuardedOp<T>): Promise<T>;
  /** Bound schema-miss predicate, for stores that also branch on it manually. */
  isSchemaMiss: (err: unknown) => boolean;
  /** Deduped fallback warner (same instance the guard uses). */
  warn: SchemaMissWarner;
  /** Reset the deduped schema-miss warnings — test-only. */
  resetWarnings: () => void;
};

/**
 * Bind the per-store fail-soft constants once — the log/warn tag, the durable
 * table(s) whose absence routes to the memory fallback, and the migration hint —
 * and hand back a `guard` that wraps each op. Collapses the boilerplate every
 * fail-soft store otherwise repeats on every `runStoreOp` call (isSchemaMiss,
 * warnSchemaMiss, logError.tag). No behaviour change: `guard` forwards to
 * `runStoreOp` with exactly the values a hand-rolled call would pass.
 */
export function createFailSoftGuard(opts: {
  /** Log/warn tag, e.g. "price-confirm". */
  tag: string;
  /** Durable table name(s) whose absence routes to the memory fallback. */
  tables: string | readonly string[];
  /** Human hint shown in the fallback warning, e.g. "apply migration 0025". */
  migrationHint: string;
}): FailSoftGuard {
  const tables = Array.isArray(opts.tables) ? [...opts.tables] : [opts.tables];
  const { warn, resetWarnings } = createSchemaMissWarner(opts.tag, opts.migrationHint);
  const isSchemaMiss = missingTables(...tables);
  return {
    isSchemaMiss,
    warn,
    resetWarnings,
    guard(op) {
      return runStoreOp({
        context: op.context,
        run: op.run,
        isSchemaMiss,
        warnSchemaMiss: warn,
        onSchemaMiss: op.onSchemaMiss,
        onError: op.onError,
        logError: op.message ? { tag: opts.tag, message: op.message } : undefined,
      });
    },
  };
}
