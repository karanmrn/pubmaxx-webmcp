// Pure logic for the mid-crawl Night-crawl surface (U7). NO React, NO DOM — just
// the arithmetic and vocabulary the card-stack surface (components/plan/
// NightCrawlMode) is built from, so every behaviour the brief names (hero
// advances on arrived, skip advances, done stops carry their disposition, honest
// failure copy) is unit-testable in the node environment the repo runs vitest in
// (UI components themselves are covered by the Playwright E2E suite).
//
// The surface is a single urgency-ranked stack around one cursor:
//   • stops BEFORE the cursor are DONE — each shrunk to a quiet row that shows
//     whether the crew arrived or skipped it (read from the plan's action log).
//   • the cursor stop is the HERO — the place you're walking to now.
//   • stops AFTER the cursor are UPCOMING — compact, waiting their turn.
// The cursor is user-advanced only (a tap on We-are-here / Skip), never guessed.

import { clampStopIndex } from "@/lib/activePlan";
import type { PlanActionDTO, PlanStopDTO } from "@/lib/plan";

export type NightCrawlActionType = "arrived" | "skipped";
export type StopDisposition = NightCrawlActionType;
export type NightCrawlSlot = "done" | "current" | "upcoming";

export type NightCrawlStopView = {
  stop: PlanStopDTO;
  /** Position in the position-sorted stack (0-based), not the raw stop.position. */
  index: number;
  slot: NightCrawlSlot;
  /** For a done row only: how that stop was left. Null for current/upcoming. */
  disposition: StopDisposition | null;
};

/** Stops sorted by their stored position — never insertion order. */
function orderedStops(stops: readonly PlanStopDTO[]): PlanStopDTO[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

/**
 * The latest recorded disposition for a stop position: an optimistic (in-flight,
 * not-yet-confirmed) tap wins over the server log so the row flips on the same
 * frame as the tap; otherwise the last arrived/skipped action for that position
 * is authoritative. Null when the stop was never actioned.
 */
export function stopDisposition(
  actions: readonly PlanActionDTO[] | undefined,
  position: number,
  optimistic?: Readonly<Record<number, NightCrawlActionType>>,
): StopDisposition | null {
  const pending = optimistic?.[position];
  if (pending) return pending;
  if (!actions) return null;
  let latest: StopDisposition | null = null;
  for (const action of actions) {
    if (action.stopPosition === position && (action.type === "arrived" || action.type === "skipped")) {
      latest = action.type;
    }
  }
  return latest;
}

/**
 * The full stack the surface renders, position-sorted and sliced by the cursor.
 * An empty stop list yields an empty stack; a cursor past the end is clamped to
 * the last stop (you can never point past the final pub).
 */
export function nightCrawlStack(
  stops: readonly PlanStopDTO[],
  cursor: number,
  actions?: readonly PlanActionDTO[],
  optimistic?: Readonly<Record<number, NightCrawlActionType>>,
): NightCrawlStopView[] {
  const ordered = orderedStops(stops);
  if (ordered.length === 0) return [];
  const safeCursor = clampStopIndex(cursor, ordered.length);
  return ordered.map((stop, index) => ({
    stop,
    index,
    slot: index < safeCursor ? "done" : index === safeCursor ? "current" : "upcoming",
    disposition: index < safeCursor ? stopDisposition(actions, stop.position, optimistic) : null,
  }));
}

/** The hero stop (the one the crew is heading to now), or null for an empty plan. */
export function nightCrawlHero(stops: readonly PlanStopDTO[], cursor: number): PlanStopDTO | null {
  const ordered = orderedStops(stops);
  if (ordered.length === 0) return null;
  return ordered[clampStopIndex(cursor, ordered.length)] ?? null;
}

/** True when the hero is the last pub of the night — no stop left to advance to. */
export function isFinalStop(stops: readonly PlanStopDTO[], cursor: number): boolean {
  const count = orderedStops(stops).length;
  return count > 0 && clampStopIndex(cursor, count) === count - 1;
}

/** Advance the cursor one stop, clamped so it never walks past the last pub. */
export function advanceNightCrawl(cursor: number, stopCount: number): number {
  return clampStopIndex(cursor + 1, stopCount);
}

/** The action POST body for arriving at / skipping a given hero stop. */
export function nightCrawlActionPayload(
  type: NightCrawlActionType,
  stop: PlanStopDTO,
): { type: NightCrawlActionType; stopPosition: number } {
  return { type, stopPosition: stop.position };
}

/**
 * Idempotency scope for a single arrive/skip on a stop — stable across retries of
 * the SAME tap (so an offline retry replays, never double-writes), distinct per
 * plan, action, and stop position (so different taps get different keys).
 */
export function nightCrawlIdempotencyScope(planId: string, type: NightCrawlActionType, position: number): string {
  return `night-crawl-action:${planId}:${type}:${position}`;
}

// ── Outcome vocabulary + honest copy ────────────────────────────────────────
// The surface must never apologise-first or invent success. A tap resolves to
// exactly one of these, and the caller reconciles its optimistic state from it:
//   confirmed → 2xx; the response carries the canonical plan, adopt it.
//   rejected  → a 4xx the retry can't fix on its own (bad request/stale); roll
//               the optimistic advance back so the hero honestly returns.
//   forbidden → 403; the viewer isn't a checked-in crew member — roll back and
//               point them at joining, never fake the check-in.
//   offline   → network drop or 5xx; keep advance only when the mutation is
//               queued in the client outbox, otherwise roll back honestly.
export type NightCrawlOutcome = "confirmed" | "rejected" | "forbidden" | "offline";
export type NightCrawlHandoffTarget = "crawl" | "ending" | "arrival_required";

/**
 * A final Crawl Stop hands off only after its action is durable. A held offline
 * action stays in Crawl mode until the outbox later confirms it, so a local
 * optimistic mark can never unlock the completion flow on its own.
 */
export function nightCrawlHandoffTarget({
  stops,
  actions,
  stopPosition,
  outcome,
}: {
  stops: readonly PlanStopDTO[];
  actions: readonly PlanActionDTO[] | undefined;
  stopPosition: number;
  outcome: NightCrawlOutcome;
}): NightCrawlHandoffTarget {
  if (outcome !== "confirmed") return "crawl";
  const ordered = orderedStops(stops);
  if (ordered.at(-1)?.position !== stopPosition) return "crawl";
  return actions?.some((action) => action.type === "arrived")
    ? "ending"
    : "arrival_required";
}

export type NightCrawlActionReconciliation = {
  cursor: number;
  optimistic: Record<number, NightCrawlActionType>;
  note: {
    text: string;
    tone: Exclude<NightCrawlOutcome, "confirmed"> | "pending";
  } | null;
};

export function classifyActionOutcome(statusOrError: number | "network"): NightCrawlOutcome {
  if (statusOrError === "network") return "offline";
  if (statusOrError >= 200 && statusOrError < 300) return "confirmed";
  if (statusOrError >= 500) return "offline";
  if (statusOrError === 403) return "forbidden";
  return "rejected";
}

/** Whether an outcome keeps the optimistic advance. Confirmed always does;
 * offline only when the client outbox accepted the mutation. */
export function outcomeKeepsOptimistic(
  outcome: NightCrawlOutcome,
  options?: { queued?: boolean },
): boolean {
  if (outcome === "confirmed") return true;
  return outcome === "offline" && options?.queued === true;
}

/**
 * Honest feedback for a failed or held tap. Confirmed taps need no note because
 * the stack speaks for itself. Queued offline holds never promise a sync.
 */
export function nightCrawlActionNote(
  type: NightCrawlActionType,
  venueName: string,
  outcome: Exclude<NightCrawlOutcome, "confirmed">,
  options?: { queued?: boolean },
): string {
  void type;
  void venueName;
  if (outcome === "offline" && options?.queued) {
    return "Held on this phone. We will try again when you have signal.";
  }
  return "That did not save. Try again when you have signal.";
}

/** Resolve temporary action state after the write returns (or is queued). */
export function reconcileNightCrawlAction({
  outcome,
  type,
  venueName,
  stopPosition,
  previousCursor,
  optimisticCursor,
  optimistic,
  queued = false,
}: {
  outcome: NightCrawlOutcome;
  type: NightCrawlActionType;
  venueName: string;
  stopPosition: number;
  previousCursor: number;
  optimisticCursor: number;
  optimistic: Readonly<Record<number, NightCrawlActionType>>;
  queued?: boolean;
}): NightCrawlActionReconciliation {
  const settledOptimistic = { ...optimistic };

  if (outcome === "confirmed") {
    delete settledOptimistic[stopPosition];
    return { cursor: optimisticCursor, optimistic: settledOptimistic, note: null };
  }

  if (outcomeKeepsOptimistic(outcome, { queued })) {
    // Keep the mark so the done row stays honest as a local hold.
    return {
      cursor: optimisticCursor,
      optimistic: settledOptimistic,
      note: {
        text: nightCrawlActionNote(type, venueName, outcome, { queued }),
        tone: "pending",
      },
    };
  }

  delete settledOptimistic[stopPosition];
  return {
    cursor: previousCursor,
    optimistic: settledOptimistic,
    note: {
      text: nightCrawlActionNote(type, venueName, outcome, { queued }),
      tone: outcome,
    },
  };
}

/** Next stop after the hero, for the mid-crawl glance strip. */
export function nightCrawlNextStop(
  stops: readonly PlanStopDTO[],
  cursor: number,
): PlanStopDTO | null {
  const ordered = orderedStops(stops);
  if (ordered.length === 0) return null;
  const safe = clampStopIndex(cursor, ordered.length);
  return ordered[safe + 1] ?? null;
}

/** Glance copy: current stop, optional next name, get-home affordance label. */
export function nightCrawlGlance(input: {
  currentName: string | null;
  nextName: string | null;
  stopIndex: number;
  stopCount: number;
}): { currentLine: string; nextLine: string | null; homeLine: string } {
  const currentLine =
    input.currentName && input.stopCount > 0
      ? `Now · ${input.currentName}`
      : "No stops yet";
  const nextLine = input.nextName ? `Then · ${input.nextName}` : null;
  return {
    currentLine,
    nextLine,
    homeLine: "Get me home",
  };
}
