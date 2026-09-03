import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route-level ownership enforcement for PATCH /api/profiles/[handle] (story 31).
//
// The REAL security boundary lives here (writes go through the service role, so
// RLS is bypassed — see lib/profileOwnership.ts + migration 0009). We pin the
// in-memory backend (clear Supabase env, repo convention) so every case is
// deterministic and network-free. In memory mode there is no JWT verifier, so a
// request is always resolved as ANONYMOUS — which is exactly the caller we need
// to prove the two contract points:
//   • an anonymous write to an UNLINKED handle still succeeds (demo preserved);
//   • an anonymous write to a handle already LINKED to a user is REJECTED (403)
//     — the hijack the ownership gate exists to stop.
// The owner-accepted path is covered by the pure decideProfileWrite tests.

// requiresSupabaseStore() reads process.env.NODE_ENV, which Vite replaces at
// transform time — so stubbing NODE_ENV at runtime silently does nothing under
// a production build (Vercel CI presets NODE_ENV=production and the route 503s
// before the ownership gate). Mock the seam itself instead: deterministic in
// every environment, and the 503 guard case flips the same switch explicitly.
const prodGuard = vi.hoisted(() => ({ requiresSupabase: false }));
const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, requiresSupabaseStore: () => prodGuard.requiresSupabase };
});
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { DELETE, PATCH } from "@/app/api/profiles/[handle]/route";
import {
  __resetMemoryProfiles,
  __seedMemoryLegacyProfile,
  __seedMemoryOwnedProfile,
  memoryProfileStore,
} from "@/lib/profileStore";

const URL_BASE = "http://localhost/api/profiles";

function patch(handle: string, body: unknown): Promise<Response> {
  const request = new Request(`${URL_BASE}/${encodeURIComponent(handle)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ handle }) });
}

function del(handle: string): Promise<Response> {
  const request = new Request(`${URL_BASE}/${encodeURIComponent(handle)}`, {
    method: "DELETE",
  });
  return DELETE(request, { params: Promise.resolve({ handle }) });
}

beforeEach(() => {
  // Pin the backend to memory mode: clear Supabase env and hold the
  // production-store guard open (see the vi.mock above for why NODE_ENV
  // stubbing can't do this). The 503 guard case flips prodGuard itself.
  prodGuard.requiresSupabase = false;
  authState.userId = null;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PATCH /api/profiles/[handle] — ownership gate", () => {
  it("allows an anonymous edit of an UNLINKED handle (demo path stands)", async () => {
    const res = await patch("ken", { displayName: "Cheap Pint Ken" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.displayName).toBe("Cheap Pint Ken");
  });

  it.each(["karan", "admin"])(
    "REJECTS anonymous edit of reserved handle %s",
    async (handle) => {
      const res = await patch(handle, { displayName: "Impostor" });

      expect(res.status).toBe(409);
      expect(await memoryProfileStore.getByHandle(handle)).toBeNull();
    },
  );

  it("allows the owner to PATCH a reserved handle they already own", async () => {
    await __seedMemoryOwnedProfile("karan", "founder-user");
    authState.userId = "founder-user";

    const res = await patch("karan", { displayName: "Karan" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.displayName).toBe("Karan");
  });

  it("REJECTS a different signed-in user claiming a reserved handle", async () => {
    await __seedMemoryOwnedProfile("karan", "founder-user");
    authState.userId = "impostor-user";

    const res = await patch("karan", { displayName: "Impostor" });

    expect(res.status).toBe(403);
  });

  it("REJECTS an anonymous edit of a handle LINKED to a user (403, no hijack)", async () => {
    // Pre-claim the handle for a real account.
    await memoryProfileStore.createOwned("ken", "user-abc");

    const res = await patch("ken", { displayName: "Impostor Ken" });
    expect(res.status).toBe(403);

    // The stored row is untouched — the impostor's value never landed.
    const row = await memoryProfileStore.getByHandle("ken");
    expect(row?.displayName).toBeUndefined();
  });

  it("never leaks the internal user_id on the write response", async () => {
    const res = await patch("sam", { bio: "hello" });
    const blob = JSON.stringify(await res.json());
    expect(blob).not.toMatch(/user_?id/i);
  });

  it("503s in production when the durable store is unconfigured (no fake persistence)", async () => {
    // Locks in the guard the cases above deliberately bypass: in a production
    // build with Supabase unconfigured, a write must fail loudly rather than
    // silently edit an in-memory row that vanishes on the next cold start.
    prodGuard.requiresSupabase = true;
    const res = await patch("ken", { displayName: "Cheap Pint Ken" });
    expect(res.status).toBe(503);
  });
});

describe("DELETE /api/profiles/[handle] — soft-delete ownership gate", () => {
  it("soft-deletes an UNLINKED handle anonymously (clears editable fields)", async () => {
    await memoryProfileStore.ensure("ken");
    await memoryProfileStore.update("ken", { displayName: "Ken", bio: "hi" });

    const res = await del("ken");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.handle).toBe("ken");
    expect(body.profile.displayName).toBeUndefined();
    expect(body.profile.bio).toBeUndefined();

    const row = await memoryProfileStore.getByHandle("ken");
    expect(row).not.toBeNull();
    expect(row!.displayName).toBeUndefined();
  });

  it("REJECTS anonymous delete of a LINKED handle (403)", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    await memoryProfileStore.update("ken", { displayName: "Ken" });

    const res = await del("ken");
    expect(res.status).toBe(403);
    const row = await memoryProfileStore.getByHandle("ken");
    expect(row?.displayName).toBe("Ken");
  });

  it("keeps deletion available when a concurrent legacy ownership claim is refused", async () => {
    await memoryProfileStore.ensure("racy");
    await memoryProfileStore.update("racy", { displayName: "Victim" });

    const readProfile = memoryProfileStore.getByHandle.bind(memoryProfileStore);
    vi.spyOn(memoryProfileStore, "getByHandle").mockImplementationOnce(async (handle) => {
      const unlinkedSnapshot = await readProfile(handle);
      await expect(
        memoryProfileStore.linkUser(handle, "victim-user"),
      ).rejects.toThrow("not available");
      return unlinkedSnapshot;
    });

    const res = await del("racy");

    expect(res.status).toBe(200);
    const row = await readProfile("racy");
    expect(row).toMatchObject({
      handle: "racy",
      displayName: undefined,
    });
    expect(row?.userId).toBeUndefined();
  });

  it("REJECTS anonymous delete of a reserved handle before unlinked allowance", async () => {
    await memoryProfileStore.ensure("admin");
    await memoryProfileStore.update("admin", { displayName: "Reserved" });

    const res = await del("admin");

    expect(res.status).toBe(409);
    expect((await memoryProfileStore.getByHandle("admin"))?.displayName).toBe("Reserved");
  });

  it("404s when the handle has no profile row", async () => {
    expect((await del("ghost")).status).toBe(404);
  });
});

describe("profileStore account ownership", () => {
  it("refuses to stamp ownership onto an existing unlinked handle", async () => {
    __seedMemoryLegacyProfile("ken");
    await memoryProfileStore.update("ken", { displayName: "Ken" });

    await expect(
      memoryProfileStore.linkUser("ken", "user-abc"),
    ).rejects.toThrow("not available");
    expect(await memoryProfileStore.getByHandle("ken")).toMatchObject({
      displayName: "Ken",
    });
  });

  it("never lets an account inherit a row created by generic ensure", async () => {
    const ensured = await memoryProfileStore.ensure("fresh");

    await expect(
      memoryProfileStore.linkUser("fresh", "user-new"),
    ).rejects.toThrow("not available");

    expect(await memoryProfileStore.getByHandle("fresh")).toMatchObject({
      id: ensured.id,
      handle: "fresh",
    });
  });

  it("is idempotent for the same user", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const again = await memoryProfileStore.linkUser("ken", "user-abc");
    expect(again.userId).toBe("user-abc");
  });

  it("refuses to re-link a handle owned by a different user", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    await expect(memoryProfileStore.linkUser("ken", "user-xyz")).rejects.toThrow();
  });

  it("creates an absent handle already owned in one operation", async () => {
    const linked = await memoryProfileStore.createOwned("fresh", "user-new");
    expect(linked.handle).toBe("fresh");
    expect(linked.userId).toBe("user-new");
  });

  it("refuses linkUser when the handle is absent", async () => {
    await expect(
      memoryProfileStore.linkUser("fresh", "user-new"),
    ).rejects.toThrow("not available");
    expect(await memoryProfileStore.getByHandle("fresh")).toBeNull();
  });
});
