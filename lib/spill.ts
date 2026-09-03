// Pure helpers for "The Spill" composer upgrade (issue #24): price
// stepper/quick-add math, the "with" structured-suffix builder, and a thin
// re-export of the visibility allowlist for composer-side validation reuse.
// No React, no DOM — these are unit-testable in isolation.

import {
  cleanPintDropText,
  DEFAULT_VISIBILITY,
  PINT_DROP_MAX_NOTE,
  type Visibility,
} from "@/lib/pintDropShared";

export { VISIBILITIES, DEFAULT_VISIBILITY, cleanVisibility } from "@/lib/pintDropShared";
export type { Visibility } from "@/lib/pintDropShared";

// ── Price stepper ───────────────────────────────────────────────────────────
// Mirrors the server's MAX_PRICE clamp (lib/pintDrops.ts) on the low end (a
// pint can't be £0 or negative) and the high end (£20) so the stepper can
// never walk the field somewhere the server would reject anyway. The step is
// 10p, matching real pint pricing granularity.
export const PRICE_STEP_GBP = 0.1;
export const MIN_PRICE_GBP = 0.1;
export const MAX_PRICE_GBP = 20;

// Quick-add chips: the common price points a pint actually lands on. Every
// entry is a price a reader may tap and log, so it sits beside real figures and
// carries no joke. "£6.9" was neither: it was the 69 gag, and it printed with
// one decimal where a price has two.
export const QUICK_ADD_PRICES_GBP = [4, 4.5, 5, 5.5, 6] as const;

/** Round to the nearest penny — floating point addition (0.1 + 0.2, etc.)
 *  otherwise drifts the displayed price by fractions of a penny. */
function roundToPenny(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Clamp a price into the valid pint range, rounded to the penny. NaN
 *  collapses to the minimum; +/-Infinity clamp to the max/min respectively —
 *  the stepper must always produce a sane, displayable value, never NaN. */
export function clampPriceGbp(value: number): number {
  if (Number.isNaN(value)) return MIN_PRICE_GBP;
  return roundToPenny(Math.min(MAX_PRICE_GBP, Math.max(MIN_PRICE_GBP, value)));
}

/**
 * Step a price string up or down by PRICE_STEP_GBP, clamped to the valid
 * range. An empty/unparseable current value steps from the first quick-add
 * price (£4) rather than from 0, so a single tap on "+" from empty lands
 * somewhere sane instead of at 10p.
 */
export function stepPrice(current: string, direction: 1 | -1): string {
  const parsed = Number(current);
  const base = current.trim() === "" || !Number.isFinite(parsed) ? QUICK_ADD_PRICES_GBP[0] : parsed;
  const next = clampPriceGbp(base + direction * PRICE_STEP_GBP);
  return formatPriceGbp(next);
}

/** Format a numeric price for the input field: trim to at most 2 decimal
 *  places, no trailing zeros beyond what's needed (e.g. 4 -> "4", 4.5 ->
 *  "4.5", 4.9999999 -> "5"). */
export function formatPriceGbp(value: number): string {
  const rounded = roundToPenny(value);
  return String(rounded);
}

/** A quick-add chip's printed price. A preset stands beside real logged
 *  figures, so it carries both pence: "4.50", never the input field's "4.5". */
export function formatPriceChipGbp(value: number): string {
  return clampPriceGbp(value).toFixed(2);
}

// ── Price-first door ────────────────────────────────────────────────────────
// The composer opens on the price: chips, drink, one Log it action. Everything
// else (photo, story, vibes, visibility) waits behind one disclosure, so the
// first Pint Drop is never parked behind a camera step. These constants are the
// door's copy; the components read them so the words cannot drift per surface.

/** The one disclosure that reveals the optional half of the composer. */
export const SPILL_EXTRAS_TOGGLE_LABEL = "Add a photo or story";

/** The compact door's submit action. */
export const SPILL_LOG_ACTION_LABEL = "Log it";
export const SPILL_LOG_ACTION_BUSY_LABEL = "Logging…";

/** Signed-out line above the price step: the door stays open, the gate is the
 *  sign-in link where submit would be. Names the account rule plainly. */
export const SPILL_SIGNED_OUT_DOOR_LINE =
  "Set the price now. Sign in to post it under your name.";

/**
 * Whether the optional half starts open. A recovered draft that already
 * carries a story, company, an era, vibes, a photo, or a non-default lane must
 * stay in sight — collapsing it would hide what the writer already wrote.
 */
export function spillExtrasStartOpen(input: {
  price: string;
  note: string;
  withWho: string;
  era: string;
  vibeTags: readonly string[];
  hasPhoto: boolean;
  visibility: Visibility;
}): boolean {
  return (
    input.note.trim() !== "" ||
    input.withWho.trim() !== "" ||
    input.era.trim() !== "" ||
    input.vibeTags.length > 0 ||
    input.hasPhoto ||
    input.visibility !== DEFAULT_VISIBILITY
  );
}

export function spillHasSubmissionEvidence(input: {
  price: string;
  note: string;
  withWho: string;
}): boolean {
  return (
    input.price.trim() !== "" ||
    cleanPintDropText(appendWithSuffix(input.note, input.withWho), PINT_DROP_MAX_NOTE) !== ""
  );
}

// ── "With" field → structured note suffix ───────────────────────────────────
// The API has no `with` column (frozen contract) — the ponytail choice is to
// fold it into passedDownNote as a suffix at submit time: "— with @sam, @priya".
// This is intentionally lossy/append-only so every existing surface that
// renders passedDownNote (feed, permalink, ledger) gets "with" for free,
// without a migration. A real column can replace this later.
const WITH_SEPARATOR_RE = /[,\s]+/;
const MAX_WITH_ENTRIES = 6;
const MAX_WITH_ENTRY_LEN = 30;

/** Split a free-text "with" input into individual entries (comma and/or
 *  whitespace separated), trimmed, capped in count and per-entry length.
 *  A bare word is kept as free text; an `@handle`-shaped token keeps its `@`. */
export function parseWithEntries(value: string): string[] {
  if (typeof value !== "string") return [];
  const parts = value
    .split(WITH_SEPARATOR_RE)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.slice(0, MAX_WITH_ENTRY_LEN));
  const out: string[] = [];
  for (const part of parts) {
    if (!out.includes(part)) out.push(part);
    if (out.length >= MAX_WITH_ENTRIES) break;
  }
  return out;
}

/**
 * Build the structured suffix to append to a note, e.g. "— with @sam, @priya".
 * Returns "" when there's nothing to say, so callers can unconditionally
 * concatenate without extra branching.
 */
export function buildWithSuffix(withValue: string): string {
  const entries = parseWithEntries(withValue);
  if (entries.length === 0) return "";
  return `with ${entries.join(", ")}`;
}

/**
 * Append the "with" suffix onto a note, joining with a space when the note is
 * non-empty. Idempotent-ish in spirit (callers only call this once, at
 * submit time) but pure/deterministic either way.
 */
export function appendWithSuffix(note: string, withValue: string): string {
  const suffix = buildWithSuffix(withValue);
  if (!suffix) return note;
  const trimmedNote = note.trim();
  return trimmedNote ? `${trimmedNote} ${suffix}` : suffix;
}
