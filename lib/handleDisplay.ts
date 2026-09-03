// Single source of truth for rendering a handle in the UI. Some handles arrive
// already carrying a leading "@" (demo seeds in lib/pintDropSeeds, lib/curation
// — e.g. "@wapping_wall_ted", "@London_W4"), so any render site that naively
// prepends its own "@" produces "@@wapping_wall_ted". These helpers normalize
// once and prepend exactly one "@", so "@@" is impossible.
//
// Pure + backend-free: reuses normalizeHandle from lib/profiles (lowercase, strip
// any leading @s, keep [a-z0-9_], cap length) so display and identity can't drift.

import { normalizeHandle } from "@/lib/profiles";

// A stable placeholder for an empty/unknown handle. Matches the existing "anon"
// UX (see TonightBoard's anonymous row) so nothing renders a bare "@".
const ANON_HANDLE = "anon";

// The bare, normalized handle (no "@") — for URLs and follow-set matching, e.g.
// `/u/${handleOnly(raw)}`. Empty/nullish input → the "anon" fallback so a link
// never points at "/u/".
export function handleOnly(raw: string | null | undefined): string {
  const normalized = normalizeHandle(raw);
  return normalized || ANON_HANDLE;
}

// The display handle with exactly one leading "@". Empty/nullish → "@anon".
// NEVER yields "@@" — normalizeHandle strips every leading @ before we prepend.
export function displayHandle(raw: string | null | undefined): string {
  return `@${handleOnly(raw)}`;
}
