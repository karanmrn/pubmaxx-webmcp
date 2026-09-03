// Weekday 5pm cheap-pint ping — one lifetime web push after the first pint
// drop or saved favourite pint. Opt-in, grounded listed prices only, no
// growth or streak language. Selection lives in cheapPintPingSelect.server.ts.

import { formatGbp } from "@/lib/formatGbp";
import { londonHour } from "@/lib/londonHour";

export const CHEAP_PINT_PING_THREAD_ID = "cheap-pint-ping";
export const CHEAP_PINT_PING_LONDON_HOUR = 17;

const BANNED_BODY =
  /\b(haven't been out|have not been out|streak|drink more|don't miss out|dont miss out|you should drink|subscribe|unsubscribe)\b/i;

export type CheapPintPingPayload = {
  title: string;
  body: string;
  url: string;
  venueId: string;
  priceLabel: string;
};

export type CheapPintPrefView = {
  qualified: boolean;
  enabled: boolean;
  declined: boolean;
  sentAt: string | null;
};

/** Monday = 0 … Sunday = 6 in Europe/London. */
export function londonWeekdayMon0(now: Date): number {
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[label] ?? 0;
}

/** Weekday 5pm Europe/London — the only send window. */
export function isCheapPintPingWindow(now: Date): boolean {
  const dow = londonWeekdayMon0(now);
  if (dow > 4) return false;
  return londonHour(now) === CHEAP_PINT_PING_LONDON_HOUR;
}

export function canPromptCheapPint(pref: CheapPintPrefView): boolean {
  return pref.qualified && !pref.declined && !pref.enabled;
}

export function canSendCheapPint(pref: CheapPintPrefView, now: Date = new Date()): boolean {
  return (
    pref.qualified &&
    pref.enabled &&
    !pref.declined &&
    !pref.sentAt &&
    isCheapPintPingWindow(now)
  );
}

export function isAllowedCheapPintCopy(text: string): boolean {
  return !BANNED_BODY.test(text);
}

export function composeCheapPintPing(input: {
  venueName: string;
  priceGbp: number;
  venueId: string;
  walkMinutes: number;
  areaName?: string | null;
}): CheapPintPingPayload | null {
  const name = input.venueName.trim();
  const minutes = Math.round(input.walkMinutes);
  if (!name || !Number.isFinite(input.priceGbp) || input.priceGbp <= 0) return null;
  if (!Number.isFinite(minutes) || minutes < 1) return null;
  const priceLabel = formatGbp(input.priceGbp);
  const areaSuffix = input.areaName?.trim()
    ? ` near ${input.areaName.trim()}`
    : " nearby";
  const body = `${priceLabel} at ${name}, about ${minutes} min walk${areaSuffix}.`;
  if (!isAllowedCheapPintCopy(body)) return null;
  return {
    title: "Cheap pint nearby",
    body,
    url: `/map?sel=${encodeURIComponent(input.venueId)}`,
    venueId: input.venueId,
    priceLabel,
  };
}

export function cheapPintPrefView(row: {
  cheapPintQualified: boolean;
  cheapPintEnabled: boolean;
  cheapPintDeclined: boolean;
  cheapPintSentAt: string | null;
}): CheapPintPrefView {
  return {
    qualified: row.cheapPintQualified,
    enabled: row.cheapPintEnabled,
    declined: row.cheapPintDeclined,
    sentAt: row.cheapPintSentAt,
  };
}
