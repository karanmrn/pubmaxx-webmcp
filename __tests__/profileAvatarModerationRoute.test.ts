import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The complaint side of the owned-avatar path: a reader can FLAG a face, a
// moderator can HIDE it, and a hidden face leaves every public read at once
// (publicOwnedImageUrl becomes undefined so initials win). Hide never deletes
// storage or report provenance, and restore puts the approved face back.
//
// Two seams are mocked so this is deterministic under a PRODUCTION build too
// (same shape as communityPriceModeration.test.ts / adminCommentsRoute.test.ts):
//   • @/lib/supabase isSupabaseConfigured() === false pins the in-memory store.
//   • @/lib/adminAuth isModerator() - the REAL gate opens on a NODE_ENV read
//     when ADMIN_TOKEN is unset, which a prod build would deny. Only that
//     branch is replaced, by a controllable flag; the token compare is kept so
//     the "wrong token → 403" case still exercises real auth.

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const { adminRateLimit } = vi.hoisted(() => ({
  adminRateLimit: { limited: false },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async () => adminRateLimit.limited,
  };
});

const { devGate } = vi.hoisted(() => ({ devGate: { open: true } }));
vi.mock("@/lib/adminAuth", () => ({
  isModerator: (request: Request): boolean => {
    const expected = process.env.ADMIN_TOKEN;
    const provided = request.headers.get("x-admin-token") ?? undefined;
    if (!expected) return devGate.open;
    if (!provided) return false;
    return provided === expected;
  },
}));

import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/profile-avatars/route";
import { POST as reportPOST } from "@/app/api/profiles/[handle]/avatar/report/route";
import {
  __resetMemoryProfiles,
  listHiddenProfileImages,
  listReportedProfileImages,
  moderateProfileImage,
  profileStore,
  publicOwnedImageUrl,
  reportProfileImage,
} from "@/lib/profileStore";
import {
  __resetProfileCoverPhotos,
  memoryProfileCoverPhotoStore,
  profileCoverPhotoStore,
} from "@/lib/profileCoverPhotoStore";
import { profileImageServingKey } from "@/lib/profileImageSlots";

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const ADMIN_URL = "http://localhost/api/admin/profile-avatars";

function adminPost(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return adminPOST(
    new Request(ADMIN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify(body),
    }),
  );
}

async function seedApprovedAvatar(handle: string, generation = "11111111-1111-4111-8111-111111111111") {
  const store = profileStore();
  await store.createOwned(handle, `user-${handle}`);
  const profile = await store.getByHandle(handle);
  expect(profile?.id).toBeTruthy();
  const objectKey = `avatars/${profile!.id}/${generation}/image.jpg`;
  const updated = await store.setOwnedImage(handle, "avatar", {
    objectKey,
    generation,
    moderationState: "approved",
  });
  expect(updated?.avatarModerationState).toBe("approved");
  expect(publicOwnedImageUrl(updated!, "avatar")).toBe(`/api/avatar/${profile!.id}/${generation}`);
  return updated!;
}

async function seedApprovedCover(handle: string, generation = "22222222-2222-4222-8222-222222222222") {
  const store = profileStore();
  await store.createOwned(handle, `user-${handle}`);
  const profile = await store.getByHandle(handle);
  expect(profile?.id).toBeTruthy();
  const objectKey = `covers/${profile!.id}/${generation}/image.jpg`;
  const updated = await store.setOwnedImage(handle, "cover", {
    objectKey,
    generation,
    moderationState: "approved",
  });
  expect(updated?.coverModerationState).toBe("approved");
  expect(publicOwnedImageUrl(updated!, "cover")).toBe(`/api/cover/${profile!.id}/${generation}`);
  return updated!;
}

describe("profile avatar moderation (memory backend)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ADMIN_TOKEN;
    devGate.open = true;
    adminRateLimit.limited = false;
    __resetProfileCoverPhotos();
  });

  afterEach(() => {
    __resetProfileCoverPhotos();
    __resetMemoryProfiles();
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it("exposes and moderates rotation-only cover reports in the admin queue", async () => {
    await profileStore().createOwned("rotation", "user-rotation");
    const profile = await profileStore().getByHandle("rotation");
    expect(profile).toBeTruthy();
    const coverId = "77777777-7777-4777-8777-777777777771";
    const generation = "55555555-5555-4555-8555-555555555555";
    await memoryProfileCoverPhotoStore.create({
      id: coverId,
      profileId: profile!.id,
      generation,
      objectKey: profileImageServingKey("cover", profile!.id, generation),
    });
    await memoryProfileCoverPhotoStore.report(coverId, "wrong backdrop", "actor-rotation");

    const reported = await adminGET(new Request(`${ADMIN_URL}?status=reported&slot=cover`));
    expect(reported.status).toBe(200);
    const reportedBody = (await reported.json()) as {
      rotationCovers: Array<Record<string, unknown>>;
    };
    expect(reportedBody.rotationCovers).toHaveLength(1);
    expect(reportedBody.rotationCovers[0]).toMatchObject({
      id: coverId,
      handle: "rotation",
      reportReason: "wrong backdrop",
      rotationOnly: true,
    });
    expect(reportedBody.rotationCovers[0]).not.toHaveProperty("objectKey");
    expect(reportedBody.rotationCovers[0]).not.toHaveProperty("reportActors");

    const hidden = await adminPost({
      action: "hide",
      handle: "rotation",
      slot: "cover",
      coverId,
    });
    expect(hidden.status).toBe(200);
    expect(await profileCoverPhotoStore().listApproved(profile!.id)).toEqual([]);
    expect((await profileCoverPhotoStore().listHidden())[0]?.id).toBe(coverId);

    const restored = await adminPost({
      action: "restore",
      handle: "rotation",
      slot: "cover",
      coverId,
    });
    expect(restored.status).toBe(200);
    expect((await profileCoverPhotoStore().listApproved(profile!.id))[0]?.id).toBe(coverId);
  });

  it("keeps mirror covers in the profile queue and restores them without a cover id", async () => {
    await profileStore().createOwned("mirror", "user-mirror");
    const profile = await profileStore().getByHandle("mirror");
    expect(profile).toBeTruthy();
    const generation = "66666666-6666-4666-8666-666666666666";
    const approved = await profileStore().setOwnedImage("mirror", "cover", {
      objectKey: profileImageServingKey("cover", profile!.id, generation),
      generation,
      moderationState: "approved",
    });
    expect(approved?.coverModerationState).toBe("approved");
    const rotationId = "88888888-8888-4888-8888-888888888888";
    await memoryProfileCoverPhotoStore.create({
      id: rotationId,
      profileId: profile!.id,
      generation,
      objectKey: profileImageServingKey("cover", profile!.id, generation),
    });
    await memoryProfileCoverPhotoStore.report(rotationId, "same backdrop", "actor-mirror");

    // A report on the rotation row must remain visible until the profile-level
    // mirror receives its own report. Otherwise the row disappears before the
    // mirror-sync path can make one canonical queue entry.
    const rotationOnlyReported = await adminGET(
      new Request(`${ADMIN_URL}?status=reported&slot=cover`),
    );
    const rotationOnlyBody = (await rotationOnlyReported.json()) as {
      avatars: Array<Record<string, unknown>>;
      rotationCovers: Array<Record<string, unknown>>;
    };
    expect(rotationOnlyBody.avatars).toEqual([]);
    expect(rotationOnlyBody.rotationCovers).toHaveLength(1);
    expect(rotationOnlyBody.rotationCovers[0]).toMatchObject({
      id: rotationId,
      rotationOnly: false,
    });

    await reportProfileImage("mirror", "cover", "wrong backdrop", "actor-mirror");

    const reported = await adminGET(new Request(`${ADMIN_URL}?status=reported&slot=cover`));
    const reportedBody = (await reported.json()) as {
      avatars: Array<Record<string, unknown>>;
      rotationCovers: Array<Record<string, unknown>>;
    };
    expect(reportedBody.avatars).toHaveLength(1);
    expect(reportedBody.avatars[0]).toMatchObject({ handle: "mirror", reportCount: 1 });
    expect(reportedBody.rotationCovers).toEqual([]);

    expect(
      (await adminPost({ action: "hide", handle: "mirror", slot: "cover" })).status,
    ).toBe(200);
    const hidden = await adminGET(new Request(`${ADMIN_URL}?status=hidden&slot=cover`));
    const hiddenBody = (await hidden.json()) as {
      avatars: Array<Record<string, unknown>>;
      rotationCovers: Array<Record<string, unknown>>;
    };
    expect(hiddenBody.avatars).toHaveLength(1);
    expect(hiddenBody.avatars[0]).toMatchObject({ handle: "mirror", moderationState: "hidden" });
    expect(hiddenBody.rotationCovers).toEqual([]);

    expect(
      (await adminPost({ action: "restore", handle: "mirror", slot: "cover" })).status,
    ).toBe(200);
    expect(
      publicOwnedImageUrl((await profileStore().getByHandle("mirror"))!, "cover"),
    ).toBe(`/api/cover/${profile!.id}/${generation}`);
  });

  it("fails closed when cover mirror synchronisation fails", async () => {
    const profile = await seedApprovedAvatar("sync-failure");
    const cover = await profileStore().setOwnedImage("sync-failure", "cover", {
      objectKey: profileImageServingKey("cover", profile.id, "22222222-2222-4222-8222-222222222222"),
      generation: "22222222-2222-4222-8222-222222222222",
      moderationState: "approved",
    });
    expect(cover?.coverModerationState).toBe("approved");
    const sync = vi
      .spyOn(memoryProfileCoverPhotoStore, "moderateAllForProfile")
      .mockRejectedValueOnce(new Error("rotation store unavailable"));

    const response = await adminPost({ action: "hide", handle: "sync-failure", slot: "cover" });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
    expect((await profileStore().getByHandle("sync-failure"))?.coverModerationState).toBe(
      "hidden",
    );
    sync.mockRestore();
  });

  afterAll(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  });

  it("hides an avatar from the public serve URL, and restores it", async () => {
    const profile = await seedApprovedAvatar("alice");
    expect(publicOwnedImageUrl(profile, "avatar")).toBeTruthy();

    expect(await moderateProfileImage("alice", "avatar", "hide", "not their face")).toBe(true);
    const hidden = await profileStore().getByHandle("alice");
    expect(hidden?.avatarModerationState).toBe("hidden");
    expect(publicOwnedImageUrl(hidden!, "avatar")).toBeUndefined();
    // Hide, never delete: object key and generation survive for provenance.
    expect(hidden?.avatarObjectKey).toBe(profile.avatarObjectKey);
    expect(hidden?.avatarGeneration).toBe(profile.avatarGeneration);

    expect(await moderateProfileImage("alice", "avatar", "restore")).toBe(true);
    const restored = await profileStore().getByHandle("alice");
    expect(restored?.avatarModerationState).toBe("approved");
    expect(publicOwnedImageUrl(restored!, "avatar")).toBe(
      `/api/avatar/${profile.id}/${profile.avatarGeneration}`,
    );
  });

  it("records a report without hiding anything", async () => {
    const profile = await seedApprovedAvatar("bob");
    expect(await reportProfileImage("bob", "avatar", "spam QR", "actor-1")).toBe(true);

    const after = await profileStore().getByHandle("bob");
    expect(after?.avatarModerationState).toBe("approved");
    expect(publicOwnedImageUrl(after!, "avatar")).toBe(
      `/api/avatar/${profile.id}/${profile.avatarGeneration}`,
    );

    const queue = await listReportedProfileImages("avatar");
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      handle: "bob",
      reportCount: 1,
      reportReason: "spam QR",
      moderationState: "approved",
    });
    expect(JSON.stringify(queue)).not.toContain("actor-1");
  });

  it("counts one report per actor, so a single reader cannot inflate the queue", async () => {
    await seedApprovedAvatar("cara");
    await reportProfileImage("cara", "avatar", "wrong", "actor-1");
    await reportProfileImage("cara", "avatar", "still wrong", "actor-1");
    expect((await listReportedProfileImages("avatar"))[0]?.reportCount).toBe(1);

    await reportProfileImage("cara", "avatar", "agreed", "actor-2");
    expect((await listReportedProfileImages("avatar"))[0]?.reportCount).toBe(2);
  });

  it("never exposes reporter actors in the moderator DTO", async () => {
    await seedApprovedAvatar("dave");
    await reportProfileImage("dave", "avatar", "wrong", "secret-reporter-token");
    expect(JSON.stringify(await listReportedProfileImages("avatar"))).not.toContain(
      "secret-reporter-token",
    );
    expect(JSON.stringify(await listHiddenProfileImages("avatar"))).not.toContain(
      "secret-reporter-token",
    );
  });

  it("returns unreported, visible avatars to nobody's queue", async () => {
    await seedApprovedAvatar("elsie");
    expect(await listReportedProfileImages("avatar")).toEqual([]);
    expect(await listHiddenProfileImages("avatar")).toEqual([]);
  });

  it("moves a hidden avatar into the hidden lane and keeps restore reversible", async () => {
    await seedApprovedAvatar("frank");
    await reportProfileImage("frank", "avatar", "abuse", "actor-1");
    expect(await listReportedProfileImages("avatar")).toHaveLength(1);

    expect(await moderateProfileImage("frank", "avatar", "hide")).toBe(true);
    expect(await listReportedProfileImages("avatar")).toEqual([]);
    expect(await listHiddenProfileImages("avatar")).toHaveLength(1);
    expect((await listHiddenProfileImages("avatar"))[0]?.handle).toBe("frank");

    expect(await moderateProfileImage("frank", "avatar", "restore")).toBe(true);
    expect(await listHiddenProfileImages("avatar")).toEqual([]);
    // Restore stamps moderatedAt, so the old reports leave the reported lane
    // until a new distinct reporter re-opens them.
    expect(await listReportedProfileImages("avatar")).toEqual([]);
  });

  describe("POST /api/profiles/[handle]/avatar/report", () => {
    it("queues a flag and never auto-hides", async () => {
      const profile = await seedApprovedAvatar("gina");
      const res = await reportPOST(
        new Request("http://localhost/api/profiles/gina/avatar/report", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
          body: JSON.stringify({ reason: "somebody else" }),
        }),
        { params: Promise.resolve({ handle: "gina" }) },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true });

      const after = await profileStore().getByHandle("gina");
      expect(after?.avatarModerationState).toBe("approved");
      expect(publicOwnedImageUrl(after!, "avatar")).toBe(
        `/api/avatar/${profile.id}/${profile.avatarGeneration}`,
      );
      expect(await listReportedProfileImages("avatar")).toHaveLength(1);
    });

    it("404s when there is no approved owned avatar to report", async () => {
      await profileStore().createOwned("ghost", "user-ghost");
      const res = await reportPOST(
        new Request("http://localhost/api/profiles/ghost/avatar/report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ handle: "ghost" }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/admin/profile-avatars", () => {
    it("hides an avatar for a moderator and 404s an unknown handle", async () => {
      await seedApprovedAvatar("helen");

      const res = await adminPost({ action: "hide", handle: "helen", note: "impersonation" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(publicOwnedImageUrl((await profileStore().getByHandle("helen"))!, "avatar")).toBeUndefined();

      expect((await adminPost({ action: "hide", handle: "nope" })).status).toBe(404);
    });

    it("rate limits cover moderation writes before parsing or mutating", async () => {
      await seedApprovedCover("rate-limited-cover");
      adminRateLimit.limited = true;

      const response = await adminPost({
        action: "hide",
        handle: "rate-limited-cover",
        slot: "cover",
      });

      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
      expect(
        (await profileStore().getByHandle("rate-limited-cover"))?.coverModerationState,
      ).toBe("approved");
    });

    it("restores a hidden avatar", async () => {
      await seedApprovedAvatar("ivan");
      await adminPost({ action: "hide", handle: "ivan" });
      expect((await adminPost({ action: "restore", handle: "ivan" })).status).toBe(200);
      expect(publicOwnedImageUrl((await profileStore().getByHandle("ivan"))!, "avatar")).toBeTruthy();
    });

    it("rejects an unknown action and a missing handle", async () => {
      await seedApprovedAvatar("jane");
      expect((await adminPost({ action: "delete", handle: "jane" })).status).toBe(400);
      expect((await adminPost({ action: "hide" })).status).toBe(400);
    });

    it("refuses a non-moderator", async () => {
      await seedApprovedAvatar("kate");
      process.env.ADMIN_TOKEN = "s3cret";

      expect((await adminPost({ action: "hide", handle: "kate" })).status).toBe(403);
      expect(
        (await adminPost({ action: "hide", handle: "kate" }, { "x-admin-token": "wrong" })).status,
      ).toBe(403);
      expect((await adminGET(new Request(`${ADMIN_URL}?status=reported`))).status).toBe(403);

      expect(publicOwnedImageUrl((await profileStore().getByHandle("kate"))!, "avatar")).toBeTruthy();

      const allowed = await adminPost(
        { action: "hide", handle: "kate" },
        { "x-admin-token": "s3cret" },
      );
      expect(allowed.status).toBe(200);
    });

    it("lists reported and hidden lanes for a moderator", async () => {
      await seedApprovedAvatar("leo");
      await reportProfileImage("leo", "avatar", "wrong", "actor-1");

      const reported = await adminGET(new Request(`${ADMIN_URL}?status=reported`));
      expect(reported.status).toBe(200);
      const reportedBody = (await reported.json()) as {
        avatars: Array<{ handle: string; reportCount: number }>;
      };
      expect(reportedBody.avatars.map((row) => row.handle)).toEqual(["leo"]);
      expect(reportedBody.avatars[0]?.reportCount).toBe(1);

      await adminPost({ action: "hide", handle: "leo" });
      const hidden = await adminGET(new Request(`${ADMIN_URL}?status=hidden`));
      expect(hidden.status).toBe(200);
      const hiddenBody = (await hidden.json()) as { avatars: Array<{ handle: string }> };
      expect(hiddenBody.avatars.map((row) => row.handle)).toEqual(["leo"]);
    });
  });
});
