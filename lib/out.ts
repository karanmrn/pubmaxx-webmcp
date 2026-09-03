import type { OutDay } from "@/lib/out/types";
import {
  OPEN_PLAN_LIST_LIMIT,
  type OpenPlanPlaceKind,
} from "@/lib/openSocialCrew";

export const OUT_OPEN_PLAN_LIMIT = OPEN_PLAN_LIST_LIMIT;

/**
 * The resolved Stop 1 a card renders: the place name plus its map point. It is
 * filled from the venue index or the ambient POI layer on the read, never
 * stored, so a renamed pub or a moved dot cannot go stale inside a plan.
 */
export type OutOpenPlanMeetingPoint = {
  kind: OpenPlanPlaceKind;
  name: string;
  lat: number;
  lng: number;
};

export type OutOpenPlan = {
  crewId: string;
  title: string;
  startTime: string;
  stopVenueId: string | null;
  stopVenueName: string | null;
  hostHandle: string;
  memberCount: number;
  /** Absent until the city read resolves Stop 1; a listed plan always has one. */
  meetingPoint: OutOpenPlanMeetingPoint | null;
};

/**
 * Inclusive window for list_open_social_crews. Today starts at the London
 * service-day open through 05:00 the next morning. Tomorrow is the next
 * service day. Weekend is Fri 17:00 through Sun 05:00.
 */
export type OutPlanWindow = { from: string; until: string };

type LondonClock = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
};

function londonClock(now: number = Date.now()): LondonClock {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(now));
  const weekdayName = (parts.find((part) => part.type === "weekday")?.value ?? "Mon").toLowerCase();
  const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].findIndex((day) => weekdayName.startsWith(day));
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? 0),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 1),
    day: Number(parts.find((part) => part.type === "day")?.value ?? 1),
    weekday: weekday === -1 ? 1 : weekday,
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
  };
}

function londonOffsetMs(base: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(base);
  const asIfUtc = Date.UTC(
    Number(parts.find((part) => part.type === "year")?.value ?? 0),
    Number(parts.find((part) => part.type === "month")?.value ?? 1) - 1,
    Number(parts.find((part) => part.type === "day")?.value ?? 1),
    Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    Number(parts.find((part) => part.type === "minute")?.value ?? 0),
    Number(parts.find((part) => part.type === "second")?.value ?? 0),
  );
  return asIfUtc - Math.floor(base.getTime() / 1000) * 1000;
}

function londonWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  let instant = wallAsUtc - londonOffsetMs(new Date(wallAsUtc));
  instant -= londonOffsetMs(new Date(instant));
  return instant;
}

function londonDate(year: number, month: number, day: number, plusDays: number): {
  year: number;
  month: number;
  day: number;
} {
  const base = new Date(Date.UTC(year, month - 1, day, 12));
  base.setUTCDate(base.getUTCDate() + plusDays);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function toIsoWindowFromWallTime(start: {
  year: number;
  month: number;
  day: number;
  hour: number;
}): string {
  return new Date(londonWallTimeToUtcMs(start.year, start.month, start.day, start.hour)).toISOString();
}

function addOneDay(value: { year: number; month: number; day: number }) {
  return londonDate(value.year, value.month, value.day, 1);
}

function subtractOneDay(value: { year: number; month: number; day: number }) {
  return londonDate(value.year, value.month, value.day, -1);
}

function weekendWindow(now = Date.now()): OutPlanWindow {
  const clock = londonClock(now);
  const daysSinceFriday = (clock.weekday + 2) % 7;
  const friday = londonDate(clock.year, clock.month, clock.day, -daysSinceFriday);
  const fridayWindowStart = toIsoWindowFromWallTime({
    year: friday.year,
    month: friday.month,
    day: friday.day,
    hour: 17,
  });
  const sundayWindowEnd = toIsoWindowFromWallTime({
    year: londonDate(friday.year, friday.month, friday.day, 2).year,
    month: londonDate(friday.year, friday.month, friday.day, 2).month,
    day: londonDate(friday.year, friday.month, friday.day, 2).day,
    hour: 5,
  });
  if (Date.parse(sundayWindowEnd) <= now) {
    const nextFriday = londonDate(friday.year, friday.month, friday.day, 7);
    const nextSunday = londonDate(nextFriday.year, nextFriday.month, nextFriday.day, 2);
    return {
      from: toIsoWindowFromWallTime({
        year: nextFriday.year,
        month: nextFriday.month,
        day: nextFriday.day,
        hour: 17,
      }),
      until: toIsoWindowFromWallTime({
        year: nextSunday.year,
        month: nextSunday.month,
        day: nextSunday.day,
        hour: 5,
      }),
    };
  }
  return {
    from: fridayWindowStart,
    until: sundayWindowEnd,
  };
}

/**
 * The resolved window for /api/out list tabs.
 * today  = London day from 05:00 to 05:00 next day.
 * tomorrow = next London day from 05:00 to 05:00 next day.
 * weekend = Fri 17:00 through Sun 05:00.
 */
export function outPlansWindow(day: OutDay, now: number = Date.now()): OutPlanWindow {
  const clock = londonClock(now);
  const serviceDate = clock.hour < 5
    ? subtractOneDay({ year: clock.year, month: clock.month, day: clock.day })
    : { year: clock.year, month: clock.month, day: clock.day };
  if (day === "weekend") return weekendWindow(now);
  if (day === "tomorrow") {
    const tomorrow = londonDate(serviceDate.year, serviceDate.month, serviceDate.day, 1);
    return {
      from: toIsoWindowFromWallTime({
        year: tomorrow.year,
        month: tomorrow.month,
        day: tomorrow.day,
        hour: 5,
      }),
      until: toIsoWindowFromWallTime({
        year: addOneDay(tomorrow).year,
        month: addOneDay(tomorrow).month,
        day: addOneDay(tomorrow).day,
        hour: 5,
      }),
    };
  }
  const today = serviceDate;
  return {
    from: toIsoWindowFromWallTime({
      year: today.year,
      month: today.month,
      day: today.day,
      hour: 5,
    }),
    until: toIsoWindowFromWallTime({
      year: addOneDay(today).year,
      month: addOneDay(today).month,
      day: addOneDay(today).day,
      hour: 5,
    }),
  };
}

export function boundOutOpenPlans(rows: OutOpenPlan[]): OutOpenPlan[] {
  return rows.slice(0, OUT_OPEN_PLAN_LIMIT);
}
