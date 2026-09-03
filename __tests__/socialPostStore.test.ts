import { describe, expect, it } from "vitest";

import {
  createMemorySocialPostStore,
  socialPostStore,
  supabaseSocialPostStore,
  type SocialPostActor,
} from "@/lib/socialPostStore";
import { validateSocialPostCreate } from "@/lib/socialPosts";

const alice: SocialPostActor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const bob: SocialPostActor = { accountId: "account-b", profileId: "profile-b", handle: "bob" };
const carol: SocialPostActor = { accountId: "account-c", profileId: "profile-c", handle: "carol" };

function fields(overrides: Record<string, unknown> = {}) {
  const result = validateSocialPostCreate({
    kind: "standard",
    visibility: "public",
    body: "A post",
    area: "camden",
    hashtags: [],
    commentPolicy: "open",
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("Social post store visibility and feeds", () => {
  it("fences keyless removal by mutation version and request key, then cancels moderation", async () => {
    const store = createMemorySocialPostStore();
    const first = await store.create(alice, fields({ body: "First" }));
    const second = await store.create(alice, fields({ body: "Second" }));
    await expect(store.remove(first.id, alice, 9, "remove-key-123456")).resolves.toBe(false);
    await expect(store.remove(first.id, alice, 0, "remove-key-123456")).resolves.toBe(true);
    await expect(store.remove(second.id, alice, 0, "remove-key-123456"))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const claims: string[] = [];
    await store.processModerationQueue({
      moderate: async ({ postId }) => { claims.push(postId); return { decision: "approved" }; },
    });
    expect(claims).toEqual([second.id]);
  });

  it("holds durable submissions until deterministic moderation approves them", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields({ hashtags: ["#Camden", "Night_Out"] }));
    const claims: string[] = [];

    expect(post.moderationState).toBe("pending");
    await expect(store.read(post.id, bob)).resolves.toBeNull();
    expect(await store.processModerationQueue({
      moderate: async ({ text }) => {
        claims.push(text);
        return { decision: "approved" };
      },
    })).toEqual({ processed: 1, approved: 1, needsReview: 0, retried: 0, terminalErrors: 0 });
    expect(claims).toEqual(["A post\n\n#camden #night_out"]);
    await expect(store.read(post.id, bob)).resolves.toMatchObject({
      id: post.id,
      author: { handle: "alice" },
    });
  });

  it("lets only the owner directly read visible pending and held posts", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields({ visibility: "private" }));

    await expect(store.readOwned(post.id, alice)).resolves.toMatchObject({
      id: post.id,
      moderationState: "pending",
      ownedByViewer: true,
    });
    await expect(store.read(post.id, bob)).resolves.toBeNull();

    await store.processModerationQueue({
      moderate: async () => ({ decision: "needs_review" }),
    });
    await expect(store.readOwned(post.id, alice)).resolves.toMatchObject({
      id: post.id,
      moderationState: "needs_review",
      ownedByViewer: true,
    });
    await expect(store.read(post.id, bob)).resolves.toBeNull();
  });

  it("keeps moderation outages queued and never treats them as clean", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields());

    expect(await store.processModerationQueue({
      moderate: async () => { throw new Error("offline"); },
    })).toEqual({ processed: 1, approved: 0, needsReview: 0, retried: 1, terminalErrors: 0 });
    await expect(store.read(post.id, bob)).resolves.toBeNull();
  });

  it("keeps non-retryable provider failures held without a hot retry loop", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields());
    const error = Object.assign(new Error("bad credentials"), { retryable: false });
    expect(await store.processModerationQueue({
      moderate: async () => { throw error; },
    })).toEqual({ processed: 1, approved: 0, needsReview: 0, retried: 0, terminalErrors: 1 });
    await expect(store.read(post.id, bob)).resolves.toBeNull();
    expect(await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) }))
      .toEqual({ processed: 0, approved: 0, needsReview: 0, retried: 0, terminalErrors: 0 });
    await expect(store.requeueTerminalModeration()).resolves.toBe(1);
    await expect(store.read(post.id, bob)).resolves.toBeNull();
    expect(await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) }))
      .toEqual({ processed: 1, approved: 1, needsReview: 0, retried: 0, terminalErrors: 0 });
  });

  it("applies public, mutual-friend, private, hidden, and removed gates on direct reads", async () => {
    const store = createMemorySocialPostStore({
      relationships: async (viewer) => viewer.profileId === bob.profileId
        ? { followingProfileIds: new Set([alice.profileId]), mutualProfileIds: new Set([alice.profileId]) }
        : { followingProfileIds: new Set(), mutualProfileIds: new Set() },
    });
    const friendPost = await store.create(alice, fields({ visibility: "friends", venueId: "venue-1" }));
    const privatePost = await store.create(alice, fields({ visibility: "private" }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    await expect(store.read(friendPost.id, bob)).resolves.toMatchObject({ venueId: "venue-1" });
    await expect(store.read(friendPost.id, carol)).resolves.toBeNull();
    await expect(store.read(privatePost.id, bob)).resolves.toBeNull();
    await expect(store.read(privatePost.id, alice)).resolves.not.toBeNull();
    await store.remove(friendPost.id, alice, friendPost.mutationVersion, "remove-test-key-1234");
    await expect(store.read(friendPost.id, alice)).resolves.toBeNull();
  });

  it("projects a public Venue to author and current mutual friends but not strangers or blocked readers", async () => {
    const store = createMemorySocialPostStore({
      relationships: async (viewer) => viewer.profileId === bob.profileId
        ? {
            followingProfileIds: new Set([alice.profileId]),
            mutualProfileIds: new Set([alice.profileId]),
            blockedProfileIds: new Set<string>(),
          }
        : viewer.profileId === carol.profileId
          ? {
              followingProfileIds: new Set([alice.profileId]),
              mutualProfileIds: new Set([alice.profileId]),
              blockedProfileIds: new Set([alice.profileId]),
            }
          : {
              followingProfileIds: new Set<string>(),
              mutualProfileIds: new Set<string>(),
              blockedProfileIds: new Set<string>(),
            },
    });
    const post = await store.create(alice, fields({ visibility: "public", venueId: "venue-1" }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    await expect(store.read(post.id, alice)).resolves.toMatchObject({
      venueId: "venue-1",
      venueProjected: true,
    });
    await expect(store.read(post.id, bob)).resolves.toMatchObject({
      venueId: "venue-1",
      venueProjected: true,
    });
    await expect(store.read(post.id, carol)).resolves.toBeNull();

    const strangerStore = createMemorySocialPostStore({
      relationships: async () => ({
        followingProfileIds: new Set<string>(),
        mutualProfileIds: new Set<string>(),
        blockedProfileIds: new Set<string>(),
      }),
    });
    const strangerPost = await strangerStore.create(alice, fields({ visibility: "public", venueId: "venue-1" }));
    await strangerStore.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    await expect(strangerStore.read(strangerPost.id, carol)).resolves.toMatchObject({
      venueId: null,
      venueProjected: false,
    });
  });

  it("returns discover, nearby, and following lanes newest-first with scoped cursors", async () => {
    let tick = Date.parse("2026-08-05T18:00:00.000Z");
    const store = createMemorySocialPostStore({
      now: () => new Date(tick += 1_000),
      relationships: async (viewer) => viewer.profileId === bob.profileId
        ? { followingProfileIds: new Set([alice.profileId]), mutualProfileIds: new Set([alice.profileId]) }
        : { followingProfileIds: new Set(), mutualProfileIds: new Set() },
    });
    await store.create(alice, fields({ body: "older public", area: "camden" }));
    await store.create(alice, fields({ body: "newer friends", visibility: "friends", area: "camden" }));
    await store.create(carol, fields({ body: "newest public", area: "shoreditch" }));
    await store.create(bob, fields({ body: "viewer's private", visibility: "private", area: "camden" }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    const discover = await store.feed(bob, { lane: "discover", limit: 1 });
    expect(discover.posts.map((post) => post.body)).toEqual(["newest public"]);
    expect(discover.nextCursor).toEqual(expect.any(String));
    const cursorParts = discover.nextCursor!.split(".");
    expect(cursorParts).toHaveLength(2);
    expect(JSON.parse(Buffer.from(cursorParts[0], "base64url").toString("utf8")))
      .not.toHaveProperty("viewer");
    const page2 = await store.feed(bob, { lane: "discover", limit: 1, cursor: discover.nextCursor });
    expect(page2.posts.map((post) => post.body)).toEqual(["older public"]);
    await expect(store.feed(carol, { lane: "discover", limit: 1, cursor: discover.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });

    expect((await store.feed(bob, { lane: "nearby", area: "camden", limit: 20 })).posts
      .map((post) => post.body)).toEqual(["older public"]);
    expect((await store.feed(bob, { lane: "following", limit: 20 })).posts
      .map((post) => post.body)).toEqual(["newer friends", "older public"]);
  });

  it("uses mutation_version compare-and-swap for every reader-visible edit and moderates only sensitive changes", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields());
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    const visibilityEdit = await store.edit(post.id, alice, 0, { visibility: "friends" }, false);

    expect(visibilityEdit).toMatchObject({
      visibility: "friends",
      revision: 0,
      mutationVersion: 1,
      moderationState: "approved",
      editedAt: null,
    });
    await expect(store.edit(post.id, alice, 0, { area: "shoreditch" }, false))
      .rejects.toMatchObject({ code: "EDIT_CONFLICT" });

    const edited = await store.edit(post.id, alice, 1, { body: "Changed" }, true);

    expect(edited).toMatchObject({ body: "Changed", revision: 1, mutationVersion: 2, moderationState: "pending" });
    expect(JSON.stringify(edited)).not.toContain(alice.accountId);
    await expect(store.read(post.id, bob)).resolves.toBeNull();
  });

  it("does not mark an unchanged content value as an edit", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields({ body: "Same words" }));
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });

    const unchanged = await store.edit(post.id, alice, 0, { body: "Same words" }, true);
    expect(unchanged).toMatchObject({
      revision: 0,
      mutationVersion: 0,
      editedAt: null,
      moderationState: "approved",
    });
    await expect(store.read(post.id, bob)).resolves.not.toBeNull();
  });

  it("edits an existing photo description through CAS and moderation", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, {
      ...fields(),
      photo: { mediaId: "11111111-1111-4111-8111-111111111111", altText: "Old description" },
    });
    await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) });
    const edited = await store.edit(post.id, alice, 0, {}, true, { existingPhotoAltText: "Corrected description" });
    expect(edited).toMatchObject({ photo: { altText: "Corrected description" }, revision: 1, mutationVersion: 1, moderationState: "pending" });
  });

  it("cannot approve a newer edit with an older in-flight moderation result", async () => {
    const store = createMemorySocialPostStore();
    const post = await store.create(alice, fields({ body: "First version" }));
    let release: (() => void) | undefined;
    const moderation = store.processModerationQueue({
      moderate: () => new Promise((resolve) => {
        release = () => resolve({ decision: "approved" });
      }),
    });
    while (!release) await Promise.resolve();
    await store.edit(post.id, alice, 0, { body: "Second version" }, true);
    release();
    await moderation;

    await expect(store.read(post.id, bob)).resolves.toBeNull();
    expect(await store.processModerationQueue({ moderate: async () => ({ decision: "approved" }) }))
      .toMatchObject({ approved: 1 });
    await expect(store.read(post.id, bob)).resolves.toMatchObject({ body: "Second version" });
  });

  it("isolates leased moderation items so one held request cannot block the next", async () => {
    const store = createMemorySocialPostStore();
    await store.create(alice, fields({ body: "Held first" }));
    await store.create(alice, fields({ body: "Starts second" }));
    let releaseFirst: (() => void) | undefined;
    let secondStarted = false;
    const processing = store.processModerationQueue({
      moderate: ({ text }) => text.startsWith("Held first")
        ? new Promise((resolve) => {
            releaseFirst = () => resolve({ decision: "approved" });
          })
        : Promise.resolve().then(() => {
            secondStarted = true;
            return { decision: "approved" as const };
          }),
    });
    while (!releaseFirst) await Promise.resolve();
    await Promise.resolve();
    const startedBeforeRelease = secondStarted;
    releaseFirst();
    await processing;

    expect(startedBeforeRelease).toBe(true);
  });
});

describe("Social post backend selection", () => {
  it("selects the fail-closed durable store in deployed production without keys", () => {
    const previousVercel = process.env.VERCEL_ENV;
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.VERCEL_ENV = "production";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(socialPostStore()).toBe(supabaseSocialPostStore);
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previousVercel;
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    }
  });
});
