// The cover ROTATION's policy, on its own: the cap, the order, what a reading
// surface paints, and when it is allowed to move.
//
// Everything here is pure, so this file needs no bucket, no store and no DOM.
// The routes are walked in `profileCoverPhotosRoute.test.ts` and the header in
// `profileCoverCarousel.test.ts`.

import { describe, expect, it } from "vitest";

import { profileImageServePath } from "@/lib/profileImageSlots";
import { publicProfileFromRecord, type ProfileRecord } from "@/lib/profileStore";
import { toPublicProfile } from "@/lib/profiles";
import {
  byCoverPosition,
  coverCarouselRotates,
  coverPositionsFor,
  isCoverMoveDirection,
  isProfileCoverModerationState,
  moveCoverPosition,
  nextCoverIndex,
  nextCoverPosition,
  PROFILE_COVER_PHOTO_CAP,
  PROFILE_COVER_ROTATION_MS,
  profileCoverCapLine,
  profileCoverEmptyLine,
  profileCoverRemoveConfirmLine,
  profileCoverRemoveLane,
  profileCoverRemoveUnavailableLine,
  profileCoverRotationNote,
  profileCoverUrls,
  PROFILE_COVER_REMOVE_ALL_LABEL,
} from "@/lib/profileCovers";

describe("the cap", () => {
  it("is the captain's five", () => {
    expect(PROFILE_COVER_PHOTO_CAP).toBe(5);
  });

  it("says the limit and the way out, because a Remove really is there", () => {
    const line = profileCoverCapLine();
    expect(line).toContain("5");
    expect(line).toMatch(/remove one/i);
  });

  it("names the field-level remove beside Add cover", () => {
    expect(PROFILE_COVER_REMOVE_ALL_LABEL).toBe("Remove cover");
  });

  it("asks before a field-level remove clears every cover", () => {
    expect(profileCoverRemoveConfirmLine()).toMatch(/remove your cover photo/i);
    expect(profileCoverRemoveConfirmLine()).toMatch(/default backdrop/i);
  });
});

describe("which lane a field-level remove belongs in", () => {
  it("takes the rotation lane while rotation rows are held", () => {
    expect(
      profileCoverRemoveLane({ status: "ready", rotationCount: 3, mirrorCount: 1 }),
    ).toBe("rotation");
  });

  it("takes the single-cover lane only for a read that answered no rotation", () => {
    expect(
      profileCoverRemoveLane({ status: "ready", rotationCount: 0, mirrorCount: 1 }),
    ).toBe("mirror");
  });

  it("refuses on a read that could not answer, however many mirrors are held", () => {
    // THE DEFECT: a degraded read left the list empty, the owner was classified
    // mirror-only, the single-cover DELETE cleared `profiles.cover_*` alone,
    // every rotation row survived and the editor still reported success.
    for (const mirrorCount of [0, 1]) {
      expect(
        profileCoverRemoveLane({ status: "degraded", rotationCount: 0, mirrorCount }),
      ).toBe("unavailable");
    }
    expect(
      profileCoverRemoveLane({ status: "degraded", rotationCount: 2, mirrorCount: 1 }),
    ).toBe("unavailable");
  });

  it("has nothing to remove when a read answered and nothing is held", () => {
    expect(
      profileCoverRemoveLane({ status: "ready", rotationCount: 0, mirrorCount: 0 }),
    ).toBe("none");
  });

  it("says nothing was removed rather than claiming a removal", () => {
    const line = profileCoverRemoveUnavailableLine();
    expect(line).toMatch(/could not read/i);
    expect(line).toMatch(/nothing was removed/i);
    expect(line).not.toContain("—");
    expect(line).not.toContain("!");
  });
});

describe("order", () => {
  const row = (id: string, position: number, createdAt = "2026-08-01T00:00:00.000Z") => ({
    id,
    position,
    createdAt,
  });

  it("sorts on position, then arrival, then id", () => {
    const sorted = [row("c", 2), row("a", 1), row("b", 1, "2026-07-01T00:00:00.000Z")]
      .sort(byCoverPosition)
      .map((r) => r.id);
    expect(sorted).toEqual(["b", "a", "c"]);
  });

  it("moves one place up and one place down", () => {
    expect(moveCoverPosition(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveCoverPosition(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
  });

  // The button is disabled at the ends; a request that arrives anyway asked for
  // the order it already has, which is not an error.
  it("returns the same order at either end, and for an id it does not hold", () => {
    expect(moveCoverPosition(["a", "b"], "a", "up")).toEqual(["a", "b"]);
    expect(moveCoverPosition(["a", "b"], "b", "down")).toEqual(["a", "b"]);
    expect(moveCoverPosition(["a", "b"], "z", "up")).toEqual(["a", "b"]);
  });

  it("never mutates the list it was handed", () => {
    const original = ["a", "b", "c"];
    moveCoverPosition(original, "a", "down");
    expect(original).toEqual(["a", "b", "c"]);
  });

  it("numbers a settled list from one", () => {
    expect(coverPositionsFor(["a", "b", "c"])).toEqual([
      { id: "a", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 3 },
    ]);
  });

  it("puts a new cover at the back of the rotation", () => {
    expect(nextCoverPosition([])).toBe(1);
    expect(nextCoverPosition([{ position: 1 }, { position: 3 }])).toBe(4);
  });

  it("takes only the two directions it offers", () => {
    expect(isCoverMoveDirection("up")).toBe(true);
    expect(isCoverMoveDirection("down")).toBe(true);
    expect(isCoverMoveDirection("first")).toBe(false);
    expect(isCoverMoveDirection(1)).toBe(false);
  });
});

describe("what a reading surface paints", () => {
  it("uses the rotation when one travelled", () => {
    expect(
      profileCoverUrls({ coverUrl: "/api/cover/p/one", coverUrls: ["/a", "/b"] }),
    ).toEqual(["/a", "/b"]);
  });

  // A surface that only knows the single cover asked a narrower question. It
  // gets the answer it can use, not a blank header.
  it("falls back to the single back-compat cover", () => {
    expect(profileCoverUrls({ coverUrl: "/api/cover/p/one" })).toEqual([
      "/api/cover/p/one",
    ]);
  });

  it("is empty only when there is really no backdrop", () => {
    expect(profileCoverUrls({})).toEqual([]);
    expect(profileCoverUrls(null)).toEqual([]);
    expect(profileCoverUrls({ coverUrls: [] })).toEqual([]);
  });

  it("drops a blank entry rather than rendering an empty frame", () => {
    expect(profileCoverUrls({ coverUrls: ["", "/b"] })).toEqual(["/b"]);
  });
});

describe("when the rotation may run", () => {
  it("rotates only for more than one cover, and only without reduced motion", () => {
    expect(coverCarouselRotates({ count: 3, reducedMotion: false })).toBe(true);
    expect(coverCarouselRotates({ count: 3, reducedMotion: true })).toBe(false);
    expect(coverCarouselRotates({ count: 1, reducedMotion: false })).toBe(false);
    expect(coverCarouselRotates({ count: 0, reducedMotion: false })).toBe(false);
  });

  it("holds each cover for five seconds", () => {
    expect(PROFILE_COVER_ROTATION_MS).toBe(5_000);
  });

  it("wraps round, and never leaves the list on junk input", () => {
    expect(nextCoverIndex(0, 3)).toBe(1);
    expect(nextCoverIndex(2, 3)).toBe(0);
    expect(nextCoverIndex(0, 0)).toBe(0);
    expect(nextCoverIndex(-4, 3)).toBe(0);
  });
});

describe("copy", () => {
  // An empty rotation under a FAILED read may never be worded as a profile that
  // chose no backdrop.
  it("separates an empty rotation from an unread one", () => {
    expect(profileCoverEmptyLine("ready")).toMatch(/no cover photo yet/i);
    expect(profileCoverEmptyLine("degraded")).toMatch(/could not read/i);
    expect(profileCoverEmptyLine("degraded")).not.toMatch(/no cover photo yet/i);
  });

  it("says nothing about a rotation that cannot rotate", () => {
    expect(profileCoverRotationNote(0)).toBeNull();
    expect(profileCoverRotationNote(1)).toBeNull();
  });

  it("names the interval and the reduced-motion answer once there are two", () => {
    const note = profileCoverRotationNote(2)!;
    expect(note).toContain("2");
    expect(note).toContain("5 seconds");
    expect(note).toMatch(/less motion/i);
  });

  it("closes the moderation state set", () => {
    expect(isProfileCoverModerationState("approved")).toBe(true);
    expect(isProfileCoverModerationState("hidden")).toBe(true);
    expect(isProfileCoverModerationState("needs_review")).toBe(true);
    expect(isProfileCoverModerationState("pending")).toBe(false);
  });
});

// The rotation crosses the wire through the ONE shared projection. A second
// copy of the field list is what dropped a founding member's number off an
// image write once already, so the list joins that copy rather than a new one.
describe("the public projection", () => {
  const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
  const GENERATION = "55555555-5555-4555-8555-555555555555";

  const record: ProfileRecord = {
    id: PROFILE_ID,
    handle: "alice",
    userId: "user-alice",
    displayName: "Alice Fennimore",
    foundingMemberNumber: 7,
    coverObjectKey: `covers/${PROFILE_ID}/${GENERATION}/cover.jpg`,
    coverGeneration: GENERATION,
    coverModerationState: "approved",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  it("carries the ordered list beside the single back-compat cover", () => {
    const projected = publicProfileFromRecord(record, {
      coverUrls: ["/api/cover/p/one", "/api/cover/p/two"],
    })!;
    expect(projected.coverUrls).toEqual(["/api/cover/p/one", "/api/cover/p/two"]);
    expect(projected.coverUrl).toBe(profileImageServePath("cover", PROFILE_ID, GENERATION));
    expect(projected.foundingMemberNumber).toBe(7);
  });

  // Absence is "not asked", never "no covers": a caller that did not read the
  // list must not tell the header this profile chose no backdrop.
  it("omits the list entirely when the caller did not read it", () => {
    const projected = publicProfileFromRecord(record)!;
    expect("coverUrls" in projected).toBe(false);
    expect(profileCoverUrls(projected)).toEqual([projected.coverUrl!]);
  });

  it("keeps every internal key out of the projection", () => {
    const projected = publicProfileFromRecord(record, { coverUrls: ["/a"] })!;
    const raw = JSON.stringify(projected);
    expect(raw).not.toContain("covers/");
    expect(raw).not.toContain("coverObjectKey");
    expect(raw).not.toContain("coverModerationState");
    expect(raw).not.toContain("userId");
  });

  it("takes a readonly list and does not hold the caller's array", () => {
    const covers: readonly string[] = ["/a", "/b"];
    const projected = toPublicProfile(record, { coverUrls: covers })!;
    expect(projected.coverUrls).toEqual(["/a", "/b"]);
    expect(projected.coverUrls).not.toBe(covers);
  });
});
