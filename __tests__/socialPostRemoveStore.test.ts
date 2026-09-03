import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => ({
    rpc: async () => ({ data: null, error: { message: "idempotency conflict" } }),
  }),
}));

import { SocialPostStoreError, supabaseSocialPostStore } from "@/lib/socialPostStore";

describe("durable Social post removal", () => {
  it("maps cross-post request-key reuse to a typed conflict", async () => {
    await expect(supabaseSocialPostStore.remove(
      "post-a",
      { accountId: "account-a", profileId: "profile-a", handle: "alice" },
      0,
      "remove-request-key",
    )).rejects.toEqual(expect.objectContaining<Partial<SocialPostStoreError>>({
      code: "IDEMPOTENCY_CONFLICT",
    }));
  });
});
