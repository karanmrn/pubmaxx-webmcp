import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  objectKey: "social/media-id/generation/image.jpg" as string | null,
  reads: 0,
}));

vi.mock("@/lib/adminAuth", () => ({
  isModerator: (request: Request) => request.headers.get("x-admin-token") === "admin-token",
  moderatorStaffRoleId: (request: Request) =>
    request.headers.get("x-admin-token") === "admin-token"
      ? "99999999-9999-4999-8999-999999999999"
      : null,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/supabase", () => ({
  clientIp: () => "127.0.0.1",
  hashIp: () => "ip-digest",
}));
vi.mock("@/lib/socialPostConsentStore", () => ({
  socialPostConsentStore: {
    adminMediaObjectKey: async () => {
      state.reads += 1;
      return state.objectKey;
    },
  },
}));
vi.mock("@/lib/socialPostMedia.server", () => ({
  signSocialPhotoObject: async () => "https://storage.test/photo",
}));

import { GET } from "@/app/api/admin/social-posts/media/[mediaId]/route";

const mediaId = "11111111-1111-4111-8111-111111111111";

function request(headers?: HeadersInit): Request {
  return new Request(`http://localhost/api/admin/social-posts/media/${mediaId}`, { headers });
}

beforeEach(() => vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("admin Social photo preview", () => {
  it("blocks photo reads during rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
    state.reads = 0;

    const response = await GET(request({ "x-admin-token": "admin-token" }), {
      params: Promise.resolve({ mediaId }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "SOCIAL_PREVIEW" });
    expect(state.reads).toBe(0);
  });

  it("requires moderator access before reading media", async () => {
    state.reads = 0;
    const response = await GET(request(), { params: Promise.resolve({ mediaId }) });
    expect(response.status).toBe(403);
    expect(state.reads).toBe(0);
  });

  it("redirects moderators to a signed URL for a held post photo", async () => {
    state.objectKey = "social/media-id/generation/image.jpg";
    const response = await GET(request({ "x-admin-token": "admin-token" }), {
      params: Promise.resolve({ mediaId }),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://storage.test/photo");
  });

  it("does not expose media outside the held queue", async () => {
    state.objectKey = null;
    const response = await GET(request({ "x-admin-token": "admin-token" }), {
      params: Promise.resolve({ mediaId }),
    });
    expect(response.status).toBe(404);
  });
});
