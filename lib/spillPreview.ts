// Pure helpers for the camera-first Spill composer (PRD "For-You map" priority
// 2). No React, no DOM — everything here is deterministic and unit-testable in
// isolation. Two jobs:
//   1. Derive the live "instant preview card" model from the raw composer form,
//      matching the final 9:16 feedSpill treatment (photo, price stamp,
//      provenance badge, handle scrim) WITHOUT flattening provenance.
//   2. Map the one-tap destination chips ("Add to Tonight / My Round / Family
//      Table / Ledger") onto the EXISTING visibility semantics — no new backend.

import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";
import { type Provenance } from "@/lib/curation";
// Shared chip vocabulary — seeded content always reads "Demo", never "Sample".
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import { displayHandle } from "@/lib/handleDisplay";
import { appendWithSuffix, formatPriceGbp, type Visibility } from "@/lib/spill";

// ── One-tap destinations ─────────────────────────────────────────────────────
// Each chip is a shortcut that sets EXISTING state (visibility, and — where a
// seam exists — the active Round). The semantics are deliberately thin:
//   • Tonight      → public. The presence / "public tonight" lane is just a
//                    public Spill; nothing extra to set.
//   • My Round     → public, and (when a Round is actually open, read from the
//                    optional client seam) tag the note so the Round's
//                    "builds-itself" route can pick it up. With no open Round
//                    the chip is DISABLED — we never fake a Round.
//   • Family Table → legacy visibility (kept for the pub's Ledger, off the feed).
//   • Ledger       → legacy visibility (a legacy note on the Ledger).
// Family Table and Ledger both map to `legacy` today (the honest ceiling until a
// dedicated column exists); they read as distinct chips so the intent survives
// even though the storage lane is shared.
export const SPILL_DESTINATIONS = ["tonight", "round", "family", "ledger"] as const;
export type SpillDestination = (typeof SPILL_DESTINATIONS)[number];

export type DestinationMeta = {
  key: SpillDestination;
  label: string;
  /** The visibility this destination selects. */
  visibility: Visibility;
  /** One honest line describing where the Spill lands. */
  helper: string;
  /** True when the chip needs an open Round to function (see resolveDestination). */
  needsActiveRound: boolean;
};

export const DESTINATION_META: Record<SpillDestination, DestinationMeta> = {
  tonight: {
    key: "tonight",
    label: "Tonight",
    visibility: "public",
    helper: "Public tonight. On the feed and the map.",
    needsActiveRound: false,
  },
  round: {
    key: "round",
    label: "My Round",
    visibility: "public",
    helper: "Adds this stop to your open Round.",
    needsActiveRound: true,
  },
  family: {
    key: "family",
    label: "Family Table",
    visibility: "legacy",
    helper: "Kept for the family. Off the public feed.",
    needsActiveRound: false,
  },
  ledger: {
    key: "ledger",
    label: "Ledger",
    visibility: "legacy",
    helper: "A legacy note on the pub's Ledger.",
    needsActiveRound: false,
  },
};

export type ResolvedDestination = {
  visibility: Visibility;
  /** Whether the chip should be selectable given the current Round state. */
  enabled: boolean;
  helper: string;
};

/**
 * Resolve a destination chip into the visibility it selects and whether it is
 * currently usable. `hasActiveRound` is the only environment input — everything
 * else is static. A destination that needs a Round but has none is returned
 * DISABLED (enabled:false) with honest copy, never silently coerced to a
 * different lane.
 */
export function resolveDestination(
  key: SpillDestination,
  hasActiveRound: boolean,
): ResolvedDestination {
  const meta = DESTINATION_META[key];
  if (meta.needsActiveRound && !hasActiveRound) {
    return {
      visibility: meta.visibility,
      enabled: false,
      helper: "Open a Round first to add this stop.",
    };
  }
  return { visibility: meta.visibility, enabled: true, helper: meta.helper };
}

// ── Price quick-add chips ─────────────────────────────────────────────────────
/**
 * Merge the venue's last-known contributor price into the base quick-add chip
 * list: it leads (so a tap on the pub's real recent price is the fastest path),
 * is clamped/rounded via formatPriceGbp, and is de-duplicated against the base
 * list. A null/NaN/out-of-range last price is simply dropped — the base chips
 * always stand. Returns numbers (callers format for display).
 */
export function mergePriceChips(
  base: readonly number[],
  lastKnown: number | null | undefined,
): number[] {
  const out: number[] = [];
  const seen = new Set<string>();
  const push = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const label = formatPriceGbp(value);
    if (seen.has(label)) return;
    seen.add(label);
    out.push(Number(label));
  };
  if (typeof lastKnown === "number") push(lastKnown);
  for (const price of base) push(price);
  return out;
}

// ── Instant preview model ─────────────────────────────────────────────────────
// The preview card mirrors FeedCard's feedSpill treatment. Provenance is derived
// the SAME way the server derives it (a priced Spill is `contributor`, a memory
// is `anecdote`) so the badge the writer sees while composing matches what will
// be stored — provenance is never flattened to a single "preview" value.

export type SpillPreviewInput = {
  handle: string;
  price: string;
  note: string;
  withWho: string;
  drink: string;
  era: string;
  visibility: Visibility;
  venueName: string;
  hasPhoto: boolean;
};

export type SpillPreviewModel = {
  /** The @handle shown on the scrim — withheld to "a PUBMAXXER" when anonymous. */
  shownHandle: string;
  /** Single uppercase avatar initial (matches feedSpillAvatar). "?" when empty. */
  initial: string;
  /** Formatted "£x.xx" price stamp, or null when there's no valid price. */
  priceLabel: string | null;
  /** The note with the "— with @sam" suffix folded in, exactly as submitted. */
  note: string;
  provenance: Provenance;
  provenanceLabel: string;
  venueName: string;
  hasPhoto: boolean;
};


/** Parse a raw price string into a number, or null when blank/unparseable. */
function parsePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Build the live preview model from the raw composer form. Pure + total: any
 * field can be blank and the model still renders a coherent card (empty handle
 * → "@anon" avatar "?", no price → no stamp, etc.).
 */
export function buildSpillPreview(input: SpillPreviewInput): SpillPreviewModel {
  const anonymous = input.visibility === "anonymous";
  const shownHandle = anonymous ? `@${ANON_HANDLE_LABEL}` : displayHandle(input.handle);
  // The avatar initial comes from the real handle for a normal Spill, but for an
  // anonymous one we must NOT leak the first letter of the withheld handle — use
  // the masked label instead.
  const initialSource = anonymous ? ANON_HANDLE_LABEL : input.handle.trim();
  const initial = initialSource.replace(/^@+/, "").charAt(0).toUpperCase() || "?";

  const priceValue = parsePrice(input.price);
  const priceLabel = priceValue !== null ? `£${priceValue.toFixed(2)}` : null;

  // Same rule as lib/pintDrops: a priced Spill is a `contributor` claim, a
  // price-less memory is an `anecdote`. Never flattened.
  const provenance: Provenance = priceValue !== null ? "contributor" : "anecdote";

  return {
    shownHandle,
    initial,
    priceLabel,
    note: appendWithSuffix(input.note, input.withWho),
    provenance,
    provenanceLabel: PROVENANCE_LABEL[provenance],
    venueName: input.venueName,
    hasPhoto: input.hasPhoto,
  };
}
