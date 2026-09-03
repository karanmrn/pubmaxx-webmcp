// The people directory: browse who has joined, without widening what a public
// profile read has ever given away.
//
// The defect this guards is the easy one: a "list everybody" route that reaches
// for the whole row and ships email, date of birth or a user id along with the
// handle. The projection here is the same four fields the handle search already
// publishes, and the row set is the same claimed-and-live one.
//
// The second defect is the one production found: the surface offers people to
// follow, so an account the viewer already follows, mates included, has no
// business on it. `?viewer=` is what makes the page discovery, and the rules it
// must keep are here: who leaves, who stays, and what a follow read that could
// not answer is allowed to do (nothing).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileRecord } from "@/lib/profileStore";

const state = vi.hoisted(() => ({
  limited: false,
  rows: [] as ProfileRecord[],
  fail: false,
  lastInput: null as unknown,
  following: [] as string[],
  followFail: false,
  followAskedFor: null as string | null,
}));

vi.mock("@/lib/followStore", () => ({
  followStore: () => ({
    listFollowing: async (handle: string) => {
      state.followAskedFor = handle;
      if (state.followFail) throw new Error("follow graph down");
      return state.following;
    },
  }),
}));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => state.limited),
}));

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "127.0.0.1",
  hashIp: (value: string) => `hashed-${value}`,
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
}));

vi.mock("@/lib/profileStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/profileStore")>();
  return {
    ...original,
    profileStore: () => ({
      listClaimedProfiles: async (input: unknown) => {
        state.lastInput = input;
        if (state.fail) throw new Error("down");
        return state.rows;
      },
    }),
  };
});

import { GET as directory } from "@/app/api/profiles/directory/route";

function profile(handle: string, overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: `id-${handle}`,
    handle,
    userId: `user-${handle}`,
    displayName: `${handle} the drinker`,
    bio: "a bio",
    homeCity: "London",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ProfileRecord;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  state.limited = false;
  state.fail = false;
  state.rows = [profile("alice"), profile("bob")];
  state.lastInput = null;
  state.following = [];
  state.followFail = false;
  state.followAskedFor = null;
});

describe("people directory", () => {
  it("does not read or expose directory data during Social rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";

    const response = await directory(new Request("https://x.test/api/profiles/directory"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "SOCIAL_PREVIEW",
      error: "Social is in preview right now.",
    });
    expect(state.lastInput).toBeNull();
  });

  it("lists claimed handles with the public projection and nothing else", async () => {
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { people: Record<string, unknown>[] };
    expect(body.people).toHaveLength(2);
    for (const person of body.people) {
      expect(Object.keys(person).sort()).toEqual(["displayName", "handle", "id"]);
    }
  });

  it("never lets a private field reach the wire, whatever the row holds", async () => {
    state.rows = [
      profile("alice", {
        userId: "auth-user-1",
        email: "alice@example.com",
        dateOfBirth: "1990-01-01",
      } as unknown as Partial<ProfileRecord>),
    ];
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    const raw = await response.text();
    expect(raw).not.toContain("alice@example.com");
    expect(raw).not.toContain("1990-01-01");
    expect(raw).not.toContain("auth-user-1");
    expect(raw).not.toContain("tombstone");
  });

  it("drops an unclaimed or tombstoned row even when a store hands one over", async () => {
    state.rows = [
      profile("alice"),
      profile("ghost", { userId: undefined }),
      profile("gone", { tombstonedAt: "2026-02-02T00:00:00.000Z" } as Partial<ProfileRecord>),
    ];
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    const body = (await response.json()) as { people: { handle: string }[] };
    expect(body.people.map((person) => person.handle)).toEqual(["alice"]);
  });

  it("pages by handle and only offers a cursor when there is another page", async () => {
    state.rows = [profile("alice"), profile("bob"), profile("cara")];
    const response = await directory(
      new Request("https://x.test/api/profiles/directory?limit=2"),
    );
    const body = (await response.json()) as {
      people: { handle: string }[];
      nextCursor: string | null;
    };
    expect(body.people.map((person) => person.handle)).toEqual(["alice", "bob"]);
    expect(body.nextCursor).toBe("bob");

    state.rows = [profile("alice"), profile("bob")];
    const last = await directory(
      new Request("https://x.test/api/profiles/directory?limit=2"),
    );
    await expect(last.json()).resolves.toMatchObject({ nextCursor: null });
  });

  it("carries the cursor back to the store", async () => {
    await directory(
      new Request("https://x.test/api/profiles/directory?limit=2&after=bob"),
    );
    expect(state.lastInput).toMatchObject({ afterHandle: "bob" });
  });

  it("refuses a limit outside its own window", async () => {
    for (const limit of ["0", "49", "2.5", "lots"]) {
      const response = await directory(
        new Request(`https://x.test/api/profiles/directory?limit=${limit}`),
      );
      expect(response.status).toBe(400);
    }
  });

  it("is rate limited like every other public read", async () => {
    state.limited = true;
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("answers a store outage as retryable rather than as an empty city", async () => {
    state.fail = true;
    const response = await directory(new Request("https://x.test/api/profiles/directory"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
  });
});

async function browse(query: string): Promise<{
  people: { handle: string }[];
  nextCursor: string | null;
  alreadyFollowing: number;
}> {
  const response = await directory(
    new Request(`https://x.test/api/profiles/directory${query}`),
  );
  return response.json() as Promise<{
    people: { handle: string }[];
    nextCursor: string | null;
    alreadyFollowing: number;
  }>;
}

describe("discovery: who the viewer has not followed yet", () => {
  it("drops an account the viewer already follows and keeps one they do not", async () => {
    state.rows = [profile("alice"), profile("bob")];
    state.following = ["alice"];
    const body = await browse("?viewer=zed");
    expect(body.people.map((person) => person.handle)).toEqual(["bob"]);
    expect(body.alreadyFollowing).toBe(1);
    expect(state.followAskedFor).toBe("zed");
  });

  it("drops a mate, because a mutual is somebody the viewer follows", async () => {
    state.rows = [profile("alice"), profile("bob")];
    // The mate follows back too, but the edge discovery reads is the viewer's
    // own: a mutual is a subset of the accounts they follow.
    state.following = ["bob"];
    const body = await browse("?viewer=zed");
    expect(body.people.map((person) => person.handle)).toEqual(["alice"]);
  });

  it("keeps somebody who follows the viewer but has not been followed back", async () => {
    state.rows = [profile("alice"), profile("bob")];
    state.following = [];
    const body = await browse("?viewer=zed");
    expect(body.people.map((person) => person.handle)).toEqual(["alice", "bob"]);
    expect(body.alreadyFollowing).toBe(0);
  });

  it("keeps the viewer's own row, which the surface prints as You", async () => {
    state.rows = [profile("alice"), profile("zed")];
    state.following = ["alice"];
    const body = await browse("?viewer=zed");
    expect(body.people.map((person) => person.handle)).toEqual(["zed"]);
  });

  it("reads the handle the same way the rest of the app does", async () => {
    state.rows = [profile("alice"), profile("bob")];
    state.following = ["@Alice"];
    const body = await browse("?viewer=%40Zed");
    expect(body.people.map((person) => person.handle)).toEqual(["bob"]);
    expect(state.followAskedFor).toBe("zed");
  });

  it("filters nothing at all when no viewer is named", async () => {
    state.rows = [profile("alice"), profile("bob")];
    state.following = ["alice", "bob"];
    const body = await browse("");
    expect(body.people.map((person) => person.handle)).toEqual(["alice", "bob"]);
    expect(state.followAskedFor).toBeNull();
  });

  it("leaves the page whole when the follow read could not answer", async () => {
    // An empty set from a broken read is indistinguishable from a drinker who
    // follows nobody. Filtering on it would hide the whole city.
    state.rows = [profile("alice"), profile("bob")];
    state.followFail = true;
    const body = await browse("?viewer=zed");
    expect(body.people.map((person) => person.handle)).toEqual(["alice", "bob"]);
    expect(body.alreadyFollowing).toBe(0);
  });

  it("pages over the same rows it always did, so nobody is skipped", async () => {
    state.rows = [profile("alice"), profile("bob"), profile("cara")];
    state.following = ["bob"];
    const body = await browse("?limit=2&viewer=zed");
    // The window is still alice and bob; only what is SHOWN narrowed, and the
    // cursor is still the last row examined.
    expect(body.people.map((person) => person.handle)).toEqual(["alice"]);
    expect(body.nextCursor).toBe("bob");
    expect(body.alreadyFollowing).toBe(1);
  });
});
