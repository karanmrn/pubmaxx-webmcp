import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const state = vi.hoisted(() => ({
  access: { available: true, state: "sign_in_required" } as unknown,
}));

vi.mock("@/lib/socialAccessServer", () => ({
  resolveSocialAccess: async () => state.access,
}));

import { GET } from "@/app/api/social/access/route";

function request(): Request {
  return new Request("http://localhost/api/social/access");
}

describe("/api/social/access", () => {
  it("returns public access state with private no-store caching", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ state: "sign_in_required" });
  });

  it("returns verified viewer fields only for verified access", async () => {
    state.access = {
      available: true,
      state: "verified",
      actor: { profileId: "profile-1", handle: "alice" },
    };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "verified",
      viewerHandle: "alice",
      draftScope: expect.any(String),
    });
  });

  it("fails closed with honest unavailable semantics", async () => {
    state.access = {
      available: false,
      state: "preview",
      code: "SOCIAL_ACCESS_UNAVAILABLE",
      error: "Social access checks are unavailable right now.",
      retryable: true,
    };

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(state.access);
  });
});
