import { describe, expect, it } from "vitest";

import {
  createMemorySocialInteractionStore,
  socialInteractionStore,
  supabaseSocialInteractionStore,
  type SocialInteractionActor,
} from "@/lib/socialInteractionStore";
import { createMemorySocialPostStore } from "@/lib/socialPostStore";
import { validateSocialPostCreate } from "@/lib/socialPosts";

const alice: SocialInteractionActor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const bob: SocialInteractionActor = { accountId: "account-b", profileId: "profile-b", handle: "bob" };
const carol: SocialInteractionActor = { accountId: "account-c", profileId: "profile-c", handle: "carol" };

function fields(overrides: Record<string, unknown> = {}) {
  const result = validateSocialPostCreate({
    kind: "standard",
    visibility: "public",
    body: "Post",
    area: "camden",
    hashtags: [],
    commentPolicy: "open",
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function harness(options: { friends?: boolean } = {}) {
  let tick = Date.parse("2026-08-05T18:00:00.000Z");
  const relationships = async (viewer: SocialInteractionActor) => ({
    followingProfileIds: viewer.profileId === bob.profileId
      ? new Set([alice.profileId])
      : new Set<string>(),
    mutualProfileIds: options.friends && viewer.profileId === bob.profileId
      ? new Set([alice.profileId])
      : new Set<string>(),
  });
  const posts = createMemorySocialPostStore({
    now: () => new Date(tick += 1_000),
    relationships,
  });
  const store = createMemorySocialInteractionStore({
    posts,
    now: () => new Date(tick += 1_000),
    relationships,
    staff: async (actor) => actor.profileId === carol.profileId
      ? { id: "staff-carol", profileId: carol.profileId, displayName: "Carol Smith", active: true, role: "moderator" }
      : null,
  });
  return { posts, store };
}

async function approvedPost(
  posts: ReturnType<typeof createMemorySocialPostStore>,
  actor = alice,
  overrides: Record<string, unknown> = {},
) {
  const post = await posts.create(actor, fields(overrides));
  await posts.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
  return post;
}

describe("Social desired-state interactions", () => {
  it("makes cheers, saves, and pure reposts idempotent desired state", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts);

    await store.setDesired(bob, post.id, "cheer", true);
    await store.setDesired(bob, post.id, "cheer", true);
    await store.setDesired(bob, post.id, "save", true);
    await store.setDesired(bob, post.id, "save", true);
    await store.setDesired(bob, post.id, "repost", true);
    await store.setDesired(bob, post.id, "repost", true);

    expect(await store.summary(bob, post.id)).toEqual({
      cheered: true,
      saved: true,
      reposted: true,
      cheerCount: 1,
      repostCount: 1,
    });
    expect(await store.listSaved(bob, { limit: 20 })).toMatchObject({
      items: [{ post: { id: post.id } }],
      nextCursor: null,
    });
    expect(await store.listCheers(alice, post.id, { limit: 20 })).toEqual({
      items: [{ profileId: bob.profileId, handle: "bob" }],
      nextCursor: null,
    });
    expect(await store.notifications(alice, { limit: 20 })).toMatchObject({
      items: [
        { kind: "repost", sourcePostId: post.id },
        { kind: "cheer", sourcePostId: post.id },
      ],
    });

    await store.setDesired(bob, post.id, "cheer", false);
    await store.setDesired(bob, post.id, "save", false);
    await store.setDesired(bob, post.id, "repost", false);
    expect(await store.summary(bob, post.id)).toEqual({
      cheered: false,
      saved: false,
      reposted: false,
      cheerCount: 0,
      repostCount: 0,
    });
  });

  it("keeps interaction ownership stable across an author handle rename", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts, { ...alice, handle: "alice-old" });

    await store.setDesired(bob, post.id, "cheer", true);
    await store.setCommentPolicy({ ...alice, handle: "alice-new" }, post.id, "locked");

    await expect(store.createComment(bob, post.id, {
      body: "Should stay closed",
      idempotencyKey: "renamed-author",
    })).rejects.toMatchObject({ code: "COMMENTS_NOT_ALLOWED" });
    expect(await store.summary(bob, post.id)).toMatchObject({ cheered: true, cheerCount: 1 });
  });

  it("never exposes save counts or creates save and self notifications", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts);
    await store.setDesired(bob, post.id, "save", true);
    await store.setDesired(alice, post.id, "cheer", true);

    expect(await store.notifications(alice, { limit: 20 })).toEqual({ items: [], nextCursor: null });
    expect(JSON.stringify(await store.summary(bob, post.id))).not.toContain("saveCount");
    expect(await store.listSaved(alice, { limit: 20 })).toEqual({ items: [], nextCursor: null });
  });

  it("binds cursors to viewer and collection scope", async () => {
    const { posts, store } = harness();
    const first = await approvedPost(posts, alice, { body: "First" });
    const second = await approvedPost(posts, alice, { body: "Second" });
    await store.setDesired(bob, first.id, "save", true);
    await store.setDesired(bob, second.id, "save", true);

    const page = await store.listSaved(bob, { limit: 1 });
    expect(page.nextCursor).toEqual(expect.any(String));
    await expect(store.listSaved(alice, { limit: 1, cursor: page.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(store.notifications(bob, { limit: 1, cursor: page.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
});

describe("Social comments, quotes, visibility, and moderation", () => {
  it("holds comments and quotes until moderation approves each exact payload", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts);
    const comment = await store.createComment(bob, post.id, {
      body: "Good shout",
      idempotencyKey: "comment-1",
    });
    const quote = await store.createQuote(bob, post.id, {
      body: "Putting this on Friday's list",
      visibility: "public",
      idempotencyKey: "quote-1",
    });

    expect(comment.moderationState).toBe("pending");
    expect(quote.moderationState).toBe("pending");
    expect(await store.listComments(alice, post.id, { limit: 20 })).toEqual({ items: [], nextCursor: null });
    expect(await store.listDerivatives(alice, { limit: 20 })).toEqual({ items: [], nextCursor: null });

    const claims: string[] = [];
    expect(await store.processModerationQueue({
      moderate: async ({ text }) => {
        claims.push(text);
        return { decision: "approved" };
      },
    })).toEqual({ processed: 2, approved: 2, needsReview: 0, retried: 0, terminalErrors: 0 });
    expect(claims).toEqual(["Good shout", "Putting this on Friday's list"]);
    expect((await store.listComments(alice, post.id, { limit: 20 })).items).toHaveLength(1);
    expect((await store.listDerivatives(alice, { limit: 20 })).items).toHaveLength(1);
  });

  it("returns the original result for a matching idempotency retry and rejects key reuse", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts);
    const first = await store.createComment(bob, post.id, { body: "Same", idempotencyKey: "retry-key" });
    const retry = await store.createComment(bob, post.id, { body: "Same", idempotencyKey: "retry-key" });
    expect(retry.id).toBe(first.id);
    await expect(store.createComment(bob, post.id, { body: "Different", idempotencyKey: "retry-key" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("enforces open, friends, and locked comment policy at mutation time", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts, alice, { commentPolicy: "friends" });
    await expect(store.createComment(bob, post.id, { body: "No", idempotencyKey: "one-way" }))
      .rejects.toMatchObject({ code: "COMMENTS_NOT_ALLOWED" });

    const friendly = harness({ friends: true });
    const friendPost = await approvedPost(friendly.posts, alice, { commentPolicy: "friends" });
    await expect(friendly.store.createComment(bob, friendPost.id, {
      body: "Allowed",
      idempotencyKey: "mutual",
    })).resolves.toMatchObject({ body: "Allowed" });
    await friendly.store.setCommentPolicy(alice, friendPost.id, "locked");
    await expect(friendly.store.createComment(bob, friendPost.id, {
      body: "Too late",
      idempotencyKey: "locked",
    })).rejects.toMatchObject({ code: "COMMENTS_NOT_ALLOWED" });
  });

  it("changes comment policy after a visibility-only mutation", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts);
    const visibilityEdit = await posts.edit(
      post.id,
      alice,
      post.mutationVersion,
      { visibility: "friends" },
      false,
    );

    await expect(store.setCommentPolicy(alice, post.id, "locked"))
      .resolves.toBeUndefined();
    await expect(posts.read(post.id, alice)).resolves.toMatchObject({
      commentPolicy: "locked",
      revision: visibilityEdit.revision,
      mutationVersion: visibilityEdit.mutationVersion + 1,
    });
  });

  it("applies two consecutive comment-policy changes using mutationVersion CAS", async () => {
    // Proven F1 repro: first policy change bumps mutationVersion only; second must
    // pass mutationVersion, not content revision, or EDIT_CONFLICT fires.
    const { posts, store } = harness();
    const post = await approvedPost(posts, alice, { commentPolicy: "open" });

    await expect(store.setCommentPolicy(alice, post.id, "friends")).resolves.toBeUndefined();
    const afterFirst = await posts.read(post.id, alice);
    expect(afterFirst).toMatchObject({
      commentPolicy: "friends",
      revision: post.revision,
      mutationVersion: post.mutationVersion + 1,
    });

    await expect(store.setCommentPolicy(alice, post.id, "locked")).resolves.toBeUndefined();
    await expect(posts.read(post.id, alice)).resolves.toMatchObject({
      commentPolicy: "locked",
      revision: post.revision,
      mutationVersion: post.mutationVersion + 2,
    });
  });

  it("applies block and source visibility reductions to comments, derivatives, counts, and notifications", async () => {
    const { posts, store } = harness({ friends: true });
    const post = await approvedPost(posts, alice, { visibility: "friends" });
    await store.setDesired(bob, post.id, "cheer", true);
    await store.createComment(bob, post.id, { body: "Friend comment", idempotencyKey: "friend-comment" });
    await store.createQuote(bob, post.id, {
      body: "Friend quote",
      visibility: "public",
      idempotencyKey: "friend-quote",
    });
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    await store.setBlock(alice, bob.profileId, true);
    expect(await store.summary(bob, post.id)).toEqual({
      cheered: false,
      saved: false,
      reposted: false,
      cheerCount: 0,
      repostCount: 0,
    });
    expect(await store.listComments(bob, post.id, { limit: 20 })).toEqual({ items: [], nextCursor: null });
    expect(await store.listDerivatives(alice, { limit: 20 })).toEqual({ items: [], nextCursor: null });
    expect(await store.notifications(alice, { limit: 20 })).toEqual({ items: [], nextCursor: null });
  });

  it("never publishes held content when moderation fails", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts);
    await store.createComment(bob, post.id, { body: "Held", idempotencyKey: "held" });
    expect(await store.processModerationQueue({ moderate: async () => { throw new Error("offline"); } }))
      .toEqual({ processed: 1, approved: 0, needsReview: 0, retried: 1, terminalErrors: 0 });
    expect(await store.listComments(alice, post.id, { limit: 20 })).toEqual({ items: [], nextCursor: null });
  });
});

describe("Social governance, reports, and notifications", () => {
  it("keeps feature-request updates append-only and chronological without votes", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts, alice, { kind: "feature_request", body: "Add quiet-pub filters" });

    await expect(store.updateFeatureRequest(bob, post.id, {
      status: "planned",
      response: "Queued",
      idempotencyKey: "staff-1",
    })).rejects.toMatchObject({ code: "STAFF_REQUIRED" });
    await store.updateFeatureRequest(carol, post.id, {
      status: "planned",
      response: "We are scoping this.",
      idempotencyKey: "staff-1",
    });
    await store.updateFeatureRequest(carol, post.id, {
      status: "shipped",
      response: "Available now.",
      idempotencyKey: "staff-2",
    });

    expect(await store.featureHistory(alice, post.id, { limit: 20 })).toMatchObject({
      currentStatus: "shipped",
      items: [
        { status: "planned", response: "We are scoping this." },
        { status: "shipped", response: "Available now." },
      ],
    });
    expect(JSON.stringify(await store.featureHistory(alice, post.id, { limit: 20 })))
      .not.toContain("Carol Smith");
    expect((await posts.read(post.id, alice))?.featureRequest).toEqual({
      status: "shipped",
      staffResponse: "Available now.",
    });
  });

  it("queues deduplicated reports without hiding content", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts);
    const first = await store.report(bob, { kind: "post", id: post.id, reason: "harassment" });
    const retry = await store.report(bob, { kind: "post", id: post.id, reason: "harassment" });
    expect(retry.id).toBe(first.id);
    await expect(posts.read(post.id, carol)).resolves.not.toBeNull();
    await expect(store.reportQueue(bob, { limit: 20 })).rejects.toMatchObject({ code: "STAFF_REQUIRED" });
    expect(await store.reportQueue(carol, { limit: 20 })).toMatchObject({
      items: [{ id: first.id, kind: "post", contentId: post.id, reason: "harassment", state: "queued" }],
    });
    await store.resolveReport(carol, first.id);
    expect(await store.reportQueue(carol, { limit: 20 })).toEqual({ items: [], nextCursor: null });
  });

  it("refuses reports for interaction content the reporter cannot read", async () => {
    const { store } = harness();
    await expect(store.report(bob, {
      kind: "comment",
      id: "11111111-1111-4111-8111-111111111111",
      reason: "harassment",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires named private staff identity for audited hide and restore", async () => {
    const { posts, store } = harness();
    const post = await approvedPost(posts);
    const comment = await store.createComment(bob, post.id, { body: "Review me", idempotencyKey: "review-me" });
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    await expect(store.moderate(bob, { kind: "comment", id: comment.id, action: "hide" }))
      .rejects.toMatchObject({ code: "STAFF_REQUIRED" });
    await expect(store.moderate(carol, { kind: "comment", id: comment.id, action: "hide" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await store.report(alice, { kind: "comment", id: comment.id, reason: "harassment" });
    await store.moderate(carol, { kind: "comment", id: comment.id, action: "hide" });
    expect(await store.listComments(alice, post.id, { limit: 20 })).toEqual({ items: [], nextCursor: null });
    await store.moderate(carol, { kind: "comment", id: comment.id, action: "restore" });
    expect((await store.listComments(alice, post.id, { limit: 20 })).items).toHaveLength(1);
  });

  it("keeps the staff feature queue chronological and staff-only", async () => {
    const { posts, store } = harness();
    await approvedPost(posts, alice, { kind: "feature_request", body: "Older feature" });
    await approvedPost(posts, bob, { kind: "feature_request", body: "Newer feature" });
    await expect(store.featureQueue(alice, { limit: 20 })).rejects.toMatchObject({ code: "STAFF_REQUIRED" });
    expect((await store.featureQueue(carol, { limit: 20 })).items.map((post) => post.body))
      .toEqual(["Newer feature", "Older feature"]);
  });

  it("projects notification detail only while the source remains authorised", async () => {
    const { posts, store } = harness({ friends: true });
    const post = await approvedPost(posts, alice, { visibility: "friends" });
    await store.createComment(bob, post.id, { body: "Visible now", idempotencyKey: "notify" });
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    expect((await store.notifications(alice, { limit: 20 })).items).toMatchObject([
      { kind: "comment", sourcePostId: post.id },
    ]);
    await posts.remove(post.id, alice, post.revision, "remove-test-key-1234");
    expect(await store.notifications(alice, { limit: 20 })).toEqual({ items: [], nextCursor: null });
  });

  it("selects the durable store in deployed production", () => {
    const prior = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      expect(socialInteractionStore()).toBe(supabaseSocialInteractionStore);
    } finally {
      if (prior === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prior;
    }
  });
});
