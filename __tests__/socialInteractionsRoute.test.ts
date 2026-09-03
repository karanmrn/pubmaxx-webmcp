import { beforeEach, describe, expect, it, vi } from "vitest";

import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";

const actor = { accountId: "account-a", profileId: "profile-a", handle: "alice" };
const store = {
  setDesired: vi.fn(),
  summary: vi.fn(),
  listSaved: vi.fn(),
  listCheers: vi.fn(),
  createComment: vi.fn(),
  listComments: vi.fn(),
  setCommentPolicy: vi.fn(),
  createQuote: vi.fn(),
  listDerivatives: vi.fn(),
  processModerationQueue: vi.fn(),
  setBlock: vi.fn(),
  notifications: vi.fn(),
  markNotificationRead: vi.fn(),
  updateFeatureRequest: vi.fn(),
  featureHistory: vi.fn(),
  report: vi.fn(),
  reportQueue: vi.fn(),
  resolveReport: vi.fn(),
  moderate: vi.fn(),
  featureQueue: vi.fn(),
};

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: vi.fn(async () => ({ ok: true, actor })),
}));
vi.mock("@/lib/socialInteractionStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/socialInteractionStore")>()),
  socialInteractionStore: () => store,
}));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: vi.fn(() => null) }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));

const URL = "http://localhost/api/social/interactions";

describe("Social interactions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(socialFreezeResponse).mockReset().mockReturnValue(null);
    vi.mocked(isLimited).mockReset().mockResolvedValue(false);
    store.summary.mockResolvedValue({ cheered: false, saved: false, reposted: false, cheerCount: 0, repostCount: 0 });
    store.listComments.mockResolvedValue({ items: [], nextCursor: null });
    store.listSaved.mockResolvedValue({ items: [], nextCursor: null });
    store.notifications.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("uses desired-state PUT and DELETE without accepting an actor from the client", async () => {
    const { PUT, DELETE } = await import("@/app/api/social/interactions/route");
    const put = await PUT(new Request(URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "desired", postId: "11111111-1111-4111-8111-111111111111", kind: "cheer" }),
    }));
    expect(put.status).toBe(200);
    expect(store.setDesired).toHaveBeenCalledWith(actor, "11111111-1111-4111-8111-111111111111", "cheer", true);

    const deleted = await DELETE(new Request(URL, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "desired", postId: "11111111-1111-4111-8111-111111111111", kind: "cheer" }),
    }));
    expect(deleted.status).toBe(200);
    expect(store.setDesired).toHaveBeenLastCalledWith(actor, "11111111-1111-4111-8111-111111111111", "cheer", false);
  });

  it("requires stable idempotency headers for comments and ignores body keys", async () => {
    const { POST } = await import("@/app/api/social/interactions/route");
    const missing = await POST(new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "comment", postId: "11111111-1111-4111-8111-111111111111", body: "Hello" }),
    }));
    expect(missing.status).toBe(400);
    expect(store.createComment).not.toHaveBeenCalled();

    store.createComment.mockResolvedValue({ id: "comment-1", moderationState: "pending" });
    const response = await POST(new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "comment-request-1" },
      body: JSON.stringify({ action: "comment", postId: "11111111-1111-4111-8111-111111111111", body: "Hello", actorId: "forged" }),
    }));
    expect(response.status).toBe(400);
    expect(store.createComment).not.toHaveBeenCalled();

    const ok = await POST(new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "comment-request-1" },
      body: JSON.stringify({ action: "comment", postId: "11111111-1111-4111-8111-111111111111", body: "Hello" }),
    }));
    expect(ok.status).toBe(202);
    expect(store.createComment).toHaveBeenCalledWith(actor, "11111111-1111-4111-8111-111111111111", {
      body: "Hello",
      idempotencyKey: "comment-request-1",
    });
  });

  it("bounds read pages and does not cache protected interaction state", async () => {
    const { GET } = await import("@/app/api/social/interactions/route");
    const invalid = await GET(new Request(`${URL}?view=comments&postId=11111111-1111-4111-8111-111111111111&limit=51`));
    expect(invalid.status).toBe(400);

    const response = await GET(new Request(`${URL}?view=comments&postId=11111111-1111-4111-8111-111111111111&limit=20`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(store.listComments).toHaveBeenCalledWith(actor, "11111111-1111-4111-8111-111111111111", {
      cursor: null,
      limit: 20,
    });
  });

  it("checks freeze and stable-actor rate limits before writes", async () => {
    const { socialFreezeResponse } = await import("@/lib/opsFreeze");
    const { isLimited } = await import("@/lib/pintDrops");
    vi.mocked(socialFreezeResponse).mockReturnValueOnce(new Response(null, { status: 503 }));
    const { PUT } = await import("@/app/api/social/interactions/route");
    expect((await PUT(new Request(URL, { method: "PUT", body: "{}" }))).status).toBe(503);
    expect(store.setDesired).not.toHaveBeenCalled();

    vi.mocked(isLimited).mockResolvedValueOnce(true);
    const limited = await PUT(new Request(URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "desired", postId: "11111111-1111-4111-8111-111111111111", kind: "save" }),
    }));
    expect(limited.status).toBe(429);
    expect(vi.mocked(isLimited).mock.calls[0]?.[0]).toMatch(/^social-interaction:[a-f0-9]{64}$/);
  });

  it("returns the exact edit conflict when comment-policy CAS loses", async () => {
    const { SocialInteractionStoreError } = await import("@/lib/socialInteractionStore");
    store.setCommentPolicy.mockRejectedValueOnce(new SocialInteractionStoreError("EDIT_CONFLICT", "Post changed before comment policy was saved."));
    const { PUT } = await import("@/app/api/social/interactions/route");
    const response = await PUT(new Request(URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "comment_policy", postId: "11111111-1111-4111-8111-111111111111", policy: "locked" }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "EDIT_CONFLICT", error: "Post changed before comment policy was saved.", retryable: false });
  });

  it("keeps reporting and moderation safety floors open during a Social freeze", async () => {
    const { socialFreezeResponse } = await import("@/lib/opsFreeze");
    vi.mocked(socialFreezeResponse).mockReturnValue(new Response(null, { status: 503 }));
    store.report.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", createdAt: "2026-08-05T18:00:00.000Z" });
    const { POST } = await import("@/app/api/social/interactions/route");
    const report = await POST(new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "report",
        kind: "post",
        id: "11111111-1111-4111-8111-111111111111",
        reason: "harassment",
      }),
    }));
    expect(report.status).toBe(202);

    const moderation = await POST(new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "moderate",
        kind: "comment",
        id: "22222222-2222-4222-8222-222222222222",
        decision: "hide",
      }),
    }));
    expect(moderation.status).toBe(200);
  });

  it("does not let the ordinary write budget stop an immediate threat report", async () => {
    const { isLimited } = await import("@/lib/pintDrops");
    vi.mocked(isLimited).mockResolvedValueOnce(true);
    store.report.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", createdAt: "2026-08-05T18:00:00.000Z" });
    const { POST } = await import("@/app/api/social/interactions/route");
    const response = await POST(new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "report",
        kind: "post",
        id: "11111111-1111-4111-8111-111111111111",
        reason: "threat",
      }),
    }));
    expect(response.status).toBe(202);
    expect(store.report).toHaveBeenCalledWith(actor, {
      kind: "post",
      id: "11111111-1111-4111-8111-111111111111",
      reason: "threat",
    });
  });

  it("exposes report review and resolution only through the verified actor", async () => {
    store.reportQueue.mockResolvedValue({ items: [], nextCursor: null });
    const { GET, POST } = await import("@/app/api/social/interactions/route");
    expect((await GET(new Request(`${URL}?view=report_queue&limit=20`))).status).toBe(200);
    expect(store.reportQueue).toHaveBeenCalledWith(actor, { cursor: null, limit: 20 });

    const response = await POST(new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "report_resolution",
        id: "22222222-2222-4222-8222-222222222222",
      }),
    }));
    expect(response.status).toBe(200);
    expect(store.resolveReport).toHaveBeenCalledWith(actor, "22222222-2222-4222-8222-222222222222");
  });
});
