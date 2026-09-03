// Granting a founding number, walked through the real stores and the real
// claim route rather than a restatement of the rule.
//
// Three things have to hold, and each of them has already been got wrong
// somewhere in this codebase's history in one shape or another:
//   1. A hundred means a hundred. The hundred-and-first claim gets nothing and
//      is otherwise a completely ordinary, successful claim.
//   2. Two claims landing together never share a number.
//   3. A departed founder keeps their number, so nobody inherits it, and the
//      wall stops listing them.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

import { POST as claimRoute } from "@/app/api/identity/handle/claim/route";
import { FOUNDING_MEMBER_CAP } from "@/lib/foundingMembers";
import {
  __resetMemoryIdentityHandles,
  identityHandleStore,
} from "@/lib/identityHandleStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  __tombstoneMemoryProfile,
  profileStore,
} from "@/lib/profileStore";

function claimRequest(handle: string): Request {
  return new Request("http://localhost/api/identity/handle/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle }),
  });
}

function handleFor(index: number): string {
  return `founder_${String(index).padStart(3, "0")}`;
}

beforeEach(() => {
  authState.userId = null;
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetPintDrops();
});

describe("granting a founding number", () => {
  it("gives the first hundred claims one number each, in arrival order", async () => {
    const store = identityHandleStore();
    const granted: number[] = [];
    for (let index = 1; index <= FOUNDING_MEMBER_CAP; index += 1) {
      const result = await store.claim(`user-${index}`, handleFor(index));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.foundingMemberNumber).toBe(index);
      granted.push(result.foundingMemberNumber!);
    }
    expect(new Set(granted).size).toBe(FOUNDING_MEMBER_CAP);
    expect(granted[0]).toBe(1);
    expect(granted[FOUNDING_MEMBER_CAP - 1]).toBe(FOUNDING_MEMBER_CAP);
  });

  it("stops at the cap without turning the next claim into an error", async () => {
    const store = identityHandleStore();
    for (let index = 1; index <= FOUNDING_MEMBER_CAP; index += 1) {
      await store.claim(`user-${index}`, handleFor(index));
    }

    authState.userId = "user-late";
    const response = await claimRoute(claimRequest("late_arrival"));
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    // A perfectly ordinary claim. Missing the first hundred is not a failure,
    // and the route says nothing about it.
    expect(body.ok).toBe(true);
    expect(body.handle).toBe("late_arrival");
    expect(body.foundingMemberNumber).toBeUndefined();

    const profile = await profileStore().getByHandle("late_arrival");
    expect(profile?.foundingMemberNumber).toBeUndefined();
  });

  it("never hands the same number to two claims that land together", async () => {
    const store = identityHandleStore();
    const results = await Promise.all(
      Array.from({ length: FOUNDING_MEMBER_CAP + 20 }, (_, index) =>
        store.claim(`user-${index + 1}`, handleFor(index + 1)),
      ),
    );

    const numbers = results
      .map((result) => (result.ok ? result.foundingMemberNumber : undefined))
      .filter((value): value is number => value !== undefined);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(numbers).toHaveLength(FOUNDING_MEMBER_CAP);
    expect(new Set(numbers).size).toBe(FOUNDING_MEMBER_CAP);
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: FOUNDING_MEMBER_CAP }, (_, index) => index + 1),
    );
  });

  it("is idempotent: re-claiming the same handle returns the same number", async () => {
    const store = identityHandleStore();
    const first = await store.claim("user-1", "same_person");
    const again = await store.claim("user-1", "same_person");
    expect(first.ok && first.foundingMemberNumber).toBe(1);
    expect(again.ok && again.foundingMemberNumber).toBe(1);

    const rows = await profileStore().listFoundingMembers();
    expect(rows).toHaveLength(1);
  });
});

describe("the backfill order", () => {
  it("numbers the accounts already here oldest first", async () => {
    // The memory store models the migration's `order by created_at`: the seed
    // helper grants as it goes, so the earliest seeded row is No. 1.
    const seeded = ["karanmrn", "karanszn", "night_owl", "quiz_queen"];
    seeded.forEach((handle, index) => {
      __seedMemoryOwnedProfile(handle, `user-${index + 1}`);
    });

    const wall = await profileStore().listFoundingMembers();
    expect(wall.map((row) => row.handle)).toEqual(seeded);
    expect(wall.map((row) => row.foundingMemberNumber)).toEqual([1, 2, 3, 4]);
  });
});

describe("a founder who leaves", () => {
  it("keeps the number and drops off the wall, so nobody inherits it", async () => {
    const store = identityHandleStore();
    await store.claim("user-1", "first_in");
    await store.claim("user-2", "second_in");

    __tombstoneMemoryProfile("first_in");

    const wall = await profileStore().listFoundingMembers();
    expect(wall.map((row) => row.handle)).toEqual(["second_in"]);

    // The next claim is No. 3, not a recycled No. 1.
    const next = await store.claim("user-3", "third_in");
    expect(next.ok && next.foundingMemberNumber).toBe(3);
  });
});
