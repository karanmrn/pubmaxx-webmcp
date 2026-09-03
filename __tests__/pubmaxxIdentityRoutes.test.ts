import { beforeEach, describe, expect, it, vi } from "vitest";

import { NEW_RESERVED_CONTRIBUTOR_HANDLE_INPUTS } from "@/__tests__/fixtures/reservedContributorHandles";

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

import { GET as availability } from "@/app/api/identity/handle/availability/route";
import { POST as claim } from "@/app/api/identity/handle/claim/route";
import { POST as rename } from "@/app/api/identity/handle/rename/route";
import { GET as resolve } from "@/app/api/identity/handle/resolve/route";
import { GET as current } from "@/app/api/identity/handle/current/route";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { GET as getProfile } from "@/app/api/profiles/[handle]/route";
import {
  __resetMemoryProfiles,
  __seedMemoryLegacyProfile,
  __seedMemoryOwnedProfile,
  __tombstoneMemoryProfile,
  memoryProfileStore,
} from "@/lib/profileStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  authState.userId = null;
  __resetMemoryProfiles();
  __resetMemoryIdentityHandles();
  __resetPintDrops();
});

describe("PUBMAXX handle APIs", () => {
  it("checks availability case-insensitively and requires auth to claim", async () => {
    let response = await availability(request("/api/identity/handle/availability?handle=Night_Owl"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handle: "night_owl", available: true });

    response = await claim(request("/api/identity/handle/claim", "POST", { handle: "night_owl" }));
    expect(response.status).toBe(401);

    authState.userId = "user-1";
    response = await claim(request("/api/identity/handle/claim", "POST", { handle: "Night_Owl" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ handle: "night_owl", claimed: true });

    response = await current(request("/api/identity/handle/current"));
    // "Who am I here" answers the founding number too: the first claim in a
    // fresh store lands inside the first hundred.
    // `hasPassword` is tri-state and answers null with no Supabase behind it.
    expect(await response.json()).toEqual({
      handle: "night_owl",
      foundingMemberNumber: 1,
      hasPassword: null,
    });

    authState.userId = null;
    response = await availability(request("/api/identity/handle/availability?handle=NIGHT_OWL"));
    expect(await response.json()).toEqual({ handle: "night_owl", available: false, reason: "taken" });
  });

  it.each(NEW_RESERVED_CONTRIBUTOR_HANDLE_INPUTS)(
    "refuses reserved contributor handle %j at the claim route",
    async (handle) => {
      authState.userId = "user-1";
      const response = await claim(
        request("/api/identity/handle/claim", "POST", { handle }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        reason: "reserved",
        error: "That handle is not available.",
        code: "INVALID_REQUEST",
        retryable: false,
      });
    },
  );

  it("renames an owned handle and keeps the old alias resolving to the immutable profile", async () => {
    authState.userId = "user-1";
    const claimed = await claim(request("/api/identity/handle/claim", "POST", { handle: "night_owl" }));
    const original = await claimed.json();

    const renamed = await rename(request("/api/identity/handle/rename", "POST", { handle: "dawn_owl" }));
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      profileId: original.profileId,
      previousHandle: "night_owl",
      handle: "dawn_owl",
    });

    const resolved = await resolve(request("/api/identity/handle/resolve?handle=night_owl"));
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      profileId: original.profileId,
      requestedHandle: "night_owl",
      currentHandle: "dawn_owl",
      redirect: true,
      status: "live",
    });
    expect(
      await (await current(request("/api/identity/handle/current"))).json(),
    ).toEqual({ handle: "dawn_owl", foundingMemberNumber: 1, hasPassword: null });
  });

  // ── Reviewer-proven failure shapes under the old user_id-null predicate ──
  // Old code treated every null user_id as gone and would have killed:
  //   (a) pre-0071 self-declared legacy rows
  //   (b) ensure()-created anonymous contributor rows (pint-drop path)
  // Gone is gated only on tombstoned_at. Alias presence is NOT a discriminator
  // (claim_pubmaxx_handle writes aliases for owned claims).

  it("(a) seeded pre-0071 legacy profile (user_id null) resolves LIVE, not gone", async () => {
    const legacy = __seedMemoryLegacyProfile("legacy_owl");
    expect(legacy.userId).toBeUndefined();
    expect(legacy.tombstonedAt).toBeUndefined();

    const resolved = await resolve(
      request("/api/identity/handle/resolve?handle=legacy_owl"),
    );
    expect(resolved.status).toBe(200);
    const body = await resolved.json();
    expect(body).toMatchObject({
      profileId: legacy.id,
      requestedHandle: "legacy_owl",
      currentHandle: "legacy_owl",
      redirect: false,
      status: "live",
    });
    // Explicit anti-regression: must never be the gone envelope.
    expect(body).not.toMatchObject({ status: "gone" });
    expect(body).not.toHaveProperty("handle", "legacy_owl");

    const availabilityResponse = await availability(
      request("/api/identity/handle/availability?handle=legacy_owl"),
    );
    expect(await availabilityResponse.json()).toEqual({
      handle: "legacy_owl",
      available: false,
      reason: "taken",
    });
  });

  it("(b) ensure()-created anonymous contributor stays live on /api/profiles/<handle>", async () => {
    // Pint-drop path: profileStore().ensure(handle) inserts without user_id and
    // without a handle alias. Must not read as gone on the public profile GET.
    const ensured = await memoryProfileStore.ensure("drop_contributor");
    expect(ensured.userId).toBeUndefined();
    expect(ensured.tombstonedAt).toBeUndefined();

    const res = await getProfile(
      request(`/api/profiles/${encodeURIComponent(ensured.handle)}`),
      { params: Promise.resolve({ handle: ensured.handle }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).not.toBe("gone");
    expect(body.profile).toMatchObject({
      id: ensured.id,
      handle: "drop_contributor",
    });
    // Internal ownership / tombstone keys never cross the public wire.
    expect(JSON.stringify(body)).not.toMatch(/userId|user_id|tombstoned/i);

    // Resolve agrees: live, not gone. No alias row exists for ensure()-only.
    const resolved = await resolve(
      request("/api/identity/handle/resolve?handle=drop_contributor"),
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      profileId: ensured.id,
      status: "live",
      redirect: false,
    });
  });

  it("answers gone only when tombstoned_at is stamped, and keeps the handle reserved", async () => {
    authState.userId = "user-1";
    const claimed = await claim(
      request("/api/identity/handle/claim", "POST", { handle: "ghost_owl" }),
    );
    expect(claimed.status).toBe(201);
    const body = await claimed.json();

    // Auth.users deletion: trigger stamps tombstoned_at; FK clears user_id.
    // Alias from claim may remain — gone still keys off tombstoned_at alone.
    const tombstoned = __tombstoneMemoryProfile("ghost_owl");
    expect(tombstoned?.userId).toBeUndefined();
    expect(tombstoned?.tombstonedAt).toBeTruthy();

    const resolved = await resolve(
      request("/api/identity/handle/resolve?handle=ghost_owl"),
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({
      status: "gone",
      handle: "ghost_owl",
      profileId: body.profileId,
    });

    const profileRes = await getProfile(
      request("/api/profiles/ghost_owl"),
      { params: Promise.resolve({ handle: "ghost_owl" }) },
    );
    expect(profileRes.status).toBe(200);
    expect(await profileRes.json()).toMatchObject({
      status: "gone",
      profile: null,
    });

    authState.userId = null;
    const availabilityResponse = await availability(
      request("/api/identity/handle/availability?handle=ghost_owl"),
    );
    expect(await availabilityResponse.json()).toEqual({
      handle: "ghost_owl",
      available: false,
      reason: "taken",
    });
  });

  it("allows an idempotent rename save for an owned reserved contributor handle", async () => {
    const owned = __seedMemoryOwnedProfile("karan", "founder-user");
    authState.userId = "founder-user";

    const response = await rename(
      request("/api/identity/handle/rename", "POST", { handle: "karan" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      profileId: owned.id,
      previousHandle: "karan",
      handle: "karan",
    });
  });

  it.each(NEW_RESERVED_CONTRIBUTOR_HANDLE_INPUTS)(
    "refuses rename into reserved contributor handle %j",
    async (handle) => {
      authState.userId = "user-1";
      expect(
        (
          await claim(
            request("/api/identity/handle/claim", "POST", {
              handle: "night_owl",
            }),
          )
        ).status,
      ).toBe(201);

      const response = await rename(
        request("/api/identity/handle/rename", "POST", { handle }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        reason: "reserved",
        error: "That handle is not available.",
        code: "INVALID_REQUEST",
        retryable: false,
      });
      expect(
        await (await current(request("/api/identity/handle/current"))).json(),
      ).toEqual({
        handle: "night_owl",
        foundingMemberNumber: 1,
        hasPassword: null,
      });
    },
  );
});
