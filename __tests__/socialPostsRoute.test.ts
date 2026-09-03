import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const state = vi.hoisted(() => ({
  access: {
    ok: true,
    actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" },
  } as unknown,
  calls: [] as Array<{ name: string; args: unknown[] }>,
  limitCalls: [] as unknown[][],
  read: null as unknown,
  ownedRead: null as unknown,
  limited: false,
  frozen: false,
  accessCalls: 0,
  venueLookup: {
    status: "found",
    canonicalId: "venue-canonical",
    venue: { id: "venue-canonical", name: "The Venue", borough: "Camden", lat: 0, lng: 0, kind: "pub" },
  } as unknown,
  removedObjects: [] as string[],
  createError: null as Error | null,
  editError: null as Error | null,
  removeError: null as Error | null,
  createRequestReads: 0,
  createWinnerMediaId: null as string | null,
  lastUploadedMediaId: null as string | null,
  createPrior: null as { digest: string; mediaId: string | null } | null,
  approvedTags: new Map<string, Array<{ handle: string }>>(),
}));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: async (...args: unknown[]) => {
    state.limitCalls.push(args);
    return state.limited;
  },
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  hashActor: () => "salted-profile-digest",
}));

vi.mock("@/lib/opsFreeze", () => ({
  socialFreezeResponse: () => state.frozen
    ? Response.json({ code: "SOCIAL_FROZEN" }, { status: 503 })
    : null,
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => {
    state.accessCalls += 1;
    return state.access;
  },
}));

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async () => state.venueLookup,
}));

vi.mock("@/lib/socialPostMedia.server", () => ({
  prepareSocialPhoto: async () => ({
    bytes: Buffer.from("normalised"),
    contentType: "image/jpeg",
    width: 640,
    height: 480,
    byteSize: 10,
    sha256: "a".repeat(64),
  }),
  uploadPreparedSocialPhoto: async (_owner: string, prepared: Record<string, unknown>, _storage: unknown, requestedMediaId?: string, requestedObjectKey?: string, requestedGeneration?: string) => {
    state.lastUploadedMediaId = requestedMediaId ?? "11111111-1111-4111-8111-111111111112";
    const generation = requestedGeneration ?? "22222222-2222-4222-8222-222222222222";
    return { ...prepared, mediaId: state.lastUploadedMediaId, generation, objectKey: requestedObjectKey ?? `social/${state.lastUploadedMediaId}/${generation}/image.jpg` };
  },
  reserveSocialPhotoUpload: async (_owner: string, prepared: Record<string, unknown>, requestedMediaId?: string) => {
    const mediaId = requestedMediaId ?? "11111111-1111-4111-8111-111111111112";
    const generation = "22222222-2222-4222-8222-222222222222";
    return { ...prepared, mediaId, generation, objectKey: `social/${mediaId}/${generation}/image.jpg` };
  },
  reconcileSocialPhotoUpload: async (_owner: string, mediaId: string, generation: string) => {
    const winner = state.createWinnerMediaId === "uploaded" ? state.lastUploadedMediaId : state.createWinnerMediaId;
    if (winner === mediaId) return false;
    state.removedObjects.push(`social/${mediaId}/${generation}/image.jpg`);
    return true;
  },
  signSocialPhotoObject: async () => null,
  SocialPhotoError: class SocialPhotoError extends Error {
    code = "INVALID_TYPE";
  },
  SOCIAL_PHOTO_MAX_BYTES: 10 * 1024 * 1024,
}));

vi.mock("@/lib/socialPostCreateRequest.server", () => ({
  readSocialPostCreateRequest: async () => {
    state.createRequestReads += 1;
    if (state.createPrior) return state.createPrior;
    return state.createRequestReads > 1 && state.createWinnerMediaId
      ? { digest: "f".repeat(64), mediaId: state.createWinnerMediaId === "uploaded" ? state.lastUploadedMediaId : state.createWinnerMediaId }
      : null;
  },
}));

vi.mock("@/lib/socialPostConsentStore", () => ({
  socialPostConsentStore: {
    approvedTags: async () => state.approvedTags,
  },
}));

vi.mock("@/lib/socialPostStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/socialPostStore")>();
  return {
    ...original,
    socialPostStore: () => ({
      create: async (...args: unknown[]) => {
        state.calls.push({ name: "create", args });
        if (state.createError) throw state.createError;
        const fields = args[1] as { venueId?: string | null };
        return {
          id: "post-1", body: "Hello", moderationState: "pending",
          author: { handle: "alice" },
          venueId: fields.venueId ?? null,
          venueName: null,
          venueProjected: Boolean(fields.venueId),
          ownedByViewer: true,
        };
      },
      feed: async (...args: unknown[]) => {
        state.calls.push({ name: "feed", args });
        return { posts: [], nextCursor: null };
      },
      read: async (...args: unknown[]) => {
        state.calls.push({ name: "read", args });
        return state.read;
      },
      readOwned: async (...args: unknown[]) => {
        state.calls.push({ name: "readOwned", args });
        return state.ownedRead;
      },
      edit: async (...args: unknown[]) => {
        state.calls.push({ name: "edit", args });
        if (state.editError) throw state.editError;
        return { id: "post-1", body: "Changed", revision: Number(args[2]) + 1, mutationVersion: Number(args[2]) + 1, moderationState: "pending" };
      },
      remove: async (...args: unknown[]) => {
        state.calls.push({ name: "remove", args });
        if (state.removeError) throw state.removeError;
        return true;
      },
    }),
  };
});

import { GET as list, POST } from "@/app/api/social/posts/route";
import { GET as read, PATCH } from "@/app/api/social/posts/[postId]/route";
import { SocialPostStoreError } from "@/lib/socialPostStore";
import { socialPhotoMediaId, socialPostRequestDigest } from "@/lib/socialPostIdempotency.server";

const actor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json", ...(method === "POST" ? { "Idempotency-Key": "test-social-post-key" } : {}) },
      body: JSON.stringify(body),
    }),
  });
}

beforeEach(() => {
  state.access = { ok: true, actor };
  state.calls = [];
  state.limitCalls = [];
  state.read = null;
  state.ownedRead = null;
  state.limited = false;
  state.frozen = false;
  state.accessCalls = 0;
  state.venueLookup = {
    status: "found",
    canonicalId: "venue-canonical",
    venue: { id: "venue-canonical", name: "The Venue", borough: "Camden", lat: 0, lng: 0, kind: "pub" },
  };
  state.removedObjects = [];
  state.createError = null;
  state.editError = null;
  state.removeError = null;
  state.createRequestReads = 0;
  state.createWinnerMediaId = null;
  state.lastUploadedMediaId = null;
  state.createPrior = null;
  state.approvedTags = new Map();
});

describe("/api/social/posts", () => {
  it("does not require a write key for feed reads but rejects missing create keys", async () => {
    expect((await list(request("/api/social/posts?lane=discover"))).status).toBe(200);
    const response = await POST(new Request("http://localhost/api/social/posts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "standard", visibility: "friends", body: "Words", commentPolicy: "open" }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
  });

  it("requires verified Social access for every feed read", async () => {
    state.access = {
      ok: false,
      status: 403,
      code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
      error: "Adult verification is needed for Social.",
    };
    const response = await list(request("/api/social/posts?lane=discover"));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.calls).toEqual([]);
  });

  it("passes only server actor and bounded lane inputs to the store", async () => {
    const response = await list(request("/api/social/posts?lane=nearby&area=camden&limit=20"));
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{
      name: "feed",
      args: [actor, { lane: "nearby", area: "camden", cursor: null, limit: 20 }],
    }]);
    expect(state.limitCalls[0]).toEqual([
      "social-post-feed:salted-profile-digest:nearby:camden",
      "social-post-feed:salted-profile-digest:nearby:camden",
      60,
      60_000,
    ]);
  });

  it("rate-limits verified feed reads before storage", async () => {
    state.limited = true;
    const response = await list(request("/api/social/posts?lane=discover"));
    expect(response.status).toBe(429);
    expect(state.calls).toEqual([]);
    expect(state.limitCalls[0]?.[0]).toBe(
      "social-post-feed:salted-profile-digest:discover:all",
    );
  });

  it("rejects an unlisted nearby area before storage", async () => {
    const response = await list(request("/api/social/posts?lane=nearby&area=not-a-place"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_AREA" });
    expect(state.calls).toEqual([]);
  });

  it("creates a pending post without accepting author or raw storage fields", async () => {
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard",
      visibility: "public",
      body: "Hello",
      commentPolicy: "open",
      hashtags: [],
    }));
    expect(response.status).toBe(201);
    expect(JSON.stringify(await response.json())).not.toContain("account-a");
    expect(state.calls[0]?.name).toBe("create");
    expect(state.calls[0]?.args[0]).toEqual(actor);

    const forged = await POST(request("/api/social/posts", "POST", {
      kind: "standard", visibility: "public", body: "Hello", commentPolicy: "open",
      authorProfileId: "forged", status: "visible", storageObjectKey: "secret/key",
    }));
    expect(forged.status).toBe(400);
    expect(state.calls).toHaveLength(1);
  });

  it("rejects caller-supplied media references", async () => {
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard",
      visibility: "friends",
      body: "",
      commentPolicy: "open",
      photo: {
        mediaId: "11111111-1111-4111-8111-111111111111",
        altText: "A pub sign",
      },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_POST" });
  });

  it("canonicalises a public pub Venue and rejects a non-pub Venue", async () => {
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard",
      visibility: "public",
      body: "At the Venue",
      venueId: "venue-alias",
      commentPolicy: "open",
      hashtags: [],
    }));
    expect(response.status).toBe(201);
    expect(state.calls[0]?.args[1]).toMatchObject({ venueId: "venue-canonical" });
    await expect(response.json()).resolves.toMatchObject({
      post: { venueId: "venue-canonical", venueName: "The Venue", ownedByViewer: true },
    });

    state.calls = [];
    state.venueLookup = {
      status: "found",
      canonicalId: "bar-canonical",
      venue: { id: "bar-canonical", name: "A Bar", borough: "Camden", lat: 0, lng: 0, kind: "bar" },
    };
    const rejected = await POST(request("/api/social/posts", "POST", {
      kind: "standard",
      visibility: "friends",
      body: "At the bar",
      venueId: "bar-alias",
      commentPolicy: "open",
      hashtags: [],
    }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: "INVALID_VENUE" });
    expect(state.calls).toEqual([]);
  });

  it("accepts multipart photo create without caller media keys", async () => {
    const form = new FormData();
    form.set("post", JSON.stringify({
      kind: "standard",
      visibility: "friends",
      body: "",
      commentPolicy: "friends",
      photoAltText: "Friends outside a pub",
      tagHandles: ["bob"],
    }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "night.jpg", { type: "image/jpeg" }));

    const response = await POST(new Request("http://localhost/api/social/posts", {
      method: "POST",
      headers: { "Idempotency-Key": "test-social-photo-key" },
      body: form,
    }));

    expect(response.status).toBe(201);
    expect(state.calls[0]).toEqual({
      name: "create",
      args: [
        actor,
        expect.objectContaining({
          body: "",
          photo: {
            mediaId: expect.any(String),
            altText: "Friends outside a pub",
          },
        }),
        {
          media: {
            mediaId: expect.any(String),
            objectKey: expect.stringMatching(/^social\/[0-9a-f-]+\/[0-9a-f-]+\/image\.jpg$/),
            sha256: "a".repeat(64),
            width: 640,
            height: 480,
            byteSize: 10,
          },
          tagHandles: ["bob"],
          idempotencyKey: "test-social-photo-key",
          requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    });
    expect(JSON.stringify(state.calls[0])).not.toContain("normalised");
  });

  it("removes an uploaded object when atomic create fails", async () => {
    state.createError = new Error("database unavailable");
    const form = new FormData();
    form.set("post", JSON.stringify({
      kind: "standard",
      visibility: "friends",
      body: "Photo",
      commentPolicy: "friends",
      photoAltText: "A pub sign",
    }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "night.jpg", { type: "image/jpeg" }));

    const response = await POST(new Request("http://localhost/api/social/posts", { method: "POST", headers: { "Idempotency-Key": "test-social-photo-key" }, body: form }));

    expect(response.status).toBe(503);
    expect(state.removedObjects).toEqual([
      expect.stringMatching(/^social\/[0-9a-f-]+\/[0-9a-f-]+\/image\.jpg$/),
    ]);
  });

  it("maps rejected create tags without disclosing validation details", async () => {
    state.createError = new Error("invalid Social tags");
    const form = new FormData();
    form.set("post", JSON.stringify({
      kind: "standard",
      visibility: "friends",
      body: "Photo",
      commentPolicy: "friends",
      photoAltText: "A pub sign",
      tagHandles: ["unknown"],
    }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "night.jpg", { type: "image/jpeg" }));

    const response = await POST(new Request("http://localhost/api/social/posts", {
      method: "POST",
      headers: { "Idempotency-Key": "invalid-create-tags-key" },
      body: form,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_TAGS",
      error: "Photo tags are not valid.",
      retryable: false,
    });
    expect(state.removedObjects).toHaveLength(1);
  });

  it("does not delete a winning replay photo after an idempotency conflict", async () => {
    state.createError = new SocialPostStoreError("IDEMPOTENCY_CONFLICT", "That post request key was already used for different content.");
    state.createWinnerMediaId = "uploaded";
    const form = new FormData();
    form.set("post", JSON.stringify({ kind: "standard", visibility: "friends", body: "Changed text", commentPolicy: "open", photoAltText: "Same photo" }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "night.jpg", { type: "image/jpeg" }));
    const response = await POST(new Request("http://localhost/api/social/posts", { method: "POST", headers: { "Idempotency-Key": "same-photo-retry-key" }, body: form }));
    expect(response.status).toBe(409);
    expect(state.removedObjects).toEqual([]);
  });

  it("does not delete committed media when create commits before its response fails", async () => {
    state.createError = new Error("response lost after commit");
    state.createWinnerMediaId = "uploaded";
    const form = new FormData();
    form.set("post", JSON.stringify({
      kind: "standard", visibility: "private", body: "Committed", commentPolicy: "locked",
      photoAltText: "A committed photo",
    }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "night.jpg", { type: "image/jpeg" }));

    const response = await POST(new Request("http://localhost/api/social/posts", {
      method: "POST", headers: { "Idempotency-Key": "commit-then-error-key" }, body: form,
    }));

    expect(response.status).toBe(503);
    expect(state.removedObjects).toEqual([]);
    expect(state.createRequestReads).toBe(1);
  });

  it("reuses an exact photo replay without uploading again", async () => {
    const key = "exact-photo-retry-key";
    const mediaId = socialPhotoMediaId(actor.profileId, key, "a".repeat(64));
    const fields = { kind: "standard" as const, visibility: "friends" as const, body: "Same", area: null, venueId: null, hashtags: [], commentPolicy: "open" as const, photo: { mediaId, altText: "Same photo" } };
    state.createPrior = { digest: socialPostRequestDigest(fields, "a".repeat(64), []), mediaId };
    const form = new FormData();
    form.set("post", JSON.stringify({ kind: "standard", visibility: "friends", body: "Same", commentPolicy: "open", photoAltText: "Same photo" }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "same.jpg", { type: "image/jpeg" }));
    const response = await POST(new Request("http://localhost/api/social/posts", { method: "POST", headers: { "Idempotency-Key": key }, body: form }));
    expect(response.status).toBe(201);
    expect(state.lastUploadedMediaId).toBeNull();
    expect((state.calls[0]?.args[1] as { photo: { mediaId: string } }).photo.mediaId).toBe(mediaId);
    expect(state.calls[0]?.args[2]).toMatchObject({ replayExistingMedia: true });
  });

  it("removes a losing different-photo upload after an idempotency conflict", async () => {
    state.createError = new SocialPostStoreError("IDEMPOTENCY_CONFLICT", "That post request key was already used for different content.");
    state.createWinnerMediaId = "99999999-9999-4999-8999-999999999999";
    const form = new FormData();
    form.set("post", JSON.stringify({ kind: "standard", visibility: "friends", body: "Changed", commentPolicy: "open", photoAltText: "Different photo" }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "other.jpg", { type: "image/jpeg" }));
    const response = await POST(new Request("http://localhost/api/social/posts", { method: "POST", headers: { "Idempotency-Key": "different-photo-key" }, body: form }));
    expect(response.status).toBe(409);
    expect(state.removedObjects).toHaveLength(1);
  });

  it("rate-limits creation by stable profile authority", async () => {
    state.limited = true;
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard", visibility: "public", body: "Hello",
      commentPolicy: "open", hashtags: [],
    }));
    expect(response.status).toBe(429);
    expect(state.calls).toEqual([]);
    expect(JSON.stringify(state.limitCalls)).not.toContain("profile-a");
    expect(state.limitCalls[0]?.[0]).toBe("social-post-create:salted-profile-digest");
  });

  it("freezes creation before identity, limiting, or storage work", async () => {
    state.frozen = true;
    const response = await POST(request("/api/social/posts", "POST", {
      kind: "standard", visibility: "public", body: "Hello",
      commentPolicy: "open", hashtags: [],
    }));
    expect(response.status).toBe(503);
    expect(state.accessCalls).toBe(0);
    expect(state.limitCalls).toEqual([]);
    expect(state.calls).toEqual([]);
  });
});

describe("/api/social/posts/[postId]", () => {
  const postId = "11111111-1111-4111-8111-111111111111";
  const context = { params: Promise.resolve({ postId }) };

  it("rejects a non-UUID path before durable storage", async () => {
    const response = await read(request("/api/social/posts/not-a-uuid"), {
      params: Promise.resolve({ postId: "not-a-uuid" }),
    });
    expect(response.status).toBe(404);
    expect(state.calls).toEqual([]);
  });

  it("returns 404 for a post hidden by visibility or moderation", async () => {
    const response = await read(request("/api/social/posts/post-1"), context);
    expect(response.status).toBe(404);
    expect(state.calls).toEqual([
      { name: "read", args: [postId, actor] },
      { name: "readOwned", args: [postId, actor] },
    ]);
  });

  it("returns an owned pending outbox post for edit conflict recovery", async () => {
    state.ownedRead = {
      id: postId,
      body: "Latest pending words",
      moderationState: "pending",
      mutationVersion: 2,
      photo: null,
      venueId: null,
      venueName: null,
      venueProjected: false,
      ownedByViewer: true,
    };

    const response = await read(request(`/api/social/posts/${postId}`), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      post: {
        id: postId,
        body: "Latest pending words",
        moderationState: "pending",
        mutationVersion: 2,
        ownedByViewer: true,
      },
    });
  });

  it("projects approved photo tags on a direct post read", async () => {
    state.read = {
      id: postId,
      photo: { mediaId: "media-a", altText: "At the pub" },
      venueId: null,
      venueName: null,
      venueProjected: false,
      ownedByViewer: false,
    };
    state.approvedTags = new Map([[postId, [{ handle: "bob" }]]]);
    const response = await read(request(`/api/social/posts/${postId}`), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      post: { photo: { tags: [{ handle: "bob" }] } },
    });
  });

  it("edits through the stable internal actor and reuses strict validation", async () => {
    const response = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      expectedMutationVersion: 4,
      body: "Changed",
    }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      audit: { fromMutationVersion: 4, toMutationVersion: 5 },
    });
    expect(state.calls[0]).toEqual({
      name: "edit",
      args: [postId, actor, 4, { body: "Changed" }, true],
    });
  });

  it("edits existing photo alt text without accepting a client media reference", async () => {
    const response = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      expectedMutationVersion: 4,
      photoAltText: "Corrected description",
    }), context);
    expect(response.status).toBe(200);
    expect(state.calls[0]).toEqual({
      name: "edit",
      args: [postId, actor, 4, {}, true, { existingPhotoAltText: "Corrected description" }],
    });
  });

  it("maps rejected edit tags and removes the unused upload", async () => {
    state.editError = new Error("invalid Social tags");
    const form = new FormData();
    form.set("post", JSON.stringify({
      expectedMutationVersion: 4,
      body: "Changed",
      photoAltText: "A pub sign",
      tagHandles: ["blocked"],
    }));
    form.set("photo", new File([Buffer.from([0xff, 0xd8, 0xff])], "night.jpg", { type: "image/jpeg" }));

    const response = await PATCH(new Request(`http://localhost/api/social/posts/${postId}`, {
      method: "PATCH",
      body: form,
    }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_TAGS",
      error: "Photo tags are not valid.",
      retryable: false,
    });
    expect(state.removedObjects).toHaveLength(1);
  });

  it("removes recoverably without a DELETE route or client status", async () => {
    const response = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      action: "remove",
      expectedMutationVersion: 4,
    }), context);
    expect(response.status).toBe(400);
    const removed = await PATCH(new Request("http://localhost/api/social/posts/post-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "remove-post-key-1234" },
      body: JSON.stringify({ action: "remove", expectedMutationVersion: 4 }),
    }), context);
    expect(removed.status).toBe(200);
    expect(state.calls[0]).toEqual({ name: "remove", args: [postId, actor, 4, "remove-post-key-1234"] });
  });

  it("returns conflict when a remove request key belongs to another post", async () => {
    state.removeError = new SocialPostStoreError("IDEMPOTENCY_CONFLICT", "That removal key belongs to another post.");
    const response = await PATCH(new Request("http://localhost/api/social/posts/post-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "cross-post-remove-key" },
      body: JSON.stringify({ action: "remove", expectedMutationVersion: 4 }),
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rate-limits item changes by stable profile authority", async () => {
    state.limited = true;
    const response = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      expectedMutationVersion: 0,
      body: "Changed",
    }), context);
    expect(response.status).toBe(429);
    expect(state.calls).toEqual([]);
    expect(JSON.stringify(state.limitCalls)).not.toContain("profile-a");
    expect(state.limitCalls[0]?.[0]).toBe("social-post-edit:salted-profile-digest");
  });

  it("freezes edits and removals before identity, limiting, or storage work", async () => {
    state.frozen = true;
    const edited = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      expectedMutationVersion: 0,
      body: "Changed",
    }), context);
    const removed = await PATCH(request("/api/social/posts/post-1", "PATCH", {
      action: "remove",
    }), context);
    expect([edited.status, removed.status]).toEqual([503, 503]);
    expect(state.accessCalls).toBe(0);
    expect(state.limitCalls).toEqual([]);
    expect(state.calls).toEqual([]);
  });
});
