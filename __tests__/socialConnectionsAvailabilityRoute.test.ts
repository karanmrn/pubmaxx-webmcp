import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { GET } from "@/app/api/social-connections/route";
import { POST } from "@/app/api/social-connections/[provider]/route";

const auth = (path: string, body?: unknown) => new Request(`http://localhost${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { authorization: "Bearer owner-1", ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("social provider capability HTTP contract", () => {
  afterEach(() => {
    delete process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_SECRET;
    delete process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY;
  });

  it("returns server-derived provider capabilities with connected accounts", async () => {
    process.env.X_CLIENT_ID = "x-id";
    process.env.X_CLIENT_SECRET = "x-secret";
    process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY = "e".repeat(32);
    const response = await GET(auth("/api/social-connections"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providers: {
        x: { oauth_identity: false, manual_link: true },
        instagram: { manual_link: true },
        tiktok: { oauth_identity: false, manual_link: true },
        website: { oauth_identity: false, manual_link: true },
      },
    });
  });

  it("rejects an unconfigured OAuth provider before creating state", async () => {
    const response = await POST(
      auth("/api/social-connections/tiktok", { mode: "oauth" }),
      { params: Promise.resolve({ provider: "tiktok" }) },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "That social connection is not configured.",
      code: "SOCIAL_PROVIDER_UNAVAILABLE",
      retryable: false,
    });
  });
});
