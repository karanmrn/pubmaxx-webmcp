// icsExport — a tiny, dependency-free iCalendar (RFC 5545) generator for a
// built crawl. It produces one VCALENDAR with one VEVENT per crawl (a single
// "block out the evening" event whose description lists the stops in order), so
// a user can tap "Add to calendar" and drop the whole night into Google/Apple
// Calendar. Kept pure + deterministic (caller supplies `start`/`now`) so it's
// unit testable; the UI wires it to a blob download.
//
// Scope is deliberately RFC-5545 *basics*: CRLF line endings, TEXT escaping,
// a stable UID, DTSTART/DTEND in UTC (…Z), and the required PRODID/VERSION.
// It is not a full calendar library — no timezones, RRULEs or alarms.

export type IcsStop = {
  name: string;
  /** Optional street address, surfaced in the event body if present. */
  address?: string;
};

export type IcsCrawl = {
  /** Stable slug-ish id used to build a deterministic UID. */
  id: string;
  /** Human title, e.g. "Victorian Soho" or "My hand-built crawl". */
  title: string;
  /** Ordered stops. An empty crawl still yields a valid (stop-less) event. */
  stops: IcsStop[];
  /** Optional one-line blurb, prepended to the event description. */
  blurb?: string;
  /** Optional per-stop noun, e.g. "coffee stop" (alt styles). Defaults "stop". */
  stopNoun?: string;
};

export type IcsOptions = {
  /** Event start. Defaults to the next sensible evening (7pm) if omitted. */
  start?: Date;
  /** Event length in minutes. Defaults to 30 min per stop, min 90. */
  durationMinutes?: number;
  /** Fixed "now" for DTSTAMP — injectable so tests are deterministic. */
  now?: Date;
};

// RFC 5545 §3.3.11: in TEXT values, backslash, comma, semicolon must be escaped,
// and newlines become the literal two-char sequence "\n".
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// RFC 5545 §3.3.5 UTC date-time form: 20260710T190000Z. We always emit UTC (Z)
// to sidestep VTIMEZONE — a calendar client localises it on import.
export function formatIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

// Europe/London wall clock, resolved without pulling in a shared module (this
// generator is deliberately dependency-free; see file header). Mirrors
// lib/whatsOn.ts's londonWallTimeToUtcMs: two offset passes are enough to
// land the resolved instant correctly across Europe/London's GMT/BST switch.
let londonPartsFormatter: Intl.DateTimeFormat | null = null;
function londonParts(date: Date) {
  londonPartsFormatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = londonPartsFormatter.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function londonOffsetMs(date: Date): number {
  const p = londonParts(date);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function londonWallTimeToUtcMs(year: number, month: number, day: number, hour: number): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  let instant = wallAsUtc - londonOffsetMs(new Date(wallAsUtc));
  instant = wallAsUtc - londonOffsetMs(new Date(instant));
  return instant;
}

// The next evening at 19:00 Europe/London time, relative to `from`. If it's
// already past 19:00 London, roll to tomorrow. A crawl you add now is for
// tonight or the next night, never a start in the past. Resolved against the
// London wall clock (not the caller's own locale/timezone) because a visitor
// planning a London night from any other timezone must still get a 7pm London
// event, not 7pm wherever their device happens to be set.
export function defaultCrawlStart(from: Date = new Date()): Date {
  const p = londonParts(from);
  let ms = londonWallTimeToUtcMs(p.year, p.month, p.day, 19);
  if (ms <= from.getTime()) {
    const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    ms = londonWallTimeToUtcMs(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      19,
    );
  }
  return new Date(ms);
}

// RFC 5545 §3.1: content lines SHOULD be folded to <=75 octets. We fold on a
// conservative character count (fine for the ASCII/short-UTF-8 text here),
// continuation lines starting with a single space.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

/**
 * Build a complete VCALENDAR string (CRLF line endings) with one VEVENT for the
 * crawl. Valid for an empty crawl (no stops) too — you still get a bookable
 * evening block.
 */
export function buildCrawlIcs(crawl: IcsCrawl, options: IcsOptions = {}): string {
  const start = options.start ?? defaultCrawlStart();
  const stampSource = options.now ?? new Date();
  const perStop = 30;
  const duration = options.durationMinutes ?? Math.max(90, crawl.stops.length * perStop);
  const end = new Date(start.getTime() + duration * 60_000);

  const noun = crawl.stopNoun ?? "stop";
  const descriptionParts: string[] = [];
  if (crawl.blurb) descriptionParts.push(crawl.blurb);
  if (crawl.stops.length) {
    const lines = crawl.stops.map((stop, index) => {
      const where = stop.address ? `, ${stop.address}` : "";
      return `${index + 1}. ${stop.name}${where}`;
    });
    descriptionParts.push(
      `${crawl.stops.length} ${noun}${crawl.stops.length === 1 ? "" : "s"}:`,
    );
    descriptionParts.push(lines.join("\n"));
  }
  descriptionParts.push("Planned on PUBMAXXING.");
  const description = descriptionParts.join("\n");

  const uid = `crawl-${crawl.id}-${formatIcsUtc(start)}@pubmaxxing`;

  const firstStop = crawl.stops[0];
  const locationLines = firstStop
    ? [`LOCATION:${escapeIcsText(firstStop.address ?? firstStop.name)}`]
    : [];

  const rawLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PUBMAXXING//Crawl Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtc(stampSource)}`,
    `DTSTART:${formatIcsUtc(start)}`,
    `DTEND:${formatIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(crawl.title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    ...locationLines,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return rawLines.map(foldLine).join("\r\n") + "\r\n";
}

/** A safe .ics filename for a crawl, e.g. "victorian-soho.ics". */
export function icsFilename(crawl: Pick<IcsCrawl, "id" | "title">): string {
  const base =
    (crawl.id || crawl.title || "crawl")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "crawl";
  return `${base}.ics`;
}
