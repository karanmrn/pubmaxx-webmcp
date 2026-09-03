// WP7 find-your-lot search: claimed + live handles only, public projection,
// rate-limited, publicApiError envelope. Never emails or private identity.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
    clientIp: () => "203.0.113.9",
    hashIp: () => "a".repeat(64),
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

const searchState = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    handle: string;
    userId?: string;
    displayName?: string;
    tombstonedAt?: string;
    email?: string;
  }>,
}));

vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return {
    ...actual,
    profileStore: () => ({
      searchClaimedByHandlePrefix: async () => searchState.rows,
    }),
    publicOwnedImageUrl: () => undefined,
    isProfileTombstoned: (profile: { tombstonedAt?: string } | null | undefined) =>
      typeof profile?.tombstonedAt === "string" && profile.tombstonedAt.length > 0,
  };
});

import { GET } from "@/app/api/profiles/search/route";

function search(q: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/profiles/search?q=${encodeURIComponent(q)}`));
}

beforeEach(() => {
  limitState.limited = false;
  searchState.rows = [];
});

describe("GET /api/profiles/search", () => {
  it("returns claimed prefix matches with public fields only", async () => {
    searchState.rows = [
      {
        id: "p1",
        handle: "samwise",
        userId: "user-sam",
        displayName: "Sam",
        email: "sam@example.com",
      },
      {
        id: "p2",
        handle: "samantha",
        // unclaimed - filtered out by the route
      },
    ];

    const res = await search("sam");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.matches).toEqual([
      { id: "p1", handle: "samwise", displayName: "Sam" },
    ]);
    const raw = JSON.stringify(body);
    for (const leak of [
      "userId",
      "user_id",
      "email",
      "dateOfBirth",
      "tombstoned",
      "avatarObjectKey",
      "user-sam",
      "sam@example.com",
    ]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("refuses a short prefix with publicApiError", async () => {
    const res = await search("s");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "INVALID_REQUEST",
      retryable: false,
    });
  });

  it("rate-limits with the public envelope", async () => {
    limitState.limited = true;
    const res = await search("sam");
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("excludes tombstoned claimed handles", async () => {
    searchState.rows = [
      {
        id: "p1",
        handle: "samwise",
        userId: "user-sam",
        tombstonedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "p2",
        handle: "samson",
        userId: "user-son",
      },
    ];

    const res = await search("sam");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches.map((m: { handle: string }) => m.handle)).toEqual([
      "samson",
    ]);
  });
});

describe("memory searchClaimedByHandlePrefix (claimed + live only)", () => {
  it("drops unclaimed and tombstoned rows at the store", async () => {
    // Import the real memory store outside the route mock path.
    const {
      memoryProfileStore,
      __resetMemoryProfiles,
      __tombstoneMemoryProfile,
    } = await vi.importActual<typeof import("@/lib/profileStore")>(
      "@/lib/profileStore",
    );
    __resetMemoryProfiles();
    await memoryProfileStore.createOwned("samwise", "user-sam");
    await memoryProfileStore.ensure("samantha");
    __tombstoneMemoryProfile("samwise");
    await memoryProfileStore.createOwned("samson", "user-son");
    const rows = await memoryProfileStore.searchClaimedByHandlePrefix("sam", 8);
    expect(rows.map((r) => r.handle)).toEqual(["samson"]);
  });
});
