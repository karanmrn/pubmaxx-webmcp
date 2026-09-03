// Structured Visit Reports v1 (Wayfinder 3.4) — the BROWSER-SAFE domain core.
//
// A Visit Report is the honest, structured sibling of the free-text Pint Drop
// anecdote: someone was at a pub on a given evening and taps a few fixed
// choices about what they observed (crowd, noise, seating, and bar wait) plus an
// optional short note. It is deliberately narrow: no free-text tags, star score,
// recommendation proxy, or aggregate verdict.
//
// This module is PURE + browser-safe (no @/lib/supabase, no node builtins, no
// React) so the capture card AND the server route share the EXACT same
// vocabulary + validation and can never drift — the same split pintDrops uses
// (pintDropShared.ts) and areaDemand.ts follows. The durable/in-memory stores
// and moderation live in lib/visitReportsStore.ts (the impure seam); id +
// timestamps are stamped THERE, so nothing here needs crypto.
//
// Duty of care: every field describes a visit, never the drinker. No streaks,
// points, public star score, or claim that one account is a verified venue fact.

import { normalizeHandle } from "@/lib/handleNormalize";
import { londonDayKey } from "@/lib/pintContributions";
import { presentableDescription } from "@/lib/slopFilter";
import { DAY_MS } from "@/lib/dayMs";

// ── Fixed vocabularies ───────────────────────────────────────────────────────
// Small, closed sets. The client can only ever send one of these; anything else
// is normalised to null (never stored raw), and the DB CHECK constraints in
// migrations 0046 (busyness) and 0058 (noise, seating, bar wait) mirror them
// (defence in depth).

/** How busy the pub was. */
export const BUSYNESS_VALUES = ["quiet", "steady", "rammed"] as const;
export type Busyness = (typeof BUSYNESS_VALUES)[number];

/** Could people talk normally, or did they have to compete with the room? */
export const NOISE_VALUES = ["easy-to-talk", "loud", "had-to-shout"] as const;
export type Noise = (typeof NOISE_VALUES)[number];

/** What finding somewhere to sit was like during this visit. */
export const SEATING_VALUES = ["plenty", "tight", "standing"] as const;
export type Seating = (typeof SEATING_VALUES)[number];

/** What the wait at the bar was like during this visit. */
export const SERVICE_WAIT_VALUES = ["quick", "some-wait", "long"] as const;
export type ServiceWait = (typeof SERVICE_WAIT_VALUES)[number];

/** A note is a courtesy line, not an essay. 140 chars keeps it a caption. */
export const MAX_VISIT_NOTE = 140;

/**
 * How far back a visit may be written up, in calendar days.
 *
 * The visited date is authority-bearing: the public lane sorts on it, so the
 * day someone types decides what a reader sees first. An unbounded past date
 * therefore hands one submission the top of a pub's page for as long as it
 * likes, and a night from years ago describes a room that may no longer exist.
 * Ninety days keeps the lane an account of the pub as it is now while still
 * covering a visit someone writes up long after the night itself.
 */
export const MAX_VISIT_AGE_DAYS = 90;

const MAX_VENUE_ID = 64;

/**
 * The visit-report id in the shared interruptive-prompt vocabulary
 * (lib/promptBudget.ts), reserved so an unprompted ASK could never stack on top
 * of the A2HS / first-run / identity-nudge surfaces in one sitting. The shipped
 * panel is inline and reader-first (the accounts always render, the composer
 * opens only on a tap), so it interrupts nobody and claims no budget.
 */
export const VISIT_REPORT_PROMPT_SURFACE = "visit-report";

export type VisitReportStatus = "visible" | "hidden";
export type VisitReportReadStatus = "ready" | "degraded";

/** The validated, normalised fields the store persists (id + timestamps + the
 *  moderation ledger are stamped by the store, keeping this module crypto-free
 *  and browser-safe). */
export type VisitReportFields = {
  venueId: string;
  handle: string;
  /** The evening the visit happened, as a London calendar day (YYYY-MM-DD). One
   *  report per handle per venue per night keys on exactly this. */
  visitedAt: string;
  busyness: Busyness | null;
  noise: Noise | null;
  seating: Seating | null;
  serviceWait: ServiceWait | null;
  /** "" when none — always a string, never null, so it round-trips cleanly. */
  note: string;
};

/** A persisted Visit Report: the validated fields plus store-stamped identity,
 *  status, and the moderation metadata (mirrors the Pint Drop report ledger). */
export type VisitReport = VisitReportFields & {
  id: string;
  status: VisitReportStatus;
  createdAt: string;
  reportedAt?: string;
  reportReason?: string;
  reportCount?: number;
  /** Distinct actor hashes that have reported this row — de-dupes so one actor
   *  can never bump the hide counter twice (the array-column mirror of the Pint
   *  Drop per-actor report ledger). */
  reportActors?: string[];
  moderatedAt?: string;
  moderatorNote?: string;
};

/** The public read shape: the row minus the moderation trail (reporter metadata
 *  and moderator notes never leave the server), mirroring PintDropDTO. */
export type VisitReportDTO = Omit<
  VisitReport,
  "reportedAt" | "reportReason" | "reportCount" | "reportActors" | "moderatedAt" | "moderatorNote" | "status"
>;

export type ValidationResult =
  | { ok: true; value: VisitReportFields }
  | { ok: false; error: string };

// ── Normalisers ──────────────────────────────────────────────────────────────

function clean(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "") // no inline user HTML
    .replace(/[\u0000-\u001f\u007f]/g, " ") // strip control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

export { normalizeHandle } from "@/lib/handleNormalize";

function coerce<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export function cleanBusyness(value: unknown): Busyness | null {
  return coerce(value, BUSYNESS_VALUES);
}
export function cleanNoise(value: unknown): Noise | null {
  return coerce(value, NOISE_VALUES);
}
export function cleanSeating(value: unknown): Seating | null {
  return coerce(value, SEATING_VALUES);
}
export function cleanServiceWait(value: unknown): ServiceWait | null {
  return coerce(value, SERVICE_WAIT_VALUES);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// A visit before ~5am London still belongs to the night that started the
// previous calendar day — the "evening date". Shift the instant back 5 hours
// BEFORE resolving the London day so 02:00 Saturday maps to Friday's night,
// while 20:00 stays put. DST-robust because the shifted instant is formatted in
// Europe/London, not arithmetic on a bare date.
const EVENING_SHIFT_MS = 5 * 60 * 60 * 1000;

/** The London "evening date" (YYYY-MM-DD) an instant belongs to — pre-dawn
 *  hours fold back onto the night that started the evening before. Pure. */
export function londonEveningKey(instant: Date | number = new Date()): string {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  if (!Number.isFinite(ms)) return "";
  return londonDayKey(new Date(ms - EVENING_SHIFT_MS));
}

/** Latest calendar date the composer and server may accept. Unlike an observed
 * timestamp, a date input never folds pre-dawn hours into the previous night. */
export function latestVisitedAt(now: Date = new Date()): string {
  return londonDayKey(now);
}

/**
 * The oldest calendar date a report may be written up for, as a London day key.
 * Calendar-day arithmetic on the day key itself (never on a wall-clock instant),
 * so today is always in range whatever the time of day, and exactly
 * MAX_VISIT_AGE_DAYS ago is the last day that still counts. Pure.
 */
export function earliestVisitedAt(now: Date = new Date()): string {
  const today = latestVisitedAt(now);
  const ms = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms - MAX_VISIT_AGE_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Resolve an untrusted `visitedAt` to a London evening day key, or null when it
 * is unusable. A bare YYYY-MM-DD is taken as the evening date verbatim (the
 * capture card sends this); a full timestamp is folded through londonEveningKey.
 * A future calendar date is rejected (you can't report a night that hasn't happened),
 * and so is one older than MAX_VISIT_AGE_DAYS — this is the SERVER's window, not
 * the composer's, so a hand-rolled POST meets the same bound as the date input.
 * Omitted → today's London calendar date.
 */
export function resolveVisitedAt(value: unknown, now: Date = new Date()): string | null {
  const today = latestVisitedAt(now);
  if (value === undefined || value === null || value === "") return today;
  let key: string;
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) {
    const trimmed = value.trim();
    // Date.parse normalises some impossible dates (for example 30 February).
    // Round-trip the parsed value so only a real calendar day survives.
    const parsed = Date.parse(`${trimmed}T00:00:00Z`);
    if (!Number.isFinite(parsed)) return null;
    if (new Date(parsed).toISOString().slice(0, 10) !== trimmed) return null;
    key = trimmed;
  } else {
    const ms = typeof value === "number" ? value : Date.parse(String(value));
    if (!Number.isFinite(ms)) return null;
    key = londonEveningKey(ms);
  }
  if (!key) return null;
  // No future calendar dates.
  if (key > today) return null;
  // No nights older than the window (calendar days, both ends inclusive).
  const earliest = earliestVisitedAt(now);
  if (earliest && key < earliest) return null;
  return key;
}

/** True when the fields carry at least one real signal — a report of nothing is
 *  meaningless and never stored (the "all optional except one" rule: at least
 *  one structured field or a note must be present). */
export function hasSignal(
  fields: Pick<VisitReportFields, "busyness" | "noise" | "seating" | "serviceWait" | "note">,
): boolean {
  return Boolean(
    fields.busyness ||
      fields.noise ||
      fields.seating ||
      fields.serviceWait ||
      (fields.note && fields.note.length > 0),
  );
}

/**
 * Validate + normalise an untrusted submission into persistable fields. The
 * trust boundary: venue + handle are required, every structured field is coerced
 * to its allowlist (unknown → null), the note is cleaned, capped, AND run
 * through the slop filter at write time (marketing-register slop is dropped to
 * ""), and at least one signal must survive.
 */
export function validateVisitReport(input: unknown, now: Date = new Date()): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Missing submission body." };
  }
  const raw = input as Record<string, unknown>;

  const venueId = clean(raw.venueId, MAX_VENUE_ID);
  if (!venueId) return { ok: false, error: "Choose a venue." };

  const handle = normalizeHandle(raw.handle);
  if (!handle) return { ok: false, error: "Add a contributor handle." };

  const visitedAt = resolveVisitedAt(raw.visitedAt, now);
  if (!visitedAt) {
    return {
      ok: false,
      error: `Pick the day you were there, from the last ${MAX_VISIT_AGE_DAYS} days.`,
    };
  }

  // Slop-filter the note at write time (lib/slopFilter): a note that reads as
  // marketing slop renders/stores nothing, exactly like the venue-story seam.
  const rawNote = clean(raw.note, MAX_VISIT_NOTE);
  const note = presentableDescription(rawNote) ?? "";

  const fields: VisitReportFields = {
    venueId,
    handle,
    visitedAt,
    busyness: cleanBusyness(raw.busyness),
    noise: cleanNoise(raw.noise),
    seating: cleanSeating(raw.seating),
    serviceWait: cleanServiceWait(raw.serviceWait),
    note,
  };

  if (!hasSignal(fields)) {
    return { ok: false, error: "Add at least one detail about your visit." };
  }

  return { ok: true, value: fields };
}

/** Strip the moderation trail for a public read (mirrors PintDrop toDTO). */
export function toVisitReportDTO(report: VisitReport): VisitReportDTO {
  return {
    id: report.id,
    venueId: report.venueId,
    handle: report.handle,
    visitedAt: report.visitedAt,
    busyness: report.busyness,
    noise: report.noise,
    seating: report.seating,
    serviceWait: report.serviceWait,
    note: report.note,
    createdAt: report.createdAt,
  };
}

// Report-abuse policy: a reader flag only ever QUEUES a row for review. There is
// deliberately no count at which a report hides an account by itself — only a
// moderator hides one, and hiding never deletes its provenance.
