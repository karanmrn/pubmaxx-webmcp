import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => ({
    ok: true,
    actor: { accountId: "account-a", profileId: "profile-a", handle: "alice" },
  }),
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/supabase", () => ({ hashActor: () => "actor-digest" }));
vi.mock("@/lib/socialPostConsentStore", () => ({
  socialPostConsentStore: {
    mediaObjectKey: async () => { state.reads += 1; return "social/media/image.jpg"; },
  },
}));
vi.mock("@/lib/socialPostMedia.server", () => ({
  signSocialPhotoObject: async () => "https://storage.test/photo",
}));

import { GET } from "@/app/api/social/media/[mediaId]/route";

describe("Social photo delivery route", () => {
  it("rejects UUID-shaped punctuation before consent storage", async () => {
    state.reads = 0;
    const response = await GET(new Request("http://localhost/api/social/media/bad"), {
      params: Promise.resolve({ mediaId: "-".repeat(36) }),
    });
    expect(response.status).toBe(404);
    expect(state.reads).toBe(0);
  });
});
