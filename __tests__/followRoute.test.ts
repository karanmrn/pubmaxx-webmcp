import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin the route to the process-memory backend even on Vercel, where production
// Supabase env vars are present. This follows the house pattern for social route
// tests: backend selection is at the @/lib/supabase seam, not NODE_ENV.
const storeState = vi.hoisted(() => ({ durable: false }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => storeState.durable,
    requiresSupabaseStore: () => false,
  };
});
// The profile read stays on the process-memory backend whichever answer
// `isSupabaseConfigured` gives, so a case can say "a durable store answered"
// without swapping the store the test seeded.
vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return { ...actual, profileStore: () => actual.memoryProfileStore };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

import { POST } from "@/app/api/profiles/[handle]/follow/route";
import { followOnce } from "@/lib/followWrite.server";
import { followStore, __resetMemoryFollows } from "@/lib/followStore";
import { __resetMemoryNotifications } from "@/lib/notificationsStore";
import { normalizeHandle } from "@/lib/profiles";
import {
  memoryProfileStore,
  __resetMemoryProfiles,
  __tombstoneMemoryProfile,
} from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/profiles";

function follow(target: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`${URL_BASE}/${encodeURIComponent(target)}/follow`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ handle: target }) },
  );
}

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

function asUser(userId: string): void {
  authState.userId = userId;
}

beforeEach(async () => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  storeState.durable = false;
  authState.userId = null;
  __resetMemoryFollows();
  __resetMemoryNotifications();
  __resetMemoryProfiles();
  await memoryProfileStore.createOwned("sam", "user-sam");
});

describe("shared follow write target guard", () => {
  it("refuses a deleted target by name, without writing an edge", async () => {
    __tombstoneMemoryProfile("sam");

    await expect(followOnce("ken", "sam")).resolves.toBe("unavailable");
    expect(await followStore().listFollowing("ken")).toEqual([]);
  });

  it("refuses a handle a DURABLE store came back with nothing for", async () => {
    storeState.durable = true;
    await expect(followOnce("ken", "missing")).resolves.toBe("unavailable");

    storeState.durable = false;
    expect(await followStore().listFollowing("ken")).toEqual([]);
  });

  it("still follows on a keyless build, where the store holds no profiles", async () => {
    // The in-memory store a keyless build runs on has never seen this handle,
    // and that silence is not evidence the account is gone.
    await expect(followOnce("ken", "stranger")).resolves.toBe("followed");
    expect(await followStore().listFollowing("ken")).toEqual(["stranger"]);
  });

  it("keeps a real store failure a failure, not a refusal", async () => {
    const original = memoryProfileStore.getByHandle.bind(memoryProfileStore);
    const failing = vi
      .spyOn(memoryProfileStore, "getByHandle")
      .mockImplementation(async (handle: string) => {
        if (normalizeHandle(handle) === "sam") {
          throw new Error("profile storage is unavailable");
        }
        return original(handle);
      });

    await expect(followOnce("ken", "sam")).rejects.toBeInstanceOf(Error);
    expect(await followStore().listFollowing("ken")).toEqual([]);
    failing.mockRestore();
  });
});

describe("POST /api/profiles/[handle]/follow", () => {
  it("blocks follow writes during the full Social rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";
    asUser("user-ken");

    const res = await follow("sam", { follower: "ken" });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Social is in preview right now.",
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
    expect(await followStore().isFollowing("ken", "sam")).toBe(false);
  });

  it("refuses an anonymous follow even under an unlinked handle", async () => {
    const res = await follow("sam", { follower: "anythingunclaimed" });
    expect(res.status).toBe(401);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      error: "Sign in to follow them.",
      code: "UNAUTHENTICATED",
      retryable: false,
    });
    expect(await followStore().isFollowing("anythingunclaimed", "sam")).toBe(false);
  });

  it("follows another handle and marks the personalized response no-store", async () => {
    asUser("user-ken");
    const res = await follow("sam", { follower: "ken" });
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      following: true,
      counts: { followers: 1, following: 0 },
    });
  });

  it("answers a deleted target as a refusal rather than a retryable outage", async () => {
    asUser("user-ken");
    __tombstoneMemoryProfile("sam");

    const res = await follow("sam", { follower: "ken" });
    expect(res.status).toBe(404);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      error: "That account isn't here any more.",
      code: "PROFILE_NOT_FOUND",
      retryable: false,
    });
    expect(await followStore().listFollowing("ken")).toEqual([]);
  });

  it("still answers a real store failure as a retryable outage", async () => {
    const original = memoryProfileStore.getByHandle.bind(memoryProfileStore);
    const failing = vi
      .spyOn(memoryProfileStore, "getByHandle")
      .mockImplementation(async (handle: string) => {
        if (normalizeHandle(handle) === "sam") {
          throw new Error("profile storage is unavailable");
        }
        return original(handle);
      });

    asUser("user-ken");
    const res = await follow("sam", { follower: "ken" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Follow storage is unavailable.",
      code: "STORE_UNAVAILABLE",
      retryable: true,
    });
    failing.mockRestore();
  });

  it("rejects self-follows with no-store headers", async () => {
    const res = await follow("sam", { follower: "@Sam" });
    expect(res.status).toBe(400);
    expectNoStore(res);
    expect(await res.json()).toEqual({ error: "You can't follow yourself.", code: "INVALID_REQUEST", retryable: false });
  });
});

describe("follow auth ownership — linked handle wins over body.follower", () => {
  it("follows as the auth-linked handle, ignoring a spoofed body.follower", async () => {
    await memoryProfileStore.createOwned("ken", "user-ken");
    asUser("user-ken");

    // Signed in as ken (linked); body claims mallory (unlinked) — write must use ken.
    const res = await follow("sam", { follower: "mallory" });
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      following: true,
      counts: { followers: 1, following: 0 },
    });

    const store = followStore();
    expect(await store.isFollowing("ken", "sam")).toBe(true);
    expect(await store.isFollowing("mallory", "sam")).toBe(false);
  });
});

describe("follow actor — the founder's cross-account report", () => {
  it("lets the second account follow the first one's profile", async () => {
    // The founder's own handles are reserved (lib/pubmaxxIdentity.ts), so this
    // uses stand-ins for the same two accounts.
    // @alfie belongs to account A. @bea signs in as account B on the same
    // browser and taps Follow on /u/alfie. With a bearer token the route reads
    // the actor off the JWT, so B follows A. Anonymous, the same request read
    // as an unowned actor CLAIMING a linked handle - the 403 the founder saw.
    await memoryProfileStore.createOwned("alfie", "user-a");
    await memoryProfileStore.createOwned("bea", "user-b");

    asUser("user-b");
    const signedIn = await follow("alfie", { follower: "bea" });
    expect(signedIn.status).toBe(200);
    expect(await followStore().isFollowing("bea", "alfie")).toBe(true);
  });

  it("still refuses an anonymous request claiming a linked handle", async () => {
    // The demo path may assert an UNLINKED handle; a claimed one needs its owner.
    await memoryProfileStore.createOwned("alfie", "user-a");
    await memoryProfileStore.createOwned("bea", "user-b");

    const res = await follow("alfie", { follower: "bea" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Sign in to follow them.",
      code: "UNAUTHENTICATED",
      retryable: false,
    });
    expect(await followStore().isFollowing("bea", "alfie")).toBe(false);
  });

  it("never lets a stale cached handle act for the signed-in account", async () => {
    // The exact leak: the browser still held @alfie when account B signed in.
    // Even if that handle reaches the body, the JWT decides who acted.
    await memoryProfileStore.createOwned("alfie", "user-a");
    await memoryProfileStore.createOwned("bea", "user-b");

    asUser("user-b");
    const res = await follow("sam", { follower: "alfie" });
    expect(res.status).toBe(200);
    const store = followStore();
    expect(await store.isFollowing("bea", "sam")).toBe(true);
    expect(await store.isFollowing("alfie", "sam")).toBe(false);
  });
});
