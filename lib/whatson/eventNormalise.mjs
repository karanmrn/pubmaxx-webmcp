// lib/whatson/eventNormalise.mjs
//
// The PURE half of the What's-On events vertical: the city table, the per-city
// provider geo, the source descriptors, the kind maps, the drop counters, the
// two provider normalisers and the sourceId dedupe.
//
// It lives here rather than in scripts/whatson/eventsRefresh.mjs because
// /api/out imports these at request time, and that script is a CLI: it pulls
// node:child_process, holds execFileSync git/gh calls and ends in a
// module-level `await main()`. A route has no business carrying any of that.
// Plain ESM with a .d.mts sidecar (the lib/pintIndexCanonical.mjs pattern),
// because allowJs is false and the script and the route both need one answer.

import { CITY_BOUNDS } from "../cityBounds.mjs";
import { eventIdentityKey } from "../whatsOnRowShape.mjs";

export const EVENT_REFRESH_CITIES = [
  "london",
  "bristol",
  "cambridge",
  "glasgow",
  "liverpool",
  "manchester",
  "oxford",
];

const LONDON = { lat: 51.5074, lng: -0.1278, radiusMiles: 30 };

// ---------------------------------------------------------------------------
// Source descriptors + attribution
// ---------------------------------------------------------------------------

// Ticketmaster: every row's source links back to the event's own TM page (the
// deep-link-back the Discovery API terms require). See research doc §1 — the
// exact "Powered by Ticketmaster" branding-guide string is unverified; the
// "via Ticketmaster" label + deep link satisfies the attribution we can
// confirm. Confirm the branding guide before public launch.
export const TICKETMASTER_SOURCE = {
  label: "Ticketmaster",
  url: "https://www.ticketmaster.co.uk/",
};

// Skiddle: rows link back to the event's own skiddle.com page (their affiliate
// / display expectation). See research doc §3 — commercial use requires written
// approval; this provider is gated behind SKIDDLE_API_KEY.
export const SKIDDLE_SOURCE = {
  label: "Skiddle",
  url: "https://www.skiddle.com/",
};

/**
 * Skiddle's licence asks for the name, the LOGO and a link to the event's own
 * skiddle.com page whenever one of their rows is on screen. We hold the name
 * and the link; the official logo asset is ABSENT and pending from the captain,
 * and drawing a lookalike would satisfy no licence while imitating another
 * company's wordmark.
 *
 * So this is the fence, and it is NOT the missing API key: while the asset is
 * absent no Skiddle row may be fetched, written or served, and the day the key
 * lands must not be the day the obligation goes undischarged. It lives HERE,
 * beside SKIDDLE_SOURCE, because the build-time CLI and the request-time seam
 * both read this module - a flag either of them could not see is a fence that
 * fails open on the other. Set it true in the same change that adds the
 * supplied asset, and the lane returns to being gated on SKIDDLE_API_KEY alone.
 */
export const SKIDDLE_BRAND_ASSET_PRESENT = false;

/** True while a Skiddle row may not be fetched, written or served at all. */
export function skiddleLaneFenced() {
  return !SKIDDLE_BRAND_ASSET_PRESENT;
}

// Music and sport keep their own kinds. Comedy / theatre / club / BARPUB land
// on "event". Anything else is dropped and counted.
export const TICKETMASTER_SEGMENT_KIND = {
  Music: "music",
  Sports: "sport",
  "Arts & Theatre": "event",
  Comedy: "event",
};

export const SKIDDLE_EVENTCODE_KIND = {
  LIVE: "music",
  FEST: "music",
  SPORT: "sport",
  CLUB: "event",
  COMEDY: "event",
  THEATRE: "event",
  BARPUB: "event",
};

/**
 * Every reason a listing is refused, named ONCE.
 *
 * A drop is a finding, so the counters travel from a normaliser up through a
 * lane into the run summary - and each of those hops used to restate this list
 * by hand. A seventh reason would then be counted by the normaliser and thrown
 * away by both merges with nothing failing, which is the shape the row contract
 * already removed by moving to lib/whatsOnRowShape.mjs.
 */
export const EVENT_DROP_REASONS = Object.freeze([
  "noKind",
  "noPlace",
  "noStart",
  "noUrl",
  "noTitle",
]);

function freshEventDrops() {
  const dropped = {};
  for (const reason of EVENT_DROP_REASONS) dropped[reason] = 0;
  dropped.total = 0;
  return dropped;
}

export const EMPTY_EVENT_DROPS = Object.freeze(freshEventDrops());

export function emptyEventDrops() {
  return freshEventDrops();
}

/** Add one set of drop counters into another, and answer the one added into. */
export function mergeEventDrops(into, from) {
  if (!from) return into;
  for (const reason of EVENT_DROP_REASONS) into[reason] += from[reason] ?? 0;
  into.total += from.total ?? 0;
  return into;
}

function noteDrop(dropped, reason) {
  dropped[reason] += 1;
  dropped.total += 1;
}

export function summariseEventDrops(dropped) {
  if (!dropped || dropped.total === 0) return "dropped 0";
  const clauses = EVENT_DROP_REASONS.map((reason) => `${reason}=${dropped[reason] ?? 0}`);
  return `dropped ${dropped.total} (${clauses.join(" ")})`;
}

export function dedupeEventRowsBySourceId(rows) {
  const byKey = new Map();
  const leftover = [];
  for (const row of rows) {
    const key = eventIdentityKey(row);
    if (!key) {
      leftover.push(row);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || Date.parse(row.observedAt) >= Date.parse(existing.observedAt)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values(), ...leftover];
}

// ---------------------------------------------------------------------------
// Time helpers (pure)
// ---------------------------------------------------------------------------

// Europe/London UTC offset (ms) at an absolute instant. +3600000 in BST, 0 in
// GMT. Mirrors lib/whatsOn.ts londonOffsetMs but self-contained for the script.
function londonOffsetMsAt(instantMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

// Turn a value into a clean absolute ISO string, or null. Accepts a
// tz-qualified ISO (used as-is) OR a bare "YYYY-MM-DD HH:MM:SS" / "…THH:MM:SS"
// wall-clock time, which is interpreted in Europe/London (what Skiddle and
// Ticketmaster localDate/localTime return).
export function toIsoInstant(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const trimmed = value.trim();
  // Already carries a timezone (Z or ±hh:mm) — trust it.
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (!Number.isFinite(asUtc)) return null;
  const offset = londonOffsetMsAt(asUtc);
  return new Date(asUtc - offset).toISOString();
}

// The one sentence a row uses when its source publishes a day and no clock
// time. Shared with the Common reader so the two lanes cannot word it apart.
export const DATE_ONLY_TIME_EVIDENCE = "Date listed, start time not published";

// A stated London calendar date, or null. Accepts "YYYY-MM-DD" with anything
// after it ignored, because a provider that also carries a time is answered by
// toIsoInstant instead. Never invents a day.
export function statedCalendarDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

// FNV-1a stable id (matches the spine's stableId flavour in lib/whatsOn.ts).
function stableId(prefix, input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function httpUrl(value) {
  if (!nonEmptyString(value)) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}

function finiteNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Parse a leading GBP amount out of a free-text price ("£10", "10.50", "Free").
function parseGbp(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (!nonEmptyString(value)) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(value.replace(/[,]/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Venue matching is not this module's business. The build-time refresh hands
// in both the loaded canonical index and the resolver; /api/out passes neither
// here and instead runs the SAME resolver after the lanes fold, over an index
// built from the slim venue rows the server already holds
// (lib/out/venueMatch.ts). Importing the resolver here would drag its 6.7 MB
// canonical-dataset reader into the route's bundle for a lane the route never
// runs.
function attachVenue(row, venueMatch, venueIndex, resolveVenue) {
  if (!venueIndex || typeof resolveVenue !== "function") return row;
  const resolved = resolveVenue(venueMatch, venueIndex);
  if (resolved) row.venueId = resolved;
  return row;
}

// ---------------------------------------------------------------------------
// Ticketmaster normalisation (pure)
// ---------------------------------------------------------------------------

// The point + radius a provider aims at for one city, derived from the shared
// bounds table so the build-time refresh and the request-time /api/out seams
// cannot aim at two different centres. Turning a city on is data, not code.
export function cityGeo(city = "london") {
  const bounds = CITY_BOUNDS[city];
  if (!bounds) return { ...LONDON };
  const lat = (bounds.latMin + bounds.latMax) / 2;
  const lng = (bounds.lonMin + bounds.lonMax) / 2;
  const latMiles = ((bounds.latMax - bounds.latMin) * 69) / 2;
  const lonMiles =
    ((bounds.lonMax - bounds.lonMin) * 69 * Math.cos((lat * Math.PI) / 180)) / 2;
  return { lat, lng, radiusMiles: Math.max(5, Math.ceil(Math.hypot(latMiles, lonMiles))) };
}

function firstImageUrl(images) {
  if (!Array.isArray(images)) return null;
  for (const image of images) {
    const url = httpUrl(image?.url);
    if (url) return url;
  }
  return null;
}

function asSourceId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (nonEmptyString(value)) return value.trim();
  return null;
}

// First mapping kind across an event's classifications, or undefined.
function ticketmasterKind(classifications) {
  for (const c of classifications) {
    const seg = c?.segment?.name;
    if (nonEmptyString(seg) && TICKETMASTER_SEGMENT_KIND[seg]) return TICKETMASTER_SEGMENT_KIND[seg];
  }
  return undefined;
}

// dates.start.dateTime (tz-qualified) or localDate+localTime (London wall).
function ticketmasterStart(start) {
  const fromDateTime = toIsoInstant(start?.dateTime);
  if (fromDateTime) return fromDateTime;
  if (nonEmptyString(start?.localDate) && nonEmptyString(start?.localTime)) {
    return toIsoInstant(`${start.localDate} ${start.localTime}`);
  }
  return null;
}

// Map one Discovery API v2 event object to a WhatsOnRow, or null if it can't be
// honestly represented (no mapping kind, no place name, no start, no link).
function classifyTicketmasterEvent(event, opts = {}) {
  const { observedAt, venueIndex = null, resolveVenue = null } = opts;
  if (!event || typeof event !== "object") return { row: null, drop: "noTitle" };

  const classifications = Array.isArray(event.classifications) ? event.classifications : [];
  const kind = ticketmasterKind(classifications);
  if (!kind) return { row: null, drop: "noKind" };

  const venue = event._embedded?.venues?.[0];
  const placeName = venue?.name;
  if (!nonEmptyString(placeName)) return { row: null, drop: "noPlace" };

  const url = httpUrl(event.url);
  if (!url) return { row: null, drop: "noUrl" };

  const title = nonEmptyString(event.name) ? event.name.trim() : null;
  if (!title) return { row: null, drop: "noTitle" };

  const startsAt = ticketmasterStart(event.dates?.start);
  if (!startsAt) return { row: null, drop: "noStart" };

  const row = {
    id: stableId("events-tm", `${event.id ?? title}|${placeName}|${startsAt}`),
    placeName: placeName.trim(),
    kind,
    startsAt,
    title,
    source: { ...TICKETMASTER_SOURCE, url },
    observedAt,
    confidence: "listed",
  };

  const lat = finiteNum(venue?.location?.latitude);
  const lng = finiteNum(venue?.location?.longitude);
  attachTicketmasterOptionals(row, event, classifications, { lat, lng });

  const match = {
    name: placeName,
    address: venue?.address?.line1 ?? "",
    postcode: venue?.postalCode ?? "",
    lat,
    lng,
  };
  return { row: attachVenue(row, match, venueIndex, resolveVenue), drop: null };
}

function attachTicketmasterOptionals(row, event, classifications, { lat, lng }) {
  const sourceId = asSourceId(event.id);
  if (sourceId) row.sourceId = sourceId;
  const imageUrl = firstImageUrl(event.images);
  if (imageUrl) row.imageUrl = imageUrl;
  if (lat !== null) row.lat = lat;
  if (lng !== null) row.lng = lng;
  const price = event.priceRanges?.find((p) => p?.currency === "GBP");
  const gbp = parseGbp(price?.min);
  if (gbp !== null) row.priceGbp = gbp;
  const genre = classifications.find((c) => nonEmptyString(c?.genre?.name))?.genre?.name;
  if (nonEmptyString(genre)) row.detail = genre.trim();
}

export function mapTicketmasterEvent(event, opts = {}) {
  return classifyTicketmasterEvent(event, opts).row;
}

export function normaliseTicketmasterEvents(payload, opts = {}) {
  const dropped = emptyEventDrops();
  const events = payload?._embedded?.events;
  if (!Array.isArray(events)) return { rows: [], dropped };
  const rows = [];
  for (const event of events) {
    const { row, drop } = classifyTicketmasterEvent(event, opts);
    if (row) rows.push(row);
    else if (drop) noteDrop(dropped, drop);
  }
  return { rows, dropped };
}

// ---------------------------------------------------------------------------
// Skiddle normalisation (pure)
// ---------------------------------------------------------------------------

// Map one Skiddle Events-API result to a WhatsOnRow, or null.
function classifySkiddleEvent(event, { observedAt, venueIndex = null, resolveVenue = null } = {}) {
  if (!event || typeof event !== "object") return { row: null, drop: "noTitle" };

  const code = event.EventCode ?? event.eventcode;
  const kind = nonEmptyString(code) ? SKIDDLE_EVENTCODE_KIND[code] : undefined;
  if (!kind) return { row: null, drop: "noKind" };

  const venue = event.venue ?? {};
  const placeName = venue.name;
  if (!nonEmptyString(placeName)) return { row: null, drop: "noPlace" };

  const url = httpUrl(event.link);
  if (!url) return { row: null, drop: "noUrl" };

  const title = nonEmptyString(event.eventname) ? event.eventname.trim() : null;
  if (!title) return { row: null, drop: "noTitle" };

  const startsAt = toIsoInstant(event.startdate) ?? toIsoInstant(event.openingtimes?.doorsopen);
  // Skiddle sometimes publishes a bare day with no start time and no doors
  // time. That is a DATE, so the row carries the date and says the start is not
  // published; it never gets an invented 20:00, which would print as a real
  // clock and drive "starts in 12 min".
  const startsDate = startsAt ? null : statedCalendarDate(event.date);
  if (!startsAt && !startsDate) return { row: null, drop: "noStart" };

  const row = {
    id: stableId("events-sk", `${event.id ?? title}|${placeName}|${startsAt ?? startsDate}`),
    placeName: placeName.trim(),
    kind,
    title,
    source: { ...SKIDDLE_SOURCE, url },
    observedAt,
    confidence: "listed",
  };
  if (startsAt) row.startsAt = startsAt;
  else {
    row.startsDate = startsDate;
    row.timeEvidence = DATE_ONLY_TIME_EVIDENCE;
  }

  const sourceId = asSourceId(event.id);
  if (sourceId) row.sourceId = sourceId;
  const imageUrl = firstImageUrl([
    { url: event.largeimageurl },
    { url: event.imageurl },
    { url: event.imageurlhttps },
  ]);
  if (imageUrl) row.imageUrl = imageUrl;

  const lat = finiteNum(venue.latitude);
  const lng = finiteNum(venue.longitude);
  if (lat !== null) row.lat = lat;
  if (lng !== null) row.lng = lng;

  // An endsAt without an exact start is not an interval, so the spine refuses
  // it (lib/whatsOn.ts optionalsValid). A date-only row keeps its stated day.
  const endsAt = startsAt ? toIsoInstant(event.enddate) : null;
  if (endsAt) row.endsAt = endsAt;

  const gbp = parseGbp(event.entryprice);
  if (gbp !== null) row.priceGbp = gbp;

  if (nonEmptyString(event.genre)) row.detail = event.genre.trim();

  return {
    row: attachVenue(row, {
      name: placeName,
      address: venue.address ?? "",
      postcode: venue.postcode ?? "",
      lat,
      lng,
    }, venueIndex, resolveVenue),
    drop: null,
  };
}

export function mapSkiddleEvent(event, opts = {}) {
  return classifySkiddleEvent(event, opts).row;
}

export function normaliseSkiddleEvents(payload, opts = {}) {
  const dropped = emptyEventDrops();
  const results = payload?.results;
  if (!Array.isArray(results)) return { rows: [], dropped };
  const rows = [];
  for (const event of results) {
    const { row, drop } = classifySkiddleEvent(event, opts);
    if (row) rows.push(row);
    else if (drop) noteDrop(dropped, drop);
  }
  return { rows, dropped };
}

