import { describe, expect, it } from "vitest";

import { ANON_HANDLE_LABEL } from "@/lib/pintDrops";
import { buildBarTab, normalizePintDrop, type FeedItem, type PintDropDTO } from "@/lib/feed";

// A minimal public DTO (the shape listVisible returns), overridable per-test.
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
    vibeTags: [],
    pintPhotoUrl: "https://cdn.example/pint.jpg",
    venuePhotoUrl: null,
    ...overrides,
  };
}

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    type: "pint_drop",
    id: "x",
    createdAt: "2026-07-05T20:00:00.000Z",
    handle: "h",
    venueId: "venue-abc",
    venueName: "The Test Tavern",
    venueMapUrl: "/map?sel=venue-abc",
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

describe("buildBarTab", () => {
  it("composes photo tiles for drops with a photo and receipt tiles for text-only", () => {
    const tab = buildBarTab([
      item({ id: "photo", photoUrls: ["p.jpg"] }),
      item({ id: "text", photoUrls: [] }),
    ]);
    expect(tab.tileCount).toBe(2);
    expect(tab.photoCount).toBe(1);
    const byId = Object.fromEntries(tab.tiles.map((t) => [t.id, t]));
    expect(byId.photo.kind).toBe("photo");
    expect(byId.photo.photoUrl).toBe("p.jpg");
    expect(byId.text.kind).toBe("receipt");
    expect(byId.text.photoUrl).toBeNull();
  });

  it("orders tiles newest-first regardless of input order", () => {
    const tab = buildBarTab([
      item({ id: "old", createdAt: "2026-07-01T10:00:00.000Z" }),
      item({ id: "new", createdAt: "2026-07-05T10:00:00.000Z" }),
      item({ id: "mid", createdAt: "2026-07-03T10:00:00.000Z" }),
    ]);
    expect(tab.tiles.map((t) => t.id)).toEqual(["new", "mid", "old"]);
  });

  it("surfaces the cheapest visible price for the header stamp", () => {
    const tab = buildBarTab([
      item({ id: "a", priceGbp: 6.2 }),
      item({ id: "b", priceGbp: 4.1 }),
      item({ id: "c", priceGbp: null }),
    ]);
    expect(tab.cheapestGbp).toBe(4.1);
  });

  it("ignores non-positive / non-finite prices when finding the cheapest", () => {
    const tab = buildBarTab([
      item({ id: "a", priceGbp: 0 }),
      item({ id: "b", priceGbp: 5 }),
    ]);
    expect(tab.cheapestGbp).toBe(5);
  });

  it("null cheapest when no visible drop carries a price", () => {
    const tab = buildBarTab([item({ id: "a", priceGbp: null })]);
    expect(tab.cheapestGbp).toBeNull();
  });

  it("empty input → an empty tab (drives the EmptyState)", () => {
    expect(buildBarTab([])).toEqual({
      tileCount: 0,
      photoCount: 0,
      cheapestGbp: null,
      tiles: [],
    });
  });

  it("does not add or drop anything the caller didn't hand it (visibility holds)", () => {
    // The page passes the store's listVisible() output — already visibility
    // filtered (#29). buildBarTab must be a pure re-shape: same count, same ids.
    const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];
    const tab = buildBarTab(items);
    expect(tab.tileCount).toBe(3);
    expect(new Set(tab.tiles.map((t) => t.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("carries the anonymised handle straight through from the DTO (no leak)", () => {
    // An anonymous drop's DTO already carries the safe label (toDTO swaps it
    // server-side). normalizePintDrop → buildBarTab must preserve it verbatim —
    // the real handle is never reconstructed here.
    const anonDto = dto({ id: "anon", handle: ANON_HANDLE_LABEL, pintPhotoUrl: "p.jpg" });
    const tab = buildBarTab([normalizePintDrop(anonDto)]);
    expect(tab.tiles[0].handle).toBe(ANON_HANDLE_LABEL);
    expect(tab.tiles[0].handle).not.toContain("old_ken");
  });
});
