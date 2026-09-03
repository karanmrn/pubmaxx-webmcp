// The batched public CARD read behind every follow list.
//
// A follower list is public, unauthenticated and unpaginated, so this one store
// method carries two loads no other profile read does.
//
// 1. A DEPARTED ACCOUNT KEEPS ITS ROW. The auth-deletion trigger stamps
//    `tombstoned_at` and nulls the images, but it LEAVES `display_name`
//    (migration 0096). `GET /api/profiles/<h>` already answers `gone` for such a
//    row, so a card reader without the same gate would print a departed
//    person's real name beside their handle to any anonymous caller.
// 2. THE FILTER TRAVELS IN THE REQUEST LINE. Every handle in one `.in(...)`
//    grows the PostgREST URL until the gateway refuses it, and the caller
//    swallows that failure, so a well-followed profile would degrade to bare
//    handles for ever with a wasted round trip each time.
//
// Both are exercised against the real store methods: the Supabase one over a
// fake table that honours `.in` / `.is` / `.not` the way PostgREST does, and the
// memory one over its own map.

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ from: supabase.from, rpc: supabase.rpc }),
}));

import {
  memoryProfileStore,
  supabaseProfileStore,
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  __tombstoneMemoryProfile,
} from "@/lib/profileStore";
import { profileImageServingKey } from "@/lib/profileImageSlots";

const GENERATION = "22222222-2222-2222-8222-222222222222";
/** Mirrors HANDLE_BATCH_CONCURRENCY in lib/profileStore.ts. */
const HANDLE_BATCH_CONCURRENCY = 6;

type Row = Record<string, unknown>;

/** One profiles row as PostgREST would return it. */
function row(handle: string, extra: Row = {}): Row {
  return {
    id: `p-${handle}`,
    handle,
    user_id: `u-${handle}`,
    tombstoned_at: null,
    display_name: `${handle} display`,
    avatar_object_key: null,
    avatar_generation: null,
    avatar_moderation_state: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

/**
 * A fake `profiles` table that applies the filters rather than recording them,
 * so a dropped `.is("tombstoned_at", null)` shows up as a leaked row instead of
 * a missing spy call. Records each request's handle list so batching is visible.
 */
function fakeTable(rows: Row[]) {
  const requests: string[][] = [];
  // Every read is deferred by a real turn of the event loop, so overlapping
  // reads are observable: `peakInFlight` is how many were open at once.
  let inFlight = 0;
  let peakInFlight = 0;
  supabase.from.mockImplementation(() => {
    let matched = [...rows];
    const builder: Record<string, unknown> = {
      select: () => builder,
      in: (column: string, values: string[]) => {
        requests.push(values);
        matched = matched.filter((entry) => values.includes(String(entry[column])));
        return builder;
      },
      is: (column: string, value: null) => {
        matched = matched.filter((entry) => (entry[column] ?? null) === value);
        return builder;
      },
      not: (column: string) => {
        matched = matched.filter((entry) => (entry[column] ?? null) !== null);
        return builder;
      },
      then: (resolve: (answer: { data: Row[]; error: null }) => unknown) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        return new Promise<{ data: Row[]; error: null }>((settle) => {
          setTimeout(() => {
            inFlight -= 1;
            settle({ data: matched, error: null });
          }, 5);
        }).then(resolve);
      },
    };
    return builder;
  });
  return { requests, peak: () => peakInFlight };
}

beforeEach(() => {
  supabase.from.mockReset();
  supabase.rpc.mockReset();
  __resetMemoryProfiles();
});

describe("a departed account is not named in a follow list", () => {
  it("answers an empty card for a tombstoned row that still holds a display name", async () => {
    fakeTable([
      row("sam"),
      row("gone", { tombstoned_at: "2026-02-01T00:00:00.000Z", user_id: null }),
    ]);

    const cards = await supabaseProfileStore.getPublicCardsByHandles(["sam", "gone"]);

    expect(cards.get("sam")).toEqual({ displayName: "sam display" });
    // THE DEFECT: the row was selected on handle alone and projected whole, so
    // `gone display` reached any anonymous reader of a followers list.
    expect(cards.get("gone")).toBeUndefined();
    expect(JSON.stringify([...cards])).not.toContain("gone display");
  });

  it("refuses the name and the face on the memory backend too", async () => {
    __seedMemoryOwnedProfile("gone", "user-gone");
    await memoryProfileStore.update("gone", { displayName: "Departed Person" });
    const profile = await memoryProfileStore.getByHandle("gone");
    await memoryProfileStore.setOwnedImage("gone", "avatar", {
      objectKey: profileImageServingKey("avatar", profile!.id, GENERATION),
      generation: GENERATION,
      moderationState: "approved",
    });
    // The memory tombstone mirrors the production trigger: images cleared,
    // display name left standing.
    const dead = __tombstoneMemoryProfile("gone");
    expect(dead?.displayName).toBe("Departed Person");

    const cards = await memoryProfileStore.getPublicCardsByHandles(["gone"]);
    expect(cards.get("gone")).toEqual({});
  });

  it("keeps a live account's name and approved face", async () => {
    __seedMemoryOwnedProfile("sam", "user-sam");
    await memoryProfileStore.update("sam", { displayName: "Sam I Am" });
    const profile = await memoryProfileStore.getByHandle("sam");
    await memoryProfileStore.setOwnedImage("sam", "avatar", {
      objectKey: profileImageServingKey("avatar", profile!.id, GENERATION),
      generation: GENERATION,
      moderationState: "approved",
    });

    const cards = await memoryProfileStore.getPublicCardsByHandles(["sam"]);
    expect(cards.get("sam")).toEqual({
      displayName: "Sam I Am",
      avatarUrl: `/api/avatar/${profile!.id}/${GENERATION}`,
    });
  });
});

describe("the batch is chunked, so a long follow list still reads", () => {
  it("splits 450 handles into bounded requests and merges every card", async () => {
    const handles = Array.from({ length: 450 }, (_, index) => `mate${index}`);
    const { requests } = fakeTable(handles.map((handle) => row(handle)));

    const cards = await supabaseProfileStore.getPublicCardsByHandles(handles);

    expect(cards.size).toBe(450);
    expect(cards.get("mate0")).toEqual({ displayName: "mate0 display" });
    expect(cards.get("mate449")).toEqual({ displayName: "mate449 display" });
    // THE DEFECT: one `.in()` carried all 450, growing the request line past the
    // gateway's ceiling and failing the read for every caller on that profile.
    expect(requests.length).toBe(3);
    for (const batch of requests) expect(batch.length).toBeLessThanOrEqual(200);
    expect(requests.flat().length).toBe(450);
  });

  it("chunks the sibling avatar read the same way", async () => {
    const handles = Array.from({ length: 250 }, (_, index) => `mate${index}`);
    const { requests } = fakeTable(handles.map((handle) => row(handle)));

    await supabaseProfileStore.getApprovedAvatarUrlsByHandles(handles);

    expect(requests.length).toBe(2);
    for (const batch of requests) expect(batch.length).toBeLessThanOrEqual(200);
  });

  it("asks for nothing when there is nothing to ask about", async () => {
    const { requests } = fakeTable([]);
    expect((await supabaseProfileStore.getPublicCardsByHandles([])).size).toBe(0);
    expect((await supabaseProfileStore.getPublicCardsByHandles(["  ", "@"])).size).toBe(0);
    expect(requests.length).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("normalizes and de-duplicates before it counts a batch", async () => {
    const { requests } = fakeTable([row("sam")]);
    await supabaseProfileStore.getPublicCardsByHandles(["@Sam", "sam", "SAM"]);
    expect(requests).toEqual([["sam"]]);
  });

  it("overlaps the chunks instead of awaiting them one after another", async () => {
    const handles = Array.from({ length: 800 }, (_, index) => `mate${index}`);
    const { requests, peak } = fakeTable(handles.map((handle) => row(handle)));

    const cards = await supabaseProfileStore.getPublicCardsByHandles(handles);

    expect(cards.size).toBe(800);
    expect(requests.length).toBe(4);
    // THE DEFECT: each chunk was awaited inside a `for` loop, so a well-followed
    // profile paid ceil(n/200) SEQUENTIAL round trips on a public read.
    expect(peak()).toBeGreaterThan(1);
  });

  it("holds the overlap to a ceiling rather than the follower count", async () => {
    // 40 chunks: without a bound this route would open forty PostgREST reads at
    // once for one anonymous request.
    const handles = Array.from({ length: 8_000 }, (_, index) => `mate${index}`);
    const { requests, peak } = fakeTable(handles.map((handle) => row(handle)));

    const cards = await supabaseProfileStore.getPublicCardsByHandles(handles);

    expect(cards.size).toBe(8_000);
    expect(requests.length).toBe(40);
    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(HANDLE_BATCH_CONCURRENCY);
  });

  it("overlaps the sibling avatar read under the same ceiling", async () => {
    const handles = Array.from({ length: 1_200 }, (_, index) => `mate${index}`);
    const { requests, peak } = fakeTable(handles.map((handle) => row(handle)));

    await supabaseProfileStore.getApprovedAvatarUrlsByHandles(handles);

    expect(requests.length).toBe(6);
    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(HANDLE_BATCH_CONCURRENCY);
  });
});
