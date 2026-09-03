import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// H3: the Supabase toggle path SELECT→INSERT can lose a race with a concurrent
// double-insert of the same (drop, actor, reaction), which trips the unique
// constraint (Postgres 23505). That is NOT a failure for a toggle — the row now
// exists, exactly the state a toggle-on wanted — so it must be treated as
// idempotent success (recompute + return the summary), never a spurious 503.
//
// We drive the REAL supabaseReactionsStore against a mocked admin client whose
// INSERT returns a 23505 error, and assert the toggle still resolves with a
// correct summary rather than throwing.

// A tiny chainable query-builder stub. `.from(table)` returns an object where
// select/insert/delete + the eq/limit chain all resolve to the scripted result
// for that operation. Each call to admin() gets a fresh builder, matching the
// store's `admin().from(...)` per-statement usage.
type Result = { data?: unknown; error: { code?: string; message?: string } | null };

function makeAdmin(script: { select: Result[]; insert: Result }) {
  let selectCall = 0;
  return {
    from() {
      const chain: Record<string, unknown> = {};
      // The SELECT chain: select().eq().eq().eq().limit() resolves to a Result.
      // We model it as a thenable that also carries the chain methods.
      const selectResult = () => script.select[selectCall++] ?? script.select.at(-1)!;
      const builder = {
        select: () => {
          const pending = selectResult();
          const thenable = {
            eq: () => thenable,
            limit: () => Promise.resolve(pending),
            then: (resolve: (r: Result) => unknown) => resolve(pending),
          };
          return thenable;
        },
        insert: () => Promise.resolve(script.insert),
        delete: () => {
          const thenable = {
            eq: () => thenable,
            then: (resolve: (r: Result) => unknown) => resolve({ error: null }),
          };
          return thenable;
        },
      };
      Object.assign(chain, builder);
      return chain;
    },
  };
}

const mockGetSupabaseAdmin = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
  requireSupabaseAdmin: () => {
    const client = mockGetSupabaseAdmin();
    if (!client) throw new Error("Supabase not configured.");
    return client;
  },
}));

// Import after the mock is registered.
import { supabaseReactionsStore } from "@/lib/reactionsStore";

const DROP = "drop-1";
const ACTOR = "actor-abc";

beforeEach(() => {
  mockGetSupabaseAdmin.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("supabaseReactionsStore.toggle — concurrent double-insert (23505)", () => {
  it("treats a unique-violation on insert as idempotent success, not a 503", async () => {
    // SELECT #1 (existence check): empty → the store goes down the INSERT path.
    // INSERT: another writer already inserted the same row → 23505.
    // SELECT #2 (recompute): the row exists, so the summary reflects it.
    const admin = makeAdmin({
      select: [
        { data: [], error: null }, // existence check: not present locally
        { data: [{ reaction: "cheers", actor_hash: ACTOR }], error: null }, // recompute
      ],
      insert: { error: { code: "23505", message: "duplicate key value" } },
    });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    // Must NOT throw despite the 23505 from the insert.
    const summary = await supabaseReactionsStore.toggle(DROP, ACTOR, "cheers");
    expect(summary.counts.cheers).toBe(1);
    expect(summary.mine).toEqual(["cheers"]);
  });

  it("still surfaces a genuine (non-23505/23503) insert error as a throw", async () => {
    const admin = makeAdmin({
      select: [{ data: [], error: null }],
      insert: { error: { code: "500", message: "boom" } },
    });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    await expect(supabaseReactionsStore.toggle(DROP, ACTOR, "cheers")).rejects.toThrow("boom");
  });
});
