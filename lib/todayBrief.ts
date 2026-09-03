// Morning brief composition core (Lane A, /today). Pure, React-free, no fetch
// and no clock of its own: every function takes `now`, so the whole surface is
// unit-testable with fixed dates. The route wires the bundled data (weather
// snapshot, baseline what's-on rows, heritage cache) and the current time in;
// this module turns them into the small, honest string bags the cards render.
//
// Honesty rules, matching the rest of the app:
//   - weather: a verdict only when the rules table fires AND the observation is
//     real and not future; when the snapshot has aged past its own expiry we
//     still show the last-known verdict but mark it stale with a "last checked"
//     line rather than passing old weather off as current.
//   - tonight picks: ranked from the already-windowed rows, never padded; an
//     empty night stays empty (the card shows its own honest empty state).
//   - pub fact: one genuinely sourced heritage fact (seed-only pubs are skipped)
//     carrying its provenance label; no invented facts, no unattributed claims.
//
// No em dashes or en dashes anywhere (product-copy rule extends to the strings
// this module builds).

import {
  evaluateDrinkWeather,
  type DrinkWeatherRuleId,
  type VenueLens,
} from "@/lib/drinkWeather";
import { daySlot } from "@/lib/daySlot";
import { DAY_MS } from "@/lib/dayMs";
import { haversineKm } from "@/lib/haversine";
import {
  isFeaturedHeritageSource,
  sanitizeHeritageFacts,
  type HeritageFact,
} from "@/lib/heritageFacts";
import { firstHttp } from "@/lib/httpUrl";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import { formatConditionDate, londonMonth } from "@/lib/tonightConditions";
import type { Provenance } from "@/lib/curation";
import { validateWeatherSnapshot } from "@/lib/weatherSnapshots";
import { whatsOnBarePriceGbp, type WhatsOnConfidence, type WhatsOnKind, type WhatsOnRow } from "@/lib/whatsOn";

// A central district for the location-free morning glance. The brief is a
// city-level weather read, so the card never claims this is "your area"; it just
// needs a representative observation to run the rules against.
export const BRIEF_DEFAULT_AREA: NightAreaSlug = "piccadilly-soho";

// ---------------------------------------------------------------------------
// Card 1: drink-weather verdict, with an honest staleness line.
// ---------------------------------------------------------------------------

export type WeatherBrief = {
  /** "Saturday 19 Jul" (London time). */
  dateLabel: string;
  /** "19C" (feels-like, rounded). */
  tempLabel: string;
  /** "cloudy" (lower-case, trimmed). */
  conditionLabel: string;
  /** The verdict's calm line, e.g. "Beer garden weather. Lager or cider." */
  verdictLine: string;
  /** The exact weather rule selected from this displayed observation. */
  ruleId: DrinkWeatherRuleId;
  /** Lower-case drink phrase, e.g. "a cold lager or cider". */
  drinkSuggestion: string;
  /** The verdict's venue classification, so surfaces above the card (the /today
   *  greeting) can phrase the same verdict without re-deriving one. */
  venueLens: VenueLens;
  /** True once the observation has aged past its own expiry at `now`. */
  stale: boolean;
  /** "Checked 2 hours ago" (fresh) or "Last checked 3 days ago" (stale). */
  checkedLabel: string;
  /** Attribution for the weather claim. */
  source: { publisher: string; url: string };
};

// Human "x ago" from an observation timestamp. Floor-based so the label only
// ever rounds down (never claims fresher than it is). London-agnostic: a
// duration, not a wall clock.
export function relativeObservedLabel(observedAtMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - observedAtMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * Build the weather card, or null when there is nothing honest to show: an
 * invalid or future-generated snapshot, no observation for the area, a
 * future-dated observation, or a grey in-between evening the rules table has no
 * verdict for. A stale-but-real observation still returns a brief (stale=true).
 */
export function buildWeatherBrief(
  snapshot: unknown,
  now: Date,
  area: NightAreaSlug = BRIEF_DEFAULT_AREA,
  options: { fallbackToFirst?: boolean } = {},
): WeatherBrief | null {
  const validated = validateWeatherSnapshot(snapshot);
  if (!validated) return null;

  const nowMs = now.getTime();
  // A snapshot generated in the future is bad data / clock skew, not weather.
  if (Date.parse(validated.generatedAt) > nowMs) return null;

  const observation =
    validated.observations.find((candidate) => candidate.nightArea === area) ??
    (options.fallbackToFirst === false ? undefined : validated.observations[0]);
  if (!observation) return null;

  const observedMs = Date.parse(observation.observedAt);
  // You cannot have observed tomorrow's weather.
  if (observedMs > nowMs) return null;

  const verdict = evaluateDrinkWeather({
    tempC: observation.feelsLikeC,
    precipitationProbabilityPct: observation.precipitationProbabilityPct,
    month: londonMonth(now),
    // The greeting above this card derives the same band. Without it the card
    // said "evening" over a "Good morning".
    dayPart: daySlot(now),
  });
  if (!verdict) return null;

  const stale = nowMs >= Date.parse(observation.expiresAt);
  const relative = relativeObservedLabel(observedMs, nowMs);
  return {
    dateLabel: formatConditionDate(now),
    // Degree sign, the same one the map's own status banner prints. Without it
    // the two surfaces contradicted each other on the same weather: "27°C" on
    // the map, "21C" on Today.
    tempLabel: `${Math.round(observation.feelsLikeC)}°C`,
    conditionLabel: observation.condition.trim().toLocaleLowerCase("en-GB"),
    verdictLine: verdict.line,
    ruleId: verdict.ruleId,
    drinkSuggestion: verdict.drinkSuggestion,
    venueLens: verdict.venueLens,
    stale,
    checkedLabel: `${stale ? "Last checked" : "Checked"} ${relative}`,
    source: { publisher: observation.source.publisher, url: observation.source.sourceUrl },
  };
}

// ---------------------------------------------------------------------------
// Card 2: tonight's top picks.
// ---------------------------------------------------------------------------

// A confirmed listing outranks a merely listed one, which outranks a
// cross-referenced inference. Mirrors the store's collision ranking so the brief
// never elevates a weaker row over a stronger one.
const CONFIDENCE_RANK: Record<WhatsOnConfidence, number> = {
  confirmed: 2,
  listed: 1,
  derived: 0,
};

/**
 * Rank already-windowed What's-On rows for the brief and take up to `limit`
 * distinct titles. Chain-wide promotions can arrive once per venue; treating
 * those copies as three separate recommendations makes the brief look broken.
 * Title identity is deliberately conservative rather than fuzzy: Unicode
 * compatibility form, case, and whitespace are ignored, but punctuation and
 * wording still distinguish genuinely different listings.
 *
 * Highest confidence first, then soonest start, then original order (stable).
 * Pure: the caller supplies rows already filtered to tonight's window via the
 * store's #409 interval-overlap windowing. An empty input yields an empty list.
 */
export function rankTonightPicks(rows: readonly WhatsOnRow[], limit = 3): WhatsOnRow[] {
  const ranked = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byConfidence = CONFIDENCE_RANK[b.row.confidence] - CONFIDENCE_RANK[a.row.confidence];
      if (byConfidence !== 0) return byConfidence;
      const byStart =
        Date.parse(a.row.startsAt ?? "") - Date.parse(b.row.startsAt ?? "");
      if (Number.isFinite(byStart) && byStart !== 0) return byStart;
      return a.index - b.index;
    });

  const cappedLimit = limit === Number.POSITIVE_INFINITY
    ? ranked.length
    : Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : 0;
  if (cappedLimit === 0) return [];
  const seenTitles = new Set<string>();
  const picks: WhatsOnRow[] = [];
  for (const { row } of ranked) {
    const titleKey = row.title
      .normalize("NFKC")
      .toLocaleLowerCase("en-GB")
      .trim()
      .replace(/\s+/g, " ");
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    picks.push(row);
    if (picks.length >= cappedLimit) break;
  }
  return picks;
}

// Serializable subset of a pick for the client card (the row's link is resolved
// here so the client never re-derives it).
export type TonightPickDto = {
  id: string;
  title: string;
  placeName: string;
  kind: WhatsOnKind;
  kindLabel: string;
  sourceLabel: string;
  /** Map deep-link (own venue) or external source URL, or null. */
  href: string | null;
  /** True when href leaves the app (an external source page). */
  external: boolean;
  priceGbp: number | null;
  /** Venue coordinate when the row carries one; lets the client order picks
   *  around the viewer's remembered patch (#427) without another fetch. */
  lat: number | null;
  lng: number | null;
  /** Honest one-line note when this pick stands in for a syndicated deal running
   *  at several venues ("Same deal at 12 pubs"), or null for a single venue. The
   *  count is real row data (lib/dealsDigest.ts), never padded. */
  venueNote?: string | null;
};

const KIND_LABEL: Record<WhatsOnKind, string> = {
  sport: "Sport",
  quiz: "Quiz",
  deal: "Deal",
  music: "Live music",
  event: "Event",
};

/** Reduce a row to the card DTO. A resolved venue deep-links to the map; a
 * scraped-by-name row links out to its source; otherwise no link. */
export function toTonightPickDto(row: WhatsOnRow): TonightPickDto {
  const venueId = typeof row.venueId === "string" && row.venueId.length > 0 ? row.venueId : null;
  const sourceUrl = firstHttp(row.source?.url);
  let href: string | null = null;
  let external = false;
  if (venueId) {
    href = `/map?sel=${encodeURIComponent(venueId)}`;
  } else if (sourceUrl) {
    href = sourceUrl;
    external = true;
  }
  return {
    id: row.id,
    title: row.title,
    placeName: row.placeName,
    kind: row.kind,
    kindLabel: KIND_LABEL[row.kind],
    sourceLabel: row.source.label,
    href,
    external,
    priceGbp: whatsOnBarePriceGbp(row),
    lat: typeof row.lat === "number" && Number.isFinite(row.lat) ? row.lat : null,
    lng: typeof row.lng === "number" && Number.isFinite(row.lng) ? row.lng : null,
  };
}

/**
 * Stable-reorder the (already server-chosen) picks so the ones nearest a point
 * lead. Same picks, same count — only the order moves; rows without a
 * coordinate keep their relative order at the tail. Pure for hermetic tests;
 * the client calls it with the remembered patch's heart (#427 seam) so Today
 * agrees with the map's Near me about which corner of London is "yours".
 */
export function orderPicksNear(
  picks: readonly TonightPickDto[],
  point: { lat: number; lng: number } | null,
): TonightPickDto[] {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return [...picks];
  }
  const km = (pick: TonightPickDto): number =>
    pick.lat != null && pick.lng != null
      ? haversineKm([pick.lng, pick.lat], [point.lng, point.lat])
      : Number.POSITIVE_INFINITY;
  return picks
    .map((pick, index) => ({ pick, index, km: km(pick) }))
    .sort((a, b) => a.km - b.km || a.index - b.index)
    .map((entry) => entry.pick);
}

// ---------------------------------------------------------------------------
// Card 4: one sourced pub-of-the-day fact.
// ---------------------------------------------------------------------------

export type TodayFact = {
  /** Display-cased pub name. */
  pubName: string;
  fact: string;
  sourceRef?: string;
  provenance: Provenance;
  provenanceLabel: string;
};

// Prefer the most readable attributable source. Seed content is excluded up
// front (it is seeded example material, not a sourced claim), so it never
// appears here.
const SOURCE_PRIORITY: readonly HeritageFact["source"][] = ["wikipedia", "nhle", "wikidata", "osm"];

function sourcePriority(source: HeritageFact["source"]): number {
  const index = SOURCE_PRIORITY.indexOf(source);
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

// Stable per-London-day integer (days since epoch), so the pick rotates once a
// day and is identical for every visitor on that calendar day.
function londonDayIndex(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS);
}

function titleCasePubName(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toLocaleUpperCase("en-GB") + word.slice(1))
    .join(" ");
}

// A pub that heritage sources describe as closed or former is history, not a
// place to send someone today — headlining it as "pub of the day" is the same
// honesty break as a closed venue on the map. HeritageFact carries no structured
// open/closed flag (see lib/heritageFacts), so we read the one signal that IS
// present: the sourced prose the card would display. Kept to high-precision
// closure phrases — an OPEN pub described as a "former coaching inn" or "former
// brewery" is never dropped, because those name a past role, not a closure.
const CLOSURE_MARKERS: readonly string[] = [
  "former pub", // also matches "former public house" (substring)
  "closed pub",
  "now closed",
  "closed down",
  "closed permanently",
  "permanently closed",
  "no longer a pub",
];

function signalsClosure(text: string): boolean {
  const haystack = text.toLowerCase();
  return CLOSURE_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Deterministically pick one genuinely sourced heritage fact as the pub of the
 * day, or null when the cache carries no eligible fact at all. Pubs whose only
 * facts are seed examples are skipped so the surfaced claim always attributes to
 * a real source with its provenance label; pubs the sources describe as closed
 * or former are skipped so today's pick is always somewhere that still exists.
 * Both skips run before the day-rotation, so the pick deterministically falls
 * through to the next eligible pub, and an empty eligible set returns null (the
 * card fails soft to its "still in the archive" state rather than lying).
 */
export function pickPubOfTheDayFact(cache: unknown, now: Date): TodayFact | null {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return null;

  const entries: { name: string; fact: HeritageFact }[] = [];
  for (const [name, rawFacts] of Object.entries(cache as Record<string, unknown>)) {
    if (typeof name !== "string" || name.trim().length === 0) continue;
    const sourced = sanitizeHeritageFacts(rawFacts).filter((fact) =>
      isFeaturedHeritageSource(fact.source),
    );
    if (sourced.length === 0) continue;
    // Closed/former pubs are ineligible — check the name and every sourced fact,
    // not just the surfaced one, so a pub known to be gone never headlines.
    if (signalsClosure(name) || sourced.some((fact) => signalsClosure(fact.fact))) continue;
    const best = [...sourced].sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source))[0];
    entries.push({ name, fact: best });
  }
  if (entries.length === 0) return null;

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const chosen = entries[londonDayIndex(now) % entries.length];

  const provenance: Provenance = "sourced";
  const result: TodayFact = {
    pubName: titleCasePubName(chosen.name),
    fact: chosen.fact.fact,
    provenance,
    provenanceLabel: PROVENANCE_LABEL[provenance],
  };
  if (chosen.fact.sourceRef) result.sourceRef = chosen.fact.sourceRef;
  return result;
}
