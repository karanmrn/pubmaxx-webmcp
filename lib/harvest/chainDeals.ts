// Reading a chain's own offers page into deal days. PURE: markdown in, deal days
// and the reasons for every drop out. No fetching, no clock, no venue list.
//
// WHAT A DEAL DAY HAS TO SAY FOR ITSELF. A block earns a deal day only when its
// own copy states a WEEKDAY and a WINDOW on one line of its own - "Every Monday,
// 11.30am - 11pm", "Available Monday-Friday 12pm-5pm". Prose that merely mentions
// a day ("from Monday 23 June, customers will be able to...") is not a schedule,
// so the schedule line is matched whole rather than searched for a day word.
// A block that states a day but no window is DROPPED and recorded as
// `no-stated-window`, because a deal reaches the reader as an interval - deal
// grace is 0 in lib/whatsOn.ts, so a deal with no end renders nowhere - and
// inventing 11:30 to 23:00 because the last one said so is exactly the guess the
// honesty rules forbid. Two drop reasons rather than one is the point: "this
// chain publishes nothing" and "this chain publishes deals without hours" are
// different findings for whoever reads the run report.
//
// A DEAL BELONGS TO THE BRAND ITS OWN COPY NAMES. Greene King's deals page
// carries offers for Flaming Grill, Hungry Horse and Farmhouse Inns beside its
// own. `brand` records the sister brand when the block names one, so the row
// builder can refuse to hang a Hungry Horse burger deal on a Greene King pub.
// Null means the block named none, which means the chain itself.

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

/** How many content lines after a heading may still belong to that block. */
const SCHEDULE_LOOKAHEAD_LINES = 4;

const WEEKDAY_INDEX = new Map<string, number>();
for (const [index, name] of WEEKDAY_NAMES.entries()) {
  WEEKDAY_INDEX.set(name.toLowerCase(), index);
  WEEKDAY_INDEX.set(name.slice(0, 3).toLowerCase(), index);
}

// A page writes a weekday half a dozen ways ("Tues", "Thurs", "Wednes"). Three
// letters identify the day on their own, so fall back to those rather than
// growing a table of spellings.
function weekdayIndexOf(word: string): number | undefined {
  const lower = word.toLowerCase();
  return WEEKDAY_INDEX.get(lower) ?? WEEKDAY_INDEX.get(lower.slice(0, 3));
}

/**
 * Sister brands whose deals may appear on a parent chain's page. Matching is on
 * the block's own words, so a brand is only claimed when it is written down.
 */
export const CHAIN_SISTER_BRANDS = [
  "Flaming Grill",
  "Hungry Horse",
  "Farmhouse Inns",
  "Chef & Brewer",
  "Greene King Inns",
  "Miller & Carter",
  "Harvester",
  "Toby Carvery",
  "Nicholson's",
  "All Bar One",
] as const;

export type HarvestedDealDay = {
  /** Stable within a source: a slug of the title. */
  id: string;
  title: string;
  /** Every weekday the copy states, in week order. */
  days: WeekdayName[];
  /** How the copy itself puts the cadence, for the row's own title. */
  cadenceLabel: string;
  /** 24-hour "HH:MM", as stated. */
  startTime: string;
  endTime: string;
  /** The block's own following sentence, when it has one. */
  detail: string | null;
  /** A sister brand this deal names, or null for the chain itself. */
  brand: string | null;
};

export type HarvestedDealDropReason = "no-stated-day" | "no-stated-window";

export type HarvestedDealDrop = {
  title: string;
  reason: HarvestedDealDropReason;
};

export type ChainDealParse = {
  deals: HarvestedDealDay[];
  drops: HarvestedDealDrop[];
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Markdown noise a block's own sentences are never made of. */
function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.startsWith("![")) return true; // image
  if (/^\[[^\]]*\]\([^)]*\)$/.test(trimmed)) return true; // bare link
  if (/^[-*_]{3,}$/.test(trimmed)) return true; // rule
  return false;
}

function normaliseDashes(value: string): string {
  return value.replace(/[‐-―]/g, "-");
}

/** A sentence a reader sees, not the markdown it arrived wrapped in. */
function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "11.30am" / "11pm" / "19:30" / "12pm" -> "HH:MM", or null when unreadable. */
export function parseStatedClock(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/\s+/g, "");
  const match = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(raw);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  // A bare "11 - 5" states no meridiem, so which 11 and which 5 is a guess. Only
  // a 24-hour reading (a colon, or an hour past 12) is taken without one.
  if (!meridiem && !/[:.]/.test(value) && hour <= 12) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function expandDayRange(from: string, to: string): WeekdayName[] | null {
  const start = weekdayIndexOf(from);
  const end = weekdayIndexOf(to);
  if (start === undefined || end === undefined) return null;
  const days: WeekdayName[] = [];
  for (let step = 0; step < 7; step += 1) {
    const index = (start + step) % 7;
    days.push(WEEKDAY_NAMES[index]);
    if (index === end) return days;
  }
  return null;
}

const DAY_WORD = "(sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat)(?:day)?";
const CLOCK = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?`;

// A schedule line is the WHOLE line, so prose that happens to name a day is not
// mistaken for one. Times are optional here and required by the caller, so the
// "day but no window" case can be reported instead of silently vanishing.
const SCHEDULE_LINE = new RegExp(
  String.raw`^(?:every|available|on|all day)?\s*(?:all day\s*)?` +
    String.raw`(${DAY_WORD})(?:\s*-\s*(${DAY_WORD}))?` +
    String.raw`\s*(?:,|-|–)?\s*` +
    // Either a whole window, or a lone clock, or nothing. A lone clock still
    // matches the line so the caller can report `no-stated-window` on a page
    // that gave a start and never said when the offer ends.
    String.raw`(?:(${CLOCK})\s*(?:-|to|until)\s*(${CLOCK})|(${CLOCK}))?\s*$`,
  "i",
);

export type ParsedSchedule = {
  days: WeekdayName[];
  cadenceLabel: string;
  startTime: string | null;
  endTime: string | null;
};

/** Read one whole line as a schedule, or null when it is not one. */
export function parseScheduleLine(line: string): ParsedSchedule | null {
  const cleaned = normaliseDashes(line).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0 || cleaned.length > 60) return null;
  const match = SCHEDULE_LINE.exec(cleaned);
  if (!match) return null;

  const [, firstDay, , secondDay, , rawStart, rawEnd] = match;
  const days = secondDay ? expandDayRange(firstDay, secondDay) : dayFromWord(firstDay);
  if (!days || days.length === 0) return null;

  const startTime = rawStart ? parseStatedClock(rawStart) : null;
  const endTime = rawEnd ? parseStatedClock(rawEnd) : null;
  // A half-stated window is not a window. Treat it as none so the caller reports
  // `no-stated-window` rather than inventing the missing end.
  const bothOrNeither = startTime !== null && endTime !== null;

  const cadenceLabel =
    days.length === 1 ? `every ${days[0]}` : `${days[0]} to ${days[days.length - 1]}`;

  return {
    days,
    cadenceLabel,
    startTime: bothOrNeither ? startTime : null,
    endTime: bothOrNeither ? endTime : null,
  };
}

// A window with no day beside it ("11.30am - 11pm" on its own line). Which day
// it belongs to is exactly the thing the page did not say, so it is a recorded
// drop rather than a deal hung on today.
const WINDOW_ONLY_LINE = new RegExp(
  String.raw`^(${CLOCK})\s*(?:-|to|until)\s*(${CLOCK})$`,
  "i",
);

export function isWindowOnlyLine(line: string): boolean {
  const cleaned = normaliseDashes(line).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0 || cleaned.length > 40) return false;
  const match = WINDOW_ONLY_LINE.exec(cleaned);
  if (!match) return false;
  return parseStatedClock(match[1]) !== null && parseStatedClock(match[2]) !== null;
}

function dayFromWord(word: string): WeekdayName[] | null {
  const index = weekdayIndexOf(word);
  if (index === undefined) return null;
  return [WEEKDAY_NAMES[index]];
}

function brandNamedIn(text: string): string | null {
  const haystack = text.toLowerCase().replace(/\s+/g, " ");
  for (const brand of CHAIN_SISTER_BRANDS) {
    if (haystack.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

type Block = { title: string; lines: string[] };

function splitHeadingBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      if (current) blocks.push(current);
      current = { title: heading[1].replace(/\*\*/g, "").trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(raw);
  }
  if (current) blocks.push(current);
  return blocks;
}

/**
 * Read a chain offers page into deal days. Every heading is considered; the
 * schedule line is what makes a block a deal, so marketing sections fall out
 * on their own rather than needing a heading allowlist.
 */
export function parseChainDealDays(markdown: string): ChainDealParse {
  const deals: HarvestedDealDay[] = [];
  const drops: HarvestedDealDrop[] = [];
  const seen = new Set<string>();

  for (const block of splitHeadingBlocks(markdown)) {
    const content = block.lines.filter((line) => !isStructuralLine(line));
    let schedule: ParsedSchedule | null = null;
    let scheduleAt = -1;
    for (let index = 0; index < Math.min(content.length, SCHEDULE_LOOKAHEAD_LINES); index += 1) {
      const parsed = parseScheduleLine(content[index]);
      if (parsed) {
        schedule = parsed;
        scheduleAt = index;
        break;
      }
    }
    const title = block.title;
    if (title.length === 0) continue;

    if (!schedule) {
      const windowOnly = content
        .slice(0, SCHEDULE_LOOKAHEAD_LINES)
        .some((line) => isWindowOnlyLine(line));
      if (windowOnly) drops.push({ title, reason: "no-stated-day" });
      continue;
    }

    if (schedule.startTime === null || schedule.endTime === null) {
      drops.push({ title, reason: "no-stated-window" });
      continue;
    }

    const detailLine = content
      .slice(scheduleAt + 1)
      .find((line) => line.trim().length > 0 && !parseScheduleLine(line));
    const detail = detailLine ? stripInlineMarkdown(detailLine) || null : null;

    const id = slugify(title);
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);

    deals.push({
      id,
      title,
      days: schedule.days,
      cadenceLabel: schedule.cadenceLabel,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      detail,
      brand: brandNamedIn([title, ...content.slice(0, SCHEDULE_LOOKAHEAD_LINES + 2)].join(" ")),
    });
  }

  return { deals, drops };
}
