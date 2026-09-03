// Pure copy/model layer for the crew-invite share loop (Social Loop v1).
//
// One source of truth for the text that appears on BOTH the /add/[handle] share
// surface and its OG card, so the picture a friend sees in the link preview and
// the page it opens onto say the same thing. No I/O, no React, no node built-ins
// — safe to import into a client component, an OG image route, and a unit test
// alike.
//
// A "lot" is mutual: you add a friend, they add you back, and from then on each
// side's nights land in the other's "Your lot" feed. The copy states that plainly
// rather than borrowing follower-count language — there are no follower counts.

import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";

// Cap the rendered handle so an over-long value can never blow out an OG card
// layout. normalizeHandle already caps at 30, so this is a belt-and-braces clamp
// that also governs the shorter card headline.
export const INVITE_HANDLE_MAX = 24;

export type InviteCardModel = {
  /** Normalized handle, clamped for display; "" when the link carries none. */
  handle: string;
  /** "@handle" with exactly one leading @, or a friendly fallback. */
  displayName: string;
  /** Small eyebrow above the headline. */
  kicker: string;
  /** The card / page headline. */
  title: string;
  /** One-line explanation of what a lot is. */
  sub: string;
  /** Footer call to action. */
  cta: string;
};

// Build the invite card/page model from a raw route handle. Total and safe:
// junk or an empty handle yields the generic "a mate" invite rather than a
// broken "@" headline.
export function inviteCardModel(raw: string | null | undefined): InviteCardModel {
  const normalized = normalizeHandle(raw).slice(0, INVITE_HANDLE_MAX);
  const hasHandle = normalized.length > 0;
  const displayName = hasHandle ? displayHandle(normalized) : "a mate";
  return {
    handle: normalized,
    displayName,
    kicker: "Your lot on PUBMAXX",
    title: hasHandle ? `Add ${displayName} to your lot` : "Add me to your lot",
    sub: "A lot is mutual. Add them, they add you back, and their nights land in Your lot. No follower counts, no public list.",
    cta: "Open the link, tap add",
  };
}
