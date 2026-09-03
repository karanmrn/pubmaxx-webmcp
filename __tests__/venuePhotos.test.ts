// The pub photo wall's policy, and the sentences it is allowed to say.
//
// Everything here is pure, so it is tested without a browser, a database or a
// storage client. The store and the route tests pin what happens to a photo;
// this pins what a photo is ALLOWED to be.

import { describe, expect, it } from "vitest";

import { DRINK_CATEGORIES } from "@/lib/drinks";
import {
  byNewestVenuePhoto,
  cleanVenuePhotoCaption,
  isBeforeVenuePhotoCursor,
  isVenuePhotoServingKey,
  isVenuePhotoVenueId,
  parseVenuePhotoCursor,
  parseVenuePhotoDrinkCategory,
  validateVenuePhotoSubmission,
  VENUE_PHOTO_ASPECT_RATIO,
  VENUE_PHOTO_CAP_PER_ACCOUNT,
  VENUE_PHOTO_CAPTION_MAX,
  VENUE_PHOTO_CROP_TARGET,
  VENUE_PHOTO_OUTPUT_HEIGHT,
  VENUE_PHOTO_OUTPUT_WIDTH,
  venuePhotoAltText,
  venuePhotoCapLine,
  venuePhotoCrosspostNote,
  venuePhotoCursor,
  venuePhotoServePath,
  venuePhotoServingKey,
  venuePhotoStagingKey,
  venuePhotoWallEmptyLine,
  type VenuePhoto,
} from "@/lib/venuePhotos";

function photo(overrides: Partial<VenuePhoto> = {}): VenuePhoto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    venueId: "venue-abc",
    authorActor: "profile:22222222-2222-4222-8222-222222222222",
    authorProfileId: "22222222-2222-4222-8222-222222222222",
    objectKey: "venue-photos/venue-abc/11111111-1111-4111-8111-111111111111.jpg",
    drinkCategory: "beer",
    caption: "",
    width: 1080,
    height: 1350,
    moderationState: "approved",
    createdAt: "2026-08-09T18:00:00.000Z",
    ...overrides,
  };
}

describe("the captain's number", () => {
  it("is a hundred per account per venue", () => {
    expect(VENUE_PHOTO_CAP_PER_ACCOUNT).toBe(100);
  });

  it("names the pub in the sentence a capped drinker reads", () => {
    const line = venuePhotoCapLine("The Churchill Arms");
    expect(line).toContain("The Churchill Arms");
    expect(line).toContain("100");
    // It says the limit and stops. The wall offers its author no delete, so
    // telling them to remove one would name a control that is not there.
    expect(line).not.toMatch(/remove/i);
    expect(line).toMatch(/limit for one pub/i);
  });

  it("still says what happened when it does not know the pub's name", () => {
    // The write path knows the venue id, not its name.
    const line = venuePhotoCapLine();
    expect(line).toContain("100");
    expect(line).toMatch(/this pub's wall/i);
    expect(line).not.toMatch(/undefined/);
  });
});

describe("a photo's storage keys", () => {
  it("puts the serving object under the venue, named for the photo", () => {
    expect(venuePhotoServingKey("venue-abc", "photo-1")).toBe(
      "venue-photos/venue-abc/photo-1.jpg",
    );
  });

  it("keeps staging a sibling of the serving key, never a parent of it", () => {
    const serving = venuePhotoServingKey("venue-abc", "photo-1");
    const staging = venuePhotoStagingKey("venue-abc", "photo-1");
    expect(staging).not.toBe(serving);
    expect(serving.startsWith(staging.replace(".staging.jpg", ""))).toBe(true);
    expect(staging.endsWith(".staging.jpg")).toBe(true);
  });

  it("recognises only the exact serving key for that venue and photo", () => {
    expect(isVenuePhotoServingKey("venue-abc", "photo-1", "venue-photos/venue-abc/photo-1.jpg")).toBe(true);
    // Another venue's folder, the staging lane, and a path walk are all refused.
    expect(isVenuePhotoServingKey("venue-abc", "photo-1", "venue-photos/other/photo-1.jpg")).toBe(false);
    expect(isVenuePhotoServingKey("venue-abc", "photo-1", "venue-photos/venue-abc/photo-1.staging.jpg")).toBe(false);
    expect(isVenuePhotoServingKey("venue-abc", "photo-1", "avatars/venue-abc/photo-1.jpg")).toBe(false);
  });

  it("serves through a path that escapes both segments", () => {
    expect(venuePhotoServePath("venue abc", "photo/1")).toBe(
      "/api/venue-photo/venue%20abc/photo%2F1",
    );
  });
});

describe("a venue id that reaches a storage key", () => {
  it("takes the ids the index really uses", () => {
    for (const id of ["venue-1a2b", "osm-node-123", "the.churchill", "uk_base:42"]) {
      expect(isVenuePhotoVenueId(id), id).toBe(true);
    }
  });

  it("refuses anything that could walk out of the venue's folder", () => {
    for (const id of ["", "../secrets", "a/b", "venue id", "..", "/leading", "a".repeat(65)]) {
      expect(isVenuePhotoVenueId(id), id).toBe(false);
    }
  });
});

describe("the tag is the one closed taxonomy", () => {
  it("takes every drink category the app already knows", () => {
    for (const category of DRINK_CATEGORIES) {
      expect(parseVenuePhotoDrinkCategory(category)).toBe(category);
    }
  });

  it("reads an absent tag as no tag", () => {
    expect(parseVenuePhotoDrinkCategory(undefined)).toBeNull();
    expect(parseVenuePhotoDrinkCategory(null)).toBeNull();
    expect(parseVenuePhotoDrinkCategory("")).toBeNull();
  });

  it("refuses an unknown tag rather than quietly dropping it", () => {
    // Silently untagging is worse than refusing: the drinker cannot tell.
    expect(parseVenuePhotoDrinkCategory("mead")).toBeUndefined();
    expect(parseVenuePhotoDrinkCategory(7)).toBeUndefined();
  });
});

describe("a caption", () => {
  it("is cleaned and capped at the Visit Report length", () => {
    expect(VENUE_PHOTO_CAPTION_MAX).toBe(140);
    expect(cleanVenuePhotoCaption(`  two   spaces  `)).toBe("two spaces");
    expect(cleanVenuePhotoCaption("a".repeat(300))).toHaveLength(140);
  });

  it("strips angle brackets and control characters", () => {
    expect(cleanVenuePhotoCaption("<b>pint</b>")).toBe("bpint/b");
    expect(cleanVenuePhotoCaption("a\u0000b")).toBe("a b");
  });

  it("is optional", () => {
    expect(cleanVenuePhotoCaption(undefined)).toBe("");
  });
});

describe("validating a submission", () => {
  it("takes a pub, a tag, a caption and an asked-for crosspost", () => {
    const result = validateVenuePhotoSubmission({
      venueId: "venue-abc",
      drinkCategory: "beer",
      caption: "First of the night",
      shareToFeed: true,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        venueId: "venue-abc",
        drinkCategory: "beer",
        caption: "First of the night",
        shareToFeed: true,
      },
    });
  });

  it("defaults the crosspost to off when nothing asked for it", () => {
    const result = validateVenuePhotoSubmission({ venueId: "venue-abc" });
    expect(result.ok && result.value.shareToFeed).toBe(false);
    expect(result.ok && result.value.drinkCategory).toBeNull();
  });

  it("refuses a missing or unusable pub", () => {
    expect(validateVenuePhotoSubmission({}).ok).toBe(false);
    expect(validateVenuePhotoSubmission({ venueId: "../x" }).ok).toBe(false);
    expect(validateVenuePhotoSubmission("nope").ok).toBe(false);
  });

  it("refuses an off-taxonomy tag", () => {
    const result = validateVenuePhotoSubmission({ venueId: "venue-abc", drinkCategory: "mead" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/listed drink/i);
  });
});

describe("the wall's order and its pages", () => {
  it("puts the newest first and breaks a tie on the id", () => {
    const older = photo({ id: "aaa", createdAt: "2026-08-08T18:00:00.000Z" });
    const newer = photo({ id: "bbb", createdAt: "2026-08-09T18:00:00.000Z" });
    expect([older, newer].sort(byNewestVenuePhoto)[0]).toBe(newer);

    const sameMoment = [photo({ id: "aaa" }), photo({ id: "bbb" })].sort(byNewestVenuePhoto);
    expect(sameMoment.map((row) => row.id)).toEqual(["bbb", "aaa"]);
  });

  it("round-trips a cursor", () => {
    const row = photo();
    const parsed = parseVenuePhotoCursor(venuePhotoCursor(row));
    expect(parsed).toEqual({ createdAt: row.createdAt, id: row.id });
  });

  it("refuses a cursor that is not one", () => {
    expect(parseVenuePhotoCursor(null)).toBeNull();
    expect(parseVenuePhotoCursor("nonsense")).toBeNull();
    expect(parseVenuePhotoCursor("not-a-date|id")).toBeNull();
  });

  it("takes strictly older rows, so a page boundary never repeats a tile", () => {
    const cursor = { createdAt: "2026-08-09T18:00:00.000Z", id: "bbb" };
    expect(isBeforeVenuePhotoCursor(photo({ id: "aaa" }), cursor)).toBe(true);
    expect(isBeforeVenuePhotoCursor(photo({ id: "bbb" }), cursor)).toBe(false);
    expect(isBeforeVenuePhotoCursor(photo({ id: "ccc" }), cursor)).toBe(false);
    expect(
      isBeforeVenuePhotoCursor(photo({ createdAt: "2026-08-08T18:00:00.000Z", id: "zzz" }), cursor),
    ).toBe(true);
  });
});

describe("the crop target", () => {
  it("is portrait, because a pint is", () => {
    expect(VENUE_PHOTO_ASPECT_RATIO).toBeLessThan(1);
    expect(VENUE_PHOTO_CROP_TARGET.aspectRatio).toBe(VENUE_PHOTO_ASPECT_RATIO);
  });

  it("renders into the box the tile reserves", () => {
    expect(VENUE_PHOTO_CROP_TARGET.outputBox).toEqual({
      width: VENUE_PHOTO_OUTPUT_WIDTH,
      height: VENUE_PHOTO_OUTPUT_HEIGHT,
    });
    expect(VENUE_PHOTO_OUTPUT_WIDTH / VENUE_PHOTO_OUTPUT_HEIGHT).toBeCloseTo(
      VENUE_PHOTO_ASPECT_RATIO,
      3,
    );
  });

  it("writes a JPEG, which is what makes an iPhone's HEIC uploadable", () => {
    expect(VENUE_PHOTO_CROP_TARGET.fileName.endsWith(".jpg")).toBe(true);
  });
});

describe("a crosspost answers in three states, never a boolean", () => {
  it("says nothing when nobody asked", () => {
    expect(venuePhotoCrosspostNote("off")).toBeNull();
  });

  it("claims the feed only when a post really exists", () => {
    expect(venuePhotoCrosspostNote("posted")).toMatch(/Shared to your feed/i);
  });

  it("names the wall's success and the feed's silence, and claims neither wrongly", () => {
    const line = venuePhotoCrosspostNote("unavailable") ?? "";
    expect(line).toMatch(/wall/i);
    expect(line).toMatch(/nothing was shared/i);
    expect(line).not.toMatch(/shared to your feed/i);
  });
});

describe("what a wall says when it has nothing to show", () => {
  it("keeps an empty pub and an unread wall apart", () => {
    const empty = venuePhotoWallEmptyLine("ready");
    const unread = venuePhotoWallEmptyLine("degraded");
    expect(empty).not.toBe(unread);
    expect(empty).toMatch(/first/i);
    expect(unread).toMatch(/could not read/i);
  });

  it("never leaks plumbing or slams the door", () => {
    for (const line of [venuePhotoWallEmptyLine("ready"), venuePhotoWallEmptyLine("degraded")]) {
      expect(line).not.toMatch(/error|fail|500|null|undefined|exception/i);
      expect(line).not.toMatch(/—/);
    }
  });
});

describe("what a screen reader hears", () => {
  it("names the author and their words when there are some", () => {
    expect(
      venuePhotoAltText({ author: { handle: "karan" }, drinkCategory: "beer", caption: "Cold one" }),
    ).toBe("@karan: Cold one");
  });

  it("names the drink by its LABEL when there are no words", () => {
    expect(
      venuePhotoAltText({ author: { handle: "karan" }, drinkCategory: "beer", caption: "" }),
    ).toBe("Beer, photographed by @karan");
    // The plural labels are why the drink gets its own clause rather than
    // sitting mid-sentence: "A Cocktails photo" is not a sentence.
    expect(
      venuePhotoAltText({ author: { handle: "karan" }, drinkCategory: "cocktail", caption: "" }),
    ).toBe("Cocktails, photographed by @karan");
    expect(
      venuePhotoAltText({ author: { handle: "karan" }, drinkCategory: "soft-drink", caption: "" }),
    ).toBe("Soft drinks, photographed by @karan");
  });

  it("still names somebody when there is neither", () => {
    expect(
      venuePhotoAltText({ author: { handle: "karan" }, drinkCategory: null, caption: "" }),
    ).toBe("A photo by @karan");
  });
});
