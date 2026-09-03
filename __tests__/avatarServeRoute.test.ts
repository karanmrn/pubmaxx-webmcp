import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const supabaseConfigured = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => supabaseConfigured.value,
    clientIp: () => "127.0.0.1",
    hashIp: (ip: string) => `hash:${ip}`,
  };
});

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async () => limitState.limited,
  };
});

import { GET } from "@/app/api/avatar/[profileId]/[generation]/route";
import {
  AVATAR_SERVE_CACHE_CONTROL,
  __setAvatarServeRouteDepsForTest,
} from "@/lib/profileImageServeRouteDeps.server";
import { profileImageServingKey } from "@/lib/profileImageSlots";
import type { ProfileRecord } from "@/lib/profileStore";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const OBJECT_KEY = profileImageServingKey("avatar", PROFILE_ID, GENERATION);

function approvedProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: PROFILE_ID,
    handle: "alice",
    userId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    avatarObjectKey: OBJECT_KEY,
    avatarGeneration: GENERATION,
    avatarModerationState: "approved",
    ...overrides,
  };
}

function route(profileId = PROFILE_ID, generation = GENERATION): Promise<Response> {
  return GET(new Request(`http://localhost/api/avatar/${profileId}/${generation}`), {
    params: Promise.resolve({ profileId, generation }),
  });
}

beforeEach(() => {
  limitState.limited = false;
  supabaseConfigured.value = true;
  __setAvatarServeRouteDepsForTest(null);
});

afterEach(() => {
  __setAvatarServeRouteDepsForTest(null);
});

describe("GET /api/avatar/[profileId]/[generation]", () => {
  it("returns 404 when the avatar is hidden or absent", async () => {
    __setAvatarServeRouteDepsForTest({
      getProfileById: async () =>
        approvedProfile({ avatarModerationState: "hidden" }),
      downloadObject: async () => null,
    });
    const res = await route();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 404 when generation does not match the stored avatar", async () => {
    __setAvatarServeRouteDepsForTest({
      getProfileById: async () => approvedProfile(),
      downloadObject: async () => null,
    });
    const res = await route(PROFILE_ID, "33333333-3333-4333-8333-333333333333");
    expect(res.status).toBe(404);
  });

  it("streams the object with public cache headers when approved", async () => {
    const bytes = Buffer.from("fake-jpeg");
    __setAvatarServeRouteDepsForTest({
      getProfileById: async () => approvedProfile(),
      downloadObject: async () => ({ bytes, contentType: "image/jpeg" }),
    });
    const res = await route();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe(AVATAR_SERVE_CACHE_CONTROL);
    expect(AVATAR_SERVE_CACHE_CONTROL).toBe("public, max-age=300, s-maxage=3600");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(bytes)).toBe(true);
  });
});
