// Browser-safe surface of the Pint Drop domain. NO server imports live here (no
// @/lib/supabase, no node:crypto, no in-memory store) so a "use client"
// component (the composer, the preview, usePintDrops) can pull the canonical
// vibe-tag/visibility allowlists, the withheld-handle label, and the shared DTO
// shapes WITHOUT dragging the server store — and its admin-Supabase transitive
// deps — into the client bundle. The server module (lib/pintDrops.ts) re-exports
// everything here so validation and UI can never drift.
//
// Precedent: lib/reactions.ts (reactions) and lib/crawlStory.ts (crawls) are the
// exact same browser-safe-twin pattern.

import type { Provenance } from "@/lib/curation";
import type { LastPintDecisionKind } from "@/lib/tfl";

// A Pint Drop is one object with optional parts: a price log, a passed-down
// memory, or both. Photos are deferred to the Storage-backed adapter (see
// lib/pintDropsStore) — the v1 seam persists the text/price payload only.
export type PintDropInput = {
  venueId: string;
  handle: string;
  drink?: string;
  priceGbp?: number | null;
  passedDownNote?: string;
  era?: string;
  vibeTags?: string[];
};

// Server-authoritative vibe-tag allowlist (PRD §8 "quick tags"). The client
// mirrors this list for UX, but the server is the trust boundary: anything not
// on this exact list is dropped on the way in (see validatePintDrop). Kept as a
// frozen array so the order is stable and it can't be mutated at runtime.
export const VIBE_TAGS = [
  "cheap",
  "chaotic",
  "quiet pint",
  "old local",
  "date night",
  "coding pint",
  "last train",
  "riverside",
  "hidden gem",
  "first legal pint",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];

export type PintDropStatus = "visible" | "hidden" | "pending";

// Per-drop visibility (issue #29, PRD § "The Spill"). Orthogonal to `status`
// (moderation): a drop can be `visible`+`friends` (moderation-clean, follower-
// gated) or `hidden`+`public` (reported). Default is `public` so every existing
// row and any write that omits it keeps today's behaviour.
//
//   • public     — feed, map, leaderboards, ledger, permalink (today's default).
//   • friends    — author + mutual follows only (see qualifiesForFriends).
//   • legacy      — the family/heirloom lane: ledger + author ONLY; kept out of the
//                  feed/map/leaderboard signals (see listLegacyForVenue).
//   • anonymous  — shown publicly, handle WITHHELD in every DTO (ANON_HANDLE_LABEL);
//                  the real handle is stored server-side for moderation/limits and
//                  must never leak through a public read.
export const VISIBILITIES = ["public", "friends", "legacy", "anonymous"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** The default visibility for any drop that doesn't specify one — today's
 *  behaviour, and the DB column default, kept in lockstep here. */
export const DEFAULT_VISIBILITY: Visibility = "public";

const VISIBILITY_SET: ReadonlySet<string> = new Set(VISIBILITIES);

/** Coerce an untrusted value to a Visibility, defaulting to `public`. Anything
 *  off the allowlist collapses to the safe default (never throws) — the write
 *  path is additive and forgiving, exactly like cleanVibeTags. Pure + browser-
 *  safe, so both the server write path and composer-side reuse share it. */
export function cleanVisibility(value: unknown): Visibility {
  if (typeof value === "string" && VISIBILITY_SET.has(value)) return value as Visibility;
  return DEFAULT_VISIBILITY;
}

/**
 * The withheld-handle label a public surface renders for an `anonymous` drop.
 * The store swaps the real handle for this in EVERY DTO — the real handle never
 * leaves the server for an anonymous drop. Kept as one constant so the feed,
 * permalink, ledger, and any future surface agree on the exact string.
 */
export const ANON_HANDLE_LABEL = "a PUBMAXXER";
export const PINT_DROP_MAX_NOTE = 500;

export function cleanPintDropText(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

export type PintDrop = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  // Optional so old rows / notes-only drops read fine without them. Always a
  // server-filtered subset of VIBE_TAGS (never client-trusted) — public content.
  vibeTags?: VibeTag[];
  provenance: Provenance;
  status: PintDropStatus;
  // Per-drop visibility (issue #29). Optional on the type so old rows / demo
  // seeds without the field read as the default `public` — normalise reads with
  // visibilityOf() rather than touching this directly.
  visibility?: Visibility;
  createdAt: string;
  /**
   * Server-derived, per-venue pseudonym for a verified PUBMAXX User ID.
   * Present only when this price may count as an independent authority voice.
   * Missing means provisional, never untrusted or invalid.
   */
  authorityKey?: string;
  // Moderation metadata — set once a drop is reported/reviewed. Optional so old
  // rows and fresh drops read fine without them.
  reportedAt?: string;
  reportReason?: string;
  reportCount?: number;
  moderatedAt?: string;
  moderatorNote?: string;
  /**
   * Optional Last Train context captured when the Spill was posted (Wave F0).
   * Honest leave-by + decision kind for feed/venue stamps — never invent these.
   */
  leaveByIso?: string | null;
  lastTrainDecision?: LastPintDecisionKind | null;
};

export type ValidationResult =
  | { ok: true; value: PintDrop }
  | { ok: false; error: string };

/**
 * The requester's identity for a friends-gated read. Prefer a JWT-resolved
 * handle (`lib/pintDropViewer.ts`); self-asserted handles remain a
 * courtesy-curtain for keyless/dev only. `handle` is the viewer's own handle;
 * `mutualHandles` is the set of NORMALISED handles with a mutual follow edge.
 * A friends-only drop is visible to the author and to mutuals — never to a
 * one-way follower (Social Launch D3 / WP6).
 *
 * `followingHandles` remains for feed ranking / discovery lanes that are not
 * friends-only visibility (e.g. the Friends feed filter in `lib/feed.ts`).
 *
 * All fields optional: an anonymous viewer sees only public + anonymous drops.
 */
export type ViewerContext = {
  /** The viewer's own self-asserted handle (raw or normalised — normalised on use). */
  handle?: string | null;
  /** Normalised handles with a mutual follow edge (Social Launch D3). */
  mutualHandles?: ReadonlySet<string>;
  /** Normalised handles the viewer follows (its followees). Ranking only. */
  followingHandles?: ReadonlySet<string>;
};
