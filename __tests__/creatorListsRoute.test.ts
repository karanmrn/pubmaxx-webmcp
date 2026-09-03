import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const discovery = vi.hoisted(() => ({
  handle: vi.fn(async () => new Response(JSON.stringify({ status: "ready" }))),
}));

vi.mock("@/lib/creatorListDiscoveryRoute.server", () => ({
  handleCreatorListDiscoveryRequest: discovery.handle,
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: vi.fn() }));

import { GET } from "@/app/api/creator-lists/route";

const originalSocialLaunch = process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;

describe("GET /api/creator-lists launch boundary", () => {
  beforeEach(() => {
    discovery.handle.mockClear();
    delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  });

  it("blocks discovery before the store handler during rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";

    const response = await GET(new Request("https://example.test/api/creator-lists"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
    expect(discovery.handle).not.toHaveBeenCalled();
  });

  it("delegates discovery while Social is live", async () => {
    const request = new Request("https://example.test/api/creator-lists");

    await GET(request);

    expect(discovery.handle).toHaveBeenCalledWith(request);
  });
});

afterEach(() => {
  if (originalSocialLaunch === undefined) {
    delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  } else {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = originalSocialLaunch;
  }
});
