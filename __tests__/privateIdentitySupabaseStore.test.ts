import { beforeEach, describe, expect, it, vi } from "vitest";

const existing = {
  user_id: "user-1",
  date_of_birth: "2015-02-03",
  full_name: null,
  sex: null,
  created_at: "2026-07-29T10:00:00.000Z",
  updated_at: "2026-07-29T10:00:00.000Z",
};

const state = vi.hoisted(() => ({
  upserted: null as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getByUserId: async () => ({ id: "profile-1", handle: "night_owl" }),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({ data: state.rows, error: null }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        state.upserted = row;
        const current = state.rows[0] ?? {};
        const stored = { ...current, ...row };
        state.rows = [stored];
        return {
          select: () => ({
            limit: async () => ({ data: [stored], error: null }),
          }),
        };
      },
    }),
  }),
}));

import { supabasePrivateIdentityStore } from "@/lib/privateIdentityStore";

beforeEach(() => {
  state.upserted = null;
  state.rows = [];
});

describe("Supabase private identity updates", () => {
  it("preserves stored date of birth during optional-field edits", async () => {
    state.rows = [{ ...existing }];

    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        fullName: "Night Owl",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "2015-02-03",
      fullName: "Night Owl",
    });
    expect(state.upserted).toMatchObject({
      user_id: "user-1",
      date_of_birth: "2015-02-03",
      full_name: "Night Owl",
    });
  });

  it("creates the identity row for a claim-path account that has none", async () => {
    // The production deadlock: a handle claimed through the early path stores
    // no date of birth, so there is no row, and refusing the save for the row's
    // own absence left the date of birth the owner typed with nowhere to go.
    expect(state.rows).toHaveLength(0);

    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        dateOfBirth: "1990-01-01",
        fullName: "Karan Founder",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "1990-01-01",
      fullName: "Karan Founder",
    });
    expect(state.upserted).toMatchObject({
      user_id: "user-1",
      date_of_birth: "1990-01-01",
    });
    await expect(
      supabasePrivateIdentityStore.read("user-1"),
    ).resolves.toMatchObject({ dateOfBirth: "1990-01-01" });
  });

  it("refuses a first save that carries no date of birth", async () => {
    // date_of_birth is NOT NULL, so a row cannot be built without one. The
    // route names that finding rather than blaming account setup.
    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        fullName: "Karan Founder",
      }),
    ).resolves.toBeNull();
    expect(state.upserted).toBeNull();
  });
});
