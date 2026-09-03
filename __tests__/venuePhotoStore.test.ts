// What the wall store owes every reader: the cap counted the same way twice,
// pages that never repeat a tile, and one moderation filter that takes a hidden
// photo off the wall, out of the pages and out of the author's cap together.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import {
  __resetMemoryProfiles,
  memoryProfileStore,
  profileStore,
} from "@/lib/profileStore";
import {
  __resetVenuePhotos,
  VENUE_PHOTO_CAP_PER_ACCOUNT,
  venuePhotoStore,
} from "@/lib/venuePhotoStore";
import { venuePhotoServingKey, type VenuePhotoFields } from "@/lib/venuePhotos";

const VENUE = "venue-abc";
const OTHER_VENUE = "venue-xyz";

async function seedAuthor(handle: string, userId: string): Promise<string> {
  await memoryProfileStore.createOwned(handle, userId);
  const profile = await profileStore().getByHandle(handle);
  return profile!.id;
}

function fields(
  profileId: string,
  overrides: Partial<VenuePhotoFields> & { photoId?: string } = {},
): VenuePhotoFields {
  const { photoId = crypto.randomUUID(), ...rest } = overrides;
  const venueId = rest.venueId ?? VENUE;
  return {
    id: photoId,
    venueId,
    authorActor: `profile:${profileId}`,
    authorProfileId: profileId,
    objectKey: venuePhotoServingKey(venueId, photoId),
    drinkCategory: "beer",
    caption: "",
    width: 1080,
    height: 1350,
    ...rest,
  };
}

let alice = "";
let bob = "";

beforeEach(async () => {
  __resetVenuePhotos();
  __resetMemoryProfiles();
  alice = await seedAuthor("alice", "user-alice");
  bob = await seedAuthor("bob", "user-bob");
});

describe("the cap is per account per venue", () => {
  it("counts only this account's own live rows at this venue", async () => {
    const store = venuePhotoStore();
    for (let i = 0; i < 3; i += 1) await store.create(fields(alice));
    await store.create(fields(alice, { venueId: OTHER_VENUE }));
    await store.create(fields(bob));

    expect(await store.countForAuthorAtVenue(alice, VENUE)).toBe(3);
    expect(await store.countForAuthorAtVenue(alice, OTHER_VENUE)).toBe(1);
    expect(await store.countForAuthorAtVenue(bob, VENUE)).toBe(1);
  });

  it("fills to the captain's hundred without one drinker closing the wall", async () => {
    const store = venuePhotoStore();
    for (let i = 0; i < VENUE_PHOTO_CAP_PER_ACCOUNT; i += 1) {
      await store.create(fields(alice));
    }
    expect(await store.countForAuthorAtVenue(alice, VENUE)).toBe(
      VENUE_PHOTO_CAP_PER_ACCOUNT,
    );
    // The wall is per account, so the next person still has a whole hundred.
    expect(await store.countForAuthorAtVenue(bob, VENUE)).toBe(0);
  });

  it("gives the slot back when a moderator hides a photo", async () => {
    const store = venuePhotoStore();
    const first = await store.create(fields(alice));
    await store.create(fields(alice));
    expect(await store.countForAuthorAtVenue(alice, VENUE)).toBe(2);

    // A removal is not a spent slot: counting it would turn one moderation
    // decision into a permanent penalty nobody explained.
    await store.moderate(first.id, "hidden");
    expect(await store.countForAuthorAtVenue(alice, VENUE)).toBe(1);
  });
});

describe("a wall page", () => {
  it("returns the newest first and hands back a cursor for the rest", async () => {
    const store = venuePhotoStore();
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const row = await store.create(fields(alice), Date.UTC(2026, 7, 9, 18, i));
      created.push(row.id);
    }

    const first = await store.listForVenue(VENUE, { limit: 2 });
    expect(first.status).toBe("ready");
    expect(first.photos.map((p) => p.id)).toEqual([created[4], created[3]]);
    expect(first.nextCursor).not.toBeNull();

    const second = await store.listForVenue(VENUE, { limit: 2, cursor: first.nextCursor });
    expect(second.photos.map((p) => p.id)).toEqual([created[2], created[1]]);

    const third = await store.listForVenue(VENUE, { limit: 2, cursor: second.nextCursor });
    expect(third.photos.map((p) => p.id)).toEqual([created[0]]);
    expect(third.nextCursor).toBeNull();
  });

  it("never repeats or skips a tile across a page boundary", async () => {
    const store = venuePhotoStore();
    // Every row at the same instant, so only the id tie-break keeps the pages
    // apart. This is the case an offset page gets wrong.
    for (let i = 0; i < 7; i += 1) {
      await store.create(fields(alice), Date.UTC(2026, 7, 9, 18, 0));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof store.listForVenue>> =
        await store.listForVenue(VENUE, { limit: 3, cursor });
      seen.push(...page.photos.map((p) => p.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("shows one venue's wall and not another's", async () => {
    const store = venuePhotoStore();
    await store.create(fields(alice));
    await store.create(fields(alice, { venueId: OTHER_VENUE }));
    const page = await store.listForVenue(VENUE);
    expect(page.photos).toHaveLength(1);
    expect(page.photos[0].venueId).toBe(VENUE);
  });

  it("says whose tile it is only to the account that posted it", async () => {
    const store = venuePhotoStore();
    await store.create(fields(alice));
    const mine = await store.listForVenue(VENUE, { viewerProfileId: alice });
    const theirs = await store.listForVenue(VENUE, { viewerProfileId: bob });
    const anonymous = await store.listForVenue(VENUE);
    expect(mine.photos[0].ownedByViewer).toBe(true);
    expect(theirs.photos[0].ownedByViewer).toBe(false);
    expect(anonymous.photos[0].ownedByViewer).toBe(false);
  });
});

describe("the author a wall prints", () => {
  it("carries the handle, the face and the brass mark off the ONE projection", async () => {
    await memoryProfileStore.setOwnedImage("alice", "avatar", {
      objectKey: `avatars/${alice}/gen-1/image.jpg`,
      generation: "gen-1",
      moderationState: "approved",
    });
    const withNumber = await memoryProfileStore.getByHandle("alice");
    // The number is granted in the claim path; the store's own row is what the
    // projection reads, so setting it here is the same input production has.
    (withNumber as { foundingMemberNumber?: number }).foundingMemberNumber = 7;

    const store = venuePhotoStore();
    await store.create(fields(alice));
    const page = await store.listForVenue(VENUE);

    expect(page.photos[0].author.handle).toBe("alice");
    expect(page.photos[0].author.avatarUrl).toBe(`/api/avatar/${alice}/gen-1`);
    expect(page.photos[0].author.foundingMemberNumber).toBe(7);
  });

  it("says nothing private about them", async () => {
    const store = venuePhotoStore();
    await store.create(fields(alice));
    const page = await store.listForVenue(VENUE);
    const author = page.photos[0].author as Record<string, unknown>;
    // The private set stays behind the owner-authenticated onboarding read.
    for (const field of ["email", "dateOfBirth", "gender", "fullName", "userId", "id"]) {
      expect(author, field).not.toHaveProperty(field);
    }
  });

  it("drops a tile whose author has left", async () => {
    const store = venuePhotoStore();
    await store.create(fields(alice));
    await store.create(fields(bob));
    const gone = await memoryProfileStore.getByHandle("alice");
    (gone as { tombstonedAt?: string }).tombstonedAt = new Date().toISOString();

    const page = await store.listForVenue(VENUE);
    expect(page.photos.map((p) => p.author.handle)).toEqual(["bob"]);
  });
});

describe("taking a photo down", () => {
  it("queues a flag per actor and never hides on its own", async () => {
    const store = venuePhotoStore();
    const row = await store.create(fields(alice));

    expect(await store.report(row.id, "not this pub", "actor-1")).toBe(true);
    // A second flag from the same actor is an idempotent no-op.
    expect(await store.report(row.id, undefined, "actor-1")).toBe(true);
    expect((await store.getById(row.id))?.reportCount).toBe(1);
    // Still on the wall: reporting is never a one-tap eraser.
    expect((await store.listForVenue(VENUE)).photos).toHaveLength(1);

    expect(await store.report(row.id, undefined, "actor-2")).toBe(2 > 1);
    expect((await store.getById(row.id))?.reportCount).toBe(2);
    expect((await store.listForReview()).map((r) => r.id)).toContain(row.id);
  });

  it("takes a hidden photo off the wall, the pages and the cap together", async () => {
    const store = venuePhotoStore();
    const row = await store.create(fields(alice));
    await store.moderate(row.id, "hidden", "duplicate");

    expect((await store.listForVenue(VENUE)).photos).toHaveLength(0);
    expect(await store.countForAuthorAtVenue(alice, VENUE)).toBe(0);
    // Hiding never deletes: the row and its provenance are still on file.
    const hidden = await store.getById(row.id);
    expect(hidden?.moderationState).toBe("hidden");
    expect(hidden?.moderatorNote).toBe("duplicate");
    expect((await store.listHidden()).map((r) => r.id)).toEqual([row.id]);
  });

  it("puts a restored photo back", async () => {
    const store = venuePhotoStore();
    const row = await store.create(fields(alice));
    await store.moderate(row.id, "hidden");
    await store.moderate(row.id, "approved");
    expect((await store.listForVenue(VENUE)).photos.map((p) => p.id)).toEqual([row.id]);
  });

  it("re-opens a kept photo when the next reader objects", async () => {
    const store = venuePhotoStore();
    const row = await store.create(fields(alice));
    await store.report(row.id, undefined, "actor-1");
    await store.moderate(row.id, "approved", "kept");
    expect(await store.listForReview()).toHaveLength(0);

    await store.report(row.id, undefined, "actor-2");
    expect((await store.listForReview()).map((r) => r.id)).toEqual([row.id]);
    // The earlier decision is still on file.
    expect((await store.getById(row.id))?.moderatorNote).toBe("kept");
  });

  it("answers a flag on an unknown photo with a plain no", async () => {
    expect(await venuePhotoStore().report("missing", undefined, "actor-1")).toBe(false);
    expect(await venuePhotoStore().moderate("missing", "hidden")).toBe(false);
  });
});
