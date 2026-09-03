import { beforeEach, describe, expect, it } from "vitest";

import { getVenueIndex } from "@/lib/venueIndex";
import {
  __resetMemorySavedPubs,
  isListType,
  memorySavedPubsStore,
  savedPubsStore,
  type ListType,
} from "@/lib/savedPubsStore";
import { isBuiltInListType } from "@/lib/savedListPolicy";

// FORCE the in-memory path. On Vercel, vitest runs with the project's env set —
// if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present, savedPubsStore() would
// select the Supabase store and every case here would hit the network (and fail
// only in CI). Clearing them in beforeEach pins the store to memory everywhere,
// which is exactly what these unit cases exercise. Also reset the memory
// partitions so cases don't leak state into each other.
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemorySavedPubs();
});

// A real venue id from the bundled dataset, so the DTO enrichment resolves a real
// pub NAME (not the friendly fallback). Resolved lazily inside the case.
async function aRealVenue(): Promise<{ id: string; name: string }> {
  const index = await getVenueIndex();
  const first = [...index.values()][0];
  if (!first) throw new Error("venue index is empty — dataset missing?");
  return { id: first.id, name: first.name };
}

describe("savedPubsStore() — seam selection", () => {
  it("selects the in-memory store when Supabase env is absent", () => {
    expect(savedPubsStore()).toBe(memorySavedPubsStore);
  });

  it("readSaved names a successful empty list as ready", async () => {
    expect(await memorySavedPubsStore.readSaved({ handle: "nobody" })).toEqual({
      status: "ready",
      rows: [],
    });
  });

  it("reads saved pubs for several handles in one keyed result", async () => {
    const { id } = await aRealVenue();
    await memorySavedPubsStore.toggleSaved({
      handle: "alice",
      venueId: id,
      listType: "Historic",
    });

    const result = await memorySavedPubsStore.readSavedByHandles({
      handles: ["ALICE", "bob", "nobody"],
    });

    expect([...result.keys()]).toEqual(["alice", "bob", "nobody"]);
    expect(result.get("alice")).toMatchObject({
      status: "ready",
      rows: [{ venueId: id, listType: "Historic" }],
    });
    expect(result.get("bob")).toEqual({ status: "ready", rows: [] });
    expect(result.get("nobody")).toEqual({ status: "ready", rows: [] });
  });
});

const BUILT_INS = [
  "Want to Visit",
  "Cheap Pint",
  "Coding Pint",
  "Historic",
  "Date Night",
  "Crawl Stop",
  "Local Legend",
];

describe("isBuiltInListType — strict built-in allowlist", () => {
  it("accepts every canonical built-in list type", () => {
    for (const t of BUILT_INS) expect(isBuiltInListType(t)).toBe(true);
  });

  it("rejects custom / malformed values (built-ins only)", () => {
    expect(isBuiltInListType("Nonsense")).toBe(false);
    expect(isBuiltInListType("want to visit")).toBe(false); // case-sensitive
    expect(isBuiltInListType("")).toBe(false);
    expect(isBuiltInListType(null)).toBe(false);
    expect(isBuiltInListType(42)).toBe(false);
    expect(isBuiltInListType(undefined)).toBe(false);
  });
});

describe("isListType — write gate (built-in OR custom, story 33)", () => {
  it("accepts every built-in", () => {
    for (const t of BUILT_INS) expect(isListType(t)).toBe(true);
  });

  it("accepts a CUSTOM non-empty name (custom lists are allowed now)", () => {
    expect(isListType("My Secret Boozers")).toBe(true);
    expect(isListType("weekend spots")).toBe(true);
  });

  it("rejects only what cleans down to empty / non-string", () => {
    expect(isListType("")).toBe(false);
    expect(isListType("   ")).toBe(false);
    expect(isListType("<>")).toBe(false); // strips to empty
    expect(isListType(null)).toBe(false);
    expect(isListType(42)).toBe(false);
    expect(isListType(undefined)).toBe(false);
  });
});

describe("memory store — round-trip (add → list → remove)", () => {
  it("adds a save, lists it, then a second toggle removes it", async () => {
    const store = savedPubsStore();
    const { id } = await aRealVenue();
    const listType: ListType = "Want to Visit";

    // add
    const afterAdd = await store.toggleSaved({ handle: "ken", venueId: id, listType });
    expect(afterAdd).toHaveLength(1);
    expect(afterAdd[0].venueId).toBe(id);
    expect(afterAdd[0].listType).toBe(listType);

    // list reads it back
    const listed = await store.listSaved({ handle: "ken" });
    expect(listed).toHaveLength(1);
    expect(listed[0].venueId).toBe(id);

    // toggle again removes it
    const afterRemove = await store.toggleSaved({ handle: "ken", venueId: id, listType });
    expect(afterRemove).toHaveLength(0);
    expect(await store.listSaved({ handle: "ken" })).toHaveLength(0);
  });

  it("keeps a note through the round-trip (cleaned)", async () => {
    const store = savedPubsStore();
    const { id } = await aRealVenue();
    const saved = await store.toggleSaved({
      handle: "ken",
      venueId: id,
      listType: "Historic",
      note: "  best\tpint\nround\there  ",
    });
    // Control chars (tab/newline) → spaces, whitespace collapsed, trimmed.
    expect(saved[0].note).toBe("best pint round here");
  });

  it("strips angle brackets from a note (no inline HTML stored)", async () => {
    const store = savedPubsStore();
    const { id } = await aRealVenue();
    const saved = await store.toggleSaved({
      handle: "ken",
      venueId: id,
      listType: "Historic",
      note: "great <script>alert(1)</script> boozer",
    });
    // Only the angle brackets are removed (mirrors lib/pintDrops clean()); the
    // point is no `<` / `>` survive to be interpreted as markup downstream.
    expect(saved[0].note).not.toContain("<");
    expect(saved[0].note).not.toContain(">");
  });
});

describe("uniqueness on (owner, venue, list)", () => {
  it("re-saving the same (venue,list) toggles off, not duplicates", async () => {
    const store = savedPubsStore();
    const { id } = await aRealVenue();
    await store.toggleSaved({ handle: "ken", venueId: id, listType: "Cheap Pint" });
    const after = await store.toggleSaved({ handle: "ken", venueId: id, listType: "Cheap Pint" });
    expect(after).toHaveLength(0); // toggled back off, never two rows
  });

  it("allows the same venue under different lists", async () => {
    const store = savedPubsStore();
    const { id } = await aRealVenue();
    await store.toggleSaved({ handle: "ken", venueId: id, listType: "Want to Visit" });
    const after = await store.toggleSaved({ handle: "ken", venueId: id, listType: "Cheap Pint" });
    expect(after).toHaveLength(2);
    expect(new Set(after.map((s) => s.listType))).toEqual(new Set(["Want to Visit", "Cheap Pint"]));
  });

  it("partitions saves by owner — one handle can't see another's", async () => {
    const store = savedPubsStore();
    const { id } = await aRealVenue();
    await store.toggleSaved({ handle: "ken", venueId: id, listType: "Historic" });
    expect(await store.listSaved({ handle: "ken" })).toHaveLength(1);
    expect(await store.listSaved({ handle: "someone_else" })).toHaveLength(0);
  });
});

describe("DTO enrichment — venue name, not raw id", () => {
  it("carries the resolved venue NAME + map url for a known venue", async () => {
    const store = savedPubsStore();
    const { id, name } = await aRealVenue();
    const [dto] = await store.toggleSaved({ handle: "ken", venueId: id, listType: "Date Night" });
    expect(dto.venueName).toBe(name);
    expect(dto.venueName).not.toMatch(/^venue-/); // never the raw id as a label
    expect(dto.venueMapUrl).toBe(`/map?sel=${encodeURIComponent(id)}`);
  });

  it("carries city-scoped map urls for known non-London venues", async () => {
    const store = savedPubsStore();
    const [dto] = await store.toggleSaved({
      handle: "ken",
      venueId: "venue-oxf-16404bl",
      listType: "Historic",
    });

    expect(dto.venueName).toBe("Turf Tavern");
    expect(dto.venueMapUrl).toBe("/map/oxford?sel=venue-oxf-16404bl");
  });

  it("falls back to a friendly label (never the raw id) for an unknown venue", async () => {
    const store = savedPubsStore();
    const [dto] = await store.toggleSaved({
      handle: "ken",
      venueId: "venue-does-not-exist",
      listType: "Local Legend",
    });
    expect(dto.venueName).toBe("A London venue");
    expect(dto.venueName).not.toBe("venue-does-not-exist");
    // The map link still resolves to the id so "open on the map" works.
    expect(dto.venueMapUrl).toBe("/map?sel=venue-does-not-exist");
  });
});
