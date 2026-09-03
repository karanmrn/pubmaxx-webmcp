// lib/whatsOnRowShape.mjs
//
// What a What's-On row must LOOK LIKE, written down exactly once.
//
// This used to live in lib/whatsOn.ts with two hand-kept "mirrors" beside it -
// scripts/validate-data.mjs and scripts/refresh_whats_on.mjs - and they drifted
// the moment the spine learned a new shape: a date-only row (a listing that
// publishes a day and no clock time) was valid to the app and a hard failure to
// the validator, which would have broken the refresh workflow's own validate
// step, the local scheduler and the pre-push gate.
//
// Plain ESM with a .d.mts sidecar (the lib/pintIndexCanonical.mjs pattern),
// because allowJs is false and the app, the validator and the refresh script
// all need ONE answer. `whatsOnRowProblems` is the whole implementation;
// `isValidWhatsOnRow` is that answer read as a boolean, so a caller wanting to
// SAY what is wrong and a caller wanting to drop the row cannot disagree.

export const WHATS_ON_KINDS = ["sport", "quiz", "deal", "music", "event"];
export const WHATS_ON_CONFIDENCES = ["confirmed", "listed", "derived"];
export const WHATS_ON_LISTED_WINDOWS = ["tonight", "tomorrow_night", "this_weekend"];

export function isWhatsOnKind(value) {
  return WHATS_ON_KINDS.includes(value);
}

export function isWhatsOnConfidence(value) {
  return WHATS_ON_CONFIDENCES.includes(value);
}

/**
 * WHO a listing is, when its publisher names it.
 *
 * A provider's own id identifies one event inside that provider's catalogue, so
 * the pair (source label, sourceId) is the whole of the identity - and the
 * three lanes that need it (the build-time fold, the request-time fold and the
 * spine's own dedupe) must spell it the SAME way or two of them will disagree
 * about whether two rows are one event. What each lane still decides for itself
 * is the MERGE: which row wins, and what it inherits.
 *
 * Null means the row names no id, and then identity falls to whatever key the
 * caller uses for a row nobody numbered.
 */
export function eventIdentityKey(row) {
  const label =
    typeof row?.source?.label === "string" ? row.source.label.trim() : row?.source?.label;
  const sourceId = typeof row?.sourceId === "string" ? row.sourceId.trim() : row?.sourceId;
  if (!isNonEmptyString(label) || !isNonEmptyString(sourceId)) return null;
  return `${label.toLocaleLowerCase("en-GB")}|${sourceId}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Optional field: absent (undefined) or null is fine; if present it must pass.
// Scraped payloads (e.g. quiz_london.json) use `null` for an unresolved
// venueId, so null is treated as "absent".
function isAbsentOr(value, guard) {
  return value === undefined || value === null || guard(value);
}

// http(s) URL guard — a source must be a real, absolute link the UI can
// attribute to.
export function isHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// A parseable ISO timestamp (no future constraint — startsAt may be future).
export function isValidIso(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

// A London calendar date, exactly YYYY-MM-DD, that names a real day. This is
// what a listing carries when it publishes a DAY and no clock time.
export function isCalendarDate(value) {
  if (!isNonEmptyString(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

// A valid ISO timestamp that is not in the future (you cannot have observed an
// event that hasn't happened yet).
export function isValidObservedAt(value, now) {
  if (!isNonEmptyString(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now;
}

function isValidSource(value) {
  if (typeof value !== "object" || value === null) return false;
  return isNonEmptyString(value.label) && isHttpUrl(value.url);
}

/**
 * Everything wrong with one row, in words a validator can print. An empty array
 * means the row is valid. `now` is injectable for deterministic tests.
 */
export function whatsOnRowProblems(value, now = Date.now()) {
  if (typeof value !== "object" || value === null) return ["not an object"];
  const row = value;
  // A row says WHEN through an exact ISO instant, a stated calendar date,
  // source-listed time wording, or a provider window. A listing that publishes
  // a day and no clock time is date-only by design and must not be refused.
  const when = {
    hasExactStart: isValidIso(row.startsAt),
    hasStatedDate: isCalendarDate(row.startsDate),
    hasListedTime: isNonEmptyString(row.timeEvidence),
    hasListedWindow: WHATS_ON_LISTED_WINDOWS.includes(row.listedWindow),
  };
  return [...requiredProblems(row, now, when), ...optionalProblems(row, when)];
}

function requiredProblems(row, now, when) {
  const problems = [];
  if (!isNonEmptyString(row.id)) problems.push("missing/empty id");
  if (!isNonEmptyString(row.placeName)) problems.push("missing/empty placeName");
  if (!isWhatsOnKind(row.kind)) problems.push(`invalid kind "${row.kind}"`);
  if (!when.hasExactStart && !when.hasStatedDate && !when.hasListedTime && !when.hasListedWindow) {
    problems.push("no startsAt, startsDate, timeEvidence or listedWindow");
  }
  if (!isNonEmptyString(row.title)) problems.push("missing/empty title");
  if (!isValidSource(row.source)) problems.push("missing/invalid source {label, url}");
  if (!isValidObservedAt(row.observedAt, now)) {
    problems.push(`observedAt "${row.observedAt}" is missing, unparseable or in the future`);
  }
  if (!isWhatsOnConfidence(row.confidence)) {
    problems.push(`invalid confidence "${row.confidence}"`);
  }
  return problems;
}

function optionalProblems(row, when) {
  const problems = [];
  const present = (field) => row[field] !== undefined && row[field] !== null;
  if (present("startsAt") && !when.hasExactStart) {
    problems.push("startsAt is not a valid ISO timestamp");
  }
  if (present("startsDate") && !when.hasStatedDate) {
    problems.push(`startsDate "${row.startsDate}" is not a YYYY-MM-DD calendar date`);
  }
  if (!isAbsentOr(row.venueId, isNonEmptyString)) {
    problems.push("venueId must be a non-empty string");
  }
  if (present("lat") && !isFiniteNumber(row.lat)) problems.push("lat must be a finite number");
  if (present("lng") && !isFiniteNumber(row.lng)) problems.push("lng must be a finite number");
  if (present("endsAt") && (!when.hasExactStart || !isValidIso(row.endsAt))) {
    problems.push("endsAt needs an exact startsAt and a valid ISO value");
  }
  if (!isAbsentOr(row.timeEvidence, isNonEmptyString)) {
    problems.push("timeEvidence must be a non-empty string");
  }
  if (row.listedWindow !== undefined && !when.hasListedWindow) {
    problems.push(`invalid listedWindow "${row.listedWindow}"`);
  }
  if (!isAbsentOr(row.detail, isNonEmptyString)) problems.push("detail must be a non-empty string");
  if (present("priceGbp") && (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0)) {
    problems.push("priceGbp must be a finite number >= 0");
  }
  if (!isAbsentOr(row.imageUrl, isHttpUrl)) problems.push("imageUrl must be an http(s) URL");
  if (!isAbsentOr(row.sourceId, isNonEmptyString)) {
    problems.push("sourceId must be a non-empty string");
  }
  if (!isAbsentOr(row.area, isNonEmptyString)) problems.push("area must be a non-empty string");
  return problems;
}

export function isValidWhatsOnRow(value, now = Date.now()) {
  return whatsOnRowProblems(value, now).length === 0;
}
