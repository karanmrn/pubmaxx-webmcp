// Both follow edges, one word. The defect this pins is a surface that knows
// only its own edge: "Following" and "Mates" then look identical, and "Follows
// you" - the one state where a single tap forms a lot - is invisible.

import { describe, expect, it } from "vitest";

import {
  FOLLOW_RELATIONS,
  followActionDescription,
  followActionLabel,
  followPendingLabel,
  followRelationHint,
  isFollowRelation,
  isMutual,
  resolveFollowRelation,
} from "@/lib/followRelation";

describe("follow relation", () => {
  it("names every combination of the two edges", () => {
    expect(
      resolveFollowRelation({ viewerFollowing: false, followsViewer: false }),
    ).toBe("none");
    expect(
      resolveFollowRelation({ viewerFollowing: true, followsViewer: false }),
    ).toBe("following");
    expect(
      resolveFollowRelation({ viewerFollowing: false, followsViewer: true }),
    ).toBe("follows_you");
    expect(
      resolveFollowRelation({ viewerFollowing: true, followsViewer: true }),
    ).toBe("mates");
  });

  it("calls only the two-sided edge a lot", () => {
    expect(isMutual("mates")).toBe(true);
    for (const relation of FOLLOW_RELATIONS) {
      if (relation === "mates") continue;
      expect(isMutual(relation)).toBe(false);
    }
  });

  it("keeps the relation set closed", () => {
    for (const relation of FOLLOW_RELATIONS) expect(isFollowRelation(relation)).toBe(true);
    expect(isFollowRelation("friend")).toBe(false);
    expect(isFollowRelation(null)).toBe(false);
  });

  it("gives every relation its own word, so two states never read alike", () => {
    const labels = FOLLOW_RELATIONS.map(followActionLabel);
    expect(new Set(labels).size).toBe(FOLLOW_RELATIONS.length);
    expect(followActionLabel("mates")).toBe("Mates");
    expect(followActionLabel("follows_you")).toBe("Follow back");
  });

  it("says the edge the button cannot, and stays quiet when there is none", () => {
    expect(followRelationHint("follows_you")).toBe("Follows you");
    expect(followRelationHint("mates")).toBe("You follow each other");
    expect(followRelationHint("following")).toMatch(/not followed back/);
    expect(followRelationHint("none")).toBeNull();
  });

  it("describes what the tap DOES, not what the state is", () => {
    expect(followActionDescription("mates", "sam")).toMatch(/no longer be mates/);
    expect(followActionDescription("follows_you", "sam")).toMatch(/become mates/);
    expect(followActionDescription("none", "sam")).toBe("Follow @sam.");
    // The accessible name must never just repeat the button word.
    for (const relation of FOLLOW_RELATIONS) {
      expect(followActionDescription(relation, "sam")).not.toBe(
        followActionLabel(relation),
      );
    }
  });

  it("reads a pending tap in the direction it is going", () => {
    expect(followPendingLabel("none")).toBe("Adding…");
    expect(followPendingLabel("follows_you")).toBe("Adding…");
    expect(followPendingLabel("following")).toBe("Removing…");
    expect(followPendingLabel("mates")).toBe("Removing…");
  });
});
