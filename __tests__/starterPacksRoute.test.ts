// The two starter-pack routes: the read that lists them and the one action
// that follows a whole pack.
//
// What is pinned here is what a drinker is entitled to believe. The read
// answers about real accounts and about THIS viewer's follow count, tri-state,
// so a surface can tell "follows nobody" from "could not check". The write
// needs an ACCOUNT (the same 401 the profile Follow button answers), proves who
// is acting before it touches the follow graph, spends ONE rate limit for the
// whole pack, is idempotent because a follow edge is, and reports a member that
// failed as a member that failed rather than rounding the tap up into a
// success.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin both routes to the process-memory backend even on Vercel, where
// production Supabase env vars are present. House pattern for social routes:
// backend selection is at the @/lib/supabase seam, not NODE_ENV.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
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

// One handle whose follow write always fails, so a part-failure can be proved
// without breaking the eleven writes beside it.
const followFault = vi.hoisted(() => ({ handle: "" }));
vi.mock("@/lib/followWrite.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/followWrite.server")>();
  return {
    ...actual,
    followOnce: async (follower: string, target: string) => {
      if (followFault.handle && target === followFault.handle) {
        throw new Error("follow storage is unavailable");
      }
      return actual.followOnce(follower, target);
    },
  };
});

import { GET } from "@/app/api/starter-packs/route";
import { POST } from "@/app/api/starter-packs/[slug]/follow/route";
import { followStore, __resetMemoryFollows } from "@/lib/followStore";
import { __resetMemoryNotifications } from "@/lib/notificationsStore";
import { memoryProfileStore, __resetMemoryProfiles, __tombstoneMemoryProfile } from "@/lib/profileStore";
import { FOUNDING_STARTER_PACK_SLUG } from "@/lib/starterPacks";

type PackBody = {
  packs: {
    slug: string;
    title: string;
    description: string;
    members: { handle: string; foundingMemberNumber?: number }[];
    memberCount: number;
  }[];
  viewerFollowing: number | null;
  coverage: "complete" | "partial";
};

type FollowBody = {
  pack: string;
  results: { handle: string; outcome: string }[];
  summary: string;
};

async function joinCamden(handle: string): Promise<void> {
  await memoryProfileStore.createOwned(handle, `user-${handle}`);
  await memoryProfileStore.update(handle, { homeCity: "Camden" });
}

function read(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/starter-packs${query}`));
}

function followPack(slug: string, body: unknown = {}): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/starter-packs/${slug}/follow`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

function packBySlug(body: PackBody, slug: string) {
  return body.packs.find((pack) => pack.slug === slug);
}

function asUser(userId: string): void {
  authState.userId = userId;
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.userId = null;
  followFault.handle = "";
  __resetMemoryFollows();
  __resetMemoryNotifications();
  __resetMemoryProfiles();
});

describe("GET /api/starter-packs", () => {
  it("lists a borough pack once it holds enough real accounts", async () => {
    await joinCamden("ada");
    await joinCamden("bex");
    await joinCamden("cal");

    const res = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as PackBody;
    const camden = packBySlug(body, "camden");
    expect(camden?.title).toBe("Drinkers of Camden");
    expect(camden?.memberCount).toBe(3);
    expect(camden?.members.map((member) => member.handle)).toEqual([
      "ada",
      "bex",
      "cal",
    ]);
    expect(body.coverage).toBe("complete");
  });

  it("hides a pack that has not reached three accounts", async () => {
    await joinCamden("ada");
    await joinCamden("bex");

    const body = (await (await read()).json()) as PackBody;
    expect(packBySlug(body, "camden")).toBeUndefined();
  });

  it("leaves a deleted account out of every pack it was in", async () => {
    await joinCamden("ada");
    await joinCamden("bex");
    await joinCamden("cal");
    __tombstoneMemoryProfile("cal");

    const body = (await (await read()).json()) as PackBody;
    expect(packBySlug(body, "camden")).toBeUndefined();
    const founders = packBySlug(body, FOUNDING_STARTER_PACK_SLUG);
    expect(founders?.members.map((member) => member.handle) ?? []).not.toContain("cal");
  });

  it("answers the viewer's follow count, and null when nobody asked", async () => {
    await joinCamden("ada");
    await joinCamden("bex");
    await joinCamden("cal");
    await followStore().follow("zed", "ada");

    const anonymous = (await (await read()).json()) as PackBody;
    expect(anonymous.viewerFollowing).toBeNull();

    const viewed = (await (await read("?viewer=zed")).json()) as PackBody;
    expect(viewed.viewerFollowing).toBe(1);
  });

  it("reads the founders in number order", async () => {
    await joinCamden("ada");
    await joinCamden("bex");
    await joinCamden("cal");

    const body = (await (await read()).json()) as PackBody;
    const founders = packBySlug(body, FOUNDING_STARTER_PACK_SLUG);
    expect(founders?.members.map((member) => member.foundingMemberNumber)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("POST /api/starter-packs/[slug]/follow", () => {
  beforeEach(async () => {
    await joinCamden("ada");
    await joinCamden("bex");
    await joinCamden("cal");
  });

  it("refuses an anonymous pack follow even under an unlinked handle", async () => {
    const res = await followPack("camden", { follower: "anythingunclaimed" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Sign in to follow them.",
      code: "UNAUTHENTICATED",
      retryable: false,
    });
    expect(await followStore().listFollowing("anythingunclaimed")).toEqual([]);
  });

  it("follows every member of the pack in one action", async () => {
    asUser("user-zed");
    const res = await followPack("camden", { follower: "zed" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as FollowBody;
    expect(body.pack).toBe("camden");
    expect(body.results).toEqual([
      { handle: "ada", outcome: "followed" },
      { handle: "bex", outcome: "followed" },
      { handle: "cal", outcome: "followed" },
    ]);
    expect(body.summary).toBe("Following all 3.");
    expect(await followStore().listFollowing("zed")).toHaveLength(3);
  });

  it("is idempotent: a second tap reports already following, not a new edge", async () => {
    asUser("user-zed");
    await followPack("camden", { follower: "zed" });
    const res = await followPack("camden", { follower: "zed" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FollowBody;
    expect(body.results.map((result) => result.outcome)).toEqual([
      "already",
      "already",
      "already",
    ]);
    expect(body.summary).toBe("Following all 3.");
    expect(await followStore().listFollowing("zed")).toHaveLength(3);
  });

  it("skips the viewer's own handle instead of refusing the whole pack", async () => {
    authState.userId = "user-bex";
    const res = await followPack("camden", { follower: "bex" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FollowBody;
    expect(body.results).toEqual([
      { handle: "ada", outcome: "followed" },
      { handle: "bex", outcome: "self" },
      { handle: "cal", outcome: "followed" },
    ]);
    expect(body.summary).toBe("Following all 2.");
  });

  it("reports one member's failure as one member's failure", async () => {
    followFault.handle = "bex";
    asUser("user-zed");
    const res = await followPack("camden", { follower: "zed" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FollowBody;
    expect(body.results).toEqual([
      { handle: "ada", outcome: "followed" },
      { handle: "bex", outcome: "failed" },
      { handle: "cal", outcome: "followed" },
    ]);
    expect(body.summary).toBe("Following 2 of 3. 1 didn't go through.");
    // The other two really went through. A part-failure is not a rollback.
    expect((await followStore().listFollowing("zed")).sort()).toEqual(["ada", "cal"]);
  });

  it("refuses a slug no pack owns", async () => {
    asUser("user-zed");
    const res = await followPack("shoreditch", { follower: "zed" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "That pack isn't here.",
      code: "STARTER_PACK_NOT_FOUND",
      retryable: false,
    });
  });

  it("refuses a pack too thin to show with the same answer, so the refusal tells nothing", async () => {
    asUser("user-zed");
    const res = await followPack("hackney", { follower: "zed" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "That pack isn't here.",
      code: "STARTER_PACK_NOT_FOUND",
      retryable: false,
    });
  });

  it("needs a handle to act as", async () => {
    const res = await followPack("camden", {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Choose a handle in your account first.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
  });

  it("refuses an anonymous caller claiming a handle an account owns", async () => {
    await memoryProfileStore.createOwned("owned", "user-owned");
    const res = await followPack("camden", { follower: "owned" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Sign in to follow them.",
      code: "UNAUTHENTICATED",
      retryable: false,
    });
    expect(await followStore().listFollowing("owned")).toEqual([]);
  });

  it("refuses a signed-in caller acting as a handle another account owns", async () => {
    await memoryProfileStore.createOwned("owned", "user-owned");
    asUser("user-mallory");
    const res = await followPack("camden", { follower: "owned" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("FORBIDDEN");
    expect(await followStore().listFollowing("owned")).toEqual([]);
  });

  it("acts as the signed-in handle, ignoring a spoofed follower in the body", async () => {
    authState.userId = "user-ada";
    const res = await followPack("camden", { follower: "mallory" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FollowBody;
    // Signed in as ada: her own handle is the one skipped as self.
    expect(body.results.find((result) => result.handle === "ada")?.outcome).toBe("self");
    expect(await followStore().listFollowing("mallory")).toEqual([]);
  });

  it("spends one rate limit per action, and stops a burst of them", async () => {
    asUser("user-burst");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await followPack("camden", { follower: "burst" });
      expect(res.status).toBe(200);
    }
    const res = await followPack("camden", { follower: "burst" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "Too many follow changes, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("rejects a malformed body rather than guessing an actor", async () => {
    const res = await POST(
      new Request("http://localhost/api/starter-packs/camden/follow", {
        method: "POST",
        body: "{not json",
      }),
      { params: Promise.resolve({ slug: "camden" }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Malformed request body.",
      code: "MALFORMED_REQUEST",
      retryable: false,
    });
  });
});
