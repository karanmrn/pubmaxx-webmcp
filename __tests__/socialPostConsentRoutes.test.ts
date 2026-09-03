import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown[] }>,
  adminQueueThrows: false,
  adminQueueRows: [] as unknown[],
  adminModerationKind: null as "conflict" | "unavailable" | null,
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => ({
    ok: true,
    actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" },
  }),
}));
vi.mock("@/lib/adminAuth", () => ({
  isModerator: (request: Request) => request.headers.get("x-admin-token") === "admin-token",
  moderatorStaffRoleId: (request: Request) =>
    request.headers.get("x-admin-token") === "admin-token"
      ? "99999999-9999-4999-8999-999999999999"
      : null,
}));
vi.mock("@/lib/socialPostConsentStore", () => {
  class SocialPostConsentStoreError extends Error {
    constructor(
      message: string,
      readonly kind: "invalid" | "conflict" | "unavailable" = "unavailable",
    ) {
      super(message);
    }
  }
  return {
    SocialPostConsentStoreError,
    socialPostConsentStore: {
      tagInbox: async (...args: unknown[]) => {
        state.calls.push({ name: "tagInbox", args });
        if ((args[1] as { cursor?: string | null }).cursor === "bad") {
          throw new SocialPostConsentStoreError("That Social page is not valid.");
        }
        return { proposals: [], nextCursor: null };
      },
      actOnTag: async (...args: unknown[]) => {
        state.calls.push({ name: "actOnTag", args });
      },
      outbox: async (...args: unknown[]) => {
        state.calls.push({ name: "outbox", args });
        if ((args[1] as { cursor?: string | null }).cursor === "bad") {
          throw new SocialPostConsentStoreError("That Social page is not valid.");
        }
        return { posts: [], nextCursor: null };
      },
      heldQueue: async () => [],
      moderateHeld: async (...args: unknown[]) => {
        state.calls.push({ name: "moderateHeld", args });
      },
      heldQueueForAdmin: async () => {
        if (state.adminQueueThrows) throw new Error("migration missing");
        return state.adminQueueRows;
      },
      adminMediaObjectKey: async (...args: unknown[]) => {
        state.calls.push({ name: "adminMediaObjectKey", args });
        return null;
      },
      moderateHeldForAdmin: async (...args: unknown[]) => {
        state.calls.push({ name: "moderateHeldForAdmin", args });
        if (state.adminModerationKind) {
          throw new SocialPostConsentStoreError(
            "moderation failed",
            state.adminModerationKind,
          );
        }
      },
    },
  };
});
vi.mock("@/lib/socialPostVenue.server", () => ({
  projectSocialVenueNames: async (posts: unknown[]) => posts,
}));

import { GET as tags, POST as act } from "@/app/api/social/tags/route";
import { GET as outbox } from "@/app/api/social/outbox/route";
import { GET as readAdminQueue, POST as moderate } from "@/app/api/admin/social-posts/route";

const proposalId = "11111111-1111-4111-8111-111111111111";
const postId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
  state.calls = [];
  state.adminQueueThrows = false;
  state.adminQueueRows = [];
  state.adminModerationKind = null;
});

afterEach(() => vi.unstubAllEnvs());

describe("Social consent API contracts", () => {
  it("blocks admin Social reads and moderation during rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");

    const queue = await readAdminQueue(
      new Request("http://localhost/api/admin/social-posts", {
        headers: { "x-admin-token": "admin-token" },
      }),
    );
    const moderation = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": "admin-token" },
      body: JSON.stringify({ postId, mediaId: null, expectedRevision: 0, action: "hide" }),
    }));

    expect(queue.status).toBe(503);
    expect(moderation.status).toBe(503);
    expect(await queue.json()).toMatchObject({ code: "SOCIAL_PREVIEW" });
    expect(await moderation.json()).toMatchObject({ code: "SOCIAL_PREVIEW" });
    expect(state.calls).toEqual([]);
  });

  it("passes bounded lane pages and owner pages to stable actor stores", async () => {
    expect((await tags(new Request("http://localhost/api/social/tags?lane=approved&limit=12&cursor=opaque"))).status).toBe(200);
    expect((await outbox(new Request("http://localhost/api/social/outbox?limit=8"))).status).toBe(200);
    expect(state.calls).toEqual([
      { name: "tagInbox", args: [expect.objectContaining({ profileId: "profile-a" }), { lane: "approved", cursor: "opaque", limit: 12 }] },
      { name: "outbox", args: [expect.objectContaining({ profileId: "profile-a" }), { cursor: null, limit: 8 }] },
    ]);
  });

  it("maps invalid signed cursors to client errors", async () => {
    expect((await tags(new Request("http://localhost/api/social/tags?cursor=bad"))).status).toBe(400);
    expect((await outbox(new Request("http://localhost/api/social/outbox?cursor=bad"))).status).toBe(400);
  });

  it("requires reviewed audience revision for approval and rejects unknown mutation fields", async () => {
    const approved = await act(new Request("http://localhost/api/social/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, action: "approve", expectedAudienceRevision: 7 }),
    }));
    expect(approved.status).toBe(200);
    expect(state.calls[0]).toEqual({
      name: "actOnTag",
      args: [expect.objectContaining({ profileId: "profile-a" }), proposalId, "approve", 7],
    });
    const staleShape = await act(new Request("http://localhost/api/social/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, action: "approve", expectedAudienceRevision: 7, actor: "forged" }),
    }));
    expect(staleShape.status).toBe(400);
  });

  it("rejects unknown moderator fields before the store", async () => {
    const response = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": "admin-token" },
      body: JSON.stringify({ postId, mediaId: null, expectedRevision: 4, action: "hide", role: "forged" }),
    }));
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
    const malformed = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": "admin-token" },
      body: JSON.stringify({ postId: "-".repeat(36), mediaId: null, expectedRevision: 4, action: "hide" }),
    }));
    expect(malformed.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("requires a PostgreSQL-safe non-negative integer held revision", async () => {
    const invalidRevisions: unknown[] = [
      -1,
      1.5,
      "0",
      null,
      undefined,
      2_147_483_648,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    for (const expectedRevision of invalidRevisions) {
      const input: Record<string, unknown> = { postId, mediaId: null, action: "hide" };
      if (expectedRevision !== undefined) input.expectedRevision = expectedRevision;
      const response = await moderate(new Request("http://localhost/api/admin/social-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": "admin-token" },
        body: JSON.stringify(input),
      }));
      expect(response.status, `revision ${String(expectedRevision)}`).toBe(400);
    }
    expect(state.calls).toEqual([]);

    const maximum = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": "admin-token" },
      body: JSON.stringify({
        postId,
        mediaId: null,
        expectedRevision: 2_147_483_647,
        action: "hide",
      }),
    }));
    expect(maximum.status).toBe(200);
    expect(state.calls).toEqual([{
      name: "moderateHeldForAdmin",
      args: [
        "99999999-9999-4999-8999-999999999999",
        postId,
        null,
        2_147_483_647,
        "hide",
      ],
    }]);
  });

  it("protects the held-post queue with moderator access, not Social actor access", async () => {
    const anonymous = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, mediaId: null, expectedRevision: 0, action: "hide" }),
    }));
    expect(anonymous.status).toBe(403);

    const moderator = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": "admin-token",
      },
      body: JSON.stringify({ postId, mediaId: null, expectedRevision: 0, action: "hide" }),
    }));
    expect(moderator.status).toBe(200);
    expect(state.calls).toEqual([
      {
        name: "moderateHeldForAdmin",
        args: ["99999999-9999-4999-8999-999999999999", postId, null, 0, "hide"],
      },
    ]);
  });

  it("reports an unavailable admin queue instead of an empty queue", async () => {
    state.adminQueueThrows = true;
    const response = await readAdminQueue(
      new Request("http://localhost/api/admin/social-posts", {
        headers: { "x-admin-token": "admin-token" },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("returns moderator-safe held revision context without the stable author ID", async () => {
    const heldPost = {
      staffDisplayName: "Captain",
      postId,
      mediaId: null,
      revision: 4,
      authorHandle: "alice",
      body: "Friday at the Pineapple.",
      photoAltText: null,
      area: "camden",
      venueId: "venue-pineapple",
      visibility: "friends",
      commentPolicy: "friends",
      moderationClaim: "Provider requested a review.",
      moderationState: "needs_review",
      createdAt: "2026-08-29T11:55:00.000Z",
      updatedAt: "2026-08-29T12:00:00.000Z",
    };
    state.adminQueueRows = [heldPost];

    const anonymous = await readAdminQueue(
      new Request("http://localhost/api/admin/social-posts"),
    );
    const moderator = await readAdminQueue(
      new Request("http://localhost/api/admin/social-posts", {
        headers: { "x-admin-token": "admin-token" },
      }),
    );

    expect(anonymous.status).toBe(403);
    expect(moderator.status).toBe(200);
    const payload = await moderator.json() as { posts: Array<Record<string, unknown>> };
    expect(payload).toEqual({ posts: [heldPost] });
    expect(payload.posts[0]).not.toHaveProperty("authorProfileId");
    expect(payload.posts[0]).toMatchObject({
      authorHandle: "alice",
      revision: 4,
      mediaId: null,
      moderationState: "needs_review",
    });
  });

  it("preserves conflict and operational moderation failures", async () => {
    state.adminModerationKind = "conflict";
    const stale = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": "admin-token" },
      body: JSON.stringify({ postId, mediaId: null, expectedRevision: 4, action: "hide" }),
    }));
    expect(stale.status).toBe(409);
    expect(state.calls[0]).toEqual({
      name: "moderateHeldForAdmin",
      args: ["99999999-9999-4999-8999-999999999999", postId, null, 4, "hide"],
    });

    state.adminModerationKind = "unavailable";
    const unavailable = await moderate(new Request("http://localhost/api/admin/social-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": "admin-token" },
      body: JSON.stringify({ postId, mediaId: null, expectedRevision: 4, action: "hide" }),
    }));
    expect(unavailable.status).toBe(503);
  });

  it("rejects UUID-shaped punctuation before tag storage", async () => {
    const response = await act(new Request("http://localhost/api/social/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: "-".repeat(36), action: "decline" }),
    }));
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});
