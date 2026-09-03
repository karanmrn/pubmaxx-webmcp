import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

const mediaId = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/supabase", () => ({
  requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return {
        data: [{
          id: "22222222-2222-4222-8222-222222222222",
          author_profile_id: "33333333-3333-4333-8333-333333333333",
          author_handle: "alice",
          kind: "standard",
          visibility: "friends",
          status: "visible",
          body: "Same",
          area_slug: null,
          venue_id: null,
          hashtags: [],
          comment_policy: "open",
          photo_media_id: mediaId,
          photo_alt_text: "Same photo",
          moderation_state: "pending",
          feature_status: null,
          feature_staff_response: null,
          revision: 0,
          edited_at: null,
          moderated_at: null,
          created_at: "2026-08-05T12:00:00.000Z",
          updated_at: "2026-08-05T12:00:00.000Z",
        }],
        error: null,
      };
    },
  }),
}));

import { supabaseSocialPostStore } from "@/lib/socialPostStore";

describe("durable Social post photo replay", () => {
  beforeEach(() => {
    state.rpcCalls = [];
  });

  it("returns the committed post through the idempotency RPC without new media", async () => {
    const post = await supabaseSocialPostStore.create(
      {
        accountId: "44444444-4444-4444-8444-444444444444",
        profileId: "33333333-3333-4333-8333-333333333333",
        handle: "alice",
      },
      {
        kind: "standard",
        visibility: "friends",
        body: "Same",
        area: null,
        venueId: null,
        hashtags: [],
        commentPolicy: "open",
        photo: { mediaId, altText: "Same photo" },
      },
      {
        idempotencyKey: "exact-photo-retry-key",
        requestDigest: "a".repeat(64),
        replayExistingMedia: true,
      },
    );

    expect(post).toMatchObject({
      id: "22222222-2222-4222-8222-222222222222",
      photo: { mediaId, altText: "Same photo" },
    });
    expect(state.rpcCalls).toEqual([{
      name: "create_social_post_idempotent",
      args: expect.objectContaining({
        p_idempotency_key: "exact-photo-retry-key",
        p_request_digest: "a".repeat(64),
        p_media_id: null,
        p_object_key: null,
      }),
    }]);
  });
});
