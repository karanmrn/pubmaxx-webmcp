// Two readers flagging the same image must both be recorded.
//
// `reportOwnedImage` read `*_report_actors`, appended in JavaScript and wrote the
// whole array back, so two concurrent reporters each wrote [base, self] and the
// later write dropped the earlier one. The append now happens in Postgres in one
// statement (migration 0105), and the store falls back to the old path only when
// that function is not deployed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc, from: supabase.from }),
}));

import { supabaseProfileStore } from "@/lib/profileStore";

/**
 * The rows a real UPDATE would touch, behind an RPC that appends the way
 * Postgres does: one statement, no window in which another caller can read a
 * stale array.
 */
function atomicRpcBackedRow(actors: string[]) {
  supabase.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
    const actor = String(args.p_actor);
    if (actors.includes(actor)) return { data: true, error: null };
    actors.push(actor);
    return { data: true, error: null };
  });
}

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.from.mockReset();
});

describe("reportOwnedImage — the append is atomic", () => {
  it("keeps BOTH reporters when two land together", async () => {
    const actors: string[] = [];
    atomicRpcBackedRow(actors);

    const [first, second] = await Promise.all([
      supabaseProfileStore.reportOwnedImage("alice", "avatar", "abusive", "actor-one"),
      supabaseProfileStore.reportOwnedImage("alice", "avatar", undefined, "actor-two"),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(actors.sort()).toEqual(["actor-one", "actor-two"]);
    // Nothing read the row and wrote it back: the whole race is gone.
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("passes the handle, slot, actor and cleaned reason to the one statement", async () => {
    atomicRpcBackedRow([]);
    await supabaseProfileStore.reportOwnedImage("@Alice", "cover", "  not theirs  ", " hash-1 ");

    expect(supabase.rpc).toHaveBeenCalledWith("append_profile_image_report_actor", {
      p_handle: "alice",
      p_slot: "cover",
      p_actor: "hash-1",
      p_reason: "not theirs",
    });
  });

  it("answers the RPC's own refusal without touching the table", async () => {
    supabase.rpc.mockResolvedValue({ data: false, error: null });
    expect(
      await supabaseProfileStore.reportOwnedImage("alice", "avatar", undefined, "actor-one"),
    ).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("falls back to the older path while migration 0105 is undeployed", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No profile row behind `from`, so the fallback simply answers false — what
    // matters is that a reader's flag is never refused because of the migration.
    supabase.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      for (const method of ["select", "update", "eq", "limit", "is", "not", "order"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return builder;
    });

    expect(
      await supabaseProfileStore.reportOwnedImage("alice", "avatar", undefined, "actor-one"),
    ).toBe(false);
    expect(supabase.from).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("softDeleteForCaller — cover fields stay schema-valid", () => {
  it("clears every constrained cover field in one durable update", async () => {
    const stored = {
      id: "44444444-4444-4444-8444-444444444444",
      handle: "alice",
      user_id: "user-alice",
      cover_object_key:
        "covers/44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555/cover.jpg",
      cover_generation: "55555555-5555-4555-8555-555555555555",
      cover_moderation_state: "hidden",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    let written: Record<string, unknown> | null = null;
    supabase.from.mockImplementation(() => ({
      update(patch: Record<string, unknown>) {
        written = patch;
        const query = {
          eq: () => query,
          or: () => query,
          is: () => query,
          select: () => query,
          async limit() {
            const validCoverTuple =
              patch.cover_object_key === null &&
              patch.cover_generation === null &&
              patch.cover_moderation_state === null;
            return validCoverTuple
              ? { data: [{ ...stored, ...patch }], error: null }
              : {
                  data: null,
                  error: { message: "profiles_cover_fields_consistent_check" },
                };
          },
        };
        return query;
      },
    }));

    const result = await supabaseProfileStore.softDeleteForCaller(
      "alice",
      "user-alice",
    );

    expect(result.status).toBe("deleted");
    expect(written).toMatchObject({
      cover_object_key: null,
      cover_generation: null,
      cover_moderation_state: null,
      cover_report_count: 0,
      cover_report_actors: [],
    });
  });
});
