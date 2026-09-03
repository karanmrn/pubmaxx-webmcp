import { describe, expect, it } from "vitest";

import {
  followListHandle,
  followListHandleSet,
  parseFollowListEntry,
} from "@/lib/followList";

describe("followList entry parsing", () => {
  it("accepts a legacy string row", () => {
    expect(parseFollowListEntry("Sam")).toEqual({ handle: "sam" });
    expect(followListHandle("Sam")).toBe("sam");
  });

  it("accepts an enriched object row", () => {
    expect(
      parseFollowListEntry({
        handle: "Sam",
        displayName: "Sam I Am",
        avatarUrl: "/api/avatar/p1/g1",
      }),
    ).toEqual({
      handle: "sam",
      displayName: "Sam I Am",
      avatarUrl: "/api/avatar/p1/g1",
    });
  });

  it("refuses junk rows", () => {
    expect(parseFollowListEntry(null)).toBeNull();
    expect(parseFollowListEntry({})).toBeNull();
    expect(followListHandle({ handle: "   " })).toBe("");
  });
});

describe("followListHandleSet", () => {
  it("holds handles, so a relation lookup on an enriched body answers", () => {
    // THE DEFECT: a caller stuffed the enriched rows straight into a Set, so the
    // set held objects and every `has()` answered false. A person the viewer
    // already follows was then offered a plain Follow button.
    const set = followListHandleSet([
      { handle: "Sam", displayName: "Sam I Am", avatarUrl: "/api/avatar/p1/g1" },
      { handle: "lee" },
    ]);
    expect(set.has("sam")).toBe(true);
    expect(set.has("lee")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("still reads a legacy string body", () => {
    const set = followListHandleSet(["@Sam", "lee"]);
    expect(set.has("sam")).toBe(true);
    expect(set.has("lee")).toBe(true);
  });

  it("drops junk rows rather than holding an empty handle", () => {
    const set = followListHandleSet([null, {}, "   ", { handle: "" }, "sam"]);
    expect([...set]).toEqual(["sam"]);
  });

  it("answers an empty set for a body that is not a list", () => {
    expect(followListHandleSet(undefined).size).toBe(0);
    expect(followListHandleSet({ following: [] }).size).toBe(0);
  });
});
