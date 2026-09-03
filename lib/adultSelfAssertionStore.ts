// Recorded adult self-assertion — dual backend (memory + Supabase).
// One row per auth account, keyed on the account's own user id (migration
// 0103). The row says one thing: this account tapped "I'm 18 or over", and
// when. `lib/socialLaunch.ts` `accountIsAdult` is the only thing that reads
// meaning into it; nothing in the product branches on it for anything else.

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";

const TABLE = "adult_self_assertions";
const MIGRATION_HINT = "apply migration 0103";
const STORE_TAG = "adult-self-assertion";

export type AdultSelfAssertionStore = {
  /** The instant this account asserted, or null when it never has. */
  read(userId: string): Promise<string | null>;
  /** Idempotent: an account that taps twice keeps its first instant. */
  record(userId: string): Promise<string>;
};

function cleanUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const memoryAssertions = new Map<string, string>();

export const memoryAdultSelfAssertionStore: AdultSelfAssertionStore = {
  async read(userId) {
    const key = cleanUserId(userId);
    return (key && memoryAssertions.get(key)) || null;
  },

  async record(userId) {
    const key = cleanUserId(userId);
    const existing = key ? memoryAssertions.get(key) : undefined;
    if (existing) return existing;
    const assertedAt = new Date().toISOString();
    if (key) memoryAssertions.set(key, assertedAt);
    return assertedAt;
  },
};

const guard = createFailSoftGuard({
  tag: STORE_TAG,
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

export const supabaseAdultSelfAssertionStore: AdultSelfAssertionStore = {
  async read(userId) {
    const key = cleanUserId(userId);
    if (!key) return null;
    return guard.guard({
      context: "read",
      onSchemaMiss: () => memoryAdultSelfAssertionStore.read(key),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("asserted_at")
          .eq("user_id", key)
          .limit(1);
        if (error) throw new Error(error.message);
        const row = (data ?? [])[0] as { asserted_at?: unknown } | undefined;
        return typeof row?.asserted_at === "string" && row.asserted_at.trim()
          ? row.asserted_at
          : null;
      },
    });
  },

  async record(userId) {
    const key = cleanUserId(userId);
    if (!key) throw new Error("An account is required to record an assertion.");
    return guard.guard({
      context: "record",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryAdultSelfAssertionStore.record(key),
        }),
      run: async () => {
        // The first tap owns the instant. `ignoreDuplicates` keeps a second tap
        // from restamping a row that already answered the question.
        const { error } = await admin()
          .from(TABLE)
          .upsert({ user_id: key }, { onConflict: "user_id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        const stored = await supabaseAdultSelfAssertionStore.read(key);
        if (!stored) throw new Error("The assertion did not persist.");
        return stored;
      },
    });
  },
};

export const adultSelfAssertionStore = createDualBackendStore(
  memoryAdultSelfAssertionStore,
  supabaseAdultSelfAssertionStore,
);

export function __resetMemoryAdultSelfAssertions(): void {
  memoryAssertions.clear();
  guard.resetWarnings();
}
