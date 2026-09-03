import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
}));

import { GET, PUT } from "@/app/api/me/night-profile/route";
import { DEFAULT_NIGHT_PROFILE_INPUT } from "@/lib/nightProfile";
import { __resetNightProfileStore } from "@/lib/nightProfileStore";
import { __resetPubPalStore } from "@/lib/pubPalStore";

const URL = "http://localhost/api/me/night-profile";
const request = (method = "GET", body?: unknown, token = "owner-1") => new Request(URL, {
  method,
  headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("GET/PUT /api/me/night-profile", () => {
  beforeEach(() => {
    __resetNightProfileStore();
    __resetPubPalStore();
  });

  it("requires verified account ownership with the flat error shape", async () => {
    const response = await GET(new Request(URL));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in to manage your Night Profile.",
      code: "AUTH_REQUIRED",
      retryable: false,
    });
  });

  it("creates, reads, and rejects stale replacement", async () => {
    const created = await PUT(request("PUT", {
      profile: DEFAULT_NIGHT_PROFILE_INPUT,
      expectedUpdatedAt: null,
    }));
    expect(created.status).toBe(200);
    const profile = (await created.json()).profile;
    expect(profile.context).toEqual(DEFAULT_NIGHT_PROFILE_INPUT.context);

    const read = await GET(request());
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ profile });

    const stale = await PUT(request("PUT", {
      profile: { ...DEFAULT_NIGHT_PROFILE_INPUT, voicePreference: "ptt" },
      expectedUpdatedAt: null,
    }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "NIGHT_PROFILE_CONFLICT",
      retryable: false,
      details: { currentProfile: profile },
    });
  });

  it("does not allow a profile to bind another account's Pub Pal id", async () => {
    const response = await PUT(request("PUT", {
      profile: {
        ...DEFAULT_NIGHT_PROFILE_INPUT,
        pubPalId: "8b855ba2-a8ac-4c58-8a69-4594b8f730d3",
      },
      expectedUpdatedAt: null,
    }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("NIGHT_PROFILE_PAL_FORBIDDEN");
  });
});
