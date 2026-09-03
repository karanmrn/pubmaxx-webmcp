import { beforeEach, describe, expect, it } from "vitest";

// Exercise the in-memory reactions store directly — no live Supabase, no env
// keys. It is the backend the route uses when Supabase is unconfigured, and it
// shares summarizeRows + the REACTION_KEYS allowlist with the Supabase path, so
// the folding / isolation guarantees here mirror production.
//
// FORCE the in-memory path: on Vercel vitest runs with the project's env set —
// if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present the store would try to
// select the Supabase client (network) and these cases would fail only in CI.
// Clearing them in beforeEach pins the store to memory everywhere. We also reset
// the shared memory Set so cases can't leak reactions into each other.
import {
  REACTION_KEYS,
  isReactionKey,
  memoryReactionsStore,
  __resetMemoryReactions,
  type ReactionKey,
  type ReactionSummary,
} from "@/lib/reactionsStore";

const DROP = "drop-1";
const ACTOR = "actor-hash-abc";
const OTHER = "actor-hash-xyz";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryReactions();
});

describe("REACTION_KEYS allowlist / isReactionKey — trust boundary", () => {
  it("accepts every canonical reaction key", () => {
    for (const k of REACTION_KEYS) expect(isReactionKey(k)).toBe(true);
  });

  it("rejects unknown / malformed reaction values", () => {
    expect(isReactionKey("nonsense")).toBe(false);
    expect(isReactionKey("Cheers")).toBe(false); // case-sensitive
    expect(isReactionKey("")).toBe(false);
    expect(isReactionKey(null)).toBe(false);
    expect(isReactionKey(undefined)).toBe(false);
    expect(isReactionKey(42)).toBe(false);
    expect(isReactionKey({})).toBe(false);
  });
});

describe("memory toggle — idempotent on/off round-trip", () => {
  it("toggling once adds the reaction, toggling again removes it", async () => {
    const on = await memoryReactionsStore.toggle(DROP, ACTOR, "cheers");
    expect(on.counts.cheers).toBe(1);
    expect(on.mine).toEqual(["cheers"]);

    const off = await memoryReactionsStore.toggle(DROP, ACTOR, "cheers");
    // Removed: no count survives, and the actor no longer "owns" it.
    expect(off.counts.cheers ?? 0).toBe(0);
    expect(off.mine).toEqual([]);
  });

  it("a third toggle re-adds it (pure insert-or-delete, no drift)", async () => {
    await memoryReactionsStore.toggle(DROP, ACTOR, "proper");
    await memoryReactionsStore.toggle(DROP, ACTOR, "proper");
    const again = await memoryReactionsStore.toggle(DROP, ACTOR, "proper");
    expect(again.counts.proper).toBe(1);
    expect(again.mine).toEqual(["proper"]);
  });
});

describe("summary counts — per reaction type", () => {
  it("counts each reaction independently across actors on one drop", async () => {
    // Two actors cheer, one calls it a bargain.
    await memoryReactionsStore.toggle(DROP, ACTOR, "cheers");
    await memoryReactionsStore.toggle(DROP, OTHER, "cheers");
    await memoryReactionsStore.toggle(DROP, ACTOR, "bargain");

    const summary = await memoryReactionsStore.summarize([DROP], ACTOR);
    expect(summary[DROP].counts.cheers).toBe(2);
    expect(summary[DROP].counts.bargain).toBe(1);
    // Reactions nobody used never appear as a 0 — the map is partial.
    expect(summary[DROP].counts).not.toHaveProperty("chaos");
  });

  it("one device can't double-inflate a count (unique per (drop,actor,reaction))", async () => {
    const first = await memoryReactionsStore.toggle(DROP, ACTOR, "legendary");
    expect(first.counts.legendary).toBe(1);
    // A second toggle by the SAME actor is a removal, not a second row.
    const second = await memoryReactionsStore.toggle(DROP, ACTOR, "legendary");
    expect(second.counts.legendary ?? 0).toBe(0);
  });
});

describe("per-actor `mine` isolation", () => {
  it("only surfaces the asking actor's own reactions in `mine`", async () => {
    await memoryReactionsStore.toggle(DROP, ACTOR, "cheers");
    await memoryReactionsStore.toggle(DROP, OTHER, "chaos");

    const mineForActor = (await memoryReactionsStore.summarize([DROP], ACTOR))[DROP];
    expect(mineForActor.mine).toEqual(["cheers"]);
    // Counts are shared, but the "on" set is not.
    expect(mineForActor.counts.cheers).toBe(1);
    expect(mineForActor.counts.chaos).toBe(1);

    const mineForOther = (await memoryReactionsStore.summarize([DROP], OTHER))[DROP];
    expect(mineForOther.mine).toEqual(["chaos"]);
  });

  it("`mine` is empty for an actor who has reacted to nothing on the drop", async () => {
    await memoryReactionsStore.toggle(DROP, OTHER, "cheers");
    const summary = (await memoryReactionsStore.summarize([DROP], "ghost-actor"))[DROP];
    expect(summary.mine).toEqual([]);
    expect(summary.counts.cheers).toBe(1); // count still visible to everyone
  });
});

describe("summarize — multi-drop batch read", () => {
  it("keys a summary per requested drop and scopes counts to each drop", async () => {
    await memoryReactionsStore.toggle("drop-a", ACTOR, "cheers");
    await memoryReactionsStore.toggle("drop-b", ACTOR, "bargain");

    const out = await memoryReactionsStore.summarize(["drop-a", "drop-b"], ACTOR);
    expect(out["drop-a"].counts.cheers).toBe(1);
    expect(out["drop-a"].counts).not.toHaveProperty("bargain");
    expect(out["drop-b"].counts.bargain).toBe(1);
    expect(out["drop-b"].counts).not.toHaveProperty("cheers");
  });

  it("returns an empty, zero-count summary for a drop with no reactions", async () => {
    const out = await memoryReactionsStore.summarize(["quiet-drop"], ACTOR);
    expect(out["quiet-drop"]).toEqual({ counts: {}, mine: [] });
  });

  it("skips empty ids and returns {} for an all-empty request", async () => {
    expect(await memoryReactionsStore.summarize([], ACTOR)).toEqual({});
    expect(await memoryReactionsStore.summarize(["", ""], ACTOR)).toEqual({});
  });
});

describe("public summary shape — never leaks actor_hash", () => {
  it("a summary carries ONLY { counts, mine } and no raw actor hashes", async () => {
    await memoryReactionsStore.toggle(DROP, ACTOR, "cheers");
    await memoryReactionsStore.toggle(DROP, OTHER, "cheers");
    const summary: ReactionSummary = (await memoryReactionsStore.summarize([DROP], ACTOR))[DROP];

    expect(Object.keys(summary).sort()).toEqual(["counts", "mine"]);
    expect(summary).not.toHaveProperty("actor_hash");
    expect(summary).not.toHaveProperty("rows");
    // No actor hash ever rides along inside the exposed values, either.
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(ACTOR);
    expect(serialized).not.toContain(OTHER);
  });
});

describe("unknown drop id — memory store contract (never raises UnknownDropError)", () => {
  it("reacts freely to any id (no FK), unlike the Supabase seed-drop path", async () => {
    // The memory backend has no foreign key, so a demo-seed / arbitrary id is a
    // valid target — this is the documented dev/demo ergonomics. It must resolve
    // to a normal summary, never throw.
    const key: ReactionKey = "chaos";
    const result = await memoryReactionsStore.toggle("seed-prospect-1", ACTOR, key);
    expect(result.counts.chaos).toBe(1);
    expect(result.mine).toEqual(["chaos"]);
  });
});
