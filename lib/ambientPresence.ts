// Deterministic ambient DEMO presence (PRD next-wave P2, second half). When the
// app runs without Supabase (demo/dev), the "Live tonight" strip would only ever
// show rows someone tapped in this process — a dead band on every fresh load.
// This module supplies a small, honest layer of *demo* presence whose volume
// follows a time-of-day curve: quiet afternoon, building evening, peak
// ~21:00–23:00, tailing off after midnight.
//
// Rules (mirrors lib/pintDropSeeds):
// - DETERMINISTIC: a seeded PRNG keyed on (venue id, hour-of-day) — the same
//   venue at the same hour always yields the same count. NO Math.random, so
//   render paths and API responses are stable within an hour.
// - HONEST: every generated row is provenance-tagged "demo" (lib/presence
//   PresenceDTO.provenance) so the UI renders the shared Demo chip idiom and
//   seeded liveliness never masquerades as organic.
// - FALLBACK-ONLY: nothing here touches real presence — the store appends demo
//   rows only on the non-Supabase read path (lib/presenceStore).
//
// Browser-safe: pure functions, no fs/Supabase/venue-index imports. The persona
// roster is derived from the demo pint-drop seeds so the same demo characters
// appear "out tonight" at the same curated heritage pubs.

import { demoContentEnabled } from "@/lib/demoContent";
import { londonHour } from "@/lib/londonHour";
import { demoPintDrops, isManchesterVenueId } from "@/lib/pintDropSeeds";

/** Hard cap on the ambient count for one venue — a glance, never a crowd. */
export const MAX_AMBIENT_PER_VENUE = 6;

// The hour-of-day shape (Europe/London wall clock): [min, max] inclusive counts.
// The PRNG picks inside the band, so the curve's ORDER is guaranteed by
// construction — any peak-hour draw exceeds any afternoon draw.
const HOUR_BAND: readonly (readonly [number, number])[] = [
  [1, 2], // 00 — tailing off after the bell
  [0, 1], // 01
  [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], // 02–10 shut
  [0, 0], // 11
  [0, 1], // 12 — quiet lunchtime trickle
  [0, 1], // 13
  [0, 1], // 14
  [0, 1], // 15
  [0, 1], // 16
  [1, 2], // 17 — after-work build
  [1, 3], // 18
  [2, 3], // 19
  [2, 4], // 20
  [3, 5], // 21 — peak
  [3, 5], // 22 — peak
  [3, 5], // 23 — peak
];

// ── Seeded PRNG (xmur3 hash → mulberry32) ────────────────────────────────────
// Tiny, dependency-free, deterministic. Quality is irrelevant here — stability is
// the contract.

function hashSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { londonHour };

/**
 * Deterministic ambient presence count for one venue at one moment. Seeded on
 * (venueKey, London hour) — the same inputs ALWAYS produce the same count.
 * Shape: 0 through the day, a lunchtime trickle, building from 17:00, peaking
 * 21:00–23:00, tailing off past midnight. Bounded 0..MAX_AMBIENT_PER_VENUE.
 */
export function ambientPresenceCurve(venueKey: string, date: Date): number {
  if (!demoContentEnabled()) return 0;
  const hour = londonHour(date);
  const [min, max] = HOUR_BAND[hour] ?? [0, 0];
  if (max <= 0) return 0;
  const rng = mulberry32(hashSeed(`${venueKey}:${hour}`));
  const count = min + Math.floor(rng() * (max - min + 1));
  return Math.min(Math.max(count, 0), MAX_AMBIENT_PER_VENUE);
}

// ── Demo roster ──────────────────────────────────────────────────────────────
// One slot per (venue, persona) pair from the seeded pint drops, grouped by
// venue in seed order. A persona is "out" when the venue's ambient count covers
// their slot index — so the same people show up first as the evening builds.

type RosterSlot = { venueId: string; handle: string; slot: number };

const roster: RosterSlot[] = (() => {
  const perVenue = new Map<string, number>();
  const slots: RosterSlot[] = [];
  const seen = new Set<string>();
  for (const drop of demoPintDrops) {
    const key = `${drop.venueId}|${drop.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slot = perVenue.get(drop.venueId) ?? 0;
    perVenue.set(drop.venueId, slot + 1);
    slots.push({ venueId: drop.venueId, handle: drop.handle, slot });
  }
  return slots;
})();

const MINUTE_MS = 60_000;

/** A raw (pre-enrichment) ambient presence row — same shape the store enriches. */
export type AmbientPresenceRow = {
  handle: string;
  venueId: string;
  at: string;
};

/**
 * The ambient demo presence rows for a moment in time, optionally scoped to one
 * venue. Deterministic within an hour: counts come from ambientPresenceCurve and
 * "minutes ago" from the same seeded PRNG; `now` is floored to the minute so
 * rapid re-reads don't jitter. Rows are ordered freshest-first per the strip's
 * convention. Empty during shut hours — the strip honestly renders nothing.
 */
export function ambientPresenceRows(now: Date, venueId?: string): AmbientPresenceRow[] {
  const nowMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const hour = londonHour(now);
  const rows: AmbientPresenceRow[] = [];
  for (const { venueId: vid, handle, slot } of roster) {
    if (venueId && vid !== venueId) continue;
    // Unscoped strip (London landing/feed): skip Manchester personas so city
    // demo liveliness does not leak across cities.
    if (!venueId && isManchesterVenueId(vid)) continue;
    const count = ambientPresenceCurve(vid, now);
    if (slot >= count) continue;
    // Deterministic "minutes ago" per (venue, persona, hour): 4–49 minutes, so
    // relativeTime always reads as a recent, plausible tap.
    const rng = mulberry32(hashSeed(`${vid}:${handle}:${hour}`));
    const minutesAgo = 4 + Math.floor(rng() * 46);
    rows.push({ handle, venueId: vid, at: new Date(nowMs - minutesAgo * MINUTE_MS).toISOString() });
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return rows;
}
