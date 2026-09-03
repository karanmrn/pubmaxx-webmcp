import { describe, expect, it } from "vitest";

import type { FeedItem } from "@/lib/feed";
import {
  FRIENDS_BONUS,
  MIN_NOTE_CHARS,
  PHOTO_BONUS,
  QUALITY_BASE,
  RECENCY_HALF_LIFE_MS,
  forYouScore,
  qualityFactor,
  rankForYou,
  recencyFactor,
} from "@/lib/forYou";
import { normalizeHandle } from "@/lib/profiles";

// A fixed "now" so every recency assertion is deterministic — the whole point
// of the now-param convention: no test ever reaches for Date.now().
const NOW = Date.parse("2026-07-06T20:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    type: "pint_drop",
    id: "x",
    createdAt: at(0),
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

const LONG_NOTE = "My grandad drank here every Friday for forty years.";

describe("recencyFactor", () => {
  it("is 1 for a just-now drop", () => {
    expect(recencyFactor(item({ createdAt: at(0) }), NOW)).toBe(1);
  });

  it("is exactly 0.5 at one half-life old", () => {
    expect(recencyFactor(item({ createdAt: at(RECENCY_HALF_LIFE_MS) }), NOW)).toBeCloseTo(
      0.5,
      10,
    );
  });

  it("is 0.25 at two half-lives old", () => {
    expect(
      recencyFactor(item({ createdAt: at(2 * RECENCY_HALF_LIFE_MS) }), NOW),
    ).toBeCloseTo(0.25, 10);
  });

  it("clamps a future-dated (clock-skewed) drop to 1, never above", () => {
    expect(recencyFactor(item({ createdAt: at(-60_000) }), NOW)).toBe(1);
  });

  it("treats an unparseable createdAt as epoch-old (decays hard, never throws)", () => {
    const f = recencyFactor(item({ createdAt: "not-a-date" }), NOW);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(0.0001);
  });
});

describe("qualityFactor", () => {
  const ctx = { now: NOW };

  it("a bare text-only drop scores the base quality", () => {
    expect(qualityFactor(item(), ctx)).toBe(QUALITY_BASE);
  });

  it("adds the photo bonus when a photo is present", () => {
    expect(qualityFactor(item({ photoUrls: ["p.jpg"] }), ctx)).toBe(
      QUALITY_BASE + PHOTO_BONUS,
    );
  });

  it("a note earns the bonus only at/above the char threshold (boundary)", () => {
    const short = "a".repeat(MIN_NOTE_CHARS - 1);
    const exact = "a".repeat(MIN_NOTE_CHARS);
    expect(qualityFactor(item({ caption: short }), ctx)).toBe(QUALITY_BASE);
    expect(qualityFactor(item({ caption: exact }), ctx)).toBeGreaterThan(QUALITY_BASE);
  });

  it("a whitespace-padded short note does not earn the note bonus", () => {
    const padded = `   ${"a".repeat(MIN_NOTE_CHARS - 1)}   `;
    expect(qualityFactor(item({ caption: padded }), ctx)).toBe(QUALITY_BASE);
  });

  it("adds the story-venue bonus only for a curated venue id", () => {
    const storyVenueIds = new Set(["v-story"]);
    expect(qualityFactor(item({ venueId: "v-story" }), { ...ctx, storyVenueIds })).toBeGreaterThan(
      qualityFactor(item({ venueId: "v-plain" }), { ...ctx, storyVenueIds }),
    );
  });

  it("reaction bonus is monotonic but diminishing and capped", () => {
    const reactionCounts = { a: 1, b: 5, c: 10_000 };
    const qa = qualityFactor(item({ id: "a" }), { ...ctx, reactionCounts });
    const qb = qualityFactor(item({ id: "b" }), { ...ctx, reactionCounts });
    const qc = qualityFactor(item({ id: "c" }), { ...ctx, reactionCounts });
    expect(qb).toBeGreaterThan(qa);
    expect(qc).toBeGreaterThan(qb);
    // Even a runaway count stays bounded (base + cap), so it can't dominate.
    expect(qc).toBeLessThanOrEqual(QUALITY_BASE + 0.75 + 1e-9);
  });
});

describe("forYouScore + rankForYou", () => {
  it("is the product of recency and quality", () => {
    const it0 = item({ id: "a", photoUrls: ["p.jpg"], createdAt: at(RECENCY_HALF_LIFE_MS) });
    const ctx = { now: NOW };
    expect(forYouScore(it0, ctx)).toBeCloseTo(
      recencyFactor(it0, NOW) * qualityFactor(it0, ctx),
      10,
    );
  });

  it("ranks a rich recent drop above a thin recent one", () => {
    const rich = item({ id: "rich", photoUrls: ["p.jpg"], caption: LONG_NOTE, createdAt: at(0) });
    const thin = item({ id: "thin", createdAt: at(0) });
    expect(rankForYou([thin, rich], { now: NOW }).map((i) => i.id)).toEqual(["rich", "thin"]);
  });

  it("recency can outweigh quality: a fresh thin drop beats an ancient rich one", () => {
    const freshThin = item({ id: "fresh", createdAt: at(0) });
    const ancientRich = item({
      id: "ancient",
      photoUrls: ["p.jpg"],
      caption: LONG_NOTE,
      createdAt: at(10 * RECENCY_HALF_LIFE_MS),
    });
    expect(rankForYou([ancientRich, freshThin], { now: NOW }).map((i) => i.id)).toEqual([
      "fresh",
      "ancient",
    ]);
  });

  it("is deterministic: ties fall back to newest-first then stable id order", () => {
    // Two identical-quality drops at the same instant → id tie-break, stable.
    const a = item({ id: "aaa", createdAt: at(0) });
    const b = item({ id: "bbb", createdAt: at(0) });
    expect(rankForYou([b, a], { now: NOW }).map((i) => i.id)).toEqual(["aaa", "bbb"]);
    // Reversing the input yields the same order — total, deterministic sort.
    expect(rankForYou([a, b], { now: NOW }).map((i) => i.id)).toEqual(["aaa", "bbb"]);
  });

  it("does not mutate the input array", () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    const snapshot = items.map((i) => i.id);
    rankForYou(items, { now: NOW });
    expect(items.map((i) => i.id)).toEqual(snapshot);
  });

  it("empty input → empty output", () => {
    expect(rankForYou([], { now: NOW })).toEqual([]);
  });

  it("the same input + same now always yields the same order (determinism)", () => {
    const items = [
      item({ id: "a", photoUrls: ["p.jpg"], createdAt: at(3_600_000) }),
      item({ id: "b", caption: LONG_NOTE, createdAt: at(7_200_000) }),
      item({ id: "c", createdAt: at(0) }),
    ];
    const first = rankForYou(items, { now: NOW }).map((i) => i.id);
    const second = rankForYou(items, { now: NOW }).map((i) => i.id);
    expect(first).toEqual(second);
  });
});

// Wave G4 — friends boost: modest quality nudge for followed authors when the
// viewer has a non-empty follow set. Never removes non-friends; empty set is a
// no-op (identical to pre-G4 ranking).
describe("Wave G4 friends boost", () => {
  it("ranks an otherwise-equal friend above a non-friend", () => {
    const friend = item({ id: "friend", handle: "mabel", createdAt: at(0) });
    const stranger = item({ id: "stranger", handle: "ken", createdAt: at(0) });
    const followingHandles = new Set([normalizeHandle("mabel")]);
    expect(
      rankForYou([stranger, friend], { now: NOW, followingHandles }).map((i) => i.id),
    ).toEqual(["friend", "stranger"]);
  });

  it("adds exactly FRIENDS_BONUS to quality for a followed author", () => {
    const followingHandles = new Set(["mabel"]);
    const friend = item({ handle: "mabel" });
    const stranger = item({ handle: "ken" });
    expect(qualityFactor(friend, { now: NOW, followingHandles })).toBe(
      QUALITY_BASE + FRIENDS_BONUS,
    );
    expect(qualityFactor(stranger, { now: NOW, followingHandles })).toBe(QUALITY_BASE);
  });

  it("empty following set leaves ranking unchanged (pre-G4 behaviour)", () => {
    const a = item({ id: "aaa", handle: "mabel", createdAt: at(0) });
    const b = item({ id: "bbb", handle: "ken", createdAt: at(0) });
    const without = rankForYou([b, a], { now: NOW }).map((i) => i.id);
    const withEmpty = rankForYou([b, a], {
      now: NOW,
      followingHandles: new Set(),
    }).map((i) => i.id);
    expect(withEmpty).toEqual(without);
    // Equal quality → stable id tie-break, not friends order.
    expect(withEmpty).toEqual(["aaa", "bbb"]);
  });

  it("undefined followingHandles is a no-op (same as empty)", () => {
    const a = item({ id: "aaa", handle: "mabel", createdAt: at(0) });
    const b = item({ id: "bbb", handle: "ken", createdAt: at(0) });
    expect(rankForYou([b, a], { now: NOW }).map((i) => i.id)).toEqual(
      rankForYou([b, a], { now: NOW, followingHandles: undefined }).map((i) => i.id),
    );
  });

  it("normalizes @@handles so @@Mabel matches a normalized following set", () => {
    const friend = item({ id: "friend", handle: "@@Mabel", createdAt: at(0) });
    const stranger = item({ id: "stranger", handle: "ken", createdAt: at(0) });
    // Following set stores normalized handles (same as Friends lane / profiles).
    const followingHandles = new Set([normalizeHandle("@@Mabel")]);
    expect(followingHandles.has("mabel")).toBe(true);
    expect(
      rankForYou([stranger, friend], { now: NOW, followingHandles }).map((i) => i.id),
    ).toEqual(["friend", "stranger"]);
    expect(qualityFactor(friend, { now: NOW, followingHandles })).toBe(
      QUALITY_BASE + FRIENDS_BONUS,
    );
  });

  it("does not remove non-friends — only reorders", () => {
    const friend = item({ id: "friend", handle: "mabel", createdAt: at(0) });
    const stranger = item({ id: "stranger", handle: "ken", createdAt: at(0) });
    const ranked = rankForYou([stranger, friend], {
      now: NOW,
      followingHandles: new Set(["mabel"]),
    });
    expect(ranked).toHaveLength(2);
    expect(ranked.map((i) => i.id).sort()).toEqual(["friend", "stranger"]);
  });
});
