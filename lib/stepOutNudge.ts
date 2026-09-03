// Step Out weekly nudge — place-bound, opt-in, one push per week maximum.
// Pure payload builders and gates. Selection against live stores lives in
// lib/stepOutNudgeSelect.server.ts. Never invents filler; never uses streak /
// "haven't been out" / drink-more pressure language.

import { DAY_MS } from "@/lib/dayMs";

export const STEP_OUT_NUDGE_WEEK_MS = 7 * DAY_MS;
export const STEP_OUT_NUDGE_MAX_WALK_MINUTES = 25;
export const STEP_OUT_NUDGE_THREAD_ID = "step-out";

export const STEP_OUT_NUDGE_KINDS = [
  "wanted_nearby",
  "soft_plan_open",
  "deal_ending",
] as const;
export type StepOutNudgeKind = (typeof STEP_OUT_NUDGE_KINDS)[number];

/** Priority for owed payloads: Wanted, then Soft Plan, then a sourced deal. */
export const STEP_OUT_NUDGE_KIND_PRIORITY: readonly StepOutNudgeKind[] = [
  "wanted_nearby",
  "soft_plan_open",
  "deal_ending",
];

export type StepOutNudgePayload = {
  kind: StepOutNudgeKind;
  title: string;
  body: string;
  url: string;
  /** First-party source label when the owed claim is a deal. */
  sourceLabel?: string;
};

const BANNED_BODY =
  /\b(haven't been out|have not been out|streak|drink more|don't miss out|dont miss out|you should drink)\b/i;

/** True when this subscription may receive another Step Out push. */
export function canSendStepOutNudge(
  lastSentAt: string | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  if (!lastSentAt) return true;
  const sentMs = Date.parse(lastSentAt);
  if (!Number.isFinite(sentMs)) return true;
  const nowMs = typeof now === "number" ? now : now.getTime();
  return nowMs - sentMs >= STEP_OUT_NUDGE_WEEK_MS;
}

/** Refuse any payload that smuggles pressure or streak language. */
export function isAllowedStepOutNudgeCopy(text: string): boolean {
  return !BANNED_BODY.test(text);
}

export function composeWantedNearbyNudge(input: {
  venueName: string;
  walkMinutes: number;
  venueId?: string;
}): StepOutNudgePayload | null {
  const name = input.venueName.trim();
  const minutes = Math.round(input.walkMinutes);
  if (!name || !Number.isFinite(minutes) || minutes < 1) return null;
  if (minutes > STEP_OUT_NUDGE_MAX_WALK_MINUTES) return null;
  const body = `Your Wanted ${name} is a ${minutes}-min walk from you-ish.`;
  if (!isAllowedStepOutNudgeCopy(body)) return null;
  const url = input.venueId
    ? `/map?sel=${encodeURIComponent(input.venueId)}`
    : "/u/you#wanted";
  return {
    kind: "wanted_nearby",
    title: "Step out",
    body,
    url,
  };
}

export function composeSoftPlanOpenNudge(input?: {
  planId?: string;
}): StepOutNudgePayload {
  const body = "Your Soft Plan for tonight is still open.";
  return {
    kind: "soft_plan_open",
    title: "Step out",
    body,
    url: input?.planId
      ? `/plan/${encodeURIComponent(input.planId)}`
      : "/tonight",
  };
}

/** Format an endsAt ISO as a short London clock label, e.g. "21:00". */
export function formatDealEndsLabel(
  endsAt: string,
  timeZone = "Europe/London",
): string | null {
  const ms = Date.parse(endsAt);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!hour || !minute) return null;
  return `${hour}:${minute}`;
}

export function composeDealEndingNudge(input: {
  dealTitle: string;
  placeName: string;
  endsAt: string;
  sourceLabel: string;
  venueId?: string;
}): StepOutNudgePayload | null {
  const deal = input.dealTitle.trim();
  const place = input.placeName.trim();
  const source = input.sourceLabel.trim();
  const ends = formatDealEndsLabel(input.endsAt);
  if (!deal || !place || !source || !ends) return null;
  const body = `${deal} at ${place} ends ${ends}. Source: ${source}.`;
  if (!isAllowedStepOutNudgeCopy(body)) return null;
  const url = input.venueId
    ? `/map?sel=${encodeURIComponent(input.venueId)}`
    : "/tonight";
  return {
    kind: "deal_ending",
    title: "Step out",
    body,
    url,
    sourceLabel: source,
  };
}

/**
 * Pick the highest-priority owed payload. Missing candidates are skipped; an
 * empty list returns null so the sender never invents filler.
 */
export function selectStepOutNudge(
  candidates: ReadonlyArray<StepOutNudgePayload | null | undefined>,
): StepOutNudgePayload | null {
  const byKind = new Map<StepOutNudgeKind, StepOutNudgePayload>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!isAllowedStepOutNudgeCopy(candidate.body)) continue;
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, candidate);
  }
  for (const kind of STEP_OUT_NUDGE_KIND_PRIORITY) {
    const hit = byKind.get(kind);
    if (hit) return hit;
  }
  return null;
}
