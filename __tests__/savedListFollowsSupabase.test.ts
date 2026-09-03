import { describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  selects: [] as { table: string; columns: string }[],
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => makeQuery(table),
  }),
  requireSupabaseAdmin: () => ({
    from: (table: string) => makeQuery(table),
  }),
  isSupabaseConfigured: () => true,
  requiresSupabaseStore: () => false,
}));

type Filter = { column: string; value: unknown };

function makeQuery(table: string) {
  const filters: Filter[] = [];
  let headCount = false;

  function result() {
    if (table === "profiles") {
      const handle = filters.find((f) => f.column === "handle")?.value;
      const id = handle === "ken" ? "profile-ken" : handle === "sam" ? "profile-sam" : "";
      return {
        data: id
          ? [
              {
                id,
                handle,
                created_at: "2026-07-07T12:00:00.000Z",
                updated_at: "2026-07-07T12:00:00.000Z",
              },
            ]
          : [],
        error: null,
      };
    }

    if (table === "saved_list_follows") {
      if (headCount) return { count: 1, error: null };
      return {
        data: [
          {
            list_owner_profile_id: "profile-sam",
            list_name: "Date Night",
            created_at: "2026-07-07T12:00:00.000Z",
            owner: { handle: "sam" },
          },
        ],
        error: null,
      };
    }

    if (table === "saved_pubs") {
      return { count: 2, error: null };
    }

    return { data: [], error: null };
  }

  const query = {
    select(columns: string, options?: { head?: boolean }) {
      supabaseMock.selects.push({ table, columns });
      headCount = Boolean(options?.head);
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return query;
    },
    limit() {
      return Promise.resolve(result());
    },
    order() {
      return Promise.resolve(result());
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: ReturnType<typeof result>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result()).then(onfulfilled, onrejected);
    },
  };

  return query;
}

describe("savedListFollowsStore — Supabase adapter", () => {
  it("embeds the followed list owner through the explicit profiles foreign key", async () => {
    const { supabaseSavedListFollowsStore } = await import("@/lib/savedPubsStore");

    const followed = await supabaseSavedListFollowsStore.listFollowedBy("ken");

    expect(followed[0]).toMatchObject({
      ownerHandle: "sam",
      listType: "Date Night",
      savedCount: 2,
      followerCount: 1,
    });
    expect(
      supabaseMock.selects.find(
        (call) => call.table === "saved_list_follows" && call.columns.includes("owner:"),
      )?.columns,
    ).toContain("owner:profiles!saved_list_follows_list_owner_profile_id_fkey(handle)");
  });
});
