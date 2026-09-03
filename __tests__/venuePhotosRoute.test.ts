// The whole journey a photo takes to a pub's wall, through the real route.
//
// The five things this pins are the five that would each be a quiet lie:
//   - the cap really stops the hundred-and-first photo for that account;
//   - a refused scan leaves nothing on the serving key, and nothing on the wall,
//     while a scan that could not RUN never closes the wall;
//   - the crosspost box never claims a feed post that does not exist;
//   - the wall's public read says nothing private about its authors, and does
//     carry the brass mark, off the one shared projection;
//   - a reader flag queues, a moderator hides, and a hide is reversible.

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => limitState.limited };
});

const identityState = vi.hoisted(() => ({
  ok: true,
  accountId: "user-alice",
  profileId: "",
  handle: "alice",
}));
vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () =>
    identityState.ok
      ? {
          ok: true,
          accountId: identityState.accountId,
          actor: `profile:${identityState.profileId}`,
          handle: identityState.handle,
        }
      : {
          ok: false,
          body: { status: "sign_in_required", error: "Sign in to contribute." },
          httpStatus: 401,
        },
}));

const dobState = vi.hoisted(() => ({ dateOfBirth: "1990-05-04" as string | null }));
vi.mock("@/lib/privateIdentityStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/privateIdentityStore")>();
  return {
    ...actual,
    privateIdentityStore: () => ({
      read: async () =>
        dobState.dateOfBirth ? { dateOfBirth: dobState.dateOfBirth } : null,
    }),
  };
});

const moderatorState = vi.hoisted(() => ({ moderator: false }));
vi.mock("@/lib/adminAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminAuth")>();
  return { ...actual, isModerator: () => moderatorState.moderator };
});

import { GET, POST } from "@/app/api/venue-photos/route";
import { __setVenuePhotoRouteDepsForTest } from "@/lib/venuePhotoRouteDeps.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetMemoryProfiles,
  memoryProfileStore,
  profileStore,
} from "@/lib/profileStore";
import type { VenuePhotoStorage } from "@/lib/venuePhotoMedia.server";
import {
  __resetVenuePhotos,
  venuePhotoStore,
} from "@/lib/venuePhotoStore";
import {
  VENUE_PHOTO_CAP_PER_ACCOUNT,
  venuePhotoServingKey,
  type VenuePhotoCrosspost,
} from "@/lib/venuePhotos";

const VENUE = "venue-abc";

async function jpeg(): Promise<File> {
  const bytes = await sharp({
    create: { width: 1200, height: 1500, channels: 3, background: "#2b1d14" },
  })
    .jpeg()
    .toBuffer();
  return new File([bytes], "pint.jpg", { type: "image/jpeg" });
}

/** A JPEG with a fake GPS block, to prove the strip step really runs. */
async function jpegWithFakeGps(): Promise<File> {
  const base = await sharp({
    create: { width: 900, height: 1100, channels: 3, background: "#31485f" },
  })
    .jpeg()
    .toBuffer();
  const payload = Buffer.from("Exif\0\0FAKE-GPS-LAT-51.5074-LON-0.1278", "binary");
  const app1 = Buffer.alloc(4 + payload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);
  const withGps = Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
  return new File([withGps], "geo.jpg", { type: "image/jpeg" });
}

function memoryStorage(): VenuePhotoStorage & {
  uploads: Array<{ path: string; bytes: Buffer }>;
  keys: () => string[];
} {
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const objects = new Map<string, Buffer>();
  return {
    uploads,
    keys: () => [...objects.keys()],
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
      for (const path of paths) objects.delete(path);
    },
    async sign(path) {
      return objects.has(path) ? `https://storage.test/${path}?sig=1` : null;
    },
  };
}

function upload(
  file: File,
  post: Record<string, unknown> = { venueId: VENUE },
): Request {
  const body = new FormData();
  body.set("post", JSON.stringify(post));
  body.set("photo", file);
  return new Request("http://localhost/api/venue-photos", { method: "POST", body });
}

function json(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/venue-photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function wall(query = `venueId=${VENUE}`): Request {
  return new Request(`http://localhost/api/venue-photos?${query}`);
}

let crosspostCalls: number;
let crosspostAnswer: VenuePhotoCrosspost;

function deps(decision: "approved" | "needs_review" = "approved", storage = memoryStorage()) {
  __setVenuePhotoRouteDepsForTest({
    storage,
    moderation: () => ({ moderate: async () => ({ decision }) }),
    crosspost: async () => {
      crosspostCalls += 1;
      return crosspostAnswer;
    },
  });
  return storage;
}

beforeEach(async () => {
  __resetVenuePhotos();
  __resetMemoryProfiles();
  __resetPintDrops();
  __setVenuePhotoRouteDepsForTest(null);
  limitState.limited = false;
  moderatorState.moderator = false;
  dobState.dateOfBirth = "1990-05-04";
  identityState.ok = true;
  crosspostCalls = 0;
  crosspostAnswer = { state: "posted", postId: "post-1" };
  await memoryProfileStore.createOwned("alice", "user-alice");
  const profile = await profileStore().getByHandle("alice");
  identityState.profileId = profile!.id;
});

afterEach(() => {
  __setVenuePhotoRouteDepsForTest(null);
});

describe("posting a photo to a wall", () => {
  it("promotes an approved photo to the venue's own serving key", async () => {
    const storage = deps("approved");
    const response = await POST(upload(await jpeg(), { venueId: VENUE, drinkCategory: "beer", caption: "First of the night" }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.photo.venueId).toBe(VENUE);
    expect(body.photo.caption).toBe("First of the night");
    expect(body.photo.drinkCategory).toBe("beer");
    expect(body.photo.url).toBe(`/api/venue-photo/${VENUE}/${body.photo.id}`);

    // Staged first, promoted second, staging cleaned up.
    expect(storage.uploads.some((u) => u.path.endsWith(".staging.jpg"))).toBe(true);
    expect(storage.keys()).toEqual([venuePhotoServingKey(VENUE, body.photo.id)]);
  });

  it("strips a photo's location before it is stored anywhere", async () => {
    const storage = deps("approved");
    await POST(upload(await jpegWithFakeGps()));
    for (const { bytes } of storage.uploads) {
      expect(bytes.toString("binary")).not.toContain("FAKE-GPS-LAT");
    }
  });

  it("refuses a signed-out caller before it spends a scan", async () => {
    identityState.ok = false;
    const storage = deps("approved");
    const response = await POST(upload(await jpeg()));
    expect(response.status).toBe(401);
    expect(storage.uploads).toHaveLength(0);
  });

  it("keeps under-18s off the wall", async () => {
    dobState.dateOfBirth = new Date().toISOString().slice(0, 10);
    const storage = deps("approved");
    const response = await POST(upload(await jpeg()));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("ADULT_REQUIRED");
    // No scan was paid for.
    expect(storage.uploads).toHaveLength(0);
  });

  it("refuses an off-taxonomy tag rather than quietly untagging it", async () => {
    deps("approved");
    const response = await POST(upload(await jpeg(), { venueId: VENUE, drinkCategory: "mead" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/listed drink/i);
  });

  it("stops at the captain's hundred for that account and that pub", async () => {
    deps("approved");
    const store = venuePhotoStore();
    for (let i = 0; i < VENUE_PHOTO_CAP_PER_ACCOUNT; i += 1) {
      const photoId = crypto.randomUUID();
      await store.create({
        id: photoId,
        venueId: VENUE,
        authorActor: `profile:${identityState.profileId}`,
        authorProfileId: identityState.profileId,
        objectKey: venuePhotoServingKey(VENUE, photoId),
        drinkCategory: null,
        caption: "",
        width: 1080,
        height: 1350,
      });
    }

    const response = await POST(upload(await jpeg()));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PHOTO_CAP_REACHED");

    // The same account has a whole hundred waiting at the pub next door.
    const elsewhere = await POST(upload(await jpeg(), { venueId: "venue-xyz" }));
    expect(elsewhere.status).toBe(201);
  });

  it("refuses over the per-account budget, and the budget fails closed", async () => {
    limitState.limited = true;
    const storage = deps("approved");
    const response = await POST(upload(await jpeg()));
    expect(response.status).toBe(429);
    expect(storage.uploads).toHaveLength(0);

    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(`${process.cwd()}/app/api/venue-photos/route.ts`, "utf8"),
    );
    expect(source).toContain("failClosed: true");
  });
});

describe("a photo the safety scan refuses", () => {
  it("never reaches the serving key, the wall, or the count", async () => {
    const storage = deps("needs_review");
    const response = await POST(upload(await jpeg()));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("PHOTO_REFUSED");
    expect(body.error).toMatch(/did not pass our checks/i);
    // Honest friction: it says what happened and hands back the next move.
    expect(body.error).toMatch(/Choose another/i);
    expect(body.error).not.toMatch(/moderation|adapter|openai|scan failed/i);

    expect(storage.keys()).toEqual([]);
    const page = await (await GET(wall())).json();
    expect(page.photos).toEqual([]);
    expect(
      await venuePhotoStore().countForAuthorAtVenue(identityState.profileId, VENUE),
    ).toBe(0);
  });

  // Only a real negative verdict refuses. A scanner nobody configured, or one
  // that is down, is a fact about us: the wall still takes the photo and the
  // moderator report/hide lane is the safety net.
  it("still takes the photo when no scan provider is configured", async () => {
    const storage = memoryStorage();
    __setVenuePhotoRouteDepsForTest({
      storage,
      moderation: () => {
        throw new Error("no key configured");
      },
      crosspost: async () => ({ state: "off" }),
    });
    const response = await POST(upload(await jpeg()));
    expect(response.status).toBe(201);
    expect(storage.keys()).toEqual([venuePhotoServingKey(VENUE, (await response.json()).photo.id)]);
    const page = await (await GET(wall())).json();
    expect(page.photos).toHaveLength(1);
  });

  it("still takes the photo when the scan provider is down", async () => {
    const storage = memoryStorage();
    __setVenuePhotoRouteDepsForTest({
      storage,
      moderation: () => ({
        moderate: async () => {
          throw new Error("offline");
        },
      }),
      crosspost: async () => ({ state: "off" }),
    });
    const response = await POST(upload(await jpeg()));
    expect(response.status).toBe(201);
    expect(storage.keys()).toHaveLength(1);
    expect(
      await venuePhotoStore().countForAuthorAtVenue(identityState.profileId, VENUE),
    ).toBe(1);
  });
});

describe("the crosspost box tells the truth", () => {
  it("does not touch the feed when nobody ticked it", async () => {
    deps("approved");
    const response = await POST(upload(await jpeg(), { venueId: VENUE }));
    expect(crosspostCalls).toBe(0);
    expect((await response.json()).crosspost).toEqual({ state: "off" });
  });

  it("claims a feed post only when one really exists", async () => {
    deps("approved");
    const response = await POST(
      upload(await jpeg(), { venueId: VENUE, shareToFeed: true }),
    );
    expect(crosspostCalls).toBe(1);
    expect((await response.json()).crosspost).toEqual({ state: "posted", postId: "post-1" });
  });

  it("says the feed did not take it when Social is not verified for that account", async () => {
    crosspostAnswer = { state: "unavailable" };
    deps("approved");
    const response = await POST(
      upload(await jpeg(), { venueId: VENUE, shareToFeed: true }),
    );
    const body = await response.json();
    // The wall still took it. Failing the whole request would throw away work
    // the drinker already did.
    expect(response.status).toBe(201);
    expect(body.photo.id).toBeTruthy();
    expect(body.crosspost).toEqual({ state: "unavailable" });
    expect(body.crosspost.postId).toBeUndefined();
  });
});

describe("reading a wall", () => {
  async function post(caption = ""): Promise<string> {
    const response = await POST(upload(await jpeg(), { venueId: VENUE, caption }));
    return (await response.json()).photo.id as string;
  }

  it("carries the handle, the face and the brass mark, and nothing private", async () => {
    deps("approved");
    await memoryProfileStore.setOwnedImage("alice", "avatar", {
      objectKey: `avatars/${identityState.profileId}/gen-1/image.jpg`,
      generation: "gen-1",
      moderationState: "approved",
    });
    const record = await memoryProfileStore.getByHandle("alice");
    (record as { foundingMemberNumber?: number }).foundingMemberNumber = 7;
    await post("Cold one");

    const page = await (await GET(wall())).json();
    expect(page.status).toBe("ready");
    expect(page.photos[0].author).toEqual({
      handle: "alice",
      avatarUrl: `/api/avatar/${identityState.profileId}/gen-1`,
      foundingMemberNumber: 7,
    });
    // No private field, and no storage key, ever crosses this wire.
    const serialised = JSON.stringify(page);
    expect(serialised).not.toContain("venue-photos/");
    expect(serialised).not.toContain("dateOfBirth");
    expect(serialised).not.toContain("user-alice");
    expect(serialised).not.toContain("authorProfileId");
  });

  it("pages rather than truncating", async () => {
    deps("approved");
    const ids = [await post("one"), await post("two"), await post("three")];
    const first = await (await GET(wall(`venueId=${VENUE}&limit=2`))).json();
    expect(first.photos).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = await (
      await GET(wall(`venueId=${VENUE}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`))
    ).json();
    expect(second.photos).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      [...first.photos, ...second.photos].map((p: { id: string }) => p.id).sort(),
    ).toEqual([...ids].sort());
  });

  it("asks for a venue rather than answering with somebody's whole wall", async () => {
    const response = await GET(new Request("http://localhost/api/venue-photos"));
    expect(response.status).toBe(400);
  });
});

describe("taking a photo down", () => {
  async function post(): Promise<string> {
    const response = await POST(upload(await jpeg()));
    return (await response.json()).photo.id as string;
  }

  it("lets a reader flag it without hiding it", async () => {
    deps("approved");
    const id = await post();
    const flagged = await POST(json({ action: "report", id, reason: "not this pub" }));
    expect(flagged.status).toBe(200);
    // A flag is never a one-tap eraser.
    expect((await (await GET(wall())).json()).photos).toHaveLength(1);
    expect((await venuePhotoStore().getById(id))?.reportCount).toBe(1);
  });

  it("lets only a moderator hide it, and the hide stays reversible", async () => {
    deps("approved");
    const id = await post();

    expect((await POST(json({ action: "hide", id }))).status).toBe(403);
    expect((await (await GET(wall())).json()).photos).toHaveLength(1);

    moderatorState.moderator = true;
    expect((await POST(json({ action: "hide", id, note: "duplicate" }))).status).toBe(200);
    expect((await (await GET(wall())).json()).photos).toHaveLength(0);

    // Hiding never deletes: the hidden lane can put it back.
    const hidden = await (await GET(wall("status=hidden"))).json();
    expect(hidden.photos.map((p: { id: string }) => p.id)).toEqual([id]);
    expect((await POST(json({ action: "restore", id }))).status).toBe(200);
    expect((await (await GET(wall())).json()).photos).toHaveLength(1);
  });

  it("keeps the moderator lanes shut to everybody else", async () => {
    expect((await GET(wall("status=reported"))).status).toBe(403);
    expect((await GET(wall("status=hidden"))).status).toBe(403);
  });
});
