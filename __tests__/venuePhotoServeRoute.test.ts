// The one route that hands out wall bytes, and the four ways it must say no.
//
// A serve route is where a moderation decision either takes effect or quietly
// does not: the row leaves the wall the moment it is hidden, but the object is
// still sitting in the bucket, and anyone who kept the URL has it. So the gate
// is re-checked here on every request rather than assumed from the listing that
// produced the link.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => true };
});

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => limitState.limited };
});

import { GET } from "@/app/api/venue-photo/[venueId]/[photoId]/route";
import {
  VENUE_PHOTO_CACHE_CONTROL,
  __setVenuePhotoServeRouteDepsForTest,
} from "@/lib/venuePhotoServeRouteDeps.server";
import type { ProfileRecord } from "@/lib/profileStore";
import {
  venuePhotoServingKey,
  type VenuePhoto,
  type VenuePhotoModerationState,
} from "@/lib/venuePhotos";

const VENUE = "venue-abc";
const PHOTO_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function row(overrides: Partial<VenuePhoto> = {}): VenuePhoto {
  return {
    id: PHOTO_ID,
    venueId: VENUE,
    authorActor: `profile:${AUTHOR_ID}`,
    authorProfileId: AUTHOR_ID,
    objectKey: venuePhotoServingKey(VENUE, PHOTO_ID),
    drinkCategory: "beer",
    caption: "",
    width: 1080,
    height: 1350,
    moderationState: "approved",
    createdAt: "2026-08-09T18:00:00.000Z",
    ...overrides,
  };
}

function author(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: AUTHOR_ID,
    handle: "alice",
    userId: "user-alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ProfileRecord;
}

function serve(
  photo: VenuePhoto | null,
  profile: ProfileRecord | null = author(),
  downloaded: { bytes: Buffer; contentType: "image/jpeg" } | null = {
    bytes: BYTES,
    contentType: "image/jpeg",
  },
): Promise<Response> {
  __setVenuePhotoServeRouteDepsForTest({
    getPhoto: async () => photo,
    getProfileById: async () => profile,
    downloadObject: async () => downloaded,
  });
  return GET(new Request(`http://localhost/api/venue-photo/${VENUE}/${PHOTO_ID}`), {
    params: Promise.resolve({ venueId: VENUE, photoId: PHOTO_ID }),
  });
}

beforeEach(() => {
  limitState.limited = false;
  __setVenuePhotoServeRouteDepsForTest(null);
});

describe("serving an approved wall photo", () => {
  it("hands back the stored bytes, cached", async () => {
    const response = await serve(row());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe(VENUE_PHOTO_CACHE_CONTROL);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
  });
});

describe("the four ways it says no", () => {
  it("404s a photo a moderator has taken off the wall", async () => {
    for (const state of ["hidden", "needs_review"] as VenuePhotoModerationState[]) {
      const response = await serve(row({ moderationState: state }));
      expect(response.status, state).toBe(404);
      // A 404 is never cached, so a restore takes effect at once.
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  it("404s a photo whose author has left", async () => {
    const response = await serve(row(), author({ tombstonedAt: "2026-08-09T00:00:00.000Z" }));
    expect(response.status).toBe(404);
  });

  it("404s a row that names an object belonging to another wall", async () => {
    // The key is rebuilt from the row rather than trusted off it, so a
    // hand-edited object_key cannot make this route read somebody else's bytes.
    const response = await serve(row({ objectKey: "avatars/somebody/gen/image.jpg" }));
    expect(response.status).toBe(404);
  });

  it("404s a photo asked for under the wrong venue", async () => {
    const response = await serve(row({ venueId: "venue-other" }));
    expect(response.status).toBe(404);
  });

  it("404s an absent object rather than an empty 200", async () => {
    expect((await serve(row(), author(), null)).status).toBe(404);
    expect((await serve(null)).status).toBe(404);
  });

  it("says nothing about why", async () => {
    const body = await (await serve(row({ moderationState: "hidden" }))).json();
    // The reader is told the photo is not there. Which of the reasons it was is
    // the moderator's business, not a browser's.
    expect(body.error).toBe("Photo not found.");
    expect(JSON.stringify(body)).not.toMatch(/hidden|tombstone|moderat/i);
  });
});

describe("the budget", () => {
  it("refuses over it, and never caches the refusal", async () => {
    limitState.limited = true;
    const response = await serve(row());
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
