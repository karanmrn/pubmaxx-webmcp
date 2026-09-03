import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  postStoreEdits: [] as unknown[][],
  postRow: {
    id: "11111111-1111-4111-8111-111111111111",
    author_profile_id: "22222222-2222-4222-8222-222222222222",
    author_handle: "alice",
    kind: "feature_request",
    visibility: "public",
    status: "visible",
    body: "Source post",
    area_slug: "camden",
    venue_id: null,
    hashtags: [],
    comment_policy: "open",
    photo_media_id: null,
    photo_alt_text: null,
    moderation_state: "approved",
    feature_status: "submitted",
    feature_staff_response: null,
    revision: 0,
    mutation_version: 0,
    edited_at: null,
    moderated_at: "2026-08-06T10:00:00.000Z",
    created_at: "2026-08-06T09:00:00.000Z",
    updated_at: "2026-08-06T10:00:00.000Z",
  },
}));

vi.mock("@/lib/socialPostStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/socialPostStore")>();
  return {
    ...original,
    socialPostStore: () => ({
      read: async () => ({
        id: state.postRow.id,
        revision: Number(state.postRow.revision),
        mutationVersion: Number(state.postRow.mutation_version),
      }),
      edit: async (...args: unknown[]) => {
        const expectedMutationVersion = Number(args[2]);
        if (expectedMutationVersion !== Number(state.postRow.mutation_version)) {
          throw new original.SocialPostStoreError(
            "EDIT_CONFLICT",
            "This post changed before your edit was saved. Reload it and try again.",
          );
        }
        state.postStoreEdits.push(args);
        const changes = args[3] as { commentPolicy?: string };
        if (changes.commentPolicy) state.postRow.comment_policy = changes.commentPolicy;
        state.postRow.mutation_version = Number(state.postRow.mutation_version) + 1;
      },
    }),
  };
});

vi.mock("@/lib/supabase", () => ({
  hashActor: (value: string) => value,
  requiresSupabaseStore: () => true,
  requireSupabaseAdmin: () => ({
    rpc: async (name: string) => {
      state.calls.push(name);
      if (name === "read_social_saves") {
        return {
          data: [{ post_id: state.postRow.id, saved_at: state.postRow.created_at, source_post: state.postRow }],
          error: null,
        };
      }
      if (name === "read_social_derivatives") {
        return {
          data: [{
            id: "33333333-3333-4333-8333-333333333333",
            kind: "repost",
            source_post_id: state.postRow.id,
            author_handle: "bob",
            body: null,
            visibility: "public",
            created_at: state.postRow.created_at,
            source_post: state.postRow,
          }],
          error: null,
        };
      }
      if (name === "read_social_feature_queue") return { data: [state.postRow], error: null };
      if (name === "read_social_feature_history") return { data: [], error: null };
      if (name === "read_social_feature_status") return { data: [], error: null };
      if (name === "read_social_post") return { data: [state.postRow], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  }),
}));

import { supabaseSocialInteractionStore } from "@/lib/socialInteractionStore";

const viewer = { accountId: "account-c", profileId: "profile-c", handle: "carol" };

beforeEach(() => {
  state.calls = [];
  state.postStoreEdits = [];
});

describe("durable Social interaction projections", () => {
  it("hydrates saved, derivative, and feature pages without per-post reads", async () => {
    await expect(supabaseSocialInteractionStore.listSaved(viewer, { limit: 20 }))
      .resolves.toMatchObject({ items: [{ post: { id: state.postRow.id } }] });
    await expect(supabaseSocialInteractionStore.listDerivatives(viewer, { limit: 20 }))
      .resolves.toMatchObject({ items: [{ sourcePost: { id: state.postRow.id } }] });
    await expect(supabaseSocialInteractionStore.featureQueue(viewer, { limit: 20 }))
      .resolves.toMatchObject({ items: [{ id: state.postRow.id }] });

    expect(state.calls).toEqual([
      "read_social_saves",
      "read_social_derivatives",
      "read_social_feature_queue",
    ]);
  });

  it("maps an absent feature status projection to not found", async () => {
    await expect(supabaseSocialInteractionStore.featureHistory(viewer, state.postRow.id, { limit: 20 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses mutation version when durable comment policy changes", async () => {
    state.postRow.mutation_version = 7;
    state.postRow.revision = 3;

    await supabaseSocialInteractionStore.setCommentPolicy(
      viewer,
      state.postRow.id,
      "locked",
    );

    expect(state.postStoreEdits).toEqual([[
      state.postRow.id,
      viewer,
      7,
      { commentPolicy: "locked" },
      false,
    ]]);
    expect(state.postRow.mutation_version).toBe(8);
    expect(state.postRow.revision).toBe(3);
  });

  it("applies two consecutive durable comment-policy changes without revision CAS conflict", async () => {
    // Same F1 repro as memory: two policy edits, revision stays, mutationVersion advances.
    state.postRow.mutation_version = 7;
    state.postRow.revision = 3;
    state.postRow.comment_policy = "open";

    await expect(supabaseSocialInteractionStore.setCommentPolicy(viewer, state.postRow.id, "friends"))
      .resolves.toBeUndefined();
    await expect(supabaseSocialInteractionStore.setCommentPolicy(viewer, state.postRow.id, "locked"))
      .resolves.toBeUndefined();

    expect(state.postStoreEdits).toEqual([
      [state.postRow.id, viewer, 7, { commentPolicy: "friends" }, false],
      [state.postRow.id, viewer, 8, { commentPolicy: "locked" }, false],
    ]);
    expect(state.postRow).toMatchObject({
      comment_policy: "locked",
      mutation_version: 9,
      revision: 3,
    });
  });
});
