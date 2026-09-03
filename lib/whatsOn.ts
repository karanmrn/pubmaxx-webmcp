// What's-On data spine (Task B1). Types + pure logic for the venue "what's on
// tonight" layer: sport / quiz / deal / music rows, each carrying non-negotiable
// provenance ({label,url}) and a non-future observedAt. zod-free, hand-rolled
// guards mirroring lib/drinkPriceUpdates.ts so a malformed scraped/hand-authored
// row drops instead of poisoning the layer.
//
// Contract note: unlike drink updates, `source` here is { label, url } ONLY —
// no licence field (per the B1 row contract).

import {
  eventIdentityKey,
  isCalendarDate as isCalendarDateShape,
  isHttpUrl as isHttpUrlShape,
  isValidIso as isValidIsoShape,
  isValidObservedAt as isValidObservedAtShape,
  isValidWhatsOnRow as isValidWhatsOnRowShape,
} from "@/lib/whatsOnRowShape.mjs";

export type WhatsOnListedWindow = "tonight" | "tomorrow_night" | "this_weekend";

export const WHATS_ON_KINDS = ["sport", "quiz", "deal", "music", "event"] as const;
export type WhatsOnKind = (typeof WHATS_ON_KINDS)[number];

// "confirmed": venue/organiser directly confirms this row. "listed": a
// first-party listing names this exact row (e.g. a quiz supplier's own venue
// page). "derived": cross-referenced from two separate first-party facts that
// were never jointly confirmed by either source (e.g. "this pub screens live
// sport" x "this fixture kicks off at 8pm") — a plausible, sourced inference,
// not a confirmation. See scripts/whatson/sportFixtures.mjs.
export const WHATS_ON_CONFIDENCES = ["confirmed", "listed", "derived"] as const;
export type WhatsOnConfidence = (typeof WHATS_ON_CONFIDENCES)[number];

// Provenance is non-negotiable: every row is attributable to a real link.
export type WhatsOnSource = { label: string; url: string };

export type WhatsOnRow = {
  id: string;
  venueId?: string;
  placeName: string;
  lat?: number;
  lng?: number;
  kind: WhatsOnKind;
  /** Exact ISO start supplied by the listing source. Missing means unknown. */
  startsAt?: string;
  /**
   * London calendar date (YYYY-MM-DD) the listing STATES when it publishes no
   * clock time. A date-only row is windowed against that evening's own
   * 16:00-04:00 service window; nothing may invent a start time from it.
   */
  startsDate?: string;
  endsAt?: string; // ISO-8601
  /** Human-readable source wording when no exact instant was supplied. */
  timeEvidence?: string;
  /** Provider window that scoped an untimed live listing. */
  listedWindow?: WhatsOnListedWindow;
  title: string;
  detail?: string;
  priceGbp?: number;
  /** Ticketmaster / Skiddle listing image. Never a pub photo. */
  imageUrl?: string;
  /** Provider event id. Dedupes a refresh that sees the same listing twice. */
  sourceId?: string;
  /** Night-area slug from assignVenueToNightArea at build / serve. */
  area?: string;
  source: WhatsOnSource;
  observedAt: string; // ISO-8601, never in the future
  confidence: WhatsOnConfidence;
};

// http(s) URL guard — a source must be a real, absolute link the UI can
// attribute to.
export function isHttpUrl(value: unknown): value is string {
  return isHttpUrlShape(value);
}

// A parseable ISO timestamp (no future constraint — startsAt may be future).
export function isValidIso(value: unknown): value is string {
  return isValidIsoShape(value);
}

// A London calendar date, exactly YYYY-MM-DD, that names a real day. This is
// what a listing carries when it publishes a DAY and no clock time.
export function isCalendarDate(value: unknown): value is string {
  return isCalendarDateShape(value);
}

// A valid ISO timestamp that is not in the future (you cannot have observed an
// event that hasn't happened yet).
export function isValidObservedAt(value: unknown, now: number): value is string {
  return isValidObservedAtShape(value, now);
}

export function isWhatsOnKind(value: unknown): value is WhatsOnKind {
  return (WHATS_ON_KINDS as readonly string[]).includes(value as string);
}

/**
 * The figure a NON-event What's-On surface may print, or null.
 *
 * A kind=event row's `priceGbp` is a TICKET price, and it belongs to the /out
 * event card alone, worded "Tickets from £X" beside its source credit. Every
 * other lane prints a bare "£23.50", which in this product reads as a drink
 * price - and it loses even the "from" qualifier. So the rule lives here, at
 * the one place every reader projects a row from, rather than being restated
 * per surface: Tonight, the map lane, the Today pick, a plan chip and the Pub
 * Pal DTO all ask this instead of reading `row.priceGbp`.
 */
export function whatsOnBarePriceGbp(row: Pick<WhatsOnRow, "kind" | "priceGbp">): number | null {
  if (row.kind === "event") return null;
  return typeof row.priceGbp === "number" && Number.isFinite(row.priceGbp) ? row.priceGbp : null;
}

/**
 * Freshest confirmation per listing kind.
 *
 * The page-level source time is the freshest thing a whole answer can show. A
 * surface about ONE source may not borrow it: the live-music lane is dated by
 * the music feed, and if only July evidence exists for music then July is what
 * that lane says, however recently the deals feed was rebuilt. A kind with no
 * datable evidence is ABSENT rather than null-filled, so a reader is told "no
 * date on this yet" instead of somebody else's day.
 */
export type WhatsOnKindObservedAt = Partial<Record<WhatsOnKind, string>>;

export const EMPTY_KIND_OBSERVED_AT: WhatsOnKindObservedAt = Object.freeze({});

/** Read the per-kind map off an API body. An unknown kind or an unparseable
 *  time contributes nothing: an unusable value must not become a date printed
 *  beside a listing. */
export function parseKindObservedAt(value: unknown): WhatsOnKindObservedAt {
  if (typeof value !== "object" || value === null) return EMPTY_KIND_OBSERVED_AT;
  const out: WhatsOnKindObservedAt = {};
  for (const [kind, at] of Object.entries(value)) {
    if (!isWhatsOnKind(kind)) continue;
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) continue;
    out[kind] = at;
  }
  return out;
}

/**
 * The date ONE line may claim when it covers several kinds at once (a venue's
 * chip row is "quiz and sport tonight" under a single check).
 *
 * A covering claim is only as good as its weakest member, so this is the
 * OLDEST of the kinds it covers - the opposite of the page-level stamp, and
 * for the opposite reason. A kind we cannot date makes the whole line
 * undatable, because a line that quietly dropped it would date the rest of the
 * row as if it spoke for all of them.
 */
export function coveringObservedAt(
  observedAt: WhatsOnKindObservedAt,
  kinds: readonly WhatsOnKind[],
): string | null {
  if (kinds.length === 0) return null;
  let oldest: string | null = null;
  for (const kind of kinds) {
    const at = observedAt[kind];
    if (!at) return null;
    if (oldest === null || Date.parse(at) < Date.parse(oldest)) oldest = at;
  }
  return oldest;
}

export function isWhatsOnConfidence(value: unknown): value is WhatsOnConfidence {
  return (WHATS_ON_CONFIDENCES as readonly string[]).includes(value as string);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Hand-rolled row guard — drop malformed rows rather than throw. `now` is
// injectable for deterministic tests. The RULE itself lives in
// lib/whatsOnRowShape.mjs, because scripts/validate-data.mjs and
// scripts/refresh_whats_on.mjs cannot import TypeScript and used to keep two
// hand-written mirrors of it that drifted the moment the shape widened.
export function isValidWhatsOnRow(value: unknown, now: number = Date.now()): value is WhatsOnRow {
  return isValidWhatsOnRowShape(value, now);
}

// Data-derived event titles occasionally carry a typographic em or en dash
// (for example a scraped "Skehan's [em dash] Live Music"). The authored-copy
// sweep (#358) fixed hand-written strings but never touches data files, so the
// dash leaks onto Tonight and the What's-On spine. This is the
// render/normalisation seam: fold any em or en dash in a displayed title down
// to a plain spaced hyphen so no typographic dash survives. Bulk-editing the
// data files is deliberately avoided; the fix lives at the seam every row
// passes through. The character class uses unicode escapes (U+2014 em,
// U+2013 en) so this source file itself stays free of typographic dashes.
function foldDisplayDashes(value: string): string {
  return value
    .replace(/\s*[\u2014\u2013]\s*/g, " - ")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function normaliseEventTitle(title: string): string {
  return foldDisplayDashes(title);
}

// The same dash leak (#373) reaches the provenance chip: a scraped source label
// like "Skehan's [em dash] Live Music" renders as "via Skehan's \u2014 Live Music" on
// Tonight. Fold the label at the same seam every displayed row passes through so
// no typographic dash survives in the source chip either.
export function normaliseSourceLabel(label: string): string {
  return foldDisplayDashes(label);
}

// Normalise a raw row into the exact WhatsOnRow shape, dropping null optionals
// so downstream `field !== undefined` checks behave.
function normaliseRow(row: WhatsOnRow): WhatsOnRow {
  const out: WhatsOnRow = {
    id: row.id,
    placeName: row.placeName,
    kind: row.kind,
    title: normaliseEventTitle(row.title),
    source: { label: normaliseSourceLabel(row.source.label), url: row.source.url },
    observedAt: row.observedAt,
    confidence: row.confidence,
  };
  if (isNonEmptyString(row.venueId)) out.venueId = row.venueId;
  if (isValidIso(row.startsAt)) out.startsAt = row.startsAt;
  if (isCalendarDate(row.startsDate)) out.startsDate = row.startsDate;
  if (isFiniteNumber(row.lat)) out.lat = row.lat;
  if (isFiniteNumber(row.lng)) out.lng = row.lng;
  if (isValidIso(row.endsAt)) out.endsAt = row.endsAt;
  if (isNonEmptyString(row.timeEvidence)) out.timeEvidence = row.timeEvidence;
  if (
    row.listedWindow === "tonight" ||
    row.listedWindow === "tomorrow_night" ||
    row.listedWindow === "this_weekend"
  ) {
    out.listedWindow = row.listedWindow;
  }
  if (isNonEmptyString(row.detail)) out.detail = row.detail;
  if (isFiniteNumber(row.priceGbp)) out.priceGbp = row.priceGbp;
  if (isHttpUrl(row.imageUrl)) out.imageUrl = row.imageUrl;
  if (isNonEmptyString(row.sourceId)) out.sourceId = row.sourceId;
  if (isNonEmptyString(row.area)) out.area = row.area;
  return out;
}

// A row that carries the PROVIDER'S OWN id is identified by it: two listings
// with distinct sourceIds are two events, however alike their venue, kind and
// start look. A multi-room venue really does run two shows at 20:00, and
// comedy, theatre, club and BARPUB all land on the single kind "event", so
// (place, kind, start) alone silently drops one of them.
//
// Exact-start rows with no id collide on place, kind, and start. Without an
// exact start, listed-time wording is not enough to identify an event, so title
// and source remain part of the identity.
export function dedupeKey(row: WhatsOnRow): string {
  const identity = eventIdentityKey(row);
  if (identity) return identity;
  const place = isNonEmptyString(row.venueId) ? row.venueId : row.placeName.toLowerCase();
  const when =
    row.startsAt ??
    [
      row.startsDate ?? row.timeEvidence ?? row.listedWindow ?? "",
      normaliseEventTitle(row.title).toLocaleLowerCase("en-GB"),
      row.source.url,
    ].join("|");
  return `${place}|${row.kind}|${when}`;
}

// Keep the freshest observedAt on collision (append-only supersede).
export function dedupeRows(rows: WhatsOnRow[]): WhatsOnRow[] {
  const byKey = new Map<string, WhatsOnRow>();
  for (const row of rows) {
    const key = dedupeKey(row);
    const existing = byKey.get(key);
    if (!existing || Date.parse(row.observedAt) > Date.parse(existing.observedAt)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

// The instant a bundled What's-On artifact was written. Every reader dates that
// file's rows by it (isValidObservedAt refuses a row observed after it), so the
// ONE helper lives here rather than being copied per reader.
export function bundledGeneratedAt(raw: unknown): number {
  const at = Date.parse(String((raw as { generatedAt?: unknown })?.generatedAt ?? ""));
  return Number.isFinite(at) ? at : Date.now();
}

// Parse a raw whats-on file body into clean WhatsOnRow[]. Accepts either a bare
// array or a `{ rows: [...] }` envelope (which the quiz_london.json meta+rows
// shape and the latest.json envelope both satisfy). Malformed rows are dropped.
export function parseWhatsOnRows(raw: unknown, now: number = Date.now()): WhatsOnRow[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { rows?: unknown }).rows)
      ? (raw as { rows: unknown[] }).rows
      : [];
  const valid: WhatsOnRow[] = [];
  for (const row of rows) {
    if (isValidWhatsOnRow(row, now)) valid.push(normaliseRow(row));
  }
  return dedupeRows(valid);
}

// Before this hour (London local) "tonight" still belongs to the PREVIOUS
// calendar evening's window — the same rollback lib/tfl.ts uses so the small
// hours resolve against the evening that is still running.
export const SERVICE_DAY_ROLLBACK_HOUR = 4;
// The evening window opens at 16:00 and runs to 04:00 the next morning.
const WINDOW_OPEN_HOUR = 16;

type LondonParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

// BUILDING an Intl.DateTimeFormat is the expensive part of reading a London
// wall clock; formatting with one already built is roughly ten times cheaper.
// This module used to build a fresh formatter on every reading, and a reading
// happens per ROW in the tonight window test, so the cost scaled with the
// listings dataset: on a phone-shaped CI box /today spent about 600ms of its
// server render inside Intl constructors alone, and every row added to the
// deals feed made it worse. The formatter carries no per-call state, so one
// lazily built instance serves the whole process.
let londonPartsFormatter: Intl.DateTimeFormat | null = null;

function londonPartsFormat(): Intl.DateTimeFormat {
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
  return londonPartsFormatter;
}

function londonParts(base: Date): LondonParts {
  const parts = londonPartsFormat().formatToParts(base);
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

// London's UTC offset (ms) at a given instant, derived by comparing the London
// wall-clock reading of `base` to `base` itself. +3600000 in summer (BST),
// 0 in winter (GMT).
function londonOffsetMs(base: Date): number {
  const p = londonParts(base);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(base.getTime() / 1000) * 1000;
}

// Convert a London wall-clock time to an absolute instant. Two offset passes are
// enough because Europe/London has only GMT/BST offsets and our service
// boundaries (16:00 and 04:00) are outside the repeated/skipped transition hour.
// Resolving each boundary independently matters on clock-change nights: using
// `now`'s offset for both ends makes the spring window an hour too long and the
// autumn window an hour too short.
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

// "Now" in Europe/London as a wall-clock Date (same approach as manchesterNow).
// Its local getHours()/getDate() read the London wall clock; do NOT use it as an
// absolute instant.
export function londonNow(base: Date = new Date()): Date {
  const p = londonParts(base);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// The "tonight" window as absolute ISO instants: [evening 16:00, next 04:00).
// Before 04:00 London, the evening date rolls back a day (the still-running
// evening). Resolve each wall-clock boundary independently so spring/autumn DST
// transitions produce the real 11h/13h service window rather than an invented
// fixed 12h span.
export function londonServiceDayBounds(now: number = Date.now()): { start: string; end: string } {
  const p = londonParts(new Date(now));
  const serviceDate = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (p.hour < SERVICE_DAY_ROLLBACK_HOUR) {
    serviceDate.setUTCDate(serviceDate.getUTCDate() - 1);
  }

  const ey = serviceDate.getUTCFullYear();
  const em = serviceDate.getUTCMonth() + 1;
  const ed = serviceDate.getUTCDate();
  const nextDate = new Date(Date.UTC(ey, em - 1, ed + 1));

  const startMs = londonWallTimeToUtcMs(ey, em, ed, WINDOW_OPEN_HOUR);
  const endMs = londonWallTimeToUtcMs(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth() + 1,
    nextDate.getUTCDate(),
    SERVICE_DAY_ROLLBACK_HOUR,
  );
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

// A point row carries no endsAt, so on its own it collapses to a zero-width
// instant at startsAt. That made an in-progress event vanish the moment its
// start passed: a 19:30 quiz dropped from the default path at 19:31 (#417).
// Give a point row a kind-aware effective DURATION instead, so its interval is
// [startsAt, startsAt + grace]. Each duration is the typical real run-length of
// that activity, picked conservatively (better to keep a just-finished row a
// little too long than to drop one that is still live):
//   quiz  ~3h    a pub quiz plus its wind-down runs about three hours.
//   music ~3h    a live-music or residency night runs a full set, about three hours.
//   sport ~2.5h  a match plus build-up and reaction runs about two and a half hours.
//   deal   0     deals always carry an explicit endsAt (their window is exact),
//                so a deal reaching here as a point gets no invented grace.
// Interval rows (any row WITH endsAt) are untouched: their endsAt stays exact.
const POINT_ROW_GRACE_MS: Record<WhatsOnKind, number> = {
  quiz: 3 * 60 * 60 * 1000,
  music: 3 * 60 * 60 * 1000,
  sport: 2.5 * 60 * 60 * 1000,
  deal: 0,
  event: 3 * 60 * 60 * 1000,
};

/**
 * The 16:00-04:00 service window as instants, resolved once for a caller that
 * is about to ask about many rows. Named for the SERVICE day it comes from,
 * because lib/tflDisruption.ts publishes its own narrower 17:00-02:00 night
 * window and two differently-bounded "tonight windows" must not read alike.
 */
export type TonightServiceWindow = { startMs: number; endMs: number };

export function tonightServiceWindow(now: number = Date.now()): TonightServiceWindow {
  const { start, end } = londonServiceDayBounds(now);
  return { startMs: Date.parse(start), endMs: Date.parse(end) };
}

/**
 * The 16:00-04:00 evening window belonging to one stated London calendar date.
 *
 * A date-only row (`startsDate`, no `startsAt`) states a DAY and nothing more,
 * so this is the whole interval it may claim. Never derive a clock time from a
 * stated date: an invented start is a fact the listing does not carry.
 */
export function londonEveningWindowForDate(date: string): TonightServiceWindow | null {
  if (!isCalendarDate(date)) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    startMs: londonWallTimeToUtcMs(year, month, day, WINDOW_OPEN_HOUR),
    endMs: londonWallTimeToUtcMs(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      SERVICE_DAY_ROLLBACK_HOUR,
    ),
  };
}

/**
 * The interval a row occupies, in the one reading every window test shares: an
 * exact-start row is [startsAt, rowEffectiveEnd], a date-only row is its stated
 * evening, and a row with neither has no interval at all.
 */
export function rowStatedInterval(row: WhatsOnRow): TonightServiceWindow | null {
  if (row.startsAt) {
    const startMs = Date.parse(row.startsAt);
    if (!Number.isFinite(startMs)) return null;
    return { startMs, endMs: rowEffectiveEnd(row) };
  }
  if (row.startsDate) return londonEveningWindowForDate(row.startsDate);
  return null;
}

// Is the row happening during tonight's evening window?
//
// Overlap, not start-containment. The original test asked only whether
// `startsAt` fell inside [16:00, 04:00). That silently dropped every all-day
// row whose clock start is BEFORE the window opens but which is plainly still
// on through the evening: most visibly the Wetherspoon food deals, which all
// carry startsAt 11:30 and endsAt 23:00 and were therefore excluded from
// Tonight on EVERY night despite being live at 22:00. We treat the row as an
// interval [startsAt, effectiveEnd] via rowEffectiveEnd and include it when that
// interval overlaps the window. An interval row uses its exact endsAt; a point
// row uses its kind-aware effective end (POINT_ROW_GRACE_MS), so an in-progress
// quiz or match still overlaps the window and tonight windowing never disagrees
// with the past-dated guard (#417).
export function isOnTonight(
  row: WhatsOnRow,
  now: number = Date.now(),
  // Tonight's window, already resolved. It depends only on `now`, so a caller
  // asking about many rows at one instant resolves it once and hands it in
  // rather than paying for a London clock reading per row. Omit it and the
  // answer is identical, just resolved here.
  tonight: TonightServiceWindow = tonightServiceWindow(now),
): boolean {
  if (!row.startsAt && !row.startsDate) return row.listedWindow === "tonight";
  const stated = rowStatedInterval(row);
  if (!stated || !Number.isFinite(stated.startMs) || !Number.isFinite(stated.endMs)) return false;
  // Half-open window [startMs, endMs): the row must begin before the window
  // closes and still be running at or after it opens.
  return stated.startMs < tonight.endMs && stated.endMs >= tonight.startMs;
}

export function filterTonight(rows: WhatsOnRow[], now: number = Date.now()): WhatsOnRow[] {
  const tonight = tonightServiceWindow(now);
  return rows.filter((row) => isOnTonight(row, now, tonight));
}

// The instant a row stops being relevant: its explicit endsAt, or (for a point
// row that carries no endsAt) startsAt plus a kind-aware effective duration
// (POINT_ROW_GRACE_MS above). Same interval reading isOnTonight uses (#409/#417):
// a row is [startsAt, effectiveEnd]. Interval rows keep their exact endsAt; only
// point rows gain grace. Returns NaN only when startsAt itself is unparseable (a
// row that would already fail isValidWhatsOnRow).
export function rowEffectiveEnd(row: WhatsOnRow): number {
  const startsAt = row.startsAt ? Date.parse(row.startsAt) : Number.NaN;
  const parsedEnd = row.endsAt ? Date.parse(row.endsAt) : NaN;
  if (Number.isFinite(parsedEnd)) return parsedEnd; // interval row: exact endsAt
  if (!Number.isFinite(startsAt)) {
    // Date-only row: its stated evening closes at 04:00 the next morning, so it
    // goes past-dated with that evening rather than never at all.
    if (row.startsDate) return londonEveningWindowForDate(row.startsDate)?.endMs ?? Number.NaN;
    return startsAt; // unparseable start -> NaN
  }
  return startsAt + POINT_ROW_GRACE_MS[row.kind]; // point row: kind-aware grace
}

// Freshness guard for the serving/build seam. A row is past-dated once its
// interval has ended: effectiveEnd <= now. A point row (no endsAt) stays live for
// its kind-aware grace after startsAt (POINT_ROW_GRACE_MS), then goes past; an
// interval row (e.g. an all-day deal) stays live while it is still running,
// exactly like isOnTonight's overlap test.
//
// This is the #408 defence: the hand-curated sport-fixtures seed goes stale the
// moment a kickoff passes (crons are dead, so nothing re-derives it), and a
// stale bundled seed must never be SERVED. The tonight window path already
// scopes past rows out via filterTonight; this guards the default (no window)
// path, which would otherwise surface a played fixture forever.
export function isPastDated(row: WhatsOnRow, now: number = Date.now()): boolean {
  const end = rowEffectiveEnd(row);
  return Number.isFinite(end) && end <= now;
}

export function filterNotPast(rows: WhatsOnRow[], now: number = Date.now()): WhatsOnRow[] {
  return rows.filter((row) => !isPastDated(row, now));
}

export function filterByKind(rows: WhatsOnRow[], kind: WhatsOnKind): WhatsOnRow[] {
  return rows.filter((row) => row.kind === kind);
}

export type VenueResolver = (placeName: string, lat?: number, lng?: number) => string | undefined;

// Attach a venueId to a row by resolving its placeName/coords. Left injectable
// so a scraped-by-name row can be matched later without this module importing
// the venue dataset (keeps it pure + cheap).
export function matchVenueId(row: WhatsOnRow, resolver: VenueResolver): WhatsOnRow {
  if (isNonEmptyString(row.venueId)) return row;
  const venueId = resolver(row.placeName, row.lat, row.lng);
  return venueId ? { ...row, venueId } : row;
}
