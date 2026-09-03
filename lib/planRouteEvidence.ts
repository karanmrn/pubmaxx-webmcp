import { priceConfidence, type PriceConfidenceState } from "@/lib/priceConfidence";
import type { PlanAccessibilityNeed } from "@/lib/planIntake";
import { DAY_MS } from "@/lib/dayMs";

const LONDON_TIME_ZONE = "Europe/London";
export const OPENING_EVIDENCE_FRESH_DAYS = 30;

export type EvidenceSource = {
  label: string;
  url: string;
  observedAt: string;
};

export type AccessEvidenceSource = Omit<EvidenceSource, "observedAt"> & {
  /** The current seed records only a capture month, so no exact day is invented. */
  observedAt: string | null;
};

export type PlanPriceEvidence = {
  pence: number | null;
  source: EvidenceSource | null;
  confidenceState: PriceConfidenceState | "unknown";
};

export type ConfirmedFact = { confirmed: true; source: AccessEvidenceSource };
export type WeeklyTimeRange = {
  weekday: string;
  startsAt: string;
  endsAt: string;
};

export type PlanAccessEvidence = {
  stepFree?: ConfirmedFact;
  accessibleToilet?: ConfirmedFact;
  /** Seating is deliberately distinct from seated table service. */
  seating?: ConfirmedFact;
  /** Quiet evidence must contain machine-readable weekly time ranges. */
  lowNoise?: { ranges: WeeklyTimeRange[]; source: AccessEvidenceSource };
};

export type WeeklyOpeningRange = WeeklyTimeRange;
export type PlanOpeningSchedule = {
  ranges: WeeklyOpeningRange[];
  source: EvidenceSource;
  venueListedOpen: boolean;
};

export type OpeningAssessment = {
  state: "listed_open" | "listed_closed" | "unknown";
  source: EvidenceSource | null;
  warning: string | null;
};

function validIso(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validPence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function buildPriceEvidence(input: {
  pence: unknown;
  label: unknown;
  url: unknown;
  observedAt: unknown;
  now: number;
}): PlanPriceEvidence {
  if (
    !validPence(input.pence)
    || typeof input.label !== "string"
    || !input.label.trim()
    || typeof input.url !== "string"
    || !/^https?:\/\//.test(input.url)
    || typeof input.observedAt !== "string"
    || validIso(input.observedAt) === null
    || validIso(input.observedAt)! > input.now
  ) return { pence: null, source: null, confidenceState: "unknown" };
  const observedAt = new Date(Date.parse(input.observedAt)).toISOString();
  const confidenceState = priceConfidence({
    confirms: 0,
    lastConfirmedAt: null,
    priceObservedAt: Date.parse(observedAt),
  }, input.now).state;
  return {
    pence: input.pence,
    source: { label: input.label.trim(), url: input.url, observedAt },
    confidenceState,
  };
}

/** An explicit ceiling can only use attributable, non-stale canonical prices. */
export function priceEvidenceUsableForCeiling(evidence: PlanPriceEvidence): boolean {
  return validPence(evidence.pence)
    && evidence.source !== null
    && (evidence.confidenceState === "fresh" || evidence.confidenceState === "aging");
}

function londonClock(iso: string): { weekday: string; minute: number; localDay: number } | null {
  if (validIso(iso) === null) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return weekday
    && Number.isInteger(year)
    && Number.isInteger(month)
    && Number.isInteger(day)
    && Number.isFinite(hour)
    && Number.isFinite(minute)
    ? { weekday, minute: hour * 60 + minute, localDay: Date.UTC(year, month - 1, day) / DAY_MS }
    : null;
}

function rangeMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 29 && minute <= 59 ? hour * 60 + minute : null;
}

function containingRangeOccurrences(ranges: readonly WeeklyTimeRange[], iso: string): Set<string> {
  const clock = londonClock(iso);
  if (!clock) return new Set();
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const index = weekdays.indexOf(clock.weekday);
  if (index < 0) return new Set();
  const occurrences = new Set<string>();
  for (const offset of [0, -1]) {
    const weekday = weekdays[(index + offset + 7) % 7];
    for (const [rangeIndex, range] of ranges.entries()) {
      if (range.weekday !== weekday) continue;
      const starts = rangeMinute(range.startsAt);
      const ends = rangeMinute(range.endsAt);
      if (starts === null || ends === null) continue;
      const adjustedEnd = ends <= starts ? ends + 24 * 60 : ends;
      const minute = offset === -1 ? clock.minute + 24 * 60 : clock.minute;
      if (minute >= starts && minute < adjustedEnd) {
        occurrences.add(`${rangeIndex}:${clock.localDay + offset}`);
      }
    }
  }
  return occurrences;
}

function rangeContains(ranges: readonly WeeklyTimeRange[], iso: string): boolean {
  return containingRangeOccurrences(ranges, iso).size > 0;
}

export function accessNeedSatisfied(
  evidence: PlanAccessEvidence,
  need: PlanAccessibilityNeed,
  visitStartsAt: string | null,
): boolean {
  switch (need) {
    case "step-free": return evidence.stepFree?.confirmed === true;
    case "accessible-toilet": return evidence.accessibleToilet?.confirmed === true;
    case "seating": return evidence.seating?.confirmed === true;
    case "low-noise":
      return visitStartsAt !== null
        && Boolean(evidence.lowNoise?.source)
        && rangeContains(evidence.lowNoise?.ranges ?? [], visitStartsAt);
  }
}

function intervalIsListedOpen(schedule: PlanOpeningSchedule, startsAt: string, endsAt: string): boolean {
  const startTimestamp = validIso(startsAt);
  const endTimestamp = validIso(endsAt);
  if (startTimestamp === null || endTimestamp === null || endTimestamp <= startTimestamp) return false;
  const startOccurrences = containingRangeOccurrences(schedule.ranges, startsAt);
  const endOccurrences = containingRangeOccurrences(
    schedule.ranges,
    new Date(endTimestamp - 1).toISOString(),
  );
  return [...startOccurrences].some((occurrence) => endOccurrences.has(occurrence));
}

export function assessOpeningSchedule(
  schedule: PlanOpeningSchedule | null,
  visit: { startsAt: string; endsAt: string } | null,
  now: number,
): OpeningAssessment {
  if (!visit) return { state: "unknown", source: null, warning: null };
  if (!schedule) return { state: "unknown", source: null, warning: "Opening hours are not checked for this visit." };
  const observed = validIso(schedule.source.observedAt);
  const ageDays = observed === null ? Number.POSITIVE_INFINITY : (now - observed) / DAY_MS;
  if (ageDays < 0 || ageDays > OPENING_EVIDENCE_FRESH_DAYS) {
    return { state: "unknown", source: schedule.source, warning: "The venue's regular opening hours are stale." };
  }
  if (!schedule.venueListedOpen) return { state: "listed_closed", source: schedule.source, warning: null };
  if (!intervalIsListedOpen(schedule, visit.startsAt, visit.endsAt)) {
    return { state: "listed_closed", source: schedule.source, warning: null };
  }
  return {
    state: "listed_open",
    source: schedule.source,
    warning: "Listed recurring hours cover this visit, but holiday and one-off exceptions may differ; check before relying on it.",
  };
}
