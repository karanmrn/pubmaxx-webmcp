import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  calls: [] as Array<{ name: string; input: Record<string, unknown> }>,
  tableRows: new Map<string, unknown[]>(),
  tableCalls: [] as Array<{
    table: string;
    columns: string;
    postIds: string[];
    state: string;
  }>,
}));

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({
    rpc: async (name: string, input: Record<string, unknown>) => {
      state.calls.push({ name, input });
      return { data: state.rows.get(name) ?? [], error: null };
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        in: (_column: string, postIds: string[]) => ({
          eq: async (_columnName: string, queueState: string) => {
            state.tableCalls.push({ table, columns, postIds, state: queueState });
            return { data: state.tableRows.get(table) ?? [], error: null };
          },
        }),
      }),
    }),
  }),
}));

import { createSocialPostConsentStore } from "@/lib/socialPostConsentStore";

const viewer = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const staffRoleId = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  state.rows = new Map();
  state.calls = [];
  state.tableRows = new Map();
  state.tableCalls = [];
});

describe("Social post consent and private read store", () => {
  it("batches only approved current-handle tags by visible post", async () => {
    state.rows.set("read_social_post_tags_many", [
      { post_id: "post-a", proposal_id: "proposal-a", handle: "bob_new" },
      { post_id: "post-a", proposal_id: "proposal-b", handle: "carol" },
    ]);
    const result = await createSocialPostConsentStore().approvedTags(viewer, ["post-a", "post-b"]);

    expect(result).toEqual(new Map([
      ["post-a", [{ handle: "bob_new" }, { handle: "carol" }]],
    ]));
    expect(state.calls[0]).toEqual({
      name: "read_social_post_tags_many",
      input: { p_viewer: "profile-a", p_post_ids: ["post-a", "post-b"] },
    });
  });

  it("reauthorises each media read and exposes no object key on denial", async () => {
    const store = createSocialPostConsentStore();
    state.rows.set("read_social_post_media", [{ object_key: "social/profile-a/media-a/image.jpg" }]);
    await expect(store.mediaObjectKey(viewer, "media-a")).resolves.toBe("social/profile-a/media-a/image.jpg");
    state.rows.set("read_social_post_media", []);
    await expect(store.mediaObjectKey(viewer, "media-a")).resolves.toBeNull();
    expect(state.calls).toHaveLength(2);
  });

  it("scopes tag actions, pending outbox, and held moderation to the verified actor", async () => {
    const store = createSocialPostConsentStore();
    state.rows.set("act_social_post_tag", true);
    state.rows.set("read_social_tag_inbox", [{
      proposal_id: "proposal-a",
      post_id: "post-a",
      media_id: "media-a",
      author_handle: "bob",
      state: "proposed",
      visibility: "private",
      photo_alt_text: "Bob beside the bar",
      review_revision: 4,
      audience_visibility: null,
      audience_revision: null,
      audience_shown_at: null,
      created_at: "2026-08-05T12:00:00.000Z",
    }]);
    state.rows.set("read_social_post_outbox", []);
    state.rows.set("read_social_post_moderation_queue", []);
    state.rows.set("moderate_social_post", true);

    await store.actOnTag(viewer, "proposal-a", "approve", 4);
    await expect(store.tagInbox(viewer, { lane: "proposed", limit: 20 })).resolves.toEqual({
      proposals: [{
        id: "proposal-a",
        postId: "post-a",
        mediaId: "media-a",
        authorHandle: "bob",
        state: "proposed",
        visibility: "private",
        photoAltText: "Bob beside the bar",
        reviewRevision: 4,
        audienceAtApproval: null,
        createdAt: "2026-08-05T12:00:00.000Z",
      }],
      nextCursor: null,
    });
    await store.outbox(viewer, { limit: 20 });
    await store.heldQueue(viewer, 20);
    await store.moderateHeld(viewer, "post-a", "media-a", "approve");

    expect(state.calls.map((call) => call.input.p_actor ?? call.input.p_owner ?? call.input.p_viewer))
      .toEqual(["profile-a", "profile-a", "profile-a", "profile-a", "profile-a"]);
    expect(state.calls[0]?.input.p_expected_audience_revision).toBe(4);
    expect(state.calls[1]?.input).toMatchObject({
      p_lane: "proposed", p_before_created_at: null, p_before_id: null, p_limit: 21,
    });
  });

  it("uses the admin-only moderation RPCs without requiring a Social session", async () => {
    state.rows.set("read_social_post_moderation_queue_admin", [{
      staff_display_name: "Captain",
      post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      moderation_claim: "A queued post",
      created_at: "2026-08-29T11:55:00.000Z",
    }]);
    state.rows.set("moderate_social_post_admin", true);
    state.tableRows.set("social_post_moderation_jobs", [{
      post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revision: 4,
      media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      moderation_claim: "A queued post",
      state: "done",
      created_at: "2026-08-29T12:01:00.000Z",
      social_posts: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        author_handle: "alice",
        visibility: "friends",
        status: "visible",
        body: "Friday at the Pineapple.",
        area_slug: "camden",
        venue_id: "venue-pineapple",
        comment_policy: "friends",
        photo_media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        photo_alt_text: "Two pints beside the window",
        moderation_state: "approved",
        revision: 4,
        created_at: "2026-08-29T11:55:00.000Z",
        updated_at: "2026-08-29T12:00:00.000Z",
      },
    }]);

    const store = createSocialPostConsentStore();
    await expect(store.heldQueueForAdmin(staffRoleId, 50)).resolves.toEqual([{
      staffDisplayName: "Captain",
      postId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      mediaId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      revision: 4,
      authorHandle: "alice",
      body: "Friday at the Pineapple.",
      photoAltText: "Two pints beside the window",
      area: "camden",
      venueId: "venue-pineapple",
      visibility: "friends",
      commentPolicy: "friends",
      moderationClaim: "A queued post",
      moderationState: "approved",
      createdAt: "2026-08-29T11:55:00.000Z",
      updatedAt: "2026-08-29T12:00:00.000Z",
    }]);
    await store.moderateHeldForAdmin(
      staffRoleId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      0,
      "approve",
    );
    expect(state.calls).toEqual([
      {
        name: "read_social_post_moderation_queue_admin",
        input: { p_staff_role_id: staffRoleId, p_limit: 50 },
      },
      {
        name: "moderate_social_post_admin",
        input: {
          p_staff_role_id: staffRoleId,
          p_post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          p_media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          p_expected_revision: 0,
          p_action: "approve",
        },
      },
    ]);
    expect(state.tableCalls).toEqual([expect.objectContaining({
      table: "social_post_moderation_jobs",
      postIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      state: "done",
    })]);
    expect(state.tableCalls[0]?.columns).toContain("author_handle");
    expect(state.tableCalls[0]?.columns).toContain("moderation_state");
    expect(state.tableCalls[0]?.columns).not.toContain("author_profile_id");
  });

  it("does not combine an authorised queue row with a different post revision", async () => {
    state.rows.set("read_social_post_moderation_queue_admin", [{
      staff_display_name: "Captain",
      post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      media_id: null,
      moderation_claim: "Held revision four",
      created_at: "2026-08-29T12:00:00.000Z",
    }]);
    state.tableRows.set("social_post_moderation_jobs", [{
      post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revision: 5,
      media_id: null,
      moderation_claim: "Held revision five",
      state: "done",
      created_at: "2026-08-29T12:05:00.000Z",
      social_posts: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        author_handle: "alice",
        visibility: "public",
        status: "visible",
        body: "A newer revision.",
        area_slug: null,
        venue_id: null,
        comment_policy: "open",
        photo_media_id: null,
        photo_alt_text: null,
        moderation_state: "needs_review",
        revision: 5,
        created_at: "2026-08-29T11:55:00.000Z",
        updated_at: "2026-08-29T12:05:00.000Z",
      },
    }]);

    await expect(createSocialPostConsentStore().heldQueueForAdmin(staffRoleId, 50))
      .resolves.toEqual([]);
  });

  it("rejects a stale expected revision for the same post and media", async () => {
    state.rows.set("moderate_social_post_admin", false);
    const store = createSocialPostConsentStore();

    await expect(store.moderateHeldForAdmin(
      staffRoleId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      4,
      "approve",
    )).rejects.toMatchObject({ kind: "conflict" });
    expect(state.calls).toEqual([{
      name: "moderate_social_post_admin",
      input: {
        p_staff_role_id: staffRoleId,
        p_post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        p_media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        p_expected_revision: 4,
        p_action: "approve",
      },
    }]);
  });

  it("binds consent cursors to stable viewer and lane", async () => {
    const proposal = (id: string, createdAt: string) => ({
      proposal_id: id,
      post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      author_handle: "bob",
      state: "proposed",
      visibility: "private",
      photo_alt_text: "Bob beside the bar",
      review_revision: 2,
      audience_visibility: null,
      audience_revision: null,
      audience_shown_at: null,
      created_at: createdAt,
    });
    state.rows.set("read_social_tag_inbox", [
      proposal("11111111-1111-4111-8111-111111111111", "2026-08-05T12:00:00.000Z"),
      proposal("22222222-2222-4222-8222-222222222222", "2026-08-05T11:00:00.000Z"),
    ]);
    const store = createSocialPostConsentStore();
    const first = await store.tagInbox(viewer, { lane: "proposed", limit: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(store.tagInbox({ ...viewer, profileId: "other-profile" }, {
      lane: "proposed", limit: 1, cursor: first.nextCursor,
    })).rejects.toThrow(/page is not valid/i);
    await expect(store.tagInbox(viewer, {
      lane: "approved", limit: 1, cursor: first.nextCursor,
    })).rejects.toThrow(/page is not valid/i);
    await expect(store.outbox(viewer, {
      limit: 1, cursor: first.nextCursor,
    })).rejects.toThrow(/page is not valid/i);
    await expect(store.tagInbox(viewer, {
      lane: "proposed", limit: 1, cursor: `${first.nextCursor}x`,
    })).rejects.toThrow(/page is not valid/i);
  });

  it("keeps approved withdrawal rows after their moderated photo is unavailable", async () => {
    state.rows.set("read_social_tag_inbox", [{
      proposal_id: "11111111-1111-4111-8111-111111111111",
      post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      media_id: null,
      author_handle: "bob",
      state: "approved",
      visibility: "friends",
      photo_alt_text: null,
      review_revision: 5,
      audience_visibility: "friends",
      audience_revision: 3,
      audience_shown_at: "2026-08-05T10:00:00.000Z",
      created_at: "2026-08-05T09:00:00.000Z",
    }]);

    const page = await createSocialPostConsentStore().tagInbox(viewer, {
      lane: "approved",
      limit: 20,
    });

    expect(page.proposals[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      mediaId: null,
      photoAltText: null,
      state: "approved",
      audienceAtApproval: { visibility: "friends", revision: 3 },
    });
    expect(page.proposals[0]).not.toHaveProperty("body");
  });

  it("returns full stable-owned posts in the owner lane", async () => {
    state.rows.set("read_social_post_outbox", [{
      id: "33333333-3333-4333-8333-333333333333",
      author_profile_id: "profile-a",
      author_handle: "alice_renamed",
      kind: "standard",
      visibility: "private",
      status: "visible",
      body: "Owner copy",
      area_slug: null,
      venue_id: null,
      hashtags: [],
      comment_policy: "locked",
      photo_media_id: null,
      photo_alt_text: null,
      moderation_state: "approved",
      revision: 3,
      edited_at: null,
      moderated_at: "2026-08-05T12:00:00.000Z",
      created_at: "2026-08-05T11:00:00.000Z",
      updated_at: "2026-08-05T12:00:00.000Z",
    }]);
    const page = await createSocialPostConsentStore().outbox(viewer, { limit: 20 });
    expect(page).toMatchObject({
      posts: [{
        id: "33333333-3333-4333-8333-333333333333",
        author: { handle: "alice_renamed" },
        ownedByViewer: true,
        visibility: "private",
        moderationState: "approved",
      }],
      nextCursor: null,
    });
  });
});
