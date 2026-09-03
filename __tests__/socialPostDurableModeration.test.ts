import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  completionPostIds: [] as string[],
  editInput: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase", () => ({
  requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => {
    const currentRow = {
      id: "post-1",
      author_profile_id: "profile-a",
      author_handle: "alice",
      kind: "standard",
      visibility: "public",
      status: "visible",
      body: "Original",
      area_slug: "camden",
      venue_id: null,
      hashtags: ["original"],
      comment_policy: "open",
      photo_media_id: null,
      photo_alt_text: null,
      feature_status: null,
      feature_staff_response: null,
      moderation_state: "approved",
      revision: 3,
      mutation_version: 7,
      edited_at: null,
      moderated_at: "2026-08-06T10:00:00.000Z",
      created_at: "2026-08-06T09:00:00.000Z",
      updated_at: "2026-08-06T10:00:00.000Z",
    };
    type Query = {
      select(...args: unknown[]): Query;
      eq(...args: unknown[]): Query;
      maybeSingle(): Promise<{ data: typeof currentRow; error: null }>;
    };
    const query: Query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: currentRow, error: null }),
    };
    return {
      from: () => query,
      rpc: async (name: string, input: Record<string, unknown>) => {
        if (name === "edit_social_post") {
          state.editInput = input;
          return input.p_expected_mutation_version === 7
            ? {
                data: [{
                  ...currentRow,
                  visibility: input.p_visibility,
                  comment_policy: input.p_comment_policy,
                  mutation_version: 8,
                }],
                error: null,
              }
            : { data: null, error: new Error("missing mutation version") };
        }
        if (name === "claim_social_post_moderation_jobs") {
          return {
            data: [
              { post_id: "post-1", revision: 0, moderation_claim: "First", attempts: 1, lease_token: "lease-1" },
              { post_id: "post-2", revision: 0, moderation_claim: "Second", attempts: 1, lease_token: "lease-2" },
            ],
            error: null,
          };
        }
        if (name === "complete_social_post_moderation_job") {
          const postId = String(input.p_post_id);
          state.completionPostIds.push(postId);
          return postId === "post-1"
            ? { data: null, error: new Error("completion unavailable") }
            : { data: true, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
    };
  },
}));

import { supabaseSocialPostStore } from "@/lib/socialPostStore";

beforeEach(() => {
  state.completionPostIds = [];
  state.editInput = null;
});

describe("durable Social post moderation isolation", () => {
  it("uses the independent mutation version for edit conflicts", async () => {
    await expect(supabaseSocialPostStore.edit(
      "post-1",
      { accountId: "account-a", profileId: "profile-a", handle: "alice" },
      7,
      { visibility: "private" },
      false,
    )).resolves.toMatchObject({ visibility: "private", revision: 3, mutationVersion: 8 });

    expect(state.editInput).toMatchObject({
      p_expected_mutation_version: 7,
      p_visibility: "private",
    });
    expect(state.editInput).not.toHaveProperty("p_expected_revision");
  });

  it("finishes unaffected leased items then fails the drain when one completion is unavailable", async () => {
    await expect(supabaseSocialPostStore.processModerationQueue({
      moderate: async () => ({ decision: "approved" }),
    })).rejects.toThrow(/moderation item/i);

    expect(state.completionPostIds).toContain("post-2");
  });
});
