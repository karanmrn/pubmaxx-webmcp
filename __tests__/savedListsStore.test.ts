import { beforeEach, describe, expect, it } from "vitest";

// Custom saved-lists registry (story 33). FORCE the in-memory path (clear Supabase
// env) so these run offline everywhere, and reset the registry between cases.
import {
  __resetMemorySavedLists,
  cleanListType,
  memorySavedListsStore,
  savedListsStore,
} from "@/lib/savedPubsStore";
import { isBuiltInListType } from "@/lib/savedListPolicy";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemorySavedLists();
});

describe("savedListsStore() — seam selection", () => {
  it("selects the in-memory store when Supabase env is absent", () => {
    expect(savedListsStore()).toBe(memorySavedListsStore);
  });
});

describe("cleanListType — trust boundary", () => {
  it("cleans + caps a custom name, strips inline HTML", () => {
    expect(cleanListType("  weekend   spots ")).toBe("weekend spots");
    expect(cleanListType("great <b>list</b>")).not.toContain("<");
  });
  it("returns empty for blank / non-string", () => {
    expect(cleanListType("   ")).toBe("");
    expect(cleanListType(null)).toBe("");
    expect(cleanListType(42)).toBe("");
  });
});

describe("createList / listCustom", () => {
  it("registers a custom list for a handle and lists it back", async () => {
    const store = savedListsStore();
    const lists = await store.createList("ken", "Sunday Roasts");
    expect(lists).toContain("Sunday Roasts");
    expect(await store.listCustom("ken")).toContain("Sunday Roasts");
  });

  it("is idempotent — re-creating the same name doesn't duplicate", async () => {
    const store = savedListsStore();
    await store.createList("ken", "Sunday Roasts");
    const again = await store.createList("ken", "Sunday Roasts");
    expect(again.filter((n) => n === "Sunday Roasts")).toHaveLength(1);
  });

  it("never registers a BUILT-IN name (it's always offered) — no-op", async () => {
    const store = savedListsStore();
    const lists = await store.createList("ken", "Cheap Pint");
    expect(isBuiltInListType("Cheap Pint")).toBe(true);
    // Custom registry excludes built-ins, so it stays empty.
    expect(lists).toHaveLength(0);
    expect(await store.listCustom("ken")).toHaveLength(0);
  });

  it("ignores a blank list name", async () => {
    const store = savedListsStore();
    expect(await store.createList("ken", "   ")).toHaveLength(0);
  });

  it("partitions custom lists by handle", async () => {
    const store = savedListsStore();
    await store.createList("ken", "Ken's Locals");
    expect(await store.listCustom("ken")).toContain("Ken's Locals");
    expect(await store.listCustom("sam")).toHaveLength(0);
  });
});
