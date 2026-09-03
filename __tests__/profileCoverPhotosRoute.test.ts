// The cover ROTATION, walked through the real routes and the real store: add,
// order, remove, cap, serve, and the reader flag lane.
//
// Every photo takes the SAME journey the single cover already takes - private
// staging, a scan that can refuse it, promotion only when it did not, and a
// write that proves itself by reading its own serving key back - so this walks
// that journey five times rather than restating it.

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// The serve route refuses outright when storage is unconfigured, so the two
// serve cases flip this on and hand the handler its own deps: the flag never
// reaches a store, which stays the in-memory one throughout.
const supabaseConfigured = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => supabaseConfigured.value,
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
  return { ...actual, isLimited: async () => limitState.limited };
});

import { GET as listCovers, POST as addCover } from "@/app/api/profiles/[handle]/covers/route";
import {
  DELETE as deleteCover,
  PATCH as moveCover,
} from "@/app/api/profiles/[handle]/covers/[coverId]/route";
import {
  __setProfileCoverPhotoRouteDepsForTest,
  __setProfileCoverPhotosRouteDepsForTest,
} from "@/lib/profileCoverPhotoRouteDeps.server";
import { POST as reportCover } from "@/app/api/profiles/[handle]/covers/[coverId]/report/route";
import { GET as getProfile } from "@/app/api/profiles/[handle]/route";
import { GET as serveCover } from "@/app/api/cover/[profileId]/[generation]/route";
import { __setCoverServeRouteDepsForTest } from "@/lib/profileImageServeRouteDeps.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import { moderateProfileImageAcrossStores } from "@/lib/profileCoverModeration.server";
import { PROFILE_COVER_PHOTO_CAP } from "@/lib/profileCovers";
import {
  __resetProfileCoverPhotos,
  memoryProfileCoverPhotoStore,
  profileCoverPhotoStore,
} from "@/lib/profileCoverPhotoStore";
import type { ProfileImageStorage } from "@/lib/profileImageMedia.server";
import type { ProfileImageServeDeps } from "@/lib/profileImageServe.server";
import {
  profileImageServingKey,
  profileImageStagingKey,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";
import {
  __resetMemoryProfiles,
  memoryProfileStore,
  profileStore,
} from "@/lib/profileStore";

const HANDLE = "alice";
const params = { params: Promise.resolve({ handle: HANDLE }) };

/** A wide source image, so the 1600w resize has something to work on. */
async function wideImage(tint = "#31485f"): Promise<File> {
  const bytes = await sharp({
    create: { width: 2400, height: 800, channels: 3, background: tint },
  })
    .jpeg()
    .toBuffer();
  return new File([bytes], "cover.jpg", { type: "image/jpeg" });
}

function memoryStorage(): ProfileImageStorage & {
  uploads: Array<{ path: string; bytes: Buffer }>;
  removed: string[][];
  has(path: string): boolean;
} {
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const removed: string[][] = [];
  const objects = new Map<string, Buffer>();
  return {
    uploads,
    removed,
    has: (path) => objects.has(path),
    async upload(path, bytes) {
      objects.set(path, Buffer.from(bytes));
      uploads.push({ path, bytes: Buffer.from(bytes) });
    },
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

let storage: ReturnType<typeof memoryStorage>;

function approving(): void {
  const deps = {
    storage,
    moderation: () => ({ moderate: async () => ({ decision: "approved" as const }) }),
  };
  __setProfileCoverPhotosRouteDepsForTest(deps);
  __setProfileCoverPhotoRouteDepsForTest(deps);
}

function multipart(file: File): Request {
  const body = new FormData();
  body.set("photo", file);
  return new Request(`http://localhost/api/profiles/${HANDLE}/covers`, {
    method: "POST",
    body,
  });
}

function coverParams(coverId: string) {
  return { params: Promise.resolve({ handle: HANDLE, coverId }) };
}

type CoverReply = {
  profile: { id: string; coverUrl?: string; coverUrls?: string[]; foundingMemberNumber?: number };
  covers: Array<{ id: string; position: number; url: string }>;
};

async function add(tint = "#31485f"): Promise<CoverReply> {
  const response = await addCover(multipart(await wideImage(tint)), params);
  expect(response.status).toBe(201);
  return (await response.json()) as CoverReply;
}

beforeEach(async () => {
  authState.userId = null;
  limitState.limited = false;
  __resetMemoryProfiles();
  __resetProfileCoverPhotos();
  __resetPintDrops();
  storage = memoryStorage();
  await memoryProfileStore.createOwned(HANDLE, "user-alice");
  approving();
  authState.userId = "user-alice";
});

afterEach(() => {
  __setProfileCoverPhotosRouteDepsForTest(null);
  __setProfileCoverPhotoRouteDepsForTest(null);
  __setCoverServeRouteDepsForTest(null);
});

describe("adding a cover", () => {
  it("promotes it to the cover slot's own serving key and answers the whole rotation", async () => {
    const body = await add();
    const profile = await profileStore().getByHandle(HANDLE);

    expect(body.covers).toHaveLength(1);
    expect(body.covers[0]!.position).toBe(1);
    expect(body.covers[0]!.url).toMatch(/^\/api\/cover\/[^/]+\/[^/]+$/);
    expect(body.profile.coverUrls).toEqual([body.covers[0]!.url]);
    expect(storage.uploads.some((u) => u.path.endsWith("/staging.jpg"))).toBe(true);
    expect(storage.uploads.some((u) => u.path.endsWith("/cover.jpg"))).toBe(true);
    // The row's own key shape, said by the store rather than by the route.
    const stored = await profileCoverPhotoStore().listApproved(profile!.id);
    expect(stored[0]!.objectKey).toBe(
      `covers/${profile!.id}/${stored[0]!.generation}/cover.jpg`,
    );
  });

  // The composer replaces its held row with this reply, so a field the reply
  // drops disappears off the card until a reload.
  it("answers with the WHOLE public profile, founding number included", async () => {
    const seeded = await profileStore().getByHandle(HANDLE);
    expect(seeded?.foundingMemberNumber).toBeGreaterThan(0);
    const body = await add();
    expect(body.profile.foundingMemberNumber).toBe(seeded!.foundingMemberNumber);
  });

  // Cover #1 stays the back-compat lane, so a surface that only knows one
  // cover still paints the right photograph.
  it("mirrors whichever cover is first into the single cover columns", async () => {
    const first = await add("#31485f");
    const record = await profileStore().getByHandle(HANDLE);
    expect(record?.coverGeneration).toBeTruthy();
    expect(first.profile.coverUrl).toBe(first.covers[0]!.url);
    expect(record?.coverObjectKey).toBe(
      `covers/${record!.id}/${record!.coverGeneration}/cover.jpg`,
    );
  });

  it("refuses a flagged cover, deletes staging, and adds no row", async () => {
    const deps = {
      storage,
      moderation: () => ({ moderate: async () => ({ decision: "needs_review" as const }) }),
    };
    __setProfileCoverPhotosRouteDepsForTest(deps);

    const response = await addCover(multipart(await wideImage()), params);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PHOTO_REFUSED");
    expect(storage.uploads.some((u) => u.path.endsWith("/cover.jpg"))).toBe(false);
    expect(storage.removed.flat().some((k) => k.endsWith("/staging.jpg"))).toBe(true);
    const profile = await profileStore().getByHandle(HANDLE);
    expect(await profileCoverPhotoStore().listApproved(profile!.id)).toEqual([]);
  });

  // A scanner we cannot reach says nothing about the photo, so it never costs
  // an owner their own backdrop. The report/hide lane is the net.
  it("stores the cover anyway when the scan is unavailable", async () => {
    __setProfileCoverPhotosRouteDepsForTest({
      storage,
      moderation: () => ({
        moderate: async () => {
          throw new Error("offline");
        },
      }),
    });
    const response = await addCover(multipart(await wideImage()), params);
    expect(response.status).toBe(201);
    expect(storage.uploads.some((u) => u.path.endsWith("/cover.jpg"))).toBe(true);
  });

  it("requires the signed-in owner of a claimed handle", async () => {
    authState.userId = null;
    expect((await addCover(multipart(await wideImage()), params)).status).toBe(403);
    authState.userId = "user-other";
    expect((await addCover(multipart(await wideImage()), params)).status).toBe(403);
    expect(storage.uploads).toHaveLength(0);
  });

  it("rate-limits per actor before anything is staged", async () => {
    limitState.limited = true;
    expect((await addCover(multipart(await wideImage()), params)).status).toBe(429);
    expect(storage.uploads).toHaveLength(0);
  });

  it("refuses an upload while the profile cover is moderator-hidden", async () => {
    await add();
    const profile = await profileStore().getByHandle(HANDLE);
    expect(await moderateProfileImageAcrossStores(HANDLE, "cover", "hide")).toBe(true);
    const hiddenBefore = await memoryProfileCoverPhotoStore.listHidden();
    const countBefore = await profileCoverPhotoStore().countForProfile(profile!.id);
    const uploadsBefore = storage.uploads.length;

    const response = await addCover(multipart(await wideImage()), params);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("COVER_HIDDEN");
    expect(storage.uploads).toHaveLength(uploadsBefore);
    expect(await memoryProfileCoverPhotoStore.listHidden()).toEqual(hiddenBefore);
    expect(await profileCoverPhotoStore().countForProfile(profile!.id)).toBe(countBefore);
  });

  it("hides rotation-only covers when the profile mirror image is absent", async () => {
    const profile = await profileStore().getByHandle(HANDLE);
    await memoryProfileCoverPhotoStore.create({
      id: "77777777-7777-4777-8777-777777777771",
      profileId: profile!.id,
      generation: "55555555-5555-4555-8555-555555555555",
      objectKey: profileImageServingKey(
        "cover",
        profile!.id,
        "55555555-5555-4555-8555-555555555555",
      ),
    });
    expect(profile?.coverObjectKey).toBeFalsy();

    expect(await moderateProfileImageAcrossStores(HANDLE, "cover", "hide")).toBe(true);
    expect(await profileCoverPhotoStore().listApproved(profile!.id)).toEqual([]);
    expect(await memoryProfileCoverPhotoStore.listForReview()).toEqual([]);
  });

  it("answers a profile guard outage as a retryable store failure", async () => {
    vi.spyOn(memoryProfileStore, "getById").mockRejectedValueOnce(
      new Error("profile read unavailable"),
    );

    const response = await addCover(multipart(await wideImage()), params);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      code: "STORE_UNAVAILABLE",
      retryable: true,
    });
  });
});

describe("the cap", () => {
  it("takes five and refuses the sixth without staging it", async () => {
    for (let i = 0; i < PROFILE_COVER_PHOTO_CAP; i += 1) await add();
    const staged = storage.uploads.length;

    const sixth = await addCover(multipart(await wideImage()), params);
    expect(sixth.status).toBe(409);
    const body = await sixth.json();
    expect(body.code).toBe("COVER_CAP_REACHED");
    expect(body.error).toMatch(/all 5 cover photos/i);
    // Nothing was staged, so the sixth attempt cost no scan and no bytes.
    expect(storage.uploads).toHaveLength(staged);
  });

  it("keeps memory inside the durable five-position cap after a row is hidden", async () => {
    for (let i = 0; i < PROFILE_COVER_PHOTO_CAP; i += 1) await add();
    const profile = await profileStore().getByHandle(HANDLE);
    const held = await profileCoverPhotoStore().listApproved(profile!.id);
    expect(await profileCoverPhotoStore().moderate(held[2]!.id, "hidden")).toBe(true);

    const response = await addCover(multipart(await wideImage()), params);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("COVER_CAP_REACHED");
  });
});

describe("ordering", () => {
  it("moves a cover up and renumbers the settled list", async () => {
    await add("#31485f");
    await add("#7a3b1d");
    const three = await add("#2f6f4f");
    const last = three.covers[2]!;

    const moved = await moveCover(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ move: "up" }),
      }),
      coverParams(last.id),
    );
    expect(moved.status).toBe(200);
    const body = (await moved.json()) as CoverReply;
    expect(body.covers.map((c) => c.id)).toEqual([
      three.covers[0]!.id,
      last.id,
      three.covers[1]!.id,
    ]);
    expect(body.covers.map((c) => c.position)).toEqual([1, 2, 3]);
  });

  // The first cover IS the back-compat cover, so promoting one to the front has
  // to move what a single-cover reader sees with it.
  it("re-mirrors the single cover when the front of the rotation changes", async () => {
    await add("#31485f");
    const two = await add("#7a3b1d");
    const second = two.covers[1]!;

    const moved = await moveCover(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ move: "up" }),
      }),
      coverParams(second.id),
    );
    const body = (await moved.json()) as CoverReply;
    expect(body.covers[0]!.id).toBe(second.id);
    expect(body.profile.coverUrl).toBe(second.url);
  });

  it("refuses a direction it does not offer, and a cover it does not hold", async () => {
    const one = await add();
    const bad = await moveCover(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ move: "first" }),
      }),
      coverParams(one.covers[0]!.id),
    );
    expect(bad.status).toBe(400);

    const missing = await moveCover(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ move: "up" }),
      }),
      coverParams("11111111-1111-4111-8111-111111111111"),
    );
    expect(missing.status).toBe(404);
  });
});

describe("removing a cover", () => {
  it("logs every orphaned object path when byte cleanup fails", async () => {
    const one = await add();
    const profile = await profileStore().getByHandle(HANDLE);
    const [stored] = await profileCoverPhotoStore().listApproved(profile!.id);
    const objectPaths = [
      stored!.objectKey,
      profileImageStagingKey("cover", profile!.id, stored!.generation),
    ];
    __setProfileCoverPhotoRouteDepsForTest({
      storage: {
        ...storage,
        remove: async () => {
          throw new Error("cleanup unavailable");
        },
      },
      moderation: () => ({ moderate: async () => ({ decision: "approved" as const }) }),
    });
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => output.push(String(line)));

    const response = await deleteCover(
      new Request("http://localhost/x", { method: "DELETE" }),
      coverParams(one.covers[0]!.id),
    );

    expect(response.status).toBe(200);
    expect(output.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        event: "profile_cover.cleanup_failed",
        objectPaths,
      }),
    );
  });

  it("deletes its bytes, closes the gap, and answers the settled rotation", async () => {
    const one = await add("#31485f");
    const two = await add("#7a3b1d");
    const target = two.covers[0]!;
    expect(one.covers[0]!.id).toBe(target.id);

    const profile = await profileStore().getByHandle(HANDLE);
    const stored = await profileCoverPhotoStore().listApproved(profile!.id);
    const objectKey = stored[0]!.objectKey;

    const response = await deleteCover(
      new Request("http://localhost/x", { method: "DELETE" }),
      coverParams(target.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CoverReply;
    expect(body.covers).toHaveLength(1);
    expect(body.covers[0]!.position).toBe(1);
    expect(body.covers[0]!.id).toBe(two.covers[1]!.id);
    expect(storage.removed.flat()).toContain(objectKey);
    // The survivor is now cover #1, so the single-cover lane names it.
    expect(body.profile.coverUrl).toBe(body.covers[0]!.url);
  });

  it("clears the single cover when the last one goes", async () => {
    const one = await add();
    const response = await deleteCover(
      new Request("http://localhost/x", { method: "DELETE" }),
      coverParams(one.covers[0]!.id),
    );
    const body = (await response.json()) as CoverReply;
    expect(body.covers).toEqual([]);
    expect(body.profile.coverUrl).toBeUndefined();
    expect(body.profile.coverUrls).toEqual([]);
  });

  it("refuses a cover that belongs to nobody here", async () => {
    const response = await deleteCover(
      new Request("http://localhost/x", { method: "DELETE" }),
      coverParams("22222222-2222-4222-8222-222222222222"),
    );
    expect(response.status).toBe(404);
  });
});

// The serve route reads UUIDs off a public URL and refuses anything else, and
// the in-memory profile store mints `mem-profile-{handle}` ids. So this section
// hands the route its own profile rather than the seeded one; what is under
// test is the new second lane, not the store that answered it.
describe("serving any cover in the rotation", () => {
  const SERVE_PROFILE = "44444444-4444-4444-8444-444444444444";
  const FIRST_GENERATION = "55555555-5555-4555-8555-555555555555";
  const SECOND_GENERATION = "66666666-6666-4666-8666-666666666666";
  const secondKey = profileImageServingKey("cover", SERVE_PROFILE, SECOND_GENERATION);

  /** Storage configured, the profile row naming cover #1, the rotation live. */
  function serveWith(download: ProfileImageServeDeps["downloadObject"]): void {
    supabaseConfigured.value = true;
    __setCoverServeRouteDepsForTest({
      getProfileById: async () => ({
        id: SERVE_PROFILE,
        handle: HANDLE,
        userId: "user-alice",
        coverObjectKey: profileImageServingKey("cover", SERVE_PROFILE, FIRST_GENERATION),
        coverGeneration: FIRST_GENERATION,
        coverModerationState: "approved",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
      extraServingKey: (profileId, generation) =>
        memoryProfileCoverPhotoStore.approvedObjectKey(profileId, generation),
      downloadObject: download,
    });
  }

  async function seedSecondCover(): Promise<string> {
    const created = await memoryProfileCoverPhotoStore.create({
      id: "77777777-7777-4777-8777-777777777777",
      profileId: SERVE_PROFILE,
      generation: SECOND_GENERATION,
      objectKey: secondKey,
    });
    return created.id;
  }

  afterEach(() => {
    supabaseConfigured.value = false;
  });

  it("serves a generation the profile row does not name", async () => {
    await seedSecondCover();
    serveWith(async (objectKey) =>
      objectKey === secondKey
        ? { bytes: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" }
        : null,
    );

    const response = await serveCover(new Request("http://localhost/x"), {
      params: Promise.resolve({
        profileId: SERVE_PROFILE,
        generation: SECOND_GENERATION,
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("refuses a hidden cover, and a generation nobody recorded", async () => {
    const coverId = await seedSecondCover();
    serveWith(async () => ({
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      contentType: "image/jpeg",
    }));
    expect(await memoryProfileCoverPhotoStore.moderate(coverId, "hidden")).toBe(true);

    const hidden = await serveCover(new Request("http://localhost/x"), {
      params: Promise.resolve({
        profileId: SERVE_PROFILE,
        generation: SECOND_GENERATION,
      }),
    });
    expect(hidden.status).toBe(404);

    const unknown = await serveCover(new Request("http://localhost/x"), {
      params: Promise.resolve({
        profileId: SERVE_PROFILE,
        generation: "33333333-3333-4333-8333-333333333333",
      }),
    });
    expect(unknown.status).toBe(404);
  });

  // Cover #1 is still served by the row it has always been served by.
  it("still serves the generation on the profile row", async () => {
    serveWith(async () => ({
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      contentType: "image/jpeg",
    }));
    const response = await serveCover(new Request("http://localhost/x"), {
      params: Promise.resolve({
        profileId: SERVE_PROFILE,
        generation: FIRST_GENERATION,
      }),
    });
    expect(response.status).toBe(200);
  });
});

describe("the public read and the owner's own list", () => {
  it("carries the ordered rotation through the one shared projection", async () => {
    const first = await add("#31485f");
    const second = await add("#7a3b1d");

    authState.userId = null;
    const response = await getProfile(
      new Request(`http://localhost/api/profiles/${HANDLE}`),
      params,
    );
    const raw = await response.clone().text();
    const body = await response.json();

    expect(body.profile.coverUrls).toEqual(second.covers.map((c) => c.url));
    expect(body.profile.coverUrl).toBe(first.covers[0]!.url);
    // The founding mark rides the same projection, which is the point of there
    // being only one.
    expect(body.profile.foundingMemberNumber).toBeGreaterThan(0);
    // Nothing internal crosses the wire.
    expect(raw).not.toContain("objectKey");
    expect(raw).not.toContain("covers/");
    expect(raw).not.toContain("staging.jpg");
    expect(raw).not.toContain("moderationState");
  });

  it("gives the owner the ids their editor needs, and nobody else the list", async () => {
    await add();
    const mine = await listCovers(new Request("http://localhost/x"), params);
    expect(mine.status).toBe(200);
    const body = await mine.json();
    expect(body.status).toBe("ready");
    expect(body.covers).toHaveLength(1);
    expect(body.covers[0].id).toBeTruthy();

    authState.userId = "user-other";
    expect((await listCovers(new Request("http://localhost/x"), params)).status).toBe(403);
  });
});

describe("the reader flag lane", () => {
  it("queues ONE cover without hiding it or touching the others", async () => {
    await add("#31485f");
    const two = await add("#7a3b1d");
    const profile = await profileStore().getByHandle(HANDLE);
    const stored = await profileCoverPhotoStore().listApproved(profile!.id);
    const second = stored[1]!;
    expect(two.covers).toHaveLength(2);

    authState.userId = null;
    const flagged = await reportCover(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "not their photo" }),
      }),
      coverParams(second.id),
    );
    expect(flagged.status).toBe(200);

    // Still public, still two, and only one of them is in the queue.
    expect(await profileCoverPhotoStore().listApproved(profile!.id)).toHaveLength(2);
    const queue = await memoryProfileCoverPhotoStore.listForReview();
    expect(queue.map((row) => row.id)).toEqual([second.id]);
  });

  it("hides on a moderator decision, keeps restore reversible, and deletes nothing", async () => {
    await add();
    const profile = await profileStore().getByHandle(HANDLE);
    const stored = await profileCoverPhotoStore().listApproved(profile!.id);
    const only = stored[0]!;

    expect(await profileCoverPhotoStore().moderate(only.id, "hidden", "wrong photo")).toBe(true);
    expect(await profileCoverPhotoStore().listApproved(profile!.id)).toEqual([]);
    expect(storage.has(only.objectKey)).toBe(true);
    expect(await memoryProfileCoverPhotoStore.listHidden()).toHaveLength(1);

    expect(await profileCoverPhotoStore().moderate(only.id, "approved")).toBe(true);
    expect(await profileCoverPhotoStore().listApproved(profile!.id)).toHaveLength(1);
  });
});

describe("0100 migration shape", () => {
  it("pins the serving key, the closed states, the deferred order and the tombstone", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260810140000_0100_profile_cover_photos.sql",
      ),
      "utf8",
    );

    expect(sql).toMatch(/create table if not exists public\.profile_cover_photos/);
    expect(sql).toMatch(
      /covers\/' \|\| profile_id::text \|\| '\/' \|\| generation::text \|\| '\/cover\.jpg'/,
    );
    expect(sql).toMatch(/moderation_state in \('approved', 'needs_review', 'hidden'\)/);
    expect(sql).toMatch(/position >= 1 and position <= 5/);
    // A reorder swaps two positions inside one statement, so the check defers.
    expect(sql).toMatch(/unique \(profile_id, position\) deferrable initially deferred/);
    expect(sql).toMatch(/unique \(profile_id, generation\)/);
    // Service-role only, like every other app store.
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.profile_cover_photos from anon, authenticated/);
    // The captain's fresh cover becomes cover #1 with nothing to redo.
    expect(sql).toMatch(/insert into public\.profile_cover_photos/);
    expect(sql).toMatch(/from public\.profiles p/);
    // Leaving takes every cover with it.
    expect(sql).toMatch(/delete from public\.profile_cover_photos c/);
    expect(sql).toMatch(/covers\/' \|\| p\.id::text \|\| '\/%'/);
    // 0093's fix: the RLS helpers moved out of `public` in 0070.
    expect(sql).not.toMatch(/public\.rls_owns_profile/);

    const rollback = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/rollback/20260810140000_0100_profile_cover_photos_rollback.sql",
      ),
      "utf8",
    );
    expect(rollback).toMatch(/drop table if exists public\.profile_cover_photos/);
    // The rollback restores 0098's trigger and leaves the bytes alone.
    expect(rollback).toMatch(/create or replace function public\.stamp_profile_tombstone_on_auth_user_delete/);
    expect(rollback).not.toMatch(/delete from public\.profile_cover_photos/);
  });
});
