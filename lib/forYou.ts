// The "For You" ranking (issue #36, PRD § "The For-You map"; Wave G4 friends
// boost). A pure, deterministic score over already-normalised FeedItems — NO ML,
// no network, no Date.now() reached for implicitly. Every time input flows
// through a `now` parameter so the whole thing is unit-testable with fixed
// timestamps (the same convention the rest of the repo's date-dependent logic
// follows).
//
// The score is a product of a recency-decay factor and a bounded quality
// factor, so a fresh-but-thin drop and a rich-but-stale drop both settle into a
// sensible middle — the feed rewards a recent drop that ALSO carries a photo, a
// real story, reactions, and a curated ("story-pub") venue. When the viewer has
// a non-empty follow set, authors in that set get a modest quality nudge
// (FRIENDS_BONUS) without removing anyone else. Ties fall back to newest-first
// so the order is total and stable.

import type { FeedItem } from "@/lib/feed";
import { normalizeHandle } from "@/lib/profiles";

// A reaction-count lookup keyed by drop id. The feed already batch-loads
// reaction summaries client-side; the caller folds those counts to a single
// number per drop and hands them in here. Absent id ⇒ 0 (a drop with no loaded
// summary simply scores no reaction bonus — never a crash).
export type ReactionCounts = Record<string, number>;

// Venue ids the viewer's dataset considers "story pubs" — curated/heritage
// venues that carry a pub story. Membership is a small quality nudge, not a
// gate. Optional so the lane still ranks with no curation signal at hand.
export type StoryVenueSet = Set<string>;

export type ForYouContext = {
  // Current wall-clock ms — ALWAYS injected (never read from Date.now() inside),
  // so tests pin recency decay to fixed timestamps.
  now: number;
  // Per-drop reaction totals (id → count). Optional; missing ⇒ no bonus.
  reactionCounts?: ReactionCounts;
  // Curated "story pub" venue ids. Optional; missing ⇒ no venue bonus.
  storyVenueIds?: StoryVenueSet;
  // Normalized handles the viewer follows (Wave G4). When non-empty, Spills
  // whose author is in this set get a modest quality boost — friends surface
  // sooner without removing anyone else. Undefined/empty ⇒ no friends boost
  // (identical to pre-G4 ranking). Same set the Friends lane filters on.
  followingHandles?: ReadonlySet<string>;
};

// ── Tunables (documented so the test can assert against them) ─────────────────

// Recency: an exponential half-life decay. A drop HALF_LIFE_MS old scores half
// the recency factor of a brand-new one; the factor is clamped to [0,1] so a
// (clock-skew) future drop never scores above a just-now drop.
export const RECENCY_HALF_LIFE_MS = 12 * 60 * 60 * 1000; // 12h

// Quality: a base of 1 plus additive, bounded bonuses. Kept as a sum of small
// weights so the ordering is easy to reason about and test at the boundaries.
export const QUALITY_BASE = 1;
export const PHOTO_BONUS = 0.6; // has at least one photo (the hero of a Spill)
export const NOTE_BONUS = 0.5; // has a passed-down note of real substance
export const STORY_VENUE_BONUS = 0.3; // dropped at a curated "story pub"
// Friends (Wave G4): modest quality nudge when the author is in the viewer's
// follow set. Sized below photo/note so a rich stranger still beats a thin
// friend at equal recency, but enough to lift an otherwise-equal friend above
// a non-friend. Empty/absent followingHandles ⇒ no boost (pre-G4 behaviour).
export const FRIENDS_BONUS = 0.35;
// Reactions: diminishing returns via log, capped, so one loud drop can't run
// away with the lane.
export const REACTION_WEIGHT = 0.25;
export const REACTION_BONUS_CAP = 0.75;

// A note must clear this many (trimmed) characters to earn the note bonus — a
// one-word "nice" doesn't count as a story handed down over the bar.
export const MIN_NOTE_CHARS = 24;

// ── Signal readers (pure) ─────────────────────────────────────────────────────

function createdMs(item: FeedItem): number {
  const t = Date.parse(item.createdAt);
  return Number.isFinite(t) ? t : 0;
}

/** Exponential recency decay in [0,1]. 1 at age 0, 0.5 at one half-life, and
 *  clamped to 1 for a future-dated (clock-skewed) drop so it can't out-score a
 *  just-now one. A drop with an unparseable createdAt reads as epoch (oldest). */
export function recencyFactor(item: FeedItem, now: number): number {
  const ageMs = now - createdMs(item);
  if (ageMs <= 0) return 1;
  return 2 ** (-ageMs / RECENCY_HALF_LIFE_MS);
}

/** Bounded quality multiplier: base + photo + substantial-note + story-venue +
 *  friends (Wave G4) + (capped, diminishing) reaction bonus. Never depends on
 *  `now`. Friends membership uses normalizeHandle so @@Handle and handle match
 *  the same normalized following set the Friends lane uses. */
export function qualityFactor(item: FeedItem, ctx: ForYouContext): number {
  let q = QUALITY_BASE;
  if (item.photoUrls.length > 0) q += PHOTO_BONUS;
  if (item.caption.trim().length >= MIN_NOTE_CHARS) q += NOTE_BONUS;
  if (ctx.storyVenueIds?.has(item.venueId)) q += STORY_VENUE_BONUS;

  // Wave G4: modest friends gravity. Only when the follow set is non-empty —
  // never a gate; non-friends stay in the ranked set, just without the nudge.
  const following = ctx.followingHandles;
  if (following && following.size > 0) {
    const author = normalizeHandle(item.handle);
    if (author && following.has(author)) q += FRIENDS_BONUS;
  }

  const reactions = Math.max(0, ctx.reactionCounts?.[item.id] ?? 0);
  if (reactions > 0) {
    // log1p gives diminishing returns; cap so a viral drop stays bounded.
    q += Math.min(REACTION_BONUS_CAP, REACTION_WEIGHT * Math.log1p(reactions));
  }
  return q;
}

/** The deterministic For-You score for one item: recency × quality. Pure —
 *  every time input is `ctx.now`. Higher is better. */
export function forYouScore(item: FeedItem, ctx: ForYouContext): number {
  return recencyFactor(item, ctx.now) * qualityFactor(item, ctx);
}

/**
 * Rank a set of already-normalised items by For-You score, highest first.
 * Deterministic and total: ties (equal score) fall back to newest-first, then
 * to a stable id comparison, so the same input always yields the same order
 * regardless of the engine's sort stability. Pure — returns a new array, never
 * mutates the input, never reads the clock (time comes from `ctx.now`).
 */
export function rankForYou(items: FeedItem[], ctx: ForYouContext): FeedItem[] {
  const scored = items.map((item) => ({ item, score: forYouScore(item, ctx) }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break 1: newest first (descending createdAt).
    const cmp = b.item.createdAt.localeCompare(a.item.createdAt);
    if (cmp !== 0) return cmp;
    // Tie-break 2: stable id order, so the sort is fully deterministic.
    return a.item.id.localeCompare(b.item.id);
  });
  return scored.map((s) => s.item);
}
