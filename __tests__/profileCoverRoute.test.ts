// The cover photo takes the SAME journey as the face: private staging, an
// image scan that can refuse it, promotion only on an approval, a reader-flag
// lane a moderator alone can act on, and deletion of every object when the
// account leaves. This walks that journey through the real route and the real
// store, and pins the two things the slot must never share with the face - its
// storage prefix and its serving file name.

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async () => limitState.limited,
  };
});

import { DELETE, POST } from "@/app/api/profiles/[handle]/cover/route";
import { __setProfileCoverRouteDepsForTest } from "@/lib/profileImageRouteDeps.server";
import { POST as reportCover } from "@/app/api/profiles/[handle]/cover/report/route";
import { GET as getProfile } from "@/app/api/profiles/[handle]/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  PROFILE_IMAGE_SIGNED_TTL_SECONDS,
  prepareProfileImage,
  purgeProfileImageObjects,
  type ProfileImageStorage,
} from "@/lib/profileImageMedia.server";
import {
  profileImageServingKey,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";
import {
  __resetMemoryProfiles,
  __tombstoneMemoryProfile,
  listHiddenProfileImages,
  listReportedProfileImages,
  memoryProfileStore,
  moderateProfileImage,
  profileStore,
  publicOwnedImageUrl,
} from "@/lib/profileStore";

/** A wide source image, so the 1600w resize has something to work on. */
async function wideImage(width = 2400, height = 800): Promise<File> {
  const bytes = await sharp({
    create: { width, height, channels: 3, background: "#31485f" },
  })
    .jpeg()
    .toBuffer();
  return new File([bytes], "cover.jpg", { type: "image/jpeg" });
}

async function jpegWithFakeGps(): Promise<File> {
  const base = await sharp({
    create: { width: 900, height: 300, channels: 3, background: "#2b1d14" },
  })
    .jpeg()
    .toBuffer();
  const gpsPayload = Buffer.from("Exif\0\0FAKE-GPS-LAT-51.5074-LON-0.1278", "binary");
  const app1 = Buffer.alloc(4 + gpsPayload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(gpsPayload.length + 2, 2);
  gpsPayload.copy(app1, 4);
  const withGps = Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
  return new File([withGps], "geo.jpg", { type: "image/jpeg" });
}

function memoryStorage(): ProfileImageStorage & {
  uploads: Array<{ path: string; bytes: Buffer }>;
  removed: string[][];
} {
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const removed: string[][] = [];
  const objects = new Map<string, Buffer>();
  return {
    uploads,
    removed,
    async upload(path, bytes) {
      objects.set(path, Buffer.from(bytes));
      uploads.push({ path, bytes: Buffer.from(bytes) });
    },
    // Promotion proves its own write through this, so the fake has to answer
    // like a bucket: absent, unreadable, or the bytes it was handed.
    async readBack(path) {
      const bytes = objects.get(path);
      if (!bytes) return { ok: false, failure: "storage_error", detail: "Object not found" };
      if (!bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
        return { ok: false, failure: "magic_bytes_mismatch", detail: `${bytes.byteLength} bytes` };
      }
      return { ok: true, image: { bytes, contentType: "image/jpeg" } };
    },
    async remove(paths) {
      removed.push([...paths]);
      for (const path of paths) objects.delete(path);
    },
    async sign(path) {
      return objects.has(path) ? `https://storage.test/${path}?sig=1` : null;
    },
    async listImageKeys(slot: ProfileImageSlot, profileId: string) {
      const prefix = slot === "cover" ? "covers" : "avatars";
      return [...objects.keys()].filter((key) => key.startsWith(`${prefix}/${profileId}/`));
    },
  };
}

function multipart(file: File): Request {
  const body = new FormData();
  body.set("photo", file);
  return new Request("http://localhost/api/profiles/alice/cover", {
    method: "POST",
    body,
  });
}

const params = { params: Promise.resolve({ handle: "alice" }) };

function approving(storage: ProfileImageStorage) {
  __setProfileCoverRouteDepsForTest({
    storage,
    moderation: () => ({ moderate: async () => ({ decision: "approved" as const }) }),
  });
}

beforeEach(async () => {
  authState.userId = null;
  limitState.limited = false;
  __resetMemoryProfiles();
  __resetPintDrops();
  __setProfileCoverRouteDepsForTest(null);
  await memoryProfileStore.createOwned("alice", "user-alice");
});

afterEach(() => {
  __setProfileCoverRouteDepsForTest(null);
});

describe("profile cover upload route", () => {
  it("promotes an approved cover to its own serving key and serves only the URL", async () => {
    const storage = memoryStorage();
    approving(storage);
    authState.userId = "user-alice";

    const response = await POST(multipart(await wideImage()), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    const profile = await profileStore().getByHandle("alice");

    expect(profile?.coverModerationState).toBe("approved");
    expect(profile?.coverObjectKey).toBe(
      `covers/${profile!.id}/${profile!.coverGeneration}/cover.jpg`,
    );
    // The face is a different slot and must not have moved.
    expect(profile?.avatarObjectKey).toBeUndefined();
    expect(body.profile.coverUrl).toBe(
      `/api/cover/${profile!.id}/${profile!.coverGeneration}`,
    );
    expect(storage.uploads.some((u) => u.path.endsWith("/staging.jpg"))).toBe(true);
    expect(storage.uploads.some((u) => u.path.endsWith("/cover.jpg"))).toBe(true);
    expect(storage.removed.flat().some((k) => k.endsWith("/staging.jpg"))).toBe(true);
  });

  // The composer replaces its held row with this reply, so a field the reply
  // drops is a field that disappears off the card until a reload. A founding
  // member's brass mark is the one that noticed: the write used to answer from
  // its own copy of the projection, which never carried the number.
  it("answers with the WHOLE public profile, founding number included", async () => {
    approving(memoryStorage());
    authState.userId = "user-alice";

    const seeded = await profileStore().getByHandle("alice");
    expect(seeded?.foundingMemberNumber).toBeGreaterThan(0);

    const posted = await POST(multipart(await wideImage()), params);
    expect(posted.status).toBe(200);
    expect((await posted.json()).profile.foundingMemberNumber).toBe(
      seeded!.foundingMemberNumber,
    );

    const removed = await DELETE(
      new Request("http://localhost/api/profiles/alice/cover", { method: "DELETE" }),
      params,
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).profile.foundingMemberNumber).toBe(
      seeded!.foundingMemberNumber,
    );
  });

  it("resizes to the cover width and keeps the wide aspect rather than squaring it", async () => {
    const prepared = await prepareProfileImage(await wideImage(2400, 800), "cover");
    expect(prepared.width).toBe(1600);
    expect(prepared.height).toBe(533);
  });

  it("refuses a flagged cover, deletes staging, and leaves the profile unchanged", async () => {
    const storage = memoryStorage();
    __setProfileCoverRouteDepsForTest({
      storage,
      moderation: () => ({ moderate: async () => ({ decision: "needs_review" as const }) }),
    });
    authState.userId = "user-alice";

    const response = await POST(multipart(await wideImage()), params);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("PHOTO_REFUSED");
    expect(body.error).toMatch(/cover photo did not pass/i);

    const profile = await profileStore().getByHandle("alice");
    expect(profile?.coverObjectKey).toBeUndefined();
    expect(storage.uploads.every((u) => u.path.endsWith("/staging.jpg"))).toBe(true);
    expect(storage.uploads.some((u) => u.path.endsWith("/cover.jpg"))).toBe(false);
    expect(storage.removed.flat().some((k) => k.endsWith("/staging.jpg"))).toBe(true);
  });

  // A scanner we cannot reach says nothing about the photo, so it never costs
  // an owner their own backdrop. The moderator report/hide lane is the net.
  it("stores the cover anyway when the scan is unavailable", async () => {
    const storage = memoryStorage();
    __setProfileCoverRouteDepsForTest({
      storage,
      moderation: () => ({
        moderate: async () => {
          throw new Error("offline");
        },
      }),
    });
    authState.userId = "user-alice";

    const response = await POST(multipart(await wideImage()), params);
    expect(response.status).toBe(200);
    expect(storage.uploads.some((u) => u.path.endsWith("/cover.jpg"))).toBe(true);
    const profile = await profileStore().getByHandle("alice");
    expect(profile?.coverModerationState).toBe("approved");
    expect(profile?.coverObjectKey).toBe(
      `covers/${profile!.id}/${profile!.coverGeneration}/cover.jpg`,
    );
  });

  it("stores the cover anyway when no scan provider is configured", async () => {
    const storage = memoryStorage();
    const { ProfileAvatarModerationError } = await import("@/lib/profileAvatarModeration");
    __setProfileCoverRouteDepsForTest({
      storage,
      moderation: () => {
        throw new ProfileAvatarModerationError("Profile avatar moderation is not configured.", false);
      },
    });
    authState.userId = "user-alice";

    const response = await POST(multipart(await wideImage()), params);
    expect(response.status).toBe(200);
    expect(storage.uploads.some((u) => u.path.endsWith("/cover.jpg"))).toBe(true);
    expect((await profileStore().getByHandle("alice"))?.coverModerationState).toBe("approved");
  });

  it("strips EXIF GPS before any cover bytes reach storage", async () => {
    const storage = memoryStorage();
    approving(storage);
    authState.userId = "user-alice";

    expect((await POST(multipart(await jpegWithFakeGps()), params)).status).toBe(200);
    expect(storage.uploads.length).toBeGreaterThan(0);
    for (const upload of storage.uploads) {
      expect(upload.bytes.toString("latin1")).not.toContain("FAKE-GPS-LAT-51.5074-LON-0.1278");
    }
  });

  it("requires the signed-in owner of a claimed handle", async () => {
    const storage = memoryStorage();
    approving(storage);

    authState.userId = null;
    expect((await POST(multipart(await wideImage()), params)).status).toBe(403);

    authState.userId = "user-other";
    expect((await POST(multipart(await wideImage()), params)).status).toBe(403);
    expect(storage.uploads).toHaveLength(0);
  });

  it("rate-limits per actor", async () => {
    const storage = memoryStorage();
    approving(storage);
    authState.userId = "user-alice";
    limitState.limited = true;

    expect((await POST(multipart(await wideImage()), params)).status).toBe(429);
    expect(storage.uploads).toHaveLength(0);
  });

  it("deletes storage objects when the cover is removed", async () => {
    const storage = memoryStorage();
    approving(storage);
    authState.userId = "user-alice";

    expect((await POST(multipart(await wideImage()), params)).status).toBe(200);
    const before = await profileStore().getByHandle("alice");
    expect(before?.coverObjectKey).toBeTruthy();

    const deleted = await DELETE(
      new Request("http://localhost/api/profiles/alice/cover", { method: "DELETE" }),
      params,
    );
    expect(deleted.status).toBe(200);
    const after = await profileStore().getByHandle("alice");
    expect(after?.coverObjectKey).toBeUndefined();
    expect(storage.removed.flat()).toContain(before!.coverObjectKey);
  });

  it("never leaks cover storage keys on the public profile read", async () => {
    const storage = memoryStorage();
    approving(storage);
    authState.userId = "user-alice";
    await POST(multipart(await wideImage()), params);

    authState.userId = null;
    const raw = await (
      await getProfile(new Request("http://localhost/api/profiles/alice"), params)
    ).text();
    expect(raw).not.toContain("coverObjectKey");
    expect(raw).not.toContain("cover_object_key");
    expect(raw).not.toContain("coverModerationState");
    expect(raw).not.toContain("staging.jpg");
    expect(raw).toContain("/api/cover/");
  });
});

describe("cover moderation lane", () => {
  async function uploadedCover() {
    const storage = memoryStorage();
    approving(storage);
    authState.userId = "user-alice";
    await POST(multipart(await wideImage()), params);
    authState.userId = null;
    return storage;
  }

  it("queues a reader flag without hiding anything", async () => {
    await uploadedCover();

    const flagged = await reportCover(
      new Request("http://localhost/api/profiles/alice/cover/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "not their photo" }),
      }),
      params,
    );
    expect(flagged.status).toBe(200);

    const profile = await profileStore().getByHandle("alice");
    expect(publicOwnedImageUrl(profile!, "cover")).toBeTruthy();
    const queue = await listReportedProfileImages("cover");
    expect(queue).toHaveLength(1);
    expect(queue[0]?.slot).toBe("cover");
    // A cover flag is not a face flag.
    expect(await listReportedProfileImages("avatar")).toEqual([]);
  });

  it("hides a cover for a moderator, keeps restore reversible, and deletes nothing", async () => {
    const storage = await uploadedCover();
    const objectKey = (await profileStore().getByHandle("alice"))!.coverObjectKey;

    expect(await moderateProfileImage("alice", "cover", "hide", "wrong photo")).toBe(true);
    const hidden = await profileStore().getByHandle("alice");
    expect(publicOwnedImageUrl(hidden!, "cover")).toBeUndefined();
    expect(hidden?.coverObjectKey).toBe(objectKey);
    expect(storage.removed.flat()).not.toContain(objectKey);
    expect(await listHiddenProfileImages("cover")).toHaveLength(1);

    expect(await moderateProfileImage("alice", "cover", "restore")).toBe(true);
    expect(publicOwnedImageUrl((await profileStore().getByHandle("alice"))!, "cover")).toBeTruthy();
    expect(await listHiddenProfileImages("cover")).toEqual([]);
  });

  it("keeps a moderator-hidden cover hidden when the owner posts a replacement", async () => {
    const storage = await uploadedCover();
    const hiddenKey = (await profileStore().getByHandle("alice"))!.coverObjectKey!;
    expect(await moderateProfileImage("alice", "cover", "hide")).toBe(true);
    const uploadsBefore = storage.uploads.length;

    approving(storage);
    authState.userId = "user-alice";
    const response = await POST(multipart(await wideImage()), params);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("COVER_HIDDEN");
    const profile = await profileStore().getByHandle("alice");
    expect(profile?.coverModerationState).toBe("hidden");
    expect(profile?.coverObjectKey).toBe(hiddenKey);
    expect(storage.uploads).toHaveLength(uploadsBefore);
  });

  it("keeps a moderator-hidden cover and its bytes when the owner deletes", async () => {
    const storage = await uploadedCover();
    const hiddenKey = (await profileStore().getByHandle("alice"))!.coverObjectKey!;
    expect(await moderateProfileImage("alice", "cover", "hide")).toBe(true);

    authState.userId = "user-alice";
    const response = await DELETE(
      new Request("http://localhost/api/profiles/alice/cover", { method: "DELETE" }),
      params,
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("COVER_HIDDEN");
    const profile = await profileStore().getByHandle("alice");
    expect(profile?.coverModerationState).toBe("hidden");
    expect(profile?.coverObjectKey).toBe(hiddenKey);
    expect(
      await storage.sign(hiddenKey, PROFILE_IMAGE_SIGNED_TTL_SECONDS),
    ).not.toBeNull();
    expect(storage.removed.flat()).not.toContain(hiddenKey);
  });

  it("clears the cover with its bytes when the account is tombstoned", async () => {
    const storage = memoryStorage();
    const profile = await profileStore().getByHandle("alice");
    const generation = "22222222-2222-4222-8222-222222222222";
    const objectKey = profileImageServingKey("cover", profile!.id, generation);
    await storage.upload(objectKey, Buffer.from("jpeg-bytes"), "image/jpeg");
    await memoryProfileStore.setOwnedImage("alice", "cover", {
      objectKey,
      generation,
      moderationState: "approved",
    });

    const removed = await purgeProfileImageObjects("cover", profile!.id, storage, [objectKey]);
    expect(removed).toContain(objectKey);

    const tombstoned = __tombstoneMemoryProfile("alice");
    expect(tombstoned?.coverObjectKey).toBeUndefined();
    expect(tombstoned?.coverGeneration).toBeUndefined();
    expect(tombstoned?.tombstonedAt).toBeTruthy();
  });
});

describe("0096 cover migration shape", () => {
  it("pins the serving key, the length caps, and the tombstone deletion", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260809120000_0096_profile_covers_and_card.sql",
      ),
      "utf8",
    );
    expect(sql).toMatch(/profiles_cover_object_key_check/);
    expect(sql).toMatch(
      /covers\/' \|\| id::text \|\| '\/' \|\| cover_generation::text \|\| '\/cover\.jpg'/,
    );
    expect(sql).toMatch(/covers\/' \|\| p\.id::text \|\| '\/%'/);
    expect(sql).toMatch(/cover_object_key = null/);
    expect(sql).toMatch(/favourite_drink is null or length\(favourite_drink\) <= 40/);
    expect(sql).toMatch(/interests is null or length\(interests\) <= 140/);
    expect(sql).toMatch(/workplace is null or length\(workplace\) <= 60/);
    // 0093's fix: the RLS helpers moved out of `public` in 0070.
    expect(sql).not.toMatch(/public\.rls_owns_profile/);
    expect(sql).toMatch(/pubmax_private\.rls_owns_profile/);

    const rollback = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/rollback/20260809120000_0096_profile_covers_and_card_rollback.sql",
      ),
      "utf8",
    );
    expect(rollback).toMatch(/drop column if exists cover_object_key/);
    expect(rollback).toMatch(/drop column if exists favourite_drink/);
    expect(rollback).toMatch(/delete from storage\.objects/i);
  });
});
