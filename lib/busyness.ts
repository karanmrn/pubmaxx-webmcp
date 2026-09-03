import { firstHttp } from "@/lib/httpUrl";

export type BusynessLevel = "quiet" | "moderate" | "busy" | "rammed";
export type BusynessSource = "typical-pattern" | "community-report";

export type BusynessReport = {
  level: Extract<BusynessLevel, "quiet" | "rammed">;
  reportedAt: string;
  reporterName?: string;
};

export type OpeningWindow = { opens: string; closes: string };
export type WeeklyOpeningHours = Partial<Record<number, OpeningWindow[]>>;

export type BusynessEstimate = {
  level: BusynessLevel;
  label: string;
  source: BusynessSource;
  isEstimate: true;
  isOpen: boolean | "unknown";
  reportCount: number;
  generatedAt: string;
  explanation: string;
};

export type LocalClock = { weekday: number; minutes: number };

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const GROUP_SIZE_WORDS = [
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
];
const REPORT_FRESHNESS_MS = 90 * 60 * 1_000;

// "Four of you" reads honest and specific; past a dozen, spell it as a
// numeral rather than reaching for words nobody says out loud.
function groupSizeWords(groupSize: number): string {
  const word = GROUP_SIZE_WORDS[groupSize - 1];
  return `${word ?? groupSize} of you`;
}

/**
 * The weekday and minute a zone is on. Building a formatter is the expensive
 * part of every open-now question, so a caller ranking a whole pool reads this
 * ONCE and asks `openStateAtClock` per venue.
 */
export function localClock(now: Date, timeZone: string): LocalClock {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value.toLowerCase() ?? "mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const weekday = WEEKDAYS.findIndex((day) => weekdayName.startsWith(day));
  return { weekday: weekday < 0 ? 1 : weekday, minutes: hour * 60 + minute };
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 29 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function windowCoversMinute(window: OpeningWindow, minutesSinceDayStart: number): boolean {
  const opens = parseClock(window.opens);
  const closes = parseClock(window.closes);
  if (opens === null || closes === null) return false;
  const adjustedClose = closes <= opens ? closes + 24 * 60 : closes;
  return minutesSinceDayStart >= opens && minutesSinceDayStart < adjustedClose;
}

export function openStateAtClock(
  clock: LocalClock,
  hours?: WeeklyOpeningHours,
): boolean | "unknown" {
  if (!hours) return "unknown";

  // A window that opened yesterday and crosses midnight is filed under
  // YESTERDAY's own weekday entry, not today's - so a venue can still be
  // open right now even though today's own schedule hasn't started yet
  // (or says the day is closed). Check that before today's own windows.
  const previousWeekday = (clock.weekday + 6) % 7;
  const yesterdayWindows = hours[previousWeekday];
  const stillOpenFromYesterday = (yesterdayWindows ?? []).some((window) =>
    windowCoversMinute(window, clock.minutes + 24 * 60),
  );
  if (stillOpenFromYesterday) return true;

  const windows = hours[clock.weekday];
  if (!windows) return "unknown";
  // Empty day list is evidence of a closed day, not a missing schedule.
  if (windows.length === 0) return false;
  return windows.some((window) => windowCoversMinute(window, clock.minutes));
}

/**
 * Whether listed weekly hours cover `now`. Missing hours stay `"unknown"` —
 * callers that filter must never treat unknown as closed.
 */
export function evaluateOpenState(input: {
  now?: Date;
  timeZone?: string;
  openingHours?: WeeklyOpeningHours;
}): boolean | "unknown" {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "Europe/London";
  return openStateAtClock(localClock(now, timeZone), input.openingHours);
}

function typicalLevel(weekday: number, minutes: number): BusynessLevel {
  const hour = minutes / 60;
  const fridayOrSaturday = weekday === 5 || weekday === 6;
  const weekdayAfterWork = weekday >= 1 && weekday <= 5 && hour >= 17 && hour < 20;

  if (fridayOrSaturday && hour >= 20 && hour < 23.5) return "busy";
  if (weekdayAfterWork) return weekday === 5 ? "busy" : "moderate";
  if (hour >= 12 && hour < 14) return "moderate";
  if (hour >= 20 && hour < 22.5) return "moderate";
  return "quiet";
}

function typicalLabel(level: BusynessLevel): string {
  if (level === "quiet") return "Usually quiet";
  if (level === "moderate") return "Usually steady";
  return "Usually busy";
}

export function estimateBusyness(input: {
  now?: Date;
  timeZone?: string;
  openingHours?: WeeklyOpeningHours;
  reports?: BusynessReport[];
}): BusynessEstimate {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "Europe/London";
  const clock = localClock(now, timeZone);
  const freshReports = (input.reports ?? []).filter((report) => {
    const reportedAt = Date.parse(report.reportedAt);
    return Number.isFinite(reportedAt) && reportedAt <= now.getTime()
      && now.getTime() - reportedAt <= REPORT_FRESHNESS_MS;
  });
  const latest = freshReports.sort(
    (a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt),
  )[0];
  const isOpen = openStateAtClock(clock, input.openingHours);

  if (latest) {
    return {
      level: latest.level,
      label: latest.level === "rammed" ? "Reported rammed" : "Reported quiet",
      source: "community-report",
      isEstimate: true,
      isOpen,
      reportCount: freshReports.length,
      generatedAt: now.toISOString(),
      explanation: "A recent community signal, not measured footfall or guaranteed entry.",
    };
  }

  const level = typicalLevel(clock.weekday, clock.minutes);
  return {
    level,
    label: typicalLabel(level),
    source: "typical-pattern",
    isEstimate: true,
    isOpen,
    reportCount: 0,
    generatedAt: now.toISOString(),
    explanation: "That's the usual pattern for this hour. We're not watching the door.",
  };
}

export type GroupFit = "likely" | "uncertain" | "unlikely" | "book-ahead";

export function canGroupGetIn(input: {
  groupSize: number;
  level: BusynessLevel;
  hasBookingLink: boolean;
  /** Drives the day-name in the "likely" reason copy. Defaults to now/London. */
  now?: Date;
  timeZone?: string;
}): { fit: GroupFit; label: string; reason: string } {
  const groupSize = Math.max(1, Math.min(30, Math.round(input.groupSize) || 1));
  if (input.hasBookingLink && groupSize >= 6 && ["busy", "rammed"].includes(input.level)) {
    return {
      fit: "book-ahead",
      label: "Book ahead",
      reason: `A group of ${groupSize} should book rather than rely on this estimate.`,
    };
  }
  if (groupSize >= 8 && ["busy", "rammed"].includes(input.level)) {
    return {
      fit: "unlikely",
      label: "Call ahead",
      reason: `A group of ${groupSize} may struggle at a usually busy time.`,
    };
  }
  if (groupSize >= 6 || input.level === "rammed") {
    return {
      fit: "uncertain",
      label: "Check before you go",
      reason: "Entry is uncertain; the venue has not confirmed space.",
    };
  }
  const dayName =
    WEEKDAY_NAMES[localClock(input.now ?? new Date(), input.timeZone ?? "Europe/London").weekday];
  return {
    fit: "likely",
    label: "Likely workable",
    reason: `${groupSizeWords(groupSize)} should get in fine, but no promises on a ${dayName}. If it matters, book.`,
  };
}

export function resolveBookingOption(bookingLink: string | null | undefined): {
  available: boolean;
  label: string;
  href: string | null;
  partner: null;
} {
  const href = firstHttp(bookingLink ?? "");
  return href
    ? { available: true, label: "Book a table", href, partner: null }
    : { available: false, label: "Booking link unavailable", href: null, partner: null };
}
