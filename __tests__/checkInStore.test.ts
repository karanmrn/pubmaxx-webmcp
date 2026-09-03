import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedCheckInInput } from "@/lib/checkIn";
import { __resetMemoryCheckIns, checkInStore } from "@/lib/checkInStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

// Keyless env → selectStore returns the in-memory backend (vitest.setup strips
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). This exercises the memory store.

function input(over: Partial<NormalizedCheckInInput> = {}): NormalizedCheckInInput {
  return {
    handle: "karan",
    areaSlug: "shoreditch",
    venueId: null,
    note: null,
    visibility: "friends",
    ...over,
  };
}

beforeEach(() => {
  __resetMemoryCheckIns();
  __resetMemoryProfiles();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkInStore (memory)", () => {
  it("creates a check-in and stamps createdAt + a 12h expiry", async () => {
    const store = checkInStore();
    const created = await store.create(input({ note: "out in Shoreditch" }));
    expect(created.id).toBeTruthy();
    expect(created.handle).toBe("karan");
    expect(created.note).toBe("out in Shoreditch");
    expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.parse(created.createdAt));
  });

  it("lists non-expired check-ins by handle, newest-first", async () => {
    vi.useFakeTimers();
    const store = checkInStore();
    vi.setSystemTime(new Date("2026-07-18T20:00:00.000Z"));
    await store.create(input({ handle: "amy" }));
    vi.setSystemTime(new Date("2026-07-18T20:05:00.000Z"));
    await store.create(input({ handle: "karan" }));
    vi.setSystemTime(new Date("2026-07-18T20:10:00.000Z"));
    const rows = await store.listByHandles(["karan", "amy"]);
    expect(rows).toHaveLength(2);
    // newest first — the karan row was created last.
    expect(rows[0].handle).toBe("karan");
    expect(rows[1].handle).toBe("amy");
  });

  it("returns [] for an empty handle list (no scan)", async () => {
    expect(await checkInStore().listByHandles([])).toEqual([]);
  });

  it("filters by visibility for the area-public read", async () => {
    const store = checkInStore();
    await store.create(input({ handle: "karan", visibility: "friends" }));
    await store.create(input({ handle: "amy", visibility: "area" }));
    const areaRows = await store.listByVisibility("area");
    expect(areaRows.map((r) => r.handle)).toEqual(["amy"]);
    const friendRows = await store.listByVisibility("friends");
    expect(friendRows.map((r) => r.handle)).toEqual(["karan"]);
  });

  it("excludes rows past their 12h expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T20:00:00.000Z"));
    const store = checkInStore();
    await store.create(input({ handle: "karan" }));
    // 13h later — the row has expired.
    vi.setSystemTime(new Date("2026-07-19T09:00:00.000Z"));
    expect(await store.listByHandles(["karan"])).toEqual([]);
  });

  it("round-trips a no-area check-in as areaSlug: null (the beacon shape)", async () => {
    const store = checkInStore();
    const created = await store.create(input({ handle: "karan", areaSlug: null, note: null }));
    expect(created.areaSlug).toBeNull();
    const [row] = await store.listByHandles(["karan"]);
    expect(row.areaSlug).toBeNull();
  });

  it("deleteForHandle removes every check-in a handle authored (cascade helper)", async () => {
    const store = checkInStore();
    await store.create(input({ handle: "karan" }));
    await store.create(input({ handle: "karan" }));
    await store.create(input({ handle: "amy" }));
    await store.deleteForHandle("karan");
    expect(await store.listByHandles(["karan"])).toEqual([]);
    expect(await store.listByHandles(["amy"])).toHaveLength(1);
  });
});
