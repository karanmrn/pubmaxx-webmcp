import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const supabase = vi.hoisted(() => ({ rpc: vi.fn() }));
const trusted = vi.hoisted(() => ({
  signingKey: vi.fn(() => Buffer.from("social-crew-read-store-test-key-0001", "utf8")),
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc }),
}));

vi.mock("@/lib/trustedSigningKey.server", () => ({
  trustedSigningKey: trusted.signingKey,
}));

import type { PlanState } from "@/lib/plan";
import type { SocialCrewListPageDTO } from "@/lib/socialCrew";
import {
  SocialCrewStoreError,
  createSocialCrewStore,
  type SocialCrewRpcName,
  type SocialCrewStoreDependencies,
} from "@/lib/socialCrewStore";
import type { SocialPostActor } from "@/lib/socialPostStore";

const KEY = Buffer.from("social-crew-read-store-test-key-0001", "utf8");
const ALICE_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const ALICE_PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const ALICE_MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const ALICE_PLAN_MEMBER_ID = "40000000-0000-4000-8000-000000000001";
const BOB_ACCOUNT_ID = "10000000-0000-4000-8000-000000000002";
const BOB_PROFILE_ID = "20000000-0000-4000-8000-000000000002";
const BOB_MEMBER_ID = "30000000-0000-4000-8000-000000000002";
const BOB_PLAN_MEMBER_ID = "40000000-0000-4000-8000-000000000002";
const CAROL_MEMBER_ID = "30000000-0000-4000-8000-000000000003";
const DAVE_MEMBER_ID = "30000000-0000-4000-8000-000000000004";
const CREW_ID = "50000000-0000-4000-8000-000000000001";
const SECOND_CREW_ID = "50000000-0000-4000-8000-000000000002";
const PLAN_ID = "60000000-0000-4000-8000-000000000001";

const alice: SocialPostActor = {
  accountId: ALICE_ACCOUNT_ID,
  profileId: ALICE_PROFILE_ID,
  handle: "alice",
};

const bob: SocialPostActor = {
  accountId: BOB_ACCOUNT_ID,
  profileId: BOB_PROFILE_ID,
  handle: "bob",
};

const plan: PlanState = {
  plan: {
    id: PLAN_ID,
    title: "Friday in Camden",
    startTime: "2026-08-07T18:30:00.000000Z",
    createdAt: "2026-08-05T12:00:00.000000Z",
    routeRevision: 4,
    status: "ready",
  },
  crew: [],
  stops: [{ venueId: "venue-a", venueName: "The First", position: 0 }],
  context: {
    nightArea: "camden",
    daypart: "evening",
    partyType: "friends",
    groupSize: 2,
    budget: "standard",
    budgetLimitPence: null,
    zeroProof: false,
    wetherspoonsPreferred: false,
    atmosphere: [],
    foodNeeds: [],
    accessibility: [],
    transportConstraints: [],
  },
  actions: [],
  ending: null,
};

function memberSnapshot(): Record<string, unknown> {
  return {
    kind: "member",
    ownerRelationship: "mutual",
    crew: {
      crewId: CREW_ID,
      planId: PLAN_ID,
      ownerAccountId: ALICE_ACCOUNT_ID,
      ownerProfileId: ALICE_PROFILE_ID,
      visibility: "friends",
      authorityRevision: 7,
      joinRequestState: "none",
      members: [
        {
          memberId: ALICE_MEMBER_ID,
          accountId: ALICE_ACCOUNT_ID,
          profileId: ALICE_PROFILE_ID,
          planMemberId: ALICE_PLAN_MEMBER_ID,
          handle: "alice-current",
          role: "owner",
          state: "active",
          joinedAt: "2026-08-05T12:00:00.000000Z",
        },
        {
          memberId: BOB_MEMBER_ID,
          accountId: BOB_ACCOUNT_ID,
          profileId: BOB_PROFILE_ID,
          planMemberId: BOB_PLAN_MEMBER_ID,
          handle: "bob-current",
          role: "member",
          state: "active",
          joinedAt: "2026-08-05T12:05:00.000000Z",
        },
      ],
    },
    plan,
  };
}

function previewSnapshot(): Record<string, unknown> {
  return {
    kind: "preview",
    preview: {
      title: "Friday in Camden",
      status: "ready",
      nightArea: "camden",
      startsAt: "2026-08-07T18:30:00.000000Z",
      joinRequestState: "pending",
    },
  };
}

type SnapshotName = "read_social_crew_snapshot" | "read_social_crew_member_page";
type SnapshotCall = { name: SnapshotName; input: Record<string, unknown> };
type ReadDependencies = {
  rpc(name: SocialCrewRpcName, input: Record<string, unknown>): Promise<unknown>;
  snapshot(name: SnapshotName, input: Record<string, unknown>): Promise<unknown>;
  signingKey(): Buffer;
};

type ReadStore = ReturnType<typeof createSocialCrewStore> & {
  list(
    actor: SocialPostActor,
    input: { cursor?: string | null; limit?: number },
  ): Promise<SocialCrewListPageDTO>;
};

function readStore(options: {
  snapshot?: ReadDependencies["snapshot"];
  signingKey?: ReadDependencies["signingKey"];
} = {}): { store: ReadStore; calls: SnapshotCall[]; writeRpc: ReturnType<typeof vi.fn> } {
  const calls: SnapshotCall[] = [];
  const writeRpc = vi.fn(async () => {
    throw new Error("member reads must not call a write RPC");
  });
  const dependencies: ReadDependencies = {
    rpc: writeRpc,
    async snapshot(name, input) {
      calls.push({ name, input });
      return options.snapshot
        ? options.snapshot(name, input)
        : { items: [], hasMore: false, cursorPosition: null };
    },
    signingKey: options.signingKey ?? (() => KEY),
  };
  return {
    store: createSocialCrewStore(
      dependencies as unknown as SocialCrewStoreDependencies,
    ) as ReadStore,
    calls,
    writeRpc,
  };
}

function listItem(
  crewId: string,
  memberId: string,
  joinedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    crewId,
    title: `Crew ${crewId.at(-1)}`,
    status: "ready",
    nightArea: "camden",
    startsAt: "2026-08-07T18:30:00.000000Z",
    memberId,
    accountId: ALICE_ACCOUNT_ID,
    profileId: ALICE_PROFILE_ID,
    role: "member",
    state: "active",
    joinedAt,
    ...overrides,
  };
}

async function expectStoreError(
  promise: Promise<unknown>,
  code: SocialCrewStoreError["code"],
  status: SocialCrewStoreError["status"],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code, status });
}

function cursorPayload(cursor: string): Record<string, unknown> {
  const [encoded] = cursor.split(".");
  return JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8")) as Record<string, unknown>;
}

function signedCursor(
  payload: Record<string, unknown>,
  viewerProfileId = ALICE_PROFILE_ID,
): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", KEY)
    .update(`social-crew-member-cursor:v1:${viewerProfileId}:${encoded}`)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

async function firstCursor(store: ReadStore): Promise<string> {
  const page = await store.list(alice, { limit: 1 });
  expect(page.nextCursor).toEqual(expect.any(String));
  return page.nextCursor!;
}

beforeEach(() => {
  supabase.rpc.mockReset();
  trusted.signingKey.mockClear();
});

describe("SocialCrewStore atomic detail reads", () => {
  it("uses one default snapshot RPC and projects its member result", async () => {
    supabase.rpc.mockResolvedValue({ data: memberSnapshot(), error: null });

    const result = await createSocialCrewStore().read(CREW_ID, bob);

    expect(result).toMatchObject({
      kind: "member",
      crewId: CREW_ID,
      viewer: { memberId: BOB_MEMBER_ID, role: "member" },
      plan: { plan: { id: PLAN_ID, routeRevision: 4 } },
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("read_social_crew_snapshot", {
      p_viewer_account_id: BOB_ACCOUNT_ID,
      p_viewer_profile_id: BOB_PROFILE_ID,
      p_crew_id: CREW_ID,
    });
  });

  it("projects preview without any protected member or Plan data", async () => {
    const { store } = readStore({
      snapshot: async () => ({
        ...previewSnapshot(),
        poisonCrew: memberSnapshot(),
      }),
    });

    const result = await store.read(CREW_ID, bob);

    expect(result).toEqual({
      kind: "preview",
      title: "Friday in Camden",
      phase: "planning",
      nightArea: "camden",
      startsAt: "2026-08-07T18:30:00.000Z",
      joinRequestState: "pending",
    });
    expect(JSON.stringify(result)).not.toContain(CREW_ID);
    expect(JSON.stringify(result)).not.toContain(PLAN_ID);
    expect(JSON.stringify(result)).not.toContain("alice-current");
  });

  it("maps null authority to not found and malformed or failed snapshots to unavailable", async () => {
    await expectStoreError(
      readStore({ snapshot: async () => null }).store.read(CREW_ID, bob),
      "NOT_FOUND",
      404,
    );
    await expectStoreError(
      readStore({ snapshot: async () => ({ kind: "member" }) }).store.read(CREW_ID, bob),
      "UNAVAILABLE",
      503,
    );
    const memberWithoutViewer = memberSnapshot();
    const crew = memberWithoutViewer.crew as Record<string, unknown>;
    crew.members = [
      (crew.members as Record<string, unknown>[])[0],
    ];
    await expectStoreError(
      readStore({ snapshot: async () => memberWithoutViewer }).store.read(CREW_ID, bob),
      "UNAVAILABLE",
      503,
    );
    await expectStoreError(
      readStore({ snapshot: async () => { throw new Error("database down"); } }).store.read(CREW_ID, bob),
      "UNAVAILABLE",
      503,
    );
  });
});

describe("SocialCrewStore signed member list", () => {
  it("uses production member-page wiring and composes its signed continuation from the RPC position", async () => {
    const joinedAt = "2026-08-05T12:00:00.123456Z";
    const rawItem = listItem(CREW_ID, ALICE_MEMBER_ID, joinedAt);
    supabase.rpc
      .mockResolvedValueOnce({
        data: {
          items: [rawItem],
          hasMore: true,
          cursorPosition: { joinedAt, memberId: ALICE_MEMBER_ID },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { items: [], hasMore: false, cursorPosition: null },
        error: null,
      });
    const store = createSocialCrewStore();

    const first = await store.list(alice, { limit: 1 });
    const second = await store.list(alice, { limit: 1, cursor: first.nextCursor });

    const expectedCursor = signedCursor({
      v: 1,
      lane: "member",
      joinedAt,
      memberId: ALICE_MEMBER_ID,
    });
    expect(first.nextCursor).toBe(expectedCursor);
    expect(first.items).toHaveLength(1);
    expect(second).toEqual({ items: [], nextCursor: null });
    expect(supabase.rpc.mock.calls).toEqual([
      ["read_social_crew_member_page", {
        p_viewer_account_id: ALICE_ACCOUNT_ID,
        p_viewer_profile_id: ALICE_PROFILE_ID,
        p_cursor_joined_at: null,
        p_cursor_member_id: null,
        p_limit: 1,
      }],
      ["read_social_crew_member_page", {
        p_viewer_account_id: ALICE_ACCOUNT_ID,
        p_viewer_profile_id: ALICE_PROFILE_ID,
        p_cursor_joined_at: joinedAt,
        p_cursor_member_id: ALICE_MEMBER_ID,
        p_limit: 1,
      }],
    ]);
    expect(trusted.signingKey).toHaveBeenCalledTimes(2);
  });

  it("uses one member-page RPC, returns only narrow items, and mints exact viewer-bound payload", async () => {
    const rawItem = listItem(
      CREW_ID,
      ALICE_MEMBER_ID,
      "2026-08-05T12:00:00.123456Z",
      { poisonPlan: plan, members: memberSnapshot(), authorityRevision: 99 },
    );
    const { store, calls, writeRpc } = readStore({
      snapshot: async () => ({
        items: [rawItem],
        hasMore: true,
        cursorPosition: {
          joinedAt: "2026-08-05T12:00:00.123456Z",
          memberId: ALICE_MEMBER_ID,
        },
      }),
    });

    const page = await store.list(alice, { limit: 1 });

    expect(page.items).toEqual([{
      kind: "member",
      crewId: CREW_ID,
      title: "Crew 1",
      phase: "planning",
      nightArea: "camden",
      startsAt: "2026-08-07T18:30:00.000Z",
      viewer: { memberId: ALICE_MEMBER_ID, role: "member" },
    }]);
    expect(cursorPayload(page.nextCursor!)).toEqual({
      v: 1,
      lane: "member",
      joinedAt: "2026-08-05T12:00:00.123456Z",
      memberId: ALICE_MEMBER_ID,
    });
    expect(calls).toEqual([{
      name: "read_social_crew_member_page",
      input: {
        p_viewer_account_id: ALICE_ACCOUNT_ID,
        p_viewer_profile_id: ALICE_PROFILE_ID,
        p_cursor_joined_at: null,
        p_cursor_member_id: null,
        p_limit: 1,
      },
    }]);
    expect(writeRpc).not.toHaveBeenCalled();
    expect(JSON.stringify(page)).not.toContain("poisonPlan");
    expect(JSON.stringify(page)).not.toContain("authorityRevision");
  });

  it("rejects a cursor minted for actor A when actor B presents it", async () => {
    const { store, calls } = readStore({
      snapshot: async () => ({
        items: [listItem(CREW_ID, ALICE_MEMBER_ID, "2026-08-05T12:00:00.000000Z")],
        hasMore: true,
        cursorPosition: { joinedAt: "2026-08-05T12:00:00.000000Z", memberId: ALICE_MEMBER_ID },
      }),
    });
    const cursor = await firstCursor(store);

    await expectStoreError(store.list(bob, { cursor, limit: 1 }), "INVALID", 422);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["wrong lane", { v: 1, lane: "preview", joinedAt: "2026-08-05T12:00:00.000000Z", memberId: ALICE_MEMBER_ID }],
    ["wrong version", { v: 2, lane: "member", joinedAt: "2026-08-05T12:00:00.000000Z", memberId: ALICE_MEMBER_ID }],
    ["invalid date", { v: 1, lane: "member", joinedAt: "2026-08-05T12:00:00.000Z", memberId: ALICE_MEMBER_ID }],
    ["invalid member ID", { v: 1, lane: "member", joinedAt: "2026-08-05T12:00:00.000000Z", memberId: "not-a-uuid" }],
    ["extra payload key", { v: 1, lane: "member", joinedAt: "2026-08-05T12:00:00.000000Z", memberId: ALICE_MEMBER_ID, crewId: CREW_ID }],
  ])("rejects a correctly signed cursor with %s", async (_label, payload) => {
    const { store, calls } = readStore();

    await expectStoreError(store.list(alice, { cursor: signedCursor(payload), limit: 1 }), "INVALID", 422);
    expect(calls).toHaveLength(0);
  });

  it("rejects signature mutation before database access", async () => {
    const cursor = signedCursor({
      v: 1,
      lane: "member",
      joinedAt: "2026-08-05T12:00:00.000000Z",
      memberId: ALICE_MEMBER_ID,
    });
    const mutated = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    const { store, calls } = readStore();

    await expectStoreError(store.list(alice, { cursor: mutated, limit: 1 }), "INVALID", 422);
    expect(calls).toHaveLength(0);
  });

  it.each([
    "x",
    "e30.e30.extra",
    "not+base64url.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    `e30.${"A".repeat(42)}`,
    "x".repeat(1_001),
  ])("rejects a malformed or oversized cursor envelope before key resolution", async (cursor) => {
    const signingKey = vi.fn(() => KEY);
    const { store, calls } = readStore({ signingKey });

    await expectStoreError(store.list(alice, { cursor, limit: 1 }), "INVALID", 422);
    expect(signingKey).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("returns unavailable for a missing key before checking a structurally valid bad signature", async () => {
    const unsigned = Buffer.from(JSON.stringify({
      v: 1,
      lane: "member",
      joinedAt: "not-yet-checked",
      memberId: "not-yet-checked",
    }), "utf8").toString("base64url");
    const cursor = `${unsigned}.${Buffer.alloc(32).toString("base64url")}`;
    const { store, calls } = readStore({
      signingKey: () => { throw new Error("trusted signing key missing"); },
    });

    await expectStoreError(store.list(alice, { cursor, limit: 1 }), "UNAVAILABLE", 503);
    expect(calls).toHaveLength(0);
  });

  it.each([
    { input: { limit: 0 }, label: "invalid lower limit" },
    { input: { limit: 51 }, label: "invalid upper limit" },
    { input: { limit: 1.5 }, label: "non-integer limit" },
    { input: { limit: 1, lane: "member" }, label: "unknown input key" },
    { input: { limit: 1, cursor: 7 }, label: "non-string cursor" },
  ])("rejects strict query input before key resolution: $label", async ({ input }) => {
    const signingKey = vi.fn(() => KEY);
    const { store, calls } = readStore({ signingKey });

    await expectStoreError(
      store.list(alice, input as { cursor?: string; limit?: number }),
      "INVALID",
      422,
    );
    expect(signingKey).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it.each(["first", "empty", "terminal"])("resolves trusted key on every valid %s page", async (kind) => {
    const signingKey = vi.fn(() => KEY);
    const { store } = readStore({
      signingKey,
      snapshot: async () => kind === "first"
        ? {
            items: [listItem(CREW_ID, ALICE_MEMBER_ID, "2026-08-05T12:00:00.000000Z")],
            hasMore: true,
            cursorPosition: { joinedAt: "2026-08-05T12:00:00.000000Z", memberId: ALICE_MEMBER_ID },
          }
        : { items: [], hasMore: false, cursorPosition: null },
    });

    if (kind === "terminal") {
      await store.list(alice, {
        limit: 1,
        cursor: signedCursor({
          v: 1,
          lane: "member",
          joinedAt: "2026-08-05T12:00:00.000000Z",
          memberId: ALICE_MEMBER_ID,
        }),
      });
    } else {
      await store.list(alice, { limit: 1 });
    }
    expect(signingKey).toHaveBeenCalledTimes(1);
  });

  it("preserves six-digit cursor precision and validates equal-timestamp UUID order", async () => {
    const laterId = DAVE_MEMBER_ID;
    const earlierId = CAROL_MEMBER_ID;
    const joinedAt = "2026-08-05T12:00:00.123456Z";
    const { store } = readStore({
      snapshot: async () => ({
        items: [
          listItem(CREW_ID, laterId, joinedAt),
          listItem(SECOND_CREW_ID, earlierId, joinedAt),
        ],
        hasMore: true,
        cursorPosition: { joinedAt, memberId: earlierId },
      }),
    });

    const page = await store.list(alice, { limit: 2 });
    await store.list(alice, { cursor: page.nextCursor, limit: 2 });

    expect(cursorPayload(page.nextCursor!)).toMatchObject({ joinedAt, memberId: earlierId });
  });

  it("returns an empty authorised page and resolves its key", async () => {
    const signingKey = vi.fn(() => KEY);
    const { store, calls } = readStore({ signingKey });

    await expect(store.list(alice, { limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(signingKey).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("maps stale actor or profile binding to not found", async () => {
    const { store } = readStore({ snapshot: async () => null });

    await expectStoreError(store.list(alice, { limit: 20 }), "NOT_FOUND", 404);
  });

  it("maps database and malformed page failures to unavailable without a memory fallback", async () => {
    let attempts = 0;
    const failure = readStore({
      snapshot: async () => {
        attempts += 1;
        throw new Error("database down");
      },
    }).store;
    await expectStoreError(failure.list(alice, { limit: 20 }), "UNAVAILABLE", 503);
    await expectStoreError(failure.list(alice, { limit: 20 }), "UNAVAILABLE", 503);
    expect(attempts).toBe(2);

    for (const malformed of [
      {},
      { items: "not-an-array", hasMore: false, cursorPosition: null },
      { items: [listItem(CREW_ID, ALICE_MEMBER_ID, "bad-date")], hasMore: false, cursorPosition: null },
      { items: [], hasMore: true, cursorPosition: null },
    ]) {
      await expectStoreError(
        readStore({ snapshot: async () => malformed }).store.list(alice, { limit: 20 }),
        "UNAVAILABLE",
        503,
      );
    }
  });

  it("rejects an invalid verified actor before query, key, or database work", async () => {
    const signingKey = vi.fn(() => KEY);
    const { store, calls } = readStore({ signingKey });

    await expectStoreError(
      store.list({ ...alice, profileId: "not-a-uuid" }, { limit: 0 }),
      "NOT_FOUND",
      404,
    );
    expect(signingKey).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
