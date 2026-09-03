// Material TfL disruption — a night-shaping layer, not a status board (ticket 3.7).
//
// The whole point of this module is restraint. TfL's Line Status endpoint reports
// every wrinkle on the network (minor delays, reduced frequency, "information"),
// but almost none of that changes what a drinker does tonight. We surface ONE
// thing: a disruption severe enough to reshape a night out (a suspension, a
// severe-delay, or a planned closure for tonight) on a line that actually serves
// the patch the user is standing in. Everything else stays silent — no empty
// state, no "all lines good service" reassurance line. If there's nothing
// material to say, the caller renders nothing.
//
// Split, like lib/tfl.ts: the pure filtering/mapping/copy logic lives here and
// is unit-tested on fixtures (no network). Only fetchLineStatuses() touches the
// wire, and it uses the same keyless api.tfl.gov.uk style, with a sensible
// server-side revalidate so we never fetch per render.

import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import { discardBody } from "@/lib/responseBody";

export function lineDisplayLabel(name: string): string {
  const trimmed = name.trim();
  return /\bline$/i.test(trimmed) ? trimmed : `${trimmed} line`;
}

// ---------------------------------------------------------------------------
// Severity model.
// ---------------------------------------------------------------------------
//
// TfL grades every line status with a numeric `statusSeverity` (Line/Meta/
// Severity). The scale runs from most-severe UPWARD: 0 Special Service, 1 Closed,
// 2 Suspended, 3 Part Suspended, 4 Planned Closure, 5 Part Closure, 6 Severe
// Delays, 7 Reduced Service, 8 Bus Service, 9 Minor Delays, 10 Good Service,
// 11 Part Closed, 16 Not Running, 20 Service Closed, and so on.
//
// We deliberately do NOT key materiality off a raw "<= 6" threshold, because the
// most-severe numeric end also holds non-disruptions: 0 Special Service is a
// special timetable, not a problem, and 16/20 (Not Running / Service Closed) are
// the ordinary overnight state of most lines, not something to warn about. So we
// name the exact codes that reshape a night out.
//
//   LIVE   — happening now, surfaced whenever present (current reality).
//   PLANNED— a closure with a validity window; surfaced ONLY when that window
//            overlaps tonight (17:00–02:00 London). A closure for next weekend is
//            not tonight's problem and must stay silent.

export type MaterialKind =
  | "closed"
  | "suspended"
  | "part_suspended"
  | "severe_delays"
  | "planned_closure"
  | "part_closure";

// Live, currently-in-effect disruptions worth reshaping a night around.
//   1 Closed · 2 Suspended · 3 Part Suspended · 6 Severe Delays
const LIVE_SEVERITY_KIND: Record<number, MaterialKind> = {
  1: "closed",
  2: "suspended",
  3: "part_suspended",
  6: "severe_delays",
};

// Planned closures — only material when the closure window is tonight.
//   4 Planned Closure · 5 Part Closure · 11 Part Closed
const PLANNED_SEVERITY_KIND: Record<number, MaterialKind> = {
  4: "planned_closure",
  5: "part_closure",
  11: "part_closure",
};

/** True for a severity code that is a live, night-shaping disruption. */
export function isLiveMaterialSeverity(code: number | undefined | null): boolean {
  return typeof code === "number" && code in LIVE_SEVERITY_KIND;
}

/** True for a severity code that is a planned closure (window-gated elsewhere). */
export function isPlannedClosureSeverity(code: number | undefined | null): boolean {
  return typeof code === "number" && code in PLANNED_SEVERITY_KIND;
}

// ---------------------------------------------------------------------------
// Line-to-patch relevance table (static, documented, honest).
// ---------------------------------------------------------------------------
//
// Which TfL lines materially serve each of the eight night patches — the lines a
// drinker in that patch would actually be on to get in or get home. This is a
// hand-authored map of the patch's real tube/rail spine (drawn from the stations
// at each patch's walking heart), NOT a runtime geometry guess: a suspension only
// counts for a patch when it would genuinely change the plan there, not merely
// because a line passes somewhere nearby. Overground is quoted by its 2024 named
// lines (Windrush, Weaver, Mildmay, Suffragette) AND the umbrella "london-
// overground" id, because TfL's Status feed can return either.
//
// Keep this in lockstep with lib/nightPatches.ts NIGHT_PATCHES.
export const LINE_PATCH_RELEVANCE: Record<NightPatchId, readonly string[]> = {
  // Oxford Circus / Tottenham Court Road / Piccadilly Circus / Leicester Square.
  soho: ["victoria", "bakerloo", "central", "northern", "piccadilly", "elizabeth"],
  // Old Street (Northern), Liverpool Street (Central, Elizabeth), Shoreditch High
  // Street (Overground / Windrush).
  shoreditch: ["northern", "central", "elizabeth", "windrush", "london-overground"],
  // Camden Town — Northern line spine.
  camden: ["northern"],
  // London Bridge — Northern (Bank branch) and Jubilee.
  "london-bridge": ["northern", "jubilee"],
  // Brixton — southern terminus of the Victoria line.
  brixton: ["victoria"],
  // Clapham Common / Clapham North — Northern line (Morden branch).
  clapham: ["northern"],
  // Angel (Northern) and Highbury & Islington (Victoria + North London / Mildmay
  // + East London / Windrush overground).
  islington: ["northern", "victoria", "mildmay", "windrush", "london-overground"],
  // Broadway Market / London Fields / Hackney Central — Overground heartland:
  // Weaver (London Fields, Hackney Downs), Suffragette and Mildmay (Hackney
  // Central), plus the umbrella id.
  hackney: ["weaver", "suffragette", "mildmay", "london-overground"],
};

/** The set of TfL line ids that materially serve a night patch, or empty. */
export function relevantLineIdsForPatch(patchId: string): Set<string> {
  const ids = (LINE_PATCH_RELEVANCE as Record<string, readonly string[]>)[patchId];
  return new Set(ids ?? []);
}

// ---------------------------------------------------------------------------
// Tonight window (17:00–02:00 London) as absolute instants.
// ---------------------------------------------------------------------------
//
// Same offset technique as lib/whatsOn.ts londonServiceDayBounds: read the London
// wall clock for `now`, then resolve each edge against the offset at that edge.
// This is what lets a planned-closure window (which TfL gives as absolute ISO
// instants) be compared honestly regardless of the server timezone or BST/GMT.

export const NIGHT_WINDOW_OPEN_HOUR = 17;
export const NIGHT_WINDOW_CLOSE_HOUR = 2;

type LondonParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function londonParts(base: Date): LondonParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(base);
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

function londonOffsetMs(base: Date): number {
  const p = londonParts(base);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
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
  instant = wallAsUtc - londonOffsetMs(new Date(instant));
  return instant;
}

/**
 * Tonight's window as absolute epoch-ms bounds: [17:00, 02:00) London. Before
 * 02:00 the window's evening date rolls back a day — at 00:30 we are still inside
 * the night that opened at 17:00 yesterday, so a closure running to 02:00 must
 * still count. Each edge is converted independently because clock-change nights
 * use different offsets at 17:00 and 02:00.
 */
export function tonightWindow(now: Date): { start: number; end: number } {
  const p = londonParts(now);

  let ey = p.year;
  let em = p.month;
  let ed = p.day;
  if (p.hour < NIGHT_WINDOW_CLOSE_HOUR) {
    const prev = new Date(Date.UTC(p.year, p.month - 1, p.day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    ey = prev.getUTCFullYear();
    em = prev.getUTCMonth() + 1;
    ed = prev.getUTCDate();
  }

  const start = londonWallTimeToUtcMs(ey, em, ed, NIGHT_WINDOW_OPEN_HOUR);
  const end = londonWallTimeToUtcMs(ey, em, ed + 1, NIGHT_WINDOW_CLOSE_HOUR);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Wire shapes (only the fields we read off TfL Line Status).
// ---------------------------------------------------------------------------

export type LineStatusPeriod = {
  fromDate?: string;
  toDate?: string;
  isNow?: boolean;
};

export type LineStatusDetail = {
  statusSeverity?: number;
  statusSeverityDescription?: string;
  reason?: string;
  validityPeriods?: LineStatusPeriod[];
};

export type RawLineStatus = {
  id?: string;
  name?: string;
  modeName?: string;
  lineStatuses?: LineStatusDetail[];
};

/**
 * Does a planned-closure validity period overlap tonight? A period with both a
 * from and to date overlaps when it starts before the window closes AND ends
 * after it opens (standard half-open interval overlap). A period that carries no
 * usable dates but is flagged isNow is treated as overlapping (it is in effect
 * right now, which is inside tonight). Anything else does not overlap.
 */
export function periodOverlapsTonight(
  period: LineStatusPeriod,
  window: { start: number; end: number },
): boolean {
  const from = period.fromDate ? Date.parse(period.fromDate) : NaN;
  const to = period.toDate ? Date.parse(period.toDate) : NaN;
  if (Number.isFinite(from) && Number.isFinite(to)) {
    return from < window.end && to > window.start;
  }
  return period.isNow === true;
}

// ---------------------------------------------------------------------------
// Material extraction.
// ---------------------------------------------------------------------------

export type MaterialDisruption = {
  lineId: string;
  lineName: string;
  kind: MaterialKind;
  reason: string | null;
};

// Ordering for "which single disruption leads": a full closure/suspension
// outranks a partial one, which outranks severe delays. Lower = more material.
const KIND_RANK: Record<MaterialKind, number> = {
  closed: 0,
  planned_closure: 0,
  suspended: 1,
  part_suspended: 2,
  part_closure: 2,
  severe_delays: 3,
};

/**
 * Pull the material disruptions out of a TfL Line Status payload, keeping only
 * lines in `relevantLineIds` and only statuses that are night-shaping: any live
 * material severity (surfaced as current), or a planned closure whose window
 * overlaps tonight. Pure — `window` and the payload are the only inputs.
 * At most one disruption is returned per line (the most material one).
 */
export function materialDisruptionsFor(
  statuses: readonly RawLineStatus[] | null | undefined,
  relevantLineIds: Set<string>,
  window: { start: number; end: number },
): MaterialDisruption[] {
  if (!statuses || relevantLineIds.size === 0) return [];
  const out: MaterialDisruption[] = [];

  for (const line of statuses) {
    if (!line.id || !relevantLineIds.has(line.id)) continue;
    let best: MaterialDisruption | null = null;

    for (const detail of line.lineStatuses ?? []) {
      const code = detail.statusSeverity;
      let kind: MaterialKind | null = null;

      if (isLiveMaterialSeverity(code)) {
        kind = LIVE_SEVERITY_KIND[code as number];
      } else if (isPlannedClosureSeverity(code)) {
        const periods = detail.validityPeriods ?? [];
        const overlaps =
          periods.length > 0
            ? periods.some((p) => periodOverlapsTonight(p, window))
            : false;
        if (overlaps) kind = PLANNED_SEVERITY_KIND[code as number];
      }
      if (!kind) continue;

      const candidate: MaterialDisruption = {
        lineId: line.id,
        lineName: line.name ?? line.id,
        kind,
        reason:
          typeof detail.reason === "string" && detail.reason.trim().length > 0
            ? detail.reason.trim()
            : null,
      };
      if (best === null || KIND_RANK[candidate.kind] < KIND_RANK[best.kind]) {
        best = candidate;
      }
    }

    if (best) out.push(best);
  }

  return out;
}

/** The single most material disruption from a list, or null. Stable: ties keep
 *  input order, so the caller's line ordering (patch relevance) breaks ties. */
export function pickTopDisruption(
  disruptions: readonly MaterialDisruption[],
): MaterialDisruption | null {
  let top: MaterialDisruption | null = null;
  for (const d of disruptions) {
    if (top === null || KIND_RANK[d.kind] < KIND_RANK[top.kind]) top = d;
  }
  return top;
}

// ---------------------------------------------------------------------------
// Copy. Plain register, no em dashes, always a "what to do instead" tail so the
// line is useful, not just a warning. "line" is appended unless the name already
// reads as a line (overground named lines like "Weaver" still take "line").
// ---------------------------------------------------------------------------

export function describeDisruption(d: MaterialDisruption): string {
  const line = lineDisplayLabel(d.lineName);
  switch (d.kind) {
    case "closed":
      return `${line} closed tonight, plan the bus or the walk`;
    case "suspended":
      return `${line} suspended tonight, plan the bus or the walk`;
    case "part_suspended":
      return `${line} part suspended tonight, check your branch is running`;
    case "severe_delays":
      return `Severe delays on the ${line} tonight, leave more time to get home`;
    case "planned_closure":
      return `${line} closed tonight for planned works, plan another way home`;
    case "part_closure":
      return `${line} part closed tonight for planned works, check your branch`;
  }
}

// ---------------------------------------------------------------------------
// Patch composer — the one thing the surface needs.
// ---------------------------------------------------------------------------

export type PatchDisruption = {
  patchId: NightPatchId;
  patchLabel: string;
  lineId: string;
  lineName: string;
  kind: MaterialKind;
  /** The compact one-liner the strip renders. */
  line: string;
};

const PATCH_LABEL: Record<NightPatchId, string> = Object.fromEntries(
  NIGHT_PATCHES.map((p) => [p.id, p.label]),
) as Record<NightPatchId, string>;

/**
 * The single material disruption line for a patch tonight, or null when there is
 * nothing worth saying. Pure over (statuses, patchId, now): resolves the patch's
 * relevant lines, filters to material disruptions overlapping tonight, and picks
 * the most material one. Relevance order breaks ties (the patch's own list order).
 */
export function disruptionForPatch(
  statuses: readonly RawLineStatus[] | null | undefined,
  patchId: string,
  now: Date,
): PatchDisruption | null {
  const relevant = LINE_PATCH_RELEVANCE[patchId as NightPatchId];
  if (!relevant) return null;

  const window = tonightWindow(now);
  const found = materialDisruptionsFor(statuses, new Set(relevant), window);
  if (found.length === 0) return null;

  // Order by the patch's own relevance list first (so a tie surfaces the more
  // central spine), then let pickTopDisruption take the most material.
  const orderIndex = (id: string) => {
    const i = relevant.indexOf(id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const ordered = [...found].sort((a, b) => orderIndex(a.lineId) - orderIndex(b.lineId));
  const top = pickTopDisruption(ordered);
  if (!top) return null;

  return {
    patchId: patchId as NightPatchId,
    patchLabel: PATCH_LABEL[patchId as NightPatchId] ?? patchId,
    lineId: top.lineId,
    lineName: top.lineName,
    kind: top.kind,
    line: describeDisruption(top),
  };
}

// ---------------------------------------------------------------------------
// Fetch (the only impure part). Keyless TfL Line Status for the modes a
// Londoner heading home uses, one call for every line, cached server-side.
// ---------------------------------------------------------------------------

const TFL_HOST = "api.tfl.gov.uk";
// Modes whose lines appear in the relevance table. detail=true gives us the
// validityPeriods a planned closure needs plus a human reason string.
const STATUS_MODES = "tube,dlr,elizabeth-line,overground";
// Revalidate cadence: line status genuinely moves, but not minute to minute for a
// "will this reshape my night" glance. Five minutes keeps it live-feeling while
// the Next data cache means we never hit TfL per render.
export const DISRUPTION_REVALIDATE_SECONDS = 300;
const CALL_TIMEOUT_MS = 9000;

function statusUrl(): string {
  const base = `https://${TFL_HOST}/Line/Mode/${STATUS_MODES}/Status?detail=true`;
  const key = process.env.TFL_APP_KEY;
  return key ? `${base}&app_key=${encodeURIComponent(key)}` : base;
}

/**
 * Fetch TfL Line Status for the night modes, revalidated server-side. Returns
 * null on ANY failure (network, timeout, non-2xx, bad JSON) — the surface then
 * simply renders nothing, never an error. Never throws.
 */
export async function fetchLineStatuses(): Promise<RawLineStatus[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(statusUrl(), {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "PubMaxxing/1.0 (+https://pubmaxxing.com)",
      },
      // Next data cache: shared across requests, refreshed every 5 min. This is
      // what makes the layer server-side-with-revalidate rather than per-render.
      next: { revalidate: DISRUPTION_REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    return (await res.json()) as RawLineStatus[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
