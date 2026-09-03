import { describe, expect, it } from "vitest";

import {
  applyFeedFilter,
  cursorOf,
  FEED_FILTERS,
  filterFeedItemsToPermittedIds,
  normalizePintDrop,
  paginate,
  type FeedItem,
  type PintDropDTO,
} from "@/lib/feed";

// A minimal valid public DTO; overrides let each test vary one field.
function dto(overrides: Partial<PintDropDTO> = {}): PintDropDTO {
  return {
    id: "d1",
    handle: "old_ken",
    priceGbp: 4.5,
    drink: "Guinness",
    passedDownNote: "My grandad drank here in the 70s.",
    era: "1970s",
    provenance: "contributor",
    venueId: "venue-abc",
    createdAt: "2026-07-05T20:00:00.000Z",
    vibeTags: ["cheap", "old local"],
    pintPhotoUrl: "https://cdn.example/pint.jpg",
    venuePhotoUrl: "https://cdn.example/venue.jpg",
    ...overrides,
  };
}

// Build a normalized FeedItem directly for filter/paginate tests.
function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    type: "pint_drop",
    id: "x",
    createdAt: "2026-07-05T20:00:00.000Z",
    handle: "h",
    venueId: "v",
    venueName: "The Test Tavern",
    venueMapUrl: "/map?sel=v",
    photoUrls: [],
    caption: "",
    priceGbp: null,
    vibeTags: [],
    provenance: "contributor",
    drink: "",
    era: "",
    ...overrides,
  };
}

describe("normalizePintDrop", () => {
  it("maps every documented field onto the normalized shape", () => {
    const feedItem = normalizePintDrop(dto());
    expect(feedItem.type).toBe("pint_drop");
    expect(feedItem.id).toBe("d1");
    expect(feedItem.handle).toBe("old_ken");
    expect(feedItem.venueId).toBe("venue-abc");
    expect(feedItem.priceGbp).toBe(4.5);
    expect(feedItem.caption).toBe("My grandad drank here in the 70s.");
    expect(feedItem.vibeTags).toEqual(["cheap", "old local"]);
    expect(feedItem.provenance).toBe("contributor");
    expect(feedItem.era).toBe("1970s");
    expect(feedItem.createdAt).toBe("2026-07-05T20:00:00.000Z");
  });

  it("collects non-null photo URLs, pint before venue", () => {
    expect(normalizePintDrop(dto()).photoUrls).toEqual([
      "https://cdn.example/pint.jpg",
      "https://cdn.example/venue.jpg",
    ]);
  });

  it("drops null/empty photo URLs and yields an empty array when text-only", () => {
    expect(
      normalizePintDrop(dto({ pintPhotoUrl: null, venuePhotoUrl: "" })).photoUrls,
    ).toEqual([]);
    expect(
      normalizePintDrop(dto({ pintPhotoUrl: null, venuePhotoUrl: "https://x/v.jpg" }))
        .photoUrls,
    ).toEqual(["https://x/v.jpg"]);
  });

  it("coerces a missing vibeTags/priceGbp to safe defaults", () => {
    const feedItem = normalizePintDrop(
      dto({ vibeTags: undefined, priceGbp: null }),
    );
    expect(feedItem.vibeTags).toEqual([]);
    expect(feedItem.priceGbp).toBeNull();
  });

  it("uses the server-resolved venueName + venueMapUrl when present", () => {
    const feedItem = normalizePintDrop(
      dto({ venueName: "The Blind Beggar", venueMapUrl: "/map?sel=venue-abc" }),
    );
    expect(feedItem.venueName).toBe("The Blind Beggar");
    expect(feedItem.venueMapUrl).toBe("/map?sel=venue-abc");
  });

  it("never surfaces a raw venue id: falls back to a friendly label + map link", () => {
    const feedItem = normalizePintDrop(
      dto({ venueId: "venue-1ufn31x", venueName: undefined, venueMapUrl: undefined }),
    );
    // The friendly fallback, never the raw id.
    expect(feedItem.venueName).toBe("A London pub");
    expect(feedItem.venueName).not.toContain("venue-");
    // A usable map link is still reconstructed from the id.
    expect(feedItem.venueMapUrl).toBe("/map?sel=venue-1ufn31x");
  });

  it("reconstructs city-scoped map links for prefixed venue ids", () => {
    const feedItem = normalizePintDrop(
      dto({ venueId: "venue-oxf-16404bl", venueName: undefined, venueMapUrl: undefined }),
    );

    expect(feedItem.venueMapUrl).toBe("/map/oxford?sel=venue-oxf-16404bl");
  });

  it("treats a blank venueName as unresolved and uses the fallback", () => {
    const feedItem = normalizePintDrop(dto({ venueName: "   " }));
    expect(feedItem.venueName).toBe("A London pub");
  });

  it("preserves optimistic posting metadata for honest pending Spill cards", () => {
    const incoming = {
      ...dto({
        id: "optimistic-1",
        pintPhotoUrl: "blob:http://localhost/pint-preview",
        venuePhotoUrl: null,
      }),
      optimistic: {
        state: "uploading" as const,
        message: "Posting Spill — uploading photo",
        uploadProgress: 0,
        canRetry: false,
        clientRequestId: "client-1",
      },
    };

    const feedItem = normalizePintDrop(incoming);

    expect((feedItem as { optimistic?: unknown }).optimistic).toEqual({
      state: "uploading",
      message: "Posting Spill — uploading photo",
      uploadProgress: 0,
      canRetry: false,
      clientRequestId: "client-1",
    });
    expect(feedItem.photoUrls).toEqual(["blob:http://localhost/pint-preview"]);
  });
});

describe("paginate", () => {
  const items: FeedItem[] = Array.from({ length: 25 }, (_, i) =>
    item({ id: `i${i}`, createdAt: `2026-07-05T20:00:${String(i).padStart(2, "0")}.000Z` }),
  );

  it("returns the first `limit` and a nextCursor of the last item", () => {
    const page = paginate(items, undefined, 10);
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBe(cursorOf(items[9]));
  });

  it("continues from a cursor with no overlap across pages", () => {
    const first = paginate(items, undefined, 10);
    const second = paginate(items, first.nextCursor, 10);
    const firstIds = new Set(first.items.map((i) => i.id));
    for (const it of second.items) {
      expect(firstIds.has(it.id)).toBe(false);
    }
    expect(second.items[0].id).toBe(items[10].id);
  });

  it("returns a null nextCursor on the final page", () => {
    const last = paginate(items, cursorOf(items[19]), 10);
    expect(last.items).toHaveLength(5);
    expect(last.nextCursor).toBeNull();
  });

  it("empty input → empty page and null cursor", () => {
    expect(paginate([], undefined, 12)).toEqual({ items: [], nextCursor: null });
  });

  it("falls back to the first page for an unknown cursor", () => {
    const page = paginate(items, "bogus|cursor", 5);
    expect(page.items[0].id).toBe(items[0].id);
  });
});

describe("applyFeedFilter", () => {
  it("cheap keeps only priced <= £5.50, sorted ascending", () => {
    const items = [
      item({ id: "a", priceGbp: 5.5 }),
      item({ id: "b", priceGbp: 8 }),
      item({ id: "c", priceGbp: 3.2 }),
      item({ id: "d", priceGbp: null }),
      item({ id: "e", priceGbp: 4.9 }),
    ];
    const cheap = applyFeedFilter(items, "cheap");
    expect(cheap.map((i) => i.id)).toEqual(["c", "e", "a"]);
    expect(cheap.every((i) => (i.priceGbp as number) <= 5.5)).toBe(true);
  });

  it("tonight keeps only drops from the last 24h", () => {
    const now = Date.now();
    const items = [
      item({ id: "fresh", createdAt: new Date(now - 60_000).toISOString() }),
      item({ id: "stale", createdAt: new Date(now - 48 * 3600_000).toISOString() }),
    ];
    expect(applyFeedFilter(items, "tonight").map((i) => i.id)).toEqual(["fresh"]);
  });

  it("golden-days keeps drops with an era or anecdote provenance", () => {
    const items = [
      item({ id: "memory", era: "1980s", provenance: "contributor" }),
      item({ id: "tale", era: "", provenance: "anecdote" }),
      item({ id: "plain", era: "", provenance: "contributor" }),
    ];
    expect(applyFeedFilter(items, "golden-days").map((i) => i.id).sort()).toEqual([
      "memory",
      "tale",
    ]);
  });

  it("demo lanes (nearby/crawls) still pass through but are hidden from FEED_FILTERS chips (Wave I1)", () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    for (const f of ["nearby", "crawls"] as const) {
      expect(applyFeedFilter(items, f).map((i) => i.id)).toEqual(["a", "b"]);
    }
    expect(FEED_FILTERS.some((f) => f.id === "nearby" || f.id === "crawls")).toBe(false);
    // `friends` is no longer a chip either (spec #393): the Social Loop's "Your
    // lot" tab owns the friends lane, so a duplicate "Friends" chip was retired.
    // The applyFeedFilter("friends", …) branch stays (the tab composes over it),
    // exercised by the `friends` describe block below.
    expect(FEED_FILTERS.some((f) => f.id === "friends")).toBe(false);
    expect(FEED_FILTERS.map((f) => f.id)).toEqual([
      "latest",
      "for-you",
      "tonight",
      "cheap",
      "golden-days",
    ]);
  });

  it("chip labels stay within the 390px strip budget (judge-w2 polish 2)", () => {
    // "Cheap Legends" clipped mid-word at the 390px viewport edge; the strip
    // fits its four primary chips whole only while every label stays at or
    // under the longest that fits ("Cheap pints", 11 chars). A longer label
    // reintroduces the mid-word cut, so the budget is pinned as a contract —
    // shorten the label (house register says the thing plainly), don't widen it.
    const budget = "Cheap pints".length;
    for (const f of FEED_FILTERS) {
      expect(f.label.length).toBeLessThanOrEqual(budget);
    }
  });

  it("empty input stays empty for every filter", () => {
    for (const f of ["tonight", "cheap", "golden-days", "friends"] as const) {
      expect(applyFeedFilter([], f)).toEqual([]);
    }
  });

  describe("friends", () => {
    it("keeps only drops from followed handles, newest-first", () => {
      const items = [
        item({ id: "old-friend", handle: "mabel", createdAt: "2026-07-05T18:00:00.000Z" }),
        item({ id: "stranger", handle: "randolph", createdAt: "2026-07-05T22:00:00.000Z" }),
        item({ id: "new-friend", handle: "gus", createdAt: "2026-07-05T21:00:00.000Z" }),
      ];
      const following = new Set(["mabel", "gus"]);
      const result = applyFeedFilter(items, "friends", { followingHandles: following });
      // Only followed handles survive, newest-first (gus 21:00 before mabel 18:00).
      expect(result.map((i) => i.id)).toEqual(["new-friend", "old-friend"]);
    });

    it("normalizes item handles before matching the follow set", () => {
      const items = [
        item({ id: "mixed", handle: "@Mabel" }),
        item({ id: "clean", handle: "gus" }),
      ];
      // The set holds normalized handles; a "@Mabel" drop still matches "mabel".
      const result = applyFeedFilter(items, "friends", {
        followingHandles: new Set(["mabel"]),
      });
      expect(result.map((i) => i.id)).toEqual(["mixed"]);
    });

    it("returns [] when the following set is empty (drives the follow prompt)", () => {
      const items = [item({ id: "a", handle: "mabel" }), item({ id: "b", handle: "gus" })];
      expect(applyFeedFilter(items, "friends", { followingHandles: new Set() })).toEqual([]);
    });

    it("returns [] with no ctx / no following set (viewer anonymous)", () => {
      const items = [item({ id: "a", handle: "mabel" })];
      expect(applyFeedFilter(items, "friends")).toEqual([]);
      expect(applyFeedFilter(items, "friends", {})).toEqual([]);
    });
  });

  describe("for-you", () => {
    const NOW = Date.parse("2026-07-06T20:00:00.000Z");

    it("re-orders the SAME set (no drops removed) by recency×quality", () => {
      const rich = item({
        id: "rich",
        photoUrls: ["p.jpg"],
        caption: "My grandad drank here every Friday for forty years.",
        createdAt: new Date(NOW).toISOString(),
      });
      const thin = item({ id: "thin", createdAt: new Date(NOW).toISOString() });
      const result = applyFeedFilter([thin, rich], "for-you", { forYou: { now: NOW } });
      // Same length (nothing filtered out), just re-ranked (rich first).
      expect(result).toHaveLength(2);
      expect(result.map((i) => i.id)).toEqual(["rich", "thin"]);
    });

    it("with no forYou context still ranks (recency-only, never empty)", () => {
      const items = [item({ id: "a" }), item({ id: "b" })];
      expect(applyFeedFilter(items, "for-you")).toHaveLength(2);
    });

    it("is deterministic for a fixed now", () => {
      const items = [
        item({ id: "a", createdAt: new Date(NOW - 3_600_000).toISOString() }),
        item({ id: "b", photoUrls: ["p.jpg"], createdAt: new Date(NOW - 7_200_000).toISOString() }),
      ];
      const first = applyFeedFilter(items, "for-you", { forYou: { now: NOW } }).map((i) => i.id);
      const second = applyFeedFilter(items, "for-you", { forYou: { now: NOW } }).map((i) => i.id);
      expect(first).toEqual(second);
    });

    it("Wave G4: falls back to ctx.followingHandles for friends boost", () => {
      const friend = item({
        id: "friend",
        handle: "mabel",
        createdAt: new Date(NOW).toISOString(),
      });
      const stranger = item({
        id: "stranger",
        handle: "ken",
        createdAt: new Date(NOW).toISOString(),
      });
      // Same follow set as Friends — For You reorders, does not filter.
      const result = applyFeedFilter([stranger, friend], "for-you", {
        followingHandles: new Set(["mabel"]),
        forYou: { now: NOW },
      });
      expect(result.map((i) => i.id)).toEqual(["friend", "stranger"]);
      expect(result).toHaveLength(2);
    });
  });

  it("the optional ctx never affects non-friends filters", () => {
    const items = [
      item({ id: "cheap-a", handle: "mabel", priceGbp: 4 }),
      item({ id: "dear-b", handle: "gus", priceGbp: 9 }),
    ];
    const ctx = { followingHandles: new Set(["mabel"]) };
    // A following set is ignored by cheap/tonight/golden-days/latest — For You
    // (Wave G4) may use it for a boost, but these lanes must stay unchanged.
    expect(applyFeedFilter(items, "cheap", ctx).map((i) => i.id)).toEqual(
      applyFeedFilter(items, "cheap").map((i) => i.id),
    );
    expect(applyFeedFilter(items, "latest", ctx).map((i) => i.id)).toEqual(
      applyFeedFilter(items, "latest").map((i) => i.id),
    );
    expect(applyFeedFilter(items, "tonight", ctx).map((i) => i.id)).toEqual(
      applyFeedFilter(items, "tonight").map((i) => i.id),
    );
  });
});

describe("filterFeedItemsToPermittedIds (defensive visibility gate)", () => {
  it("keeps only items whose ids survived the server gate", () => {
    const items = [
      item({ id: "visible-1" }),
      item({ id: "gated-1" }),
      item({ id: "visible-2" }),
    ];
    const kept = filterFeedItemsToPermittedIds(items, new Set(["visible-1", "visible-2"]));
    expect(kept.map((i) => i.id)).toEqual(["visible-1", "visible-2"]);
  });

  it("returns [] when the permitted set is empty", () => {
    expect(filterFeedItemsToPermittedIds([item({ id: "x" })], new Set())).toEqual([]);
  });
});
