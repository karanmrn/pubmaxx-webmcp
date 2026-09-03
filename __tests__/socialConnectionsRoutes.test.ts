import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

import { GET as listConnections } from "@/app/api/social-connections/route";
import {
  POST as connect,
  DELETE as disconnect,
} from "@/app/api/social-connections/[provider]/route";
import { GET as oauthCallback } from "@/app/api/social-connections/[provider]/callback/route";
import { __resetMemorySocialConnections } from "@/lib/socialConnectionStore";

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const instagramParams = { params: Promise.resolve({ provider: "instagram" }) };

beforeEach(() => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  authState.userId = null;
  __resetMemorySocialConnections();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("social connection APIs", () => {
  it("blocks connected-account reads, writes, and callbacks during rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";
    authState.userId = "owner-1";

    const responses = [
      await listConnections(request("/api/social-connections")),
      await connect(
        request("/api/social-connections/instagram", "POST", { mode: "manual", value: "nightowl" }),
        instagramParams,
      ),
      await oauthCallback(
        request("/api/social-connections/x/callback?code=abc&state=state"),
        { params: Promise.resolve({ provider: "x" }) },
      ),
    ];

    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Social is in preview right now.",
        code: "SOCIAL_PREVIEW",
        retryable: false,
      });
    }
  });

  it("requires an authenticated account", async () => {
    const response = await listConnections(request("/api/social-connections"));
    expect(response.status).toBe(401);
  });

  it("connects and disconnects a manual personal Instagram link", async () => {
    authState.userId = "user-1";
    let response = await connect(
      request("/api/social-connections/instagram", "POST", {
        mode: "manual",
        accountKind: "personal",
        profileUrl: "https://instagram.com/night.owl",
      }),
      instagramParams,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      connection: {
        provider: "instagram",
        mode: "manual",
        accountKind: "personal",
        username: "night.owl",
        status: "connected",
      },
    });

    response = await listConnections(request("/api/social-connections"));
    const body = await response.json();
    expect(body.connections).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("Token");

    response = await disconnect(
      request("/api/social-connections/instagram", "DELETE"),
      instagramParams,
    );
    expect(response.status).toBe(204);
    response = await listConnections(request("/api/social-connections"));
    expect(await response.json()).toMatchObject({
      connections: [],
      providers: { instagram: { manual_link: true, oauth_identity: false } },
    });
  });

  it("returns OAuth outcomes to the canonical You surface", async () => {
    const response = await oauthCallback(
      request("/api/social-connections/x/callback"),
      { params: Promise.resolve({ provider: "x" }) },
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/u/you");
    expect(location.searchParams.get("socialConnection")).toBe("x");
    expect(location.searchParams.get("status")).toBe("failed");
  });

  it("returns deployed OAuth outcomes through the production site", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pubmaxxing.com");

    const response = await oauthCallback(
      new Request(
        "https://chengdu-pubmax69.vercel.app/api/social-connections/x/callback",
      ),
      { params: Promise.resolve({ provider: "x" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pubmaxxing.com/u/you?socialConnection=x&status=failed",
    );
  });

  it("falls back to the apex and logs invalid production configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://preview-team.vercel.app");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await oauthCallback(
      new Request(
        "https://preview-team.vercel.app/api/social-connections/x/callback",
      ),
      { params: Promise.resolve({ provider: "x" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://pubmaxxing.com/u/you?socialConnection=x&status=failed",
    );
    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringMatching(
        /^FATAL: NEXT_PUBLIC_SITE_URL must be the canonical https:\/\/pubmaxxing\.com origin\./,
      ),
    );
  });

  it("does not let deployed credentials enable uncertified OAuth", async () => {
    authState.userId = "user-1";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pubmaxxing.com");
    vi.stubEnv("X_CLIENT_ID", "client-id");
    vi.stubEnv("X_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SOCIAL_CONNECTION_ENCRYPTION_KEY", "x".repeat(32));

    const response = await connect(
      new Request(
        "https://chengdu-pubmax69.vercel.app/api/social-connections/x",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "oauth" }),
        },
      ),
      { params: Promise.resolve({ provider: "x" }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "SOCIAL_PROVIDER_UNAVAILABLE",
      retryable: false,
    });
  });
});
