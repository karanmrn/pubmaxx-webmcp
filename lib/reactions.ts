// Browser-safe reaction constants + types. NO server imports live here (no
// @/lib/supabase, no node:crypto) so a "use client" feed component can pull the
// canonical allowlist / DTO shapes without dragging the server store — and its
// admin-Supabase transitive deps — into the client bundle. The server store
// (lib/reactionsStore.ts) re-exports these so validation and UI can never drift.

// The canonical reaction allowlist — imported by the feed card so the UI chips
// and the server validation share one source of truth. Values are stored
// verbatim in the `reaction` text column.
export const REACTION_KEYS = ["cheers", "bargain", "chaos", "proper", "legendary"] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];

/** Closed chip labels + emoji. Feed and invite UI import this so meanings cannot drift. */
export const REACTION_META: Record<ReactionKey, { label: string; emoji: string }> = {
  cheers: { label: "Cheers", emoji: "🍺" },
  bargain: { label: "Bargain", emoji: "💷" },
  chaos: { label: "Chaos", emoji: "🔥" },
  proper: { label: "Proper", emoji: "👌" },
  legendary: { label: "Legendary", emoji: "🏆" },
};

const REACTION_SET = new Set<string>(REACTION_KEYS);
export function isReactionKey(value: unknown): value is ReactionKey {
  return typeof value === "string" && REACTION_SET.has(value);
}

// Per-drop summary: a count for each reaction that has any, plus the subset the
// asking actor has themselves selected (drives the "on" state of each chip).
export type ReactionSummary = { counts: Partial<Record<ReactionKey, number>>; mine: ReactionKey[] };
