// scripts/whatson/quizParsers.mjs
//
// Pure parsers + date math for the What's-On QUIZ vertical (PRD_WHATS_ON B3).
// No fetching here: every function is a plain transform over strings so the
// whole module unit-tests offline against saved fixtures
// (__tests__/fixtures/whats_on/*). Fetch orchestration lives in
// scripts/whatson/quizRefresh.mjs.
//
// Sources are the quiz suppliers' own public venue listings (first-party):
//   - Question One  https://questionone.com/venues/         (parsed, rows emitted)
//   - SpeedQuizzing https://www.speedquizzing.com/find/     (parsed, rows NOT
//     emitted in v1: the inline events array is public, but venue names/times
//     only exist behind /utils/… which speedquizzing.com/robots.txt disallows.
//     We keep the parser so coverage can light up if terms are obtained.)
//   - Redtooth      https://www.redtoothquiz.co.uk/pages/find-us (checked
//     2026-07-11: page is now only their office address — no venue finder.)
// Aggregators (pubquizzers.com etc.) are cross-check only, never ingested.

import { resolveVenueId } from "./resolveVenueId.mjs";

const LONDON_TZ = "Europe/London";

export const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// ---------------------------------------------------------------------------
// Greater London postcode filter
// ---------------------------------------------------------------------------

// Inner London postal areas: always Greater London.
const INNER_LONDON_AREAS = new Set(["E", "EC", "N", "NW", "SE", "SW", "W", "WC"]);

// Outer postcode areas straddle the Greater London boundary, so only outward
// codes that sit inside a London borough are allowed. Curated by hand for v1;
// anything not listed is dropped (never guessed). Excluded on purpose:
// BR8 (Swanley, Kent), CR3 (Caterham, Surrey), DA1-4/9-13 (Kent), EN6+
// (Herts), IG7/9/10 (Essex), KT7/8/10+ (Surrey), RM15+ (Essex), SM7
// (Banstead, Surrey), TW15+ (Surrey), UB9 (straddles Bucks), all WD (Herts).
const OUTER_LONDON_OUTWARD = new Set([
  "BR1", "BR2", "BR3", "BR4", "BR5", "BR6", "BR7",
  "CR0", "CR2", "CR4", "CR5", "CR6", "CR7", "CR8",
  "DA5", "DA6", "DA7", "DA8", "DA14", "DA15", "DA16", "DA17", "DA18",
  "EN1", "EN2", "EN3", "EN4", "EN5",
  "HA0", "HA1", "HA2", "HA3", "HA4", "HA5", "HA6", "HA7", "HA8", "HA9",
  "IG1", "IG2", "IG3", "IG4", "IG5", "IG6", "IG8", "IG11",
  "KT1", "KT2", "KT3", "KT4", "KT5", "KT6", "KT9",
  "RM1", "RM2", "RM3", "RM4", "RM5", "RM6", "RM7", "RM8", "RM9", "RM10",
  "RM11", "RM12", "RM13", "RM14",
  "SM1", "SM2", "SM3", "SM4", "SM5", "SM6",
  "TW1", "TW2", "TW3", "TW4", "TW5", "TW6", "TW7", "TW8", "TW9", "TW10",
  "TW11", "TW12", "TW13", "TW14",
  "UB1", "UB2", "UB3", "UB4", "UB5", "UB6", "UB7", "UB8", "UB10", "UB11",
]);

const POSTCODE_RE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/;

// Extract the first full UK postcode from free text, or null.
export function extractPostcode(text) {
  const m = POSTCODE_RE.exec(String(text ?? "").toUpperCase());
  return m ? `${m[1]} ${m[2]}` : null;
}

// True when a full postcode sits inside Greater London (see tables above).
export function isGreaterLondonPostcode(postcode) {
  const m = POSTCODE_RE.exec(String(postcode ?? "").toUpperCase());
  if (!m) return false;
  const outward = m[1];
  const area = outward.replace(/\d.*$/, "");
  if (INNER_LONDON_AREAS.has(area)) return true;
  return OUTER_LONDON_OUTWARD.has(outward);
}

// ---------------------------------------------------------------------------
// Weekly-slot date math (Europe/London, DST-aware)
// ---------------------------------------------------------------------------

function londonParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return parts;
}

// Offset (minutes) of Europe/London from UTC at the given instant (+60 BST).
function londonOffsetMinutes(date) {
  const p = londonParts(date);
  const wallAsUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return Math.round((wallAsUtc - date.getTime()) / 60_000);
}

const pad = (n) => String(n).padStart(2, "0");

// The next time a weekly slot (e.g. "Tuesday" + "19:30" London wall clock)
// occurs strictly AFTER observedAtIso. Returns an ISO string with the correct
// Europe/London offset for that date (+01:00 in BST, +00:00 in GMT), so the
// row never claims a one-off event — it is always "the next occurrence".
export function nextWeeklyOccurrence(dayName, hhmm, observedAtIso) {
  const targetDow = DAY_NAMES.indexOf(dayName);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ""));
  if (targetDow < 0 || !tm) return null;
  const [hh, mm] = [Number(tm[1]), Number(tm[2])];
  if (hh > 23 || mm > 59) return null;
  const observed = new Date(observedAtIso);
  if (Number.isNaN(observed.getTime())) return null;

  const p = londonParts(observed);
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentDow = dowMap[p.weekday];
  // London calendar date of the observation, as a UTC day handle.
  const baseDayUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));

  for (let add = (targetDow - currentDow + 7) % 7; ; add += 7) {
    const day = new Date(baseDayUtc + add * 86_400_000);
    const [y, mo, da] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
    // Resolve wall time -> instant (two passes to land on the right offset
    // around DST switches).
    let offset = londonOffsetMinutes(new Date(Date.UTC(y, mo, da, hh, mm)));
    let instant = Date.UTC(y, mo, da, hh, mm) - offset * 60_000;
    offset = londonOffsetMinutes(new Date(instant));
    instant = Date.UTC(y, mo, da, hh, mm) - offset * 60_000;
    if (instant > observed.getTime()) {
      const sign = offset < 0 ? "-" : "+";
      const abs = Math.abs(offset);
      return `${y}-${pad(mo + 1)}-${pad(da)}T${pad(hh)}:${pad(mm)}:00` +
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Question One (https://questionone.com/venues/ — WordPress archive)
// ---------------------------------------------------------------------------

const ENTITIES = {
  "&#8211;": "–", "&#8212;": "—", "&#8216;": "‘",
  "&#8217;": "’", "&#038;": "&", "&amp;": "&", "&nbsp;": " ",
  "&#8230;": "…",
};

export function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&#?\w+;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}


// Fallback for listing entries whose detail page carries no postcode: an
// explicit allowlist of London district names (matched against the area part
// of the card title, e.g. "Grapes, Limehouse"). Only districts unambiguously
// inside Greater London are listed — Epping, Histon, Windsor etc. never
// match, and an unknown area is dropped, not guessed.
export const LONDON_AREA_NAMES = new Set([
  "angel", "balham", "bank", "barnes", "battersea", "bermondsey",
  "bethnal green", "blackheath", "bloomsbury", "borough", "bow", "brixton",
  "camden", "canary wharf", "chancery lane", "chelsea", "chiswick",
  "city of london", "clapham", "clerkenwell", "covent garden", "dalston",
  "deptford", "ealing", "earlsfield", "elephant and castle", "eltham",
  "farringdon", "finchley", "fitzrovia", "forrest hill", "forest hill",
  "fulham", "greenwich", "hackney", "hackney wick", "hammersmith",
  "hampstead", "herne hill", "highbury", "holborn", "holland park",
  "hoxton", "islington", "kennington", "kensington", "kentish town", "kew",
  "kingston", "lewisham", "limehouse", "liverpool street", "locksbottom",
  "london", "marylebone", "mayfair", "mile end", "muswell hill",
  "north finchley", "notting hill", "paddington", "peckham", "pimlico",
  "primrose hill", "putney", "richmond", "ruislip", "shoreditch", "soho",
  "stoke newington", "stratford", "streatham", "tooting", "tower hill",
  "twickenham", "upminster", "uxbridge", "vauxhall", "victoria", "wandsworth",
  "waterloo", "wembley", "west hampstead", "whitechapel", "wimbledon",
  "wimbledon park",
]);

// True when the trailing ", Area" of a place name is a known London district.
export function isKnownLondonAreaName(placeName) {
  const parts = String(placeName ?? "").split(",");
  if (parts.length < 2) return false;
  const area = parts[parts.length - 1].trim().toLowerCase().replace(/’/g, "'");
  return LONDON_AREA_NAMES.has(area);
}

const QO_CARD_RE =
  /<a class="media-card media-card--content-left" href="([^"]+)">[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<div class="excerpt">([\s\S]*?)<\/div>\s*<\/div>\s*<\/a>/g;

// Listing cards: [{ url, title, day, time }]. `day`/`time` come from the
// card's excerpt line ("Tuesday 19:30"); rows with a malformed slot get null.
export function parseQuestionOneVenuesPage(html) {
  const cards = [];
  for (const m of String(html ?? "").matchAll(QO_CARD_RE)) {
    const [, url, rawTitle, excerpt] = m;
    const slotMatch = /<div>\s*([A-Za-z]+)\s+(\d{1,2}:\d{2})\s*<\/div>/.exec(excerpt);
    const day = slotMatch && DAY_NAMES.includes(slotMatch[1]) ? slotMatch[1] : null;
    cards.push({
      url,
      title: decodeEntities(rawTitle),
      day,
      time: day ? slotMatch[2] : null,
    });
  }
  return cards;
}

// "next page" link of the archive, or null on the last page.
export function parseQuestionOneNextPage(html) {
  const m = /<link rel="next" href="([^"]+)"/.exec(String(html ?? ""));
  return m ? m[1] : null;
}

const QO_ICON_FIELD_RE =
  /icons\.svg#(calendar|tag|pin|link)"[^>]*><\/use>[\s\S]*?<div class="text-with-icon__text">\s*([\s\S]*?)\s*<\/div>/g;

// Venue detail page: slot, entry fee, address (+postcode). Fee text like
// "£2" or "£2.50"; absent fee stays null (unknown, never invented).
export function parseQuestionOneVenueDetail(html) {
  const out = { day: null, time: null, feeGbp: null, feeRaw: null, address: null, postcode: null };
  for (const m of String(html ?? "").matchAll(QO_ICON_FIELD_RE)) {
    const [, icon, raw] = m;
    const text = decodeEntities(raw.replace(/<[^>]+>/g, " "));
    if (icon === "calendar" && !out.day) {
      const slot = /([A-Za-z]+)\s+(\d{1,2}:\d{2})/.exec(text);
      if (slot && DAY_NAMES.includes(slot[1])) { out.day = slot[1]; out.time = slot[2]; }
    } else if (icon === "tag" && !out.feeRaw) {
      const fee = /£\s*(\d+(?:\.\d{1,2})?)/.exec(text);
      if (fee) { out.feeRaw = text; out.feeGbp = Number(fee[1]); }
    } else if (icon === "pin" && !out.address) {
      out.address = text;
      out.postcode = extractPostcode(text);
    }
  }
  return out;
}

// Cards whose TITLE declares a non-weekly cadence must not be emitted with a
// weekly next-occurrence (that would invent events on off weeks).
const NON_WEEKLY_RE =
  /monthly|every other|fortnight|(first|second|third|fourth|last)\s+\w+day\s+of|of (the|every) month/i;

export function isWeeklyCadence(title) {
  return !NON_WEEKLY_RE.test(String(title ?? ""));
}

// "PUB QUIZ – King's Arms, Waterloo – Every Sunday" -> "King's Arms, Waterloo"
export function placeNameFromQuestionOneTitle(title) {
  let t = decodeEntities(title)
    .replace(/^\s*pub\s+qui+z\s*[-–—:]?\s*/i, "");
  const parts = t.split(/\s+[–—-]\s+/);
  const cadence = /^(every|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|first|second|third|fourth|last|monthly)\b/i;
  const kept = parts.filter((p) => !cadence.test(p.trim()));
  return (kept.length ? kept : parts).join(" – ").replace(/,\s*$/, "").trim();
}

const AMPM_HOURS = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${pad(m)}${suffix}`;
};

// Assemble contract rows (B1 shape) from listing cards + optional detail
// lookups. Detail wins over card for the slot; London filter is
// postcode-first with NO area-name guessing — a card without a London
// postcode is dropped and counted, not invented.
export function buildQuestionOneRows({ cards, detailsByUrl = new Map(), observedAt, venueIndex = null }) {
  const rows = [];
  const dropped = { nonWeekly: 0, notLondon: 0, noSlot: 0 };
  for (const card of cards) {
    if (!isWeeklyCadence(card.title)) { dropped.nonWeekly += 1; continue; }
    const detail = detailsByUrl.get(card.url) ?? {};
    const day = detail.day ?? card.day;
    const time = detail.time ?? card.time;
    if (!day || !time) { dropped.noSlot += 1; continue; }
    const placeName = placeNameFromQuestionOneTitle(card.title);
    // London filter: full postcode wins; when the page has no postcode, fall
    // back to the explicit district-name allowlist. Ambiguous -> dropped.
    const inLondon = detail.postcode
      ? isGreaterLondonPostcode(detail.postcode)
      : isKnownLondonAreaName(placeName);
    if (!inLondon) { dropped.notLondon += 1; continue; }
    const startsAt = nextWeeklyOccurrence(day, time, observedAt);
    if (!startsAt) { dropped.noSlot += 1; continue; }
    const slug = card.url.replace(/\/+$/, "").split("/").pop();
    const detailBits = [`Weekly pub quiz — every ${day} ${time}`];
    if (detail.feeGbp != null) detailBits.push(`entry £${detail.feeGbp}`);
    if (detail.postcode) detailBits.push(detail.postcode);
    detailBits.push("run by Question One");
    // Question One's own titles are "Pub Name, Area" (placeNameFromQuestionOneTitle
    // above) — the trailing ", Area" is a locality qualifier, not part of the
    // pub's own name, so it's stripped ONLY for resolver matching (never for
    // the displayed placeName) to line up with the canonical dataset's bare
    // pub_name.
    const resolverName = placeName.includes(",")
      ? placeName.slice(0, placeName.lastIndexOf(",")).trim()
      : placeName;
    const resolvedVenueId = venueIndex
      ? resolveVenueId({ name: resolverName, address: detail.address, postcode: detail.postcode }, venueIndex)
      : null;
    rows.push({
      id: `quiz-qo-${slug}`,
      venueId: resolvedVenueId,
      placeName,
      kind: "quiz",
      startsAt,
      title: `Pub quiz — ${day}s ${AMPM_HOURS(time)}`,
      detail: detailBits.join(" · "),
      ...(detail.feeGbp != null ? { priceGbp: detail.feeGbp } : {}),
      source: { label: "Question One", url: card.url },
      observedAt,
      confidence: "listed",
    });
  }
  return { rows, dropped };
}

// ---------------------------------------------------------------------------
// SpeedQuizzing (https://www.speedquizzing.com/find/)
// ---------------------------------------------------------------------------

const SQ_EVENTS_RE = /var events = JSON\.parse\('(\[[\s\S]*?\])'\)/;

// The /find/ page embeds `var events = JSON.parse('[...]')` — real upcoming
// events with date/day/lat/lon but NO venue name or start time (those live
// behind robots-disallowed /utils/ ajax). Parsed for coverage counts only.
export function parseSpeedQuizzingFindEvents(html) {
  const m = SQ_EVENTS_RE.exec(String(html ?? ""));
  if (!m) return [];
  let events;
  try {
    // The array is single-quoted into JS source; unescape \' the way the
    // browser's string literal parsing would before JSON.parse sees it.
    events = JSON.parse(m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\"));
  } catch {
    return [];
  }
  return events
    .map((e) => ({
      eventId: String(e.event_id ?? ""),
      date: String(e.date ?? ""),
      day: String(e.day ?? ""),
      lat: Number.parseFloat(e.lat),
      lng: Number.parseFloat(e.lon),
    }))
    .filter((e) => e.eventId && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
}

// Greater-London bounding box (coarse, for coverage counting only).
export function isGreaterLondonLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= 51.28 && lat <= 51.70 && lng >= -0.51 && lng <= 0.34;
}
