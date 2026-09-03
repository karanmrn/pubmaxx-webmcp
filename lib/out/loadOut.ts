import rawEventsLondon from "../../public/data/whats_on/events_london.json";
import { EVENT_REFRESH_CITIES } from "@/lib/whatson/eventNormalise.mjs";
import { eventIdentityKey } from "@/lib/whatsOnRowShape.mjs";
import { CITIES, type CityId } from "@/lib/cities";
import type { EventsProvider } from "@/lib/events/provider";
import { createSkiddleProvider } from "@/lib/events/skiddle";
import { createTicketmasterProvider } from "@/lib/events/ticketmaster";
import { log } from "@/lib/log";
import { fillEventArea } from "@/lib/out/eventArea";
import { outSourceAttribution } from "@/lib/out/attribution";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import {
  attachOutVenues,
  type OutVenueMatchIndex,
  type OutVenueMatchStatus,
} from "@/lib/out/venueMatch";
import { loadOutVenueMatchIndex } from "@/lib/out/venueMatch.server";
import {
  MAX_OUT_EVENTS,
  OUT_DAYS,
  OUT_UNMATCHED_PLACES_SHOWN,
  type OutDay,
  type OutProviderReport,
  type OutQuery,
  type OutResponse,
  type OutStatus,
} from "@/lib/out/types";
import {
  bundledGeneratedAt,
  dedupeKey,
  londonServiceDayBounds,
  dedupeRows,
  filterNotPast,
  parseWhatsOnRows,
  rowStatedInterval,
  tonightServiceWindow,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export const OUT_CITIES = EVENT_REFRESH_CITIES;
export type OutCity = (typeof OUT_CITIES)[number];
export type { OutDay, OutQuery, OutResponse } from "@/lib/out/types";
export { MAX_OUT_EVENTS, OUT_DAYS } from "@/lib/out/types";

export type OutLiveProvider = Pick<EventsProvider, "name" | "isConfigured" | "fetchTonight">;

export type BuildOutResponseOpts = {
  now?: number;
  loadBaseline?: (city: OutCity) => WhatsOnRow[];
  liveProviders?: OutLiveProvider[];
  /**
   * The request-time venue match index. Null means the slim index could not
   * be read; a loader that THROWS reads the same way, so a broken pack never
   * turns a listings answer into a platform error.
   */
  loadVenueMatchIndex?: (city: OutCity) => Promise<OutVenueMatchIndex | null>;
};

// A city is COVERED when a bundled events file for it ships. The param is open
// to every refresh city so turning one on is data (run the refresh, commit the
// file, add it here), but until that file exists the answer is an honest
// "not covered yet" with zero rows. It may never be another city's listings:
// serving London under a Bristol query is worse than saying nothing.
const BUNDLED_EVENT_FILES: Partial<Record<OutCity, unknown>> = {
  london: rawEventsLondon,
};

function isOutCity(value: string): value is OutCity {
  return (OUT_CITIES as readonly string[]).includes(value);
}

function isOutDay(value: string): value is OutDay {
  return (OUT_DAYS as readonly string[]).includes(value);
}

export function isOutCityCovered(city: OutCity): boolean {
  return BUNDLED_EVENT_FILES[city] !== undefined;
}

function cityDisplayName(city: OutCity): string {
  return CITIES[city as CityId]?.displayName ?? city;
}

export function outCityNotCoveredReason(city: OutCity): string {
  return `Out does not cover ${cityDisplayName(city)} yet.`;
}

export function parseOutQuery(params: URLSearchParams): OutQuery | null {
  const cityRaw = (params.get("city") ?? "london").trim().toLowerCase();
  const dayRaw = (params.get("day") ?? "today").trim().toLowerCase();
  if (!isOutCity(cityRaw) || !isOutDay(dayRaw)) return null;
  return { city: cityRaw, day: dayRaw };
}

export function loadBundledOutEvents(city: OutCity): WhatsOnRow[] {
  const raw = BUNDLED_EVENT_FILES[city];
  if (raw === undefined) return [];
  return parseWhatsOnRows(raw, bundledGeneratedAt(raw));
}

export type ServedOutEvents = {
  rows: WhatsOnRow[];
  readStatus: "ready" | "degraded";
};

// The durable store holds only the bounded London refresh's rows, so only a
// London answer may read it: London listings under a Bristol query is worse
// than saying nothing. Another city's bundled events stand alone, and a
// durable read that failed is reported rather than served as a quiet fallback
// that reads "ready".
export async function loadServedOutEvents(
  city: OutCity,
  now: number,
): Promise<ServedOutEvents> {
  const bundled = loadBundledOutEvents(city);
  if (city !== "london") return { rows: bundled, readStatus: "ready" };
  try {
    const { loadServedWhatsOnListingsWithFreshness } = await import(
      "@/lib/whatsOnListings.server"
    );
    const served = await loadServedWhatsOnListingsWithFreshness({
      bundled,
      now,
      kind: "event",
    });
    return { rows: served.rows, readStatus: served.readStatus };
  } catch (error) {
    log("warn", "out.whats_on_store_fallback", {
      city,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { rows: bundled, readStatus: "degraded" };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
// A service day opens at 16:00 and closes at 04:00, so a probe four hours in
// lands at 20:00 - far enough from either boundary that a DST shift cannot push
// it into the neighbouring day.
const EVENING_PROBE_MS = 4 * 60 * 60 * 1000;

// Which weekday the SERVICE day belongs to. Reading the weekday off `now`
// instead mixes two day origins: at Sunday 02:00 London the service day is
// still Saturday's evening, so `now` says Sun and the weekend window landed a
// day early - with Sunday night outside `day=weekend` entirely.
function serviceDayWeekdayIndex(serviceDayStartMs: number): number {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(new Date(serviceDayStartMs));
  const index: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return index[weekday] ?? 1;
}

export function outDayWindow(day: OutDay, now: number): { startMs: number; endMs: number } {
  if (day === "today") return tonightServiceWindow(now);
  if (day === "tomorrow") {
    const today = londonServiceDayBounds(now);
    return tonightServiceWindow(Date.parse(today.end) + 1);
  }
  const today = tonightServiceWindow(now);
  const current = serviceDayWeekdayIndex(today.startMs);
  // Friday, Saturday and Sunday evenings are THIS weekend; anything else looks
  // forward to the next Friday.
  const daysUntilFriday =
    current === 5 ? 0 : current === 6 ? -1 : current === 0 ? -2 : (5 - current + 7) % 7;
  // The two ends are resolved as SERVICE DAYS, not by adding raw days: Sunday's
  // evening closes at Monday 04:00, so a fixed three-day span leaves twelve
  // hours of Monday daytime under a chip that means Friday, Saturday and Sunday
  // nights - and a BST/GMT transition inside the span drifts a raw day by an
  // hour.
  const friday = tonightServiceWindow(today.startMs + daysUntilFriday * DAY_MS + EVENING_PROBE_MS);
  const sunday = tonightServiceWindow(friday.startMs + 2 * DAY_MS + EVENING_PROBE_MS);
  return { startMs: friday.startMs, endMs: sunday.endMs };
}

// A row with no stated interval says only which window it was LISTED for, so it
// may answer that day and no other. Reading "tonight" as an answer to the
// Tomorrow chip is a wrong-day claim, and a row that cannot support the day
// asked for is dropped rather than shown under it.
const LISTED_WINDOW_DAY: Record<string, OutDay> = {
  tonight: "today",
  tomorrow_night: "tomorrow",
  this_weekend: "weekend",
};

function rowOverlapsWindow(
  row: WhatsOnRow,
  window: { startMs: number; endMs: number },
  day: OutDay,
): boolean {
  const stated = rowStatedInterval(row);
  if (stated) {
    if (!Number.isFinite(stated.startMs) || !Number.isFinite(stated.endMs)) return false;
    return stated.startMs < window.endMs && stated.endMs > window.startMs;
  }
  if (!row.listedWindow) return false;
  return LISTED_WINDOW_DAY[row.listedWindow] === day;
}

/**
 * Fold the two lanes onto ONE row per provider listing.
 *
 * The bundled row was venue-matched by the refresh script and the request-time
 * row was not, so `dedupeRows` - which keys on `venueId ?? placeName` - reads a
 * single Ticketmaster event as two and /out shows it twice. The provider's own
 * id is the same on both, so it decides here first; a row with no sourceId is
 * left for the spine's own key.
 *
 * The freshest observation wins, but the venueId is INHERITED either way: the
 * bundled row was matched with an address and a postcode to confirm with, so
 * taking the live row whole would strip the stronger match. A live row that
 * has NO bundled twin is matched after the fold, at request time
 * (attachOutVenues), over the slim index.
 */
function foldBySourceId(rows: readonly WhatsOnRow[]): WhatsOnRow[] {
  const byKey = new Map<string, WhatsOnRow>();
  const noSourceId: WhatsOnRow[] = [];
  for (const row of rows) {
    const key = eventIdentityKey(row);
    if (!key) {
      noSourceId.push(row);
      continue;
    }
    const held = byKey.get(key);
    if (!held) {
      byKey.set(key, row);
      continue;
    }
    const winner = Date.parse(row.observedAt) >= Date.parse(held.observedAt) ? row : held;
    const winnerVenueId = canonicalOutVenueId(winner.venueId);
    const venueId =
      winnerVenueId ?? canonicalOutVenueId(held.venueId) ?? canonicalOutVenueId(row.venueId);
    byKey.set(key, venueId && winnerVenueId === null ? { ...winner, venueId } : winner);
  }
  return [...byKey.values(), ...noSourceId];
}

function observedAtBySource(rows: readonly WhatsOnRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.source.label.toLowerCase();
    const current = out[key];
    if (!current || Date.parse(row.observedAt) > Date.parse(current)) {
      out[key] = row.observedAt;
    }
  }
  return out;
}

function unmatchedNoticeMetadata(rows: readonly WhatsOnRow[]): {
  places: string[];
  placeCount: number;
  sources: string[];
} {
  const places: string[] = [];
  const placeKeys = new Set<string>();
  const sources: string[] = [];
  const sourceKeys = new Set<string>();
  for (const row of rows) {
    if (canonicalOutVenueId(row.venueId) !== null) continue;
    const placeName = row.placeName.trim();
    const placeKey = placeName.toLocaleLowerCase().replace(/\s+/g, " ");
    if (placeName && !placeKeys.has(placeKey)) {
      placeKeys.add(placeKey);
      if (places.length < OUT_UNMATCHED_PLACES_SHOWN) places.push(placeName);
    }
    const sourceLabel = row.source.label.trim();
    const sourceKey = sourceLabel.toLocaleLowerCase();
    if (sourceLabel && !sourceKeys.has(sourceKey)) {
      sourceKeys.add(sourceKey);
      sources.push(sourceLabel);
    }
  }
  return { places, placeCount: placeKeys.size, sources };
}

function notCoveredResponse(city: OutCity): OutResponse {
  return {
    status: "degraded",
    listingsStatus: "degraded",
    listingsReason: outCityNotCoveredReason(city),
    events: [],
    openPlans: [],
    attribution: [],
    observedAt: {},
    providers: [],
    reason: outCityNotCoveredReason(city),
    venueMatch: "unavailable",
  };
}

export async function buildOutResponse(
  query: OutQuery,
  opts: BuildOutResponseOpts = {},
): Promise<OutResponse> {
  const now = opts.now ?? Date.now();
  const city = query.city as OutCity;
  if (!isOutCityCovered(city)) return notCoveredResponse(city);

  const liveProviders = opts.liveProviders ?? [
    createTicketmasterProvider(),
    createSkiddleProvider(),
  ];
  const loadVenueMatchIndex = opts.loadVenueMatchIndex ?? loadOutVenueMatchIndex;

  let status: OutStatus = "ready";
  let reason: string | undefined;
  let baseline: WhatsOnRow[] = [];
  try {
    if (opts.loadBaseline) {
      baseline = opts.loadBaseline(city);
    } else {
      const served = await loadServedOutEvents(city, now);
      baseline = served.rows;
      if (served.readStatus === "degraded") {
        status = "degraded";
        reason = "Some listings could not be checked.";
      }
    }
  } catch {
    status = "degraded";
    reason = "Some listings could not be checked.";
    baseline = [];
  }

  const window = outDayWindow(query.day, now);

  // Every lane is asked AT ONCE. Each carries its own request timeout, so a
  // sequential walk spends them one after another: two slow upstreams cost more
  // than the function's whole budget and the reader gets a platform error
  // instead of the honest degraded body this status design exists to produce.
  const settled = await Promise.all(
    liveProviders.map(
      async (provider): Promise<{ report: OutProviderReport; rows: WhatsOnRow[] }> => {
        if (!provider.isConfigured()) {
          return {
            report: { name: provider.name, configured: false, rows: 0, status: "not-configured" },
            rows: [],
          };
        }
        try {
          // The provider is asked for the window this answer will KEEP, so a
          // tomorrow or weekend request never spends an upstream call on rows
          // the filter below would discard.
          const rows = await provider.fetchTonight({ now, city, window });
          return {
            report: { name: provider.name, configured: true, rows: rows.length, status: "ready" },
            rows,
          };
        } catch (err) {
          // The upstream message is a server-side diagnostic. The public body
          // says only that this lane is degraded.
          log("warn", "out.provider_failed", {
            provider: provider.name,
            city,
            day: query.day,
            error: err instanceof Error ? err.message : "provider failed",
          });
          return {
            report: { name: provider.name, configured: true, rows: 0, status: "degraded" },
            rows: [],
          };
        }
      },
    ),
  );

  const reports: OutProviderReport[] = settled.map((entry) => entry.report);
  const liveRows: WhatsOnRow[] = settled.flatMap((entry) => entry.rows);
  if (reports.some((report) => report.status === "degraded")) {
    status = "degraded";
    reason = "Some listings could not be checked.";
  }

  const liveRowKeys = new Set(liveRows.map(dedupeKey));
  const folded = dedupeRows(foldBySourceId([...baseline, ...liveRows]));
  const inWindow = filterNotPast(folded, now).filter((row) =>
    rowOverlapsWindow(row, window, query.day),
  );

  // Match AFTER the window filter, so a past row never spends a lookup, and
  // BEFORE the cap, so what the cap keeps is what the page can show. A read of
  // the slim index that could not run is reported as its own finding: the rows
  // are still real listings, so the lane stays ready, and the surface words
  // "we could not check" apart from "not listed yet".
  let venueMatch: OutVenueMatchStatus = "ready";
  let matchedAtRequest = 0;
  let unmatched = inWindow.filter((row) => canonicalOutVenueId(row.venueId) === null).length;
  let matchedRows = inWindow;
  try {
    const index = await loadVenueMatchIndex(city as CityId);
    if (index) {
      const attached = attachOutVenues(inWindow, index, (row) => liveRowKeys.has(dedupeKey(row)));
      matchedRows = attached.rows;
      matchedAtRequest = attached.matchedAtRequest;
      unmatched = attached.unmatched;
    } else {
      venueMatch = "unavailable";
    }
  } catch (err) {
    venueMatch = "unavailable";
    log("warn", "out.venue_match_unavailable", {
      city,
      day: query.day,
      error: err instanceof Error ? err.message : "venue index unreadable",
    });
  }

  const unmatchedMetadata = unmatchedNoticeMetadata(matchedRows);
  const matchedCount = matchedRows.length - unmatched;
  const merged = matchedRows
    .map(fillEventArea)
    .sort(
      (left, right) =>
        (left.startsAt ?? left.startsDate ?? "").localeCompare(
          right.startsAt ?? right.startsDate ?? "",
        ) || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_OUT_EVENTS);

  reports.sort((left, right) => left.name.localeCompare(right.name));

  // The supply counts at every point a row can be lost, so an empty Out can be
  // read back to its cause - provider, window, or venue match - from the log
  // rather than guessed at from the page.
  log("info", "out.supply", {
    city,
    day: query.day,
    baselineRows: baseline.length,
    liveRows: liveRows.length,
    providers: reports.map((report) => `${report.name}:${report.status}:${report.rows}`),
    folded: folded.length,
    inWindow: inWindow.length,
    served: merged.length,
    matchedAtRequest,
    matched: matchedCount,
    unmatched,
    venueMatch,
  });

  // Every live lane held shut - no key, or a licence fence - means nothing was
  // asked, and an unasked question may not read as a quiet city. It only
  // reaches the reader as `not-configured` when the answer is EMPTY: with
  // bundled rows on screen the listings plainly ARE on, and saying otherwise
  // over visible cards contradicts them.
  const askedNothing =
    reports.length > 0 && reports.every((report) => report.status === "not-configured");
  if (status === "ready" && askedNothing && merged.length === 0) status = "not-configured";

  const body: OutResponse = {
    status,
    listingsStatus: status,
    events: merged,
    openPlans: [],
    attribution: outSourceAttribution(merged),
    observedAt: observedAtBySource(merged),
    providers: reports,
    unmatchedCount: unmatched,
    unmatchedPlaces: unmatchedMetadata.places,
    unmatchedPlaceCount: unmatchedMetadata.placeCount,
    unmatchedSources: unmatchedMetadata.sources,
    venueMatch,
  };
  if (reason) {
    body.reason = reason;
    body.listingsReason = reason;
  }
  return body;
}
