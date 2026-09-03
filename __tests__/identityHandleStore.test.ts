import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  profile_handle_aliases: [] as Record<string, unknown>[],
  profiles: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({
    from: (table: keyof typeof rows) => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({ data: rows[table], error: null }),
        }),
      }),
    }),
  }),
  isSupabaseConfigured: () => true,
}));

import { supabaseIdentityHandleStore } from "@/lib/identityHandleStore";

beforeEach(() => {
  rows.profile_handle_aliases = [];
  rows.profiles = [];
});

describe("Supabase handle availability", () => {
  it("treats an unaliased generic profile row as taken", async () => {
    rows.profiles = [{ id: "profile-1" }];

    await expect(
      supabaseIdentityHandleStore.availability("anonymous_night"),
    ).resolves.toEqual({
      handle: "anonymous_night",
      available: false,
      reason: "taken",
    });
  });

  it("reports an absent handle as available", async () => {
    await expect(
      supabaseIdentityHandleStore.availability("brand_new_night"),
    ).resolves.toEqual({
      handle: "brand_new_night",
      available: true,
    });
  });
});
