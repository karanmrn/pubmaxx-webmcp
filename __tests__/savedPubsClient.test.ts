import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchFollowedListsForHandle } from "@/lib/savedPubs";
import {
  eligibleBuiltInListTypes,
  isListTypeEligibleForVenue,
} from "@/lib/savedListPolicy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchFollowedListsForHandle", () => {
  it("normalizes followed-list author handles and regenerates canonical links", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        followedLists: [
          {
            ownerHandle: "@@Sam Pub!",
            ownerProfileUrl: "/u/@@Sam%20Pub!",
            listType: "Date Night",
            listUrl: "/u/@@Sam%20Pub!/lists/Date%20Night",
            savedCount: 2,
            followerCount: 5,
            followedAt: "2026-07-07T12:00:00.000Z",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFollowedListsForHandle("@Ken")).resolves.toEqual([
      {
        ownerHandle: "sampub",
        ownerProfileUrl: "/u/sampub",
        listType: "Date Night",
        listUrl: "/u/sampub/lists/Date%20Night",
        savedCount: 2,
        followerCount: 5,
        followedAt: "2026-07-07T12:00:00.000Z",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/saved-pubs/list-follows?follower=%40Ken",
      { signal: undefined },
    );
  });

  it("cleans followed-list names before rendering or regenerating links", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        followedLists: [
          {
            ownerHandle: "Sam",
            listType: "  <b>Date\u0000Night</b>  ",
            savedCount: 1,
            followerCount: 2,
            followedAt: "2026-07-07T12:00:00.000Z",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFollowedListsForHandle("Ken")).resolves.toEqual([
      {
        ownerHandle: "sam",
        ownerProfileUrl: "/u/sam",
        listType: "bDate Night/b",
        listUrl: "/u/sam/lists/bDate%20Night%2Fb",
        savedCount: 1,
        followerCount: 2,
        followedAt: "2026-07-07T12:00:00.000Z",
      },
    ]);
  });
});

describe("saved-list venue-kind policy", () => {
  it("keeps pint-specific built-ins for backward-compatible pubs", () => {
    expect(eligibleBuiltInListTypes(undefined)).toEqual([
      "Want to Visit",
      "Cheap Pint",
      "Coding Pint",
      "Historic",
      "Date Night",
      "Crawl Stop",
      "Local Legend",
    ]);
    expect(eligibleBuiltInListTypes("pub")).toEqual([
      "Want to Visit",
      "Cheap Pint",
      "Coding Pint",
      "Historic",
      "Date Night",
      "Crawl Stop",
      "Local Legend",
    ]);
  });

  it("removes pint-specific built-ins from bar and late-food pickers", () => {
    const expected = [
      "Want to Visit",
      "Historic",
      "Date Night",
      "Crawl Stop",
      "Local Legend",
    ];

    expect(eligibleBuiltInListTypes("bar")).toEqual(expected);
    expect(eligibleBuiltInListTypes("food")).toEqual(expected);
  });

  it("still allows arbitrary custom list names for non-pubs", () => {
    expect(isListTypeEligibleForVenue("Cheap Pint", "food")).toBe(false);
    expect(isListTypeEligibleForVenue("Coding Pint", "bar")).toBe(false);
    expect(isListTypeEligibleForVenue("Post-gig cocktails", "bar")).toBe(true);
    expect(isListTypeEligibleForVenue("Late-night food", "food")).toBe(true);
  });
});
