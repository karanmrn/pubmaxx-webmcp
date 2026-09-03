import { beforeEach, describe, expect, it } from "vitest";

import type { NormalizedCheckInInput } from "@/lib/checkIn";
import { __resetMemoryCheckIns, checkInStore } from "@/lib/checkInStore";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";
import { areaPublicCheckIns, visibleCheckInsForViewer } from "@/lib/socialFeed";

// The privacy choke: which check-ins reach which viewer. This is the single
// tested gate that keeps friends-only content out of public queries.

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
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

async function mutualFollow(a: string, b: string): Promise<void> {
  const s = followStore();
  await s.follow(a, b);
  await s.follow(b, a);
}

describe("visibleCheckInsForViewer", () => {
  it("returns a mutual friend's check-in", async () => {
    await mutualFollow("karan", "amy");
    await checkInStore().create(input({ handle: "amy" }));
    const visible = await visibleCheckInsForViewer("karan");
    expect(visible.map((c) => c.handle)).toEqual(["amy"]);
  });

  it("never returns a NON-mutual's check-in (one-way follow is not a friend)", async () => {
    // karan follows ben, but ben does not follow back.
    await followStore().follow("karan", "ben");
    await checkInStore().create(input({ handle: "ben" }));
    const visible = await visibleCheckInsForViewer("karan");
    expect(visible).toEqual([]);
  });

  it("includes the viewer's own check-in", async () => {
    await checkInStore().create(input({ handle: "karan" }));
    const visible = await visibleCheckInsForViewer("karan");
    expect(visible.map((c) => c.handle)).toEqual(["karan"]);
  });

  it("returns [] for an anonymous viewer (no handle)", async () => {
    await checkInStore().create(input({ handle: "karan" }));
    expect(await visibleCheckInsForViewer("")).toEqual([]);
  });

  it("does not leak a stranger's check-in to an unrelated viewer", async () => {
    await checkInStore().create(input({ handle: "stranger" }));
    expect(await visibleCheckInsForViewer("karan")).toEqual([]);
  });
});

describe("areaPublicCheckIns", () => {
  it("returns ONLY 'area'-visibility check-ins — friends-only never leaks", async () => {
    await checkInStore().create(input({ handle: "karan", visibility: "friends" }));
    await checkInStore().create(input({ handle: "amy", visibility: "area" }));
    const rows = await areaPublicCheckIns();
    expect(rows.map((c) => c.handle)).toEqual(["amy"]);
    expect(rows.every((c) => c.visibility === "area")).toBe(true);
  });

  it("is empty when everything is friends-only (the default posture today)", async () => {
    await checkInStore().create(input({ handle: "karan", visibility: "friends" }));
    expect(await areaPublicCheckIns()).toEqual([]);
  });
});
