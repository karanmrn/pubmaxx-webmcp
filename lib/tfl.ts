import { WALK_KMH } from "@/lib/routeLegs";
import { whatsappShareHref } from "@/lib/shareArtifacts";

// TfL "last drink / last train home" helpers — pure, unit-tested, no network.
//
// This module holds only the deterministic bits of the last-train feature: the
// official TfL line colours, the London day-type mapping, and the after-midnight
// clock formatting. The API route (app/api/last-train/route.ts) does the fetching
// and wires these helpers together; keeping fetch out of here makes every branch
// trivially testable (see __tests__/tfl.test.ts) and side-effect free.
//
// Why the after-midnight maths matters: TfL timetables express the last journey
// of a service day with hours that roll past 24 (e.g. {hour:24,minute:28} = 00:28
// the next calendar day; {hour:26,minute:57} = 02:57 — Night Tube). Real clock
// time is therefore `hour % 24`, and anything with hour >= 24 belongs to tomorrow.

// Official TfL Colour Standard (Issue 10) line colours, keyed by TfL lineId.
// Used to draw the small line dot in LastTrainCard so it reads like the real map.
export const LINE_COLOURS: Record<string, string> = {
  bakerloo: "#B26300",
  central: "#DC241F",
  circle: "#FFC80A",
  district: "#007D32",
  "hammersmith-city": "#F589A6",
  jubilee: "#838D93",
  metropolitan: "#9B0058",
  northern: "#000000",
  piccadilly: "#0019A8",
  victoria: "#039BE5",
  "waterloo-city": "#76D0BD",
  elizabeth: "#60399E",
  dlr: "#00AFAD",
  "london-overground": "#FA7B05",
  liberty: "#5D6061",
  lioness: "#FAA61A",
  mildmay: "#0077AD",
  suffragette: "#5BBD72",
  weaver: "#823A62",
  windrush: "#ED1B00",
  tram: "#5FB526",
};

// Neutral brass-ish fallback for any line we don't have a colour for (new lines,
// rail modes, typos) so the dot never renders blank.
const FALLBACK_COLOUR = "#6b726a";

// The hex colour for a TfL lineId, or the neutral fallback for unknown ids.
export function lineColour(lineId: string): string {
  return LINE_COLOURS[lineId] ?? FALLBACK_COLOUR;
}

// The four TfL timetable "day types". Weekday timetables collapse Mon-Thu into a
// single schedule; Fri, Sat and Sun each get their own (late-night services differ).
export type DayType = "mon-thu" | "fri" | "sat" | "sun";

// The day-type for a given Date, from its weekday. The caller passes a Date that
// already represents "now in London" (the route uses the Europe/London locale),
// so we can read getDay() directly: 0 = Sunday … 6 = Saturday.
export function dayTypeForDate(d: Date): DayType {
  switch (d.getDay()) {
    case 0:
      return "sun";
    case 5:
      return "fri";
    case 6:
      return "sat";
    default:
      // Monday (1) through Thursday (4).
      return "mon-thu";
  }
}

// The hour (London local, 0-23) before which "tonight" still belongs to the
// PREVIOUS calendar day's service. TfL encodes the tail of a service day with
// hours that roll past 24 on the PRIOR day's schedule (a 00:28 last train is
// {hour:24} on the Friday timetable, not a Saturday entry), so the whole
// early-morning window before the last Night-Tube-ish service must resolve
// against yesterday's day-type. 4am comfortably clears the latest service
// (~02:57 Night Tube) with margin.
export const SERVICE_DAY_ROLLBACK_HOUR = 4;

// The service DAY-TYPE for "now in London". Between midnight and
// SERVICE_DAY_ROLLBACK_HOUR the still-running trains belong to the previous
// calendar day's service (see above), so we roll the date back a day before
// reading its weekday. From ~04:00 onward it's just today's day-type.
//   Sat 00:15  → "fri"  (Friday's late service is still running)
//   Sat 21:00  → "sat"  (normal evening, unchanged)
export function serviceDayTypeForDate(d: Date): DayType {
  if (d.getHours() < SERVICE_DAY_ROLLBACK_HOUR) {
    const prev = new Date(d.getTime());
    prev.setDate(prev.getDate() - 1);
    return dayTypeForDate(prev);
  }
  return dayTypeForDate(d);
}

// Does a TfL schedule name (e.g. "Monday - Thursday", "Saturday (also Good Friday)")
// match the given day-type? Case-insensitive substring logic on the weekday words —
// TfL is inconsistent about phrasing, so we look for the day name(s) rather than an
// exact match. For Mon-Thu we accept any of the four weekday names appearing.
export function matchesDayType(scheduleName: string, dt: DayType): boolean {
  const name = scheduleName.toLowerCase();
  switch (dt) {
    case "fri":
      return name.includes("friday");
    case "sat":
      return name.includes("saturday");
    case "sun":
      return name.includes("sunday");
    case "mon-thu":
      return (
        name.includes("monday") ||
        name.includes("tuesday") ||
        name.includes("wednesday") ||
        name.includes("thursday")
      );
  }
}

// A TfL journey time. Note TfL returns these as strings in the wire format
// ("24", "34"); the route coerces them to numbers before calling in, and the
// type here is the clean numeric shape.
export type JourneyTime = { hour: number; minute: number };

// Format a (possibly after-midnight) last-journey time into a real wall clock.
//   {23,42} → { clock: "23:42", pastMidnight: false }
//   {24,28} → { clock: "00:28", pastMidnight: true  }   (00:28 tomorrow)
//   {26,57} → { clock: "02:57", pastMidnight: true  }   (02:57 tomorrow, Night Tube)
export function formatLastJourney({ hour, minute }: JourneyTime): {
  clock: string;
  pastMidnight: boolean;
} {
  const realHour = ((hour % 24) + 24) % 24;
  const hh = String(realHour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return { clock: `${hh}:${mm}`, pastMidnight: hour >= 24 };
}

// One line's last train from a station tonight, ready for the card to render.
export type LastTrain = {
  lineId: string;
  lineName: string;
  colour: string;
  clock: string;
  pastMidnight: boolean;
  /** Original TfL timetable hour, retained to resolve a repeated DST hour. */
  serviceHour?: number;
};

// One line's upcoming departures (live "next departures", not just the last
// train). `dueIn` values are minutes-from-now the way TfL's Arrivals API reports
// them; the route sorts and slices to the soonest few per line before this
// reaches the card, so `times` is already "next 2-3" by the time it's rendered.
export type NextDepartures = {
  lineId: string;
  lineName: string;
  colour: string;
  times: string[]; // "HH:MM" wall-clock, soonest first
  live: boolean; // true = from live Arrivals, false = timetable fallback
};

// The full answer for a point: which station, how far, and each serving line's
// last train tonight. `generatedAt` is an ISO string for provenance/debugging.
export type LastTrainResult = {
  station: { id: string; name: string; distanceM: number };
  trains: LastTrain[];
  generatedAt: string;
  // Additive fields (user stories 20-24) — optional so any older consumer that
  // only reads {station, trains, generatedAt} keeps working untouched.
  departures?: NextDepartures[];
  decision?: LastPintDecision;
  nearestPubs?: NearestPub[];
  /** True when station context came from bundled static data, not live TfL. */
  staticFallback?: boolean;
};

// --- Last Pint decision (user stories 19, 21, 23, 24) ---------------------
//
// The pub-native "what do I do right now" answer. Computed server-side, pure
// function of inputs below so it's trivially unit-testable without a clock or
// network mock beyond passing `now` explicitly.

export type LastPintDecisionKind =
  | "order_one_more"
  | "half_pint_only"
  | "settle_up_now"
  | "train_risk"
  | "live_data_unavailable";

export type LastPintDecision = {
  decision: LastPintDecisionKind;
  leaveByIso: string | null;
  stationName: string;
  lineNames: string[];
  disruptionSummary: string | null;
  walkMinutesEstimate: number;
  bufferMinutes: number;
  destinationLabel: string | null;
  live: boolean;
};

// Constant safety margin baked into the leave-by time: TfL's published last
// train can be a "doors closing" time, platforms aren't instant, and a drinker
// needs a moment to settle up and get moving. Documented here (not a magic
// number in the route) so the threshold story is legible in one place.
export const BUFFER_MINUTES = 5;

export function walkMinutesForKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  // Floored at 1 so a short-but-real distance never reads "0 min walk" - a
  // drinker still needs a moment to get up and out of the pub.
  return Math.max(1, Math.round((distanceKm / WALK_KMH) * 60));
}

// Minutes from now until a last train departs, off ACTUAL clock time rather than
// a static "past midnight" flag. Both inputs are minutes-since-London-midnight of
// the current service window: `departureMinutes` is the train's wall-clock rank
// (a 00:28 train after midnight has already rolled to hour<24, so pass its rank
// as `clockMinutes` and set `pastMidnight` from formatLastJourney), `nowMinutes`
// is now's rank.
//
// The wrap is decided by NOW, not the timetable:
//   • A departure whose rank is >= now is later today   → minutes = dep - now.
//   • A past-midnight departure (hour>=24 in TfL's data) sits in the small hours;
//     when we're still in the evening (now late) it's genuinely tomorrow-early,
//     so add a day. When we're ALREADY past midnight (now small), it's today and
//     may have already gone — do NOT add a day.
//   • A same-service departure earlier than now has already left → negative
//     minutes (the caller reads that as departed/withdrawn), NOT +1440.
//
// The old bug: keying the +1440 off the entry's `pastMidnight` flag meant a
// 00:30 train, checked at 00:45, reported ~24h left instead of "gone 15m ago".
// When `nowDate` is supplied, the calculation resolves both values in
// Europe/London so a 23:00→02:57 service crossing DST uses elapsed minutes,
// not wall-clock rank minutes.
// `serviceHour` keeps TfL's original hour>=24 value, so 25:xx identifies the
// first repeated 01:xx occurrence on a fall-back night.
export function minutesUntilDeparture(
  clockMinutes: number,
  pastMidnight: boolean,
  nowMinutes: number,
  nowDate?: Date,
  serviceHour?: number,
): number {
  if (nowDate && !Number.isNaN(nowDate.getTime())) {
    return minutesUntilLondonDeparture(clockMinutes, pastMidnight, nowDate, serviceHour);
  }

  let mins = clockMinutes - nowMinutes;
  // Only wrap a past-midnight departure forward a day when NOW is still in the
  // evening (before the early-hours window it lands in). Once now itself is in
  // the small hours, that departure is today — a negative result means it's gone.
  if (pastMidnight && nowMinutes >= SERVICE_DAY_ROLLBACK_HOUR * 60) {
    mins += 24 * 60;
  }
  return mins;
}

type LondonDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function londonDateTimeParts(date: Date): LondonDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return Number.parseInt(value ?? "0", 10);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

// Read London's UTC offset at an instant without relying on the server's local
// timezone. This lets a wall-clock timetable rank become a real elapsed
// duration when the departure date crosses a clock change.
function londonOffsetMinutes(date: Date): number {
  const parts = londonDateTimeParts(date);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return Math.round((wallAsUtc - date.getTime()) / 60_000);
}

function minutesUntilLondonDeparture(
  clockMinutes: number,
  pastMidnight: boolean,
  nowDate: Date,
  serviceHour?: number,
): number {
  const nowParts = londonDateTimeParts(nowDate);
  const dayOffset = pastMidnight && nowParts.hour >= SERVICE_DAY_ROLLBACK_HOUR ? 1 : 0;
  const departureWallAsUtc = Date.UTC(
    nowParts.year,
    nowParts.month - 1,
    nowParts.day + dayOffset,
    Math.floor(clockMinutes / 60),
    clockMinutes % 60,
  );
  const expectedTarget = new Date(departureWallAsUtc);
  const expectedParts = {
    year: expectedTarget.getUTCFullYear(),
    month: expectedTarget.getUTCMonth() + 1,
    day: expectedTarget.getUTCDate(),
    hour: Math.floor(clockMinutes / 60),
    minute: clockMinutes % 60,
  };

  // The same wall-clock minutes can be separated by 23 or 25 real hours at a
  // DST boundary. Resolve the departure wall clock to an instant before
  // subtracting the actual now instant, rather than assuming every day is 24
  // hours long.
  const candidates = londonWallClockCandidates(departureWallAsUtc, expectedParts);
  const departureInstant = selectLondonDepartureCandidate(
    departureWallAsUtc,
    candidates,
    serviceHour,
  );
  return (departureInstant - nowDate.getTime()) / 60_000;
}

function londonWallClockCandidates(
  wallAsUtc: number,
  expected: LondonDateTimeParts,
): number[] {
  const offsets = new Set<number>();
  for (const probeMinutes of [-120, -60, 0, 60, 120]) {
    offsets.add(londonOffsetMinutes(new Date(wallAsUtc + probeMinutes * 60_000)));
  }

  return [...offsets]
    .map((offset) => wallAsUtc - offset * 60_000)
    .filter((instant) => {
      const parts = londonDateTimeParts(new Date(instant));
      return (
        parts.year === expected.year &&
        parts.month === expected.month &&
        parts.day === expected.day &&
        parts.hour === expected.hour &&
        parts.minute === expected.minute
      );
    })
    .sort((a, b) => a - b);
}

function selectLondonDepartureCandidate(
  wallAsUtc: number,
  candidates: number[],
  serviceHour?: number,
): number {
  if (candidates.length === 0) {
    // Spring-forward gaps have no real instant. Keep the existing offset-based
    // fallback for malformed or exceptional timetable data.
    const departureOffset = londonOffsetMinutes(new Date(wallAsUtc));
    return wallAsUtc - departureOffset * 60_000;
  }
  // TfL's 25:xx service hour is the first 01:xx occurrence on a fall-back
  // night. Without the original hour, retain the prior later-occurrence choice
  // for callers that only have a display clock and past-midnight flag.
  return serviceHour === 25 ? candidates[0] : candidates[candidates.length - 1];
}

export type LastPintDecisionInput = {
  // Minutes from `now` until the last train departs this station (can be
  // negative if it's already gone). Null when we have no last-train time at
  // all for the relevant line(s) (e.g. no timetable resolved).
  minutesUntilLastTrain: number | null;
  walkMinutesEstimate: number;
  bufferMinutes?: number;
  stationName: string;
  lineNames: string[];
  // True if TfL Line Status reports a disruption affecting a line the drinker
  // needs (any severity below "Good Service" for that line).
  disruptionOnNeededLine: boolean;
  disruptionSummary?: string | null;
  destinationLabel?: string | null;
  // False when TfL itself couldn't be reached at all (StopPoint/timetable both
  // failed) — distinct from "reached TfL, no disruption, but no train times".
  live?: boolean;
  now?: Date;
};

// Pure decision function — user stories 19, 21, 24. Given how long until the
// last train (after subtracting the walk and safety buffer), returns the
// pub-native state plus everything the card needs to render it.
//
// Thresholds (minutes of margin = minutesUntilLastTrain - walk - buffer):
//   TfL unreachable                       -> live_data_unavailable
//   margin < 5  OR disruption on the line -> train_risk
//   5  <= margin < 20                     -> settle_up_now
//   20 <= margin < 45                     -> half_pint_only
//   margin >= 45                          -> order_one_more
export function computeLastPintDecision(input: LastPintDecisionInput): LastPintDecision {
  const {
    minutesUntilLastTrain,
    walkMinutesEstimate,
    bufferMinutes = BUFFER_MINUTES,
    stationName,
    lineNames,
    disruptionOnNeededLine,
    disruptionSummary = null,
    destinationLabel = null,
    live = true,
    now = new Date(),
  } = input;

  const base: Omit<LastPintDecision, "decision" | "leaveByIso"> = {
    stationName,
    lineNames,
    disruptionSummary,
    walkMinutesEstimate,
    bufferMinutes,
    destinationLabel,
    live,
  };

  if (!live || minutesUntilLastTrain === null) {
    return { ...base, decision: "live_data_unavailable", leaveByIso: null };
  }

  const leaveBy = new Date(now.getTime() + (minutesUntilLastTrain - walkMinutesEstimate) * 60_000);
  const leaveByIso = leaveBy.toISOString();
  const margin = minutesUntilLastTrain - walkMinutesEstimate - bufferMinutes;

  if (margin < 5 || disruptionOnNeededLine) {
    return { ...base, decision: "train_risk", leaveByIso };
  }
  if (margin < 20) {
    return { ...base, decision: "settle_up_now", leaveByIso };
  }
  if (margin < 45) {
    return { ...base, decision: "half_pint_only", leaveByIso };
  }
  return { ...base, decision: "order_one_more", leaveByIso };
}

// --- Nearest pubs to the station (user story 22) ---------------------------

export type NearestPub = {
  id: string;
  name: string;
  price: number | null;
};

// --- Live "leave by" countdown (Last Pint Guardian) -------------------------
//
// The card renders a static "Leave by 23:28" line; the Guardian adds a calm,
// live-ticking relative countdown next to it. Both bits below are pure so the
// component only owns the interval that re-invokes them — the phrasing itself
// is unit-tested without a clock.

// Whole minutes from `now` until the leave-by moment. Positive = still time in
// hand, negative = the leave-by time has already passed. Rounds toward zero so
// "30s left" reads as 0 (not yet negative) — we never round a live "go now" up
// into a scary "you're late".
export function minutesUntilLeaveBy(leaveByIso: string | null, now: Date = new Date()): number | null {
  if (!leaveByIso) return null;
  const leaveBy = new Date(leaveByIso);
  if (Number.isNaN(leaveBy.getTime())) return null;
  return Math.trunc((leaveBy.getTime() - now.getTime()) / 60_000);
}

// Calm, non-alarmist phrasing for the live countdown. The repo tone is honest,
// no fake urgency: we state the fact and stop. Returns null when the number
// adds nothing over the absolute "Leave by HH:MM" already shown (far out), so
// the UI can simply omit the line.
//   >= 90 min  -> null            (the clock time alone is calmer this far out)
//   2..89 min  -> "in N min"
//   1 min      -> "in 1 min"
//   0 min      -> "right about now"
//   < 0 min    -> "leave-by time has passed"
export function describeLeaveCountdown(minutesRemaining: number | null): string | null {
  if (minutesRemaining === null) return null;
  if (minutesRemaining >= 90) return null;
  if (minutesRemaining < 0) return "leave-by time has passed";
  if (minutesRemaining === 0) return "right about now";
  if (minutesRemaining === 1) return "in 1 min";
  return `in ${minutesRemaining} min`;
}

// --- "Send to crew" share (issue #45 remaining acceptance item) -------------
//
// A WhatsApp-ready message a drinker can fire to their group so everyone leaves
// together. Deliberately worded around GETTING HOME, never around drinking
// more: the tone tags below are all home-logistics, so the share never
// encourages excess. Provenance-honest — when live data was unavailable the
// message says so rather than inventing a time.

export type LastPintShareInput = {
  decision: LastPintDecisionKind;
  stationName: string;
  // Wall-clock "HH:MM" the card already computed for the leave-by line (London
  // local). Null when there's no leave-by (live_data_unavailable).
  leaveByClock: string | null;
  // The last-service wall clock ("23:42"), if known — the anchor fact.
  lastServiceClock?: string | null;
  // "train" | "tram" | "subway" — from the city's mode word.
  modeWord: string;
  // Session-only destination label, if the drinker set one.
  destinationLabel?: string | null;
};

// One calm home-logistics line per state. None of these nudge "one more" as an
// instruction — order_one_more just states there's time in hand.
function shareToneTag(kind: LastPintDecisionKind): string {
  switch (kind) {
    case "order_one_more":
      return "Time in hand. No rush yet.";
    case "half_pint_only":
      return "Start thinking about home.";
    case "settle_up_now":
      return "Time to settle up.";
    case "train_risk":
      return "Cutting it fine. Sort a backup way home.";
    case "live_data_unavailable":
      return "Couldn't check live times. Check before you head out.";
  }
}

// Build the crew message text. Pure — no window, no navigator.
export function buildLastPintShareText(input: LastPintShareInput): string {
  const { decision, stationName, leaveByClock, lastServiceClock, modeWord, destinationLabel } = input;
  const mode = modeWord || "train";
  const lines: string[] = [];

  if (decision === "live_data_unavailable" || !leaveByClock) {
    lines.push(`Last ${mode} home from ${stationName}. Couldn't check live times.`);
    lines.push(shareToneTag("live_data_unavailable"));
  } else {
    const anchor = lastServiceClock
      ? `Last ${mode} home: ${lastServiceClock} from ${stationName}.`
      : `Last ${mode} home from ${stationName}.`;
    lines.push(anchor);
    const leaveLine = destinationLabel
      ? `Leave by ${leaveByClock} for ${destinationLabel}.`
      : `Leave by ${leaveByClock}.`;
    lines.push(leaveLine);
    lines.push(shareToneTag(decision));
  }

  lines.push("via PUBMAXXING");
  return lines.join("\n");
}

// WhatsApp deep link for the crew message. The share text is self-contained,
// so no URL is appended. Delegates to the one wa.me builder in
// lib/shareArtifacts.ts.
export function lastPintShareHref(shareText: string): string {
  return whatsappShareHref(shareText);
}
