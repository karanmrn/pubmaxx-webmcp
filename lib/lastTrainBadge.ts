// "Made the last train" transport-context badge — pure, unit-tested, no network,
// no clock of its own (every input is passed in). This is IDEAS doc A5 / PRD user
// story 36: a Spill carries an HONEST fragment of its night's transport context.
//
// THE HONESTY MODEL (why the copy is what it is)
// ------------------------------------------------
// We know exactly three things and nothing more:
//   1. dropCreatedAt — the ISO instant the Spill was posted.
//   2. leaveByIso    — the "leave the pub by" instant the Last Pint decision
//                      computed at post time (now + minutesUntilLastTrain - walk).
//   3. decision      — which live LastPintDecisionKind was on screen then.
//
// We do NOT know whether the drinker actually boarded a train. So we NEVER stamp
// "made the last train" as a claim of fact. We only ever say what the timestamps
// prove: the Spill was posted while a LIVE last-train decision was showing, on one
// side or the other of its leave-by clock.
//   • Posted at/before leave-by  → "before the last train"  (they still had time).
//   • Posted after leave-by      → "after the last train"   (the safe window had
//                                   passed by the time they posted — still honest,
//                                   the classic "one more and stranded" story).
// The badge is null whenever we can't back a claim with data:
//   • no leaveByIso (null / unparseable),
//   • no dropCreatedAt (null / unparseable),
//   • the decision was live_data_unavailable (TfL was down — a guess, not a fact),
//   • no decision at all (Spill composed without an active Last Pint session).
//
// All comparisons are done on epoch millis parsed from ISO strings, so the result
// is timezone-safe: two instants are compared, never wall-clock strings.

import type { LastPintDecisionKind } from "@/lib/tfl";

// The rendered badge. `tone` lets the surface pick a colour without re-deriving
// the meaning: "safe" = posted with time to spare, "risk" = posted after the
// leave-by clock. Kept deliberately tiny — a display atom, not a stored record.
export type LastTrainBadge = {
  label: string;
  tone: "safe" | "risk";
};

// The decision kinds that represent a GENUINE live last-train verdict — i.e. TfL
// was reachable and produced a real leave-by time. `live_data_unavailable` is
// excluded on purpose: it means we could not reach TfL, so any badge would be a
// guess dressed as a fact, which is exactly the failure mode A5 warns against.
const LIVE_DECISION_KINDS: ReadonlySet<LastPintDecisionKind> = new Set([
  "order_one_more",
  "half_pint_only",
  "settle_up_now",
  "train_risk",
]);

/** True when `kind` is a genuine live Last Pint verdict (not TfL-down / unknown). */
export function isLiveLastTrainDecision(
  kind: LastPintDecisionKind | string | null | undefined,
): kind is LastPintDecisionKind {
  return typeof kind === "string" && LIVE_DECISION_KINDS.has(kind as LastPintDecisionKind);
}

/**
 * Fields to stamp onto a Spill create payload when a LIVE Last Pint decision is
 * on screen (Wave G1). Returns null when TfL was down, leave-by is missing, or
 * there is no decision — never invent transport context at compose time.
 */
export type LastTrainComposeFields = {
  leaveByIso: string;
  lastTrainDecision: LastPintDecisionKind;
};

export function lastTrainComposeFields(
  decision:
    | { decision: LastPintDecisionKind; leaveByIso: string | null }
    | null
    | undefined,
): LastTrainComposeFields | null {
  if (!decision) return null;
  if (!isLiveLastTrainDecision(decision.decision)) return null;
  if (typeof decision.leaveByIso !== "string" || decision.leaveByIso === "") return null;
  if (Number.isNaN(Date.parse(decision.leaveByIso))) return null;
  return {
    leaveByIso: decision.leaveByIso,
    lastTrainDecision: decision.decision,
  };
}

// Parse an ISO instant to epoch millis, or null if it's missing/unparseable.
// Never throws — a bad timestamp degrades to "no badge", never a crash.
function toMillis(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso === "") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * The honest transport-context badge for a Spill, or null when we can't back a
 * claim with data. Pure: pass the drop's post time, the leave-by time the Last
 * Pint decision computed at that moment, and which decision it was.
 *
 * @param dropCreatedAt ISO instant the Spill was posted.
 * @param leaveByIso    ISO leave-by instant from the active LastPintDecision
 *                      (its `leaveByIso` field), or null when there wasn't one.
 * @param decision      The active LastPintDecisionKind, or null/undefined when no
 *                      Last Pint session was live at post time.
 */
export function lastTrainBadge(
  dropCreatedAt: string | null | undefined,
  leaveByIso: string | null | undefined,
  decision: LastPintDecisionKind | null | undefined,
): LastTrainBadge | null {
  // No live decision → nothing honest to say.
  if (!isLiveLastTrainDecision(decision)) return null;

  const postedAt = toMillis(dropCreatedAt);
  const leaveBy = toMillis(leaveByIso);
  if (postedAt === null || leaveBy === null) return null;

  // Posted at or before the leave-by clock: they still had time when they Spilled.
  // Posted after it: the safe window had already passed. Either way we only assert
  // the timestamp relationship — never that a train was actually caught.
  if (postedAt <= leaveBy) {
    return { label: "before the last train", tone: "safe" };
  }
  return { label: "after the last train", tone: "risk" };
}
