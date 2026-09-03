// BROWSER-SAFE pure module: turns a price-confirm tally into an honest
// confidence read for the venue sheet's Golden Thread. No IO, no Date.now()
// defaults at module scope — callers pass `now` so the maths is testable and
// SSR-stable.
//
// Why these thresholds (documented, not vibes):
//   • FRESH  — a distinct confirmer vouched within 14 days. London pub prices
//     move on brewery/quarterly cycles, not daily; a fortnight-old vouch from a
//     stranger is still meaningful, and 14d spans two pub-weeks (the weekly
//     quiz/round rhythm most regulars keep).
//   • AGING  — the last signal (confirm OR the observation itself) is 14–60
//     days old. Nothing is wrong with the price; we just stop implying the
//     community has recently checked. The plaque keeps its dignity, the label
//     goes quiet.
//   • STALE  — no signal for 60+ days (two typical price-review cycles). The
//     price still renders (an old truth beats a blank), but visibly humbler,
//     and the copy invites a fresh look instead of asserting accuracy.
//
// The label NEVER invents activity: "×3 this week" requires real windowed
// confirms; "vouched this week"/"vouched recently" require a real timestamp.
// A price with zero confirm history simply shows no confidence line — absence
// of signal is not a state we dress up.

import { DAY_MS } from "@/lib/dayMs";

export type PriceConfidenceState = "fresh" | "aging" | "stale";

export const CONFIRM_WINDOW_DAYS = 7;
export const FRESH_WITHIN_DAYS = 14;
export const STALE_AFTER_DAYS = 60;

export type PriceConfidenceInput = {
  /** Distinct confirmers, all time. */
  confirms: number;
  /** Epoch ms of the latest confirmation, or null when never confirmed. */
  lastConfirmedAt: number | null;
  /** Distinct confirmers within the last CONFIRM_WINDOW_DAYS, when known. */
  recentConfirms?: number | null;
  /** Epoch ms the displayed price itself was observed, when known. */
  priceObservedAt?: number | null;
};

export type PriceConfidence = {
  state: PriceConfidenceState;
  /**
   * Short, dry line for the plaque ("×3 this week", "vouched this week",
   * "vouched recently"), or null when there is nothing honest to say.
   */
  label: string | null;
};

/** The most recent moment anyone stood behind this price, or null. */
function latestSignalAt(input: PriceConfidenceInput): number | null {
  const stamps = [input.lastConfirmedAt, input.priceObservedAt].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (stamps.length === 0) return null;
  return Math.max(...stamps);
}

export function priceConfidence(
  input: PriceConfidenceInput,
  now: number,
): PriceConfidence {
  const signalAt = latestSignalAt(input);
  const ageDays = signalAt === null ? Infinity : (now - signalAt) / DAY_MS;

  const state: PriceConfidenceState =
    ageDays <= FRESH_WITHIN_DAYS ? "fresh" : ageDays <= STALE_AFTER_DAYS ? "aging" : "stale";

  // Labels only ever describe real confirm activity — the observation keeps a
  // price "fresh" but earns no community wording of its own.
  let label: string | null = null;
  const recent = input.recentConfirms ?? null;
  const confirmedAt = input.lastConfirmedAt;
  const confirmAgeDays =
    typeof confirmedAt === "number" && Number.isFinite(confirmedAt)
      ? (now - confirmedAt) / DAY_MS
      : null;

  if (typeof recent === "number" && recent > 1) {
    label = `×${recent} this week`;
  } else if (typeof recent === "number" && recent === 1) {
    label = "vouched this week";
  } else if (confirmAgeDays !== null && confirmAgeDays <= FRESH_WITHIN_DAYS) {
    label = "vouched recently";
  } else if (state === "stale") {
    label = "worth a fresh look";
  }

  return { state, label };
}
