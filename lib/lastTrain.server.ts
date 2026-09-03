import "server-only";

// GET /api/last-train?lat=..&lng=..  ->  LastTrainResult
// GET /api/last-train?lat=..&lng=..&scope=stable  ->  stable timetable result
//
// "Last Pint": given a point (a pub), find the nearest Tube/rail station, when the
// last train of the night leaves each serving line, what's due next right now, a
// pub-native decision ("order one more" ... "train risk"), and the 3 nearest pubs
// to the station for a final pint by the platform. Covers user stories 19-24.
//
// Strategy
// --------
//  1. Nearest station: TfL Unified API `GET /StopPoint?lat&lon&stopTypes&radius&modes`
//     returns stations nearest-first, each with the lines that serve it.
//  2. Per line (capped at LINE_CAP to respect the ~50 req/min keyless rate limit):
//     - Last train: `GET /Line/{lineId}/Timetable/{stationId}` → today's day-type
//       schedule's `lastJourney`. TfL's plain timetable call sometimes returns a
//       *disambiguation* (Brixton→Walthamstow vs the reverse) instead of a
//       timetable; when it does we follow the offered direction URIs and merge
//       their schedules. Hours roll past 24 for after-midnight / Night Tube
//       services. formatLastJourney handles that.
//     - Next departures: the normal request uses
//       `GET /StopPoint/{id}/Arrivals` filtered to the line,
//       which is genuinely live (vehicles in service right now). When Arrivals
//       comes back empty for a line (last train of the night has gone, or the
//       line just isn't running), we fall back to the same timetable's *next*
//       scheduled entry after "now" so the card still shows something. The
//       stable scope skips Arrivals and line status, omits the decision, and
//       returns only timetable-safe data that can be prefetched and cached.
//  3. Pick the LATEST lastJourney across all matching schedules/routes for the line
//     (a station can host several branches; the drinker cares about the last one).
//  4. Disruption: `GET /Line/{ids}/Status` for the served lines feeds both the
//     card's disruption note and the decision's train_risk trigger.
//  5. Decision: computeLastPintDecision (lib/tfl.ts, pure + unit tested) combines
//     the last train, a haversine walk estimate, a fixed buffer and disruption
//     state into one of the five pub-native states.
//  6. Nearest pubs: haversine (lib/haversine.ts) against the bundled venue index,
//     sorted by distance to the station, top 3 with id/name/price.
//
// Robustness: every TfL call is wrapped in try/catch with a short per-call
// AbortController timeout. This route NEVER throws and NEVER 500s the user - if the
// nearest-station lookup fails or finds nothing, it returns 200 with an `error`
// string and an empty body the card can show gracefully (user story 24).

import { publicApiError } from "@/lib/apiError";
import {
  computeLastPintDecision,
  formatLastJourney,
  lineColour,
  matchesDayType,
  minutesUntilDeparture,
  serviceDayTypeForDate,
  walkMinutesForKm,
  type DayType,
  type LastTrain,
  type LastTrainResult,
  type NearestPub,
  type NextDepartures,
} from "@/lib/tfl";
import { CITIES, pointInCityBounds } from "@/lib/cities";
import { coarsenViewerPoint } from "@/lib/geo";
import { haversineKm } from "@/lib/haversine";
import { isLastRideLimited } from "@/lib/lastRideRateLimit";
import { nearestStaticStation } from "@/lib/staticStations";
import { tflGet } from "@/lib/tflClient.server";
import { peekPricedVenues } from "@/lib/venuePriceIndex";
import { cachedLastTrainValue } from "@/lib/lastTrainStableCache.server";

const STATION_RADIUS_M = 1500;
// Broad coverage: metro + national-rail stations, across the modes a Londoner
// heading home actually uses. modes narrows StopPoint results to real options.
const STOP_TYPES = "NaptanMetroStation,NaptanRailStation";
const MODES = "tube,dlr,elizabeth-line,overground";
// Cap the timetable fan-out so a busy interchange (many lines) can't blow the
// keyless rate limit; four lines is plenty for a "head home" glance.
const LINE_CAP = 4;
// --- Minimal shapes for just the fields we read off the TfL responses. ---

type StopPointLine = { id?: string; name?: string };
type StopPoint = {
  id?: string;
  commonName?: string;
  distance?: number;
  lines?: StopPointLine[];
  lat?: number;
  lon?: number;
};
type StopPointResponse = { stopPoints?: StopPoint[] };

// TfL sends hour/minute as strings ("24", "34"); coerce defensively.
type KnownJourney = { hour?: number | string; minute?: number | string };
type Schedule = { name?: string; lastJourney?: KnownJourney };
type Route = { schedules?: Schedule[] };
type DisambiguationOption = { uri?: string };
type TimetableResponse = {
  timetable?: { routes?: Route[] };
  disambiguation?: { disambiguationOptions?: DisambiguationOption[] };
};

const STATION_CACHE_TTL_MS = 30 * 60_000;
const TIMETABLE_CACHE_TTL_MS = 6 * 60 * 60_000;

// The card has a useful static station fallback, so a stalled TfL request must
// not occupy the browser or a serverless function for the platform timeout.
// This is an upstream-response budget, not an end-to-end SLO: local response
// work and the rate limiter still sit outside it. A timeout returns only known
// station context and the unavailable decision, never a guessed departure.
export const LAST_TRAIN_ROUTE_BUDGET_MS = 1_800;

// A shared producer may outlive its first request so a later request can reuse
// it. Keep that orphan work finite: three seconds gives the latency test's
// two-second producer time to help a second waiter, while avoiding the default
// nine-second read plus retry (up to eighteen seconds without a waiter).
export const LAST_TRAIN_SHARED_PRODUCER_TIMEOUT_MS = 3_000;

function runSharedProducer<T>(
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    LAST_TRAIN_SHARED_PRODUCER_TIMEOUT_MS,
  );
  return Promise.resolve()
    .then(() => load(controller.signal))
    .finally(() => clearTimeout(timer));
}

// Stable values are shared across requests, but a request must own only its
// wait. The producer must not receive one request's deadline, or a timed-out
// caller would cancel work that a second caller could still use.
function awaitCachedValueForRequest<T>(
  producer: Promise<T>,
  signal: AbortSignal | undefined,
  fallback: T,
): Promise<T> {
  if (!signal) return producer;
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(fallback);
    signal.addEventListener("abort", onAbort, { once: true });
    void producer.then(finish, () => finish(fallback));
  });
}

async function nearestStation(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<StopPoint | null> {
  if (signal?.aborted) return null;
  const egressPoint = coarsenViewerPoint({ lat, lng });
  const key = `${egressPoint.lat.toFixed(3)}:${egressPoint.lng.toFixed(3)}`;
  const producer = cachedLastTrainValue(
    "stations",
    key,
    STATION_CACHE_TTL_MS,
    () => runSharedProducer(async (signal) => {
      const stopUrl =
        `/StopPoint?lat=${egressPoint.lat}&lon=${egressPoint.lng}` +
        `&stopTypes=${STOP_TYPES}&radius=${STATION_RADIUS_M}&modes=${MODES}`;
      const stops = await tflGet<StopPointResponse>(stopUrl, {
        retries: 0,
        timeoutMs: LAST_TRAIN_SHARED_PRODUCER_TIMEOUT_MS,
        signal,
      });
      return stops?.stopPoints?.[0] ?? null;
    }),
    (station) => Boolean(station?.id),
  );
  return awaitCachedValueForRequest(producer, signal, null);
}

// TfL Arrivals: one entry per vehicle currently predicted for this stop.
type ArrivalPrediction = {
  lineId?: string;
  lineName?: string;
  timeToStation?: number; // seconds from now
  expectedArrival?: string; // ISO
};

// TfL Line Status: `lineStatuses[].statusSeverityDescription` of "Good Service"
// means nothing to report; anything else is a disruption worth surfacing.
type LineStatusEntry = {
  id?: string;
  name?: string;
  lineStatuses?: { statusSeverityDescription?: string; reason?: string }[];
};

function toInt(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : null;
}

// Total minutes-since-midnight of a lastJourney, used only to pick the LATEST one.
// After-midnight hours (>=24) sort naturally after evening times, which is exactly
// what we want ("the last train" is the one with the largest hour:minute).
function journeyRank(j: KnownJourney): number | null {
  const hour = toInt(j.hour);
  const minute = toInt(j.minute);
  if (hour === null || minute === null) return null;
  return hour * 60 + minute;
}

// Gather every schedule from a timetable response. If TfL handed back a
// disambiguation (no routes, but direction options), follow each offered URI and
// merge the schedules it yields. Bounded: at most the options TfL lists (2 for a
// two-terminus line).
async function collectSchedules(
  lineId: string,
  stationId: string,
  signal?: AbortSignal,
): Promise<Schedule[]> {
  if (signal?.aborted) return [];
  const key = `${lineId}:${stationId}`;
  const producer = cachedLastTrainValue(
    "timetables",
    key,
    TIMETABLE_CACHE_TTL_MS,
    () => runSharedProducer(async (signal) => {
      const direct = await tflGet<TimetableResponse>(
        `/Line/${encodeURIComponent(lineId)}/Timetable/${encodeURIComponent(stationId)}`,
        {
          retries: 0,
          timeoutMs: LAST_TRAIN_SHARED_PRODUCER_TIMEOUT_MS,
          signal,
        },
      );
      if (!direct) return [];
      return mergeTimetableSchedules(direct, (uri) =>
        tflGet<TimetableResponse>(uri, {
          retries: 0,
          timeoutMs: LAST_TRAIN_SHARED_PRODUCER_TIMEOUT_MS,
          signal,
        }),
      );
    }),
    (schedules) => schedules.length > 0,
  );
  return awaitCachedValueForRequest(producer, signal, []);
}

export async function mergeTimetableSchedules(
  direct: TimetableResponse,
  resolveOption: (uri: string) => Promise<TimetableResponse | null>,
): Promise<Schedule[]> {
  const routes = direct.timetable?.routes ?? [];
  if (routes.length > 0) return routes.flatMap((route) => route.schedules ?? []);

  const options = (direct.disambiguation?.disambiguationOptions ?? []).filter(
    (option): option is DisambiguationOption & { uri: string } => Boolean(option.uri),
  );
  const resolvedOptions = await Promise.all(options.map((option) => resolveOption(option.uri)));
  const schedules: Schedule[] = [];
  for (const resolved of resolvedOptions) {
    for (const route of resolved?.timetable?.routes ?? []) {
      schedules.push(...(route.schedules ?? []));
    }
  }
  return schedules;
}

export function latestJourneyForDay(
  schedules: Schedule[],
  dayType: DayType,
): KnownJourney | null {
  let best: KnownJourney | null = null;
  let bestRank = -Infinity;
  for (const schedule of schedules) {
    if (!schedule.name || !matchesDayType(schedule.name, dayType)) continue;
    if (!schedule.lastJourney) continue;
    const rank = journeyRank(schedule.lastJourney);
    if (rank === null) continue;
    if (rank > bestRank) {
      bestRank = rank;
      best = schedule.lastJourney;
    }
  }
  return best;
}

// The latest lastJourney for one line at one station on today's day-type, formatted
// for the card. Returns null if the line has no schedule matching today (or TfL
// failed for it). The caller simply omits that line.
async function lastTrainForLine(
  lineId: string,
  lineName: string,
  stationId: string,
  dayType: DayType,
  signal?: AbortSignal,
): Promise<LastTrain | null> {
  const schedules = await collectSchedules(lineId, stationId, signal);

  const best = latestJourneyForDay(schedules, dayType);
  if (!best) return null;

  const hour = toInt(best.hour);
  const minute = toInt(best.minute);
  if (hour === null || minute === null) return null;

  const { clock, pastMidnight } = formatLastJourney({ hour, minute });
  return { lineId, lineName, colour: lineColour(lineId), clock, pastMidnight, serviceHour: hour };
}

// How many upcoming departures to show per line (user story 20: "next 2-3").
const DEPARTURES_PER_LINE = 3;
// How many nearest pubs to surface for "a final pint by the platform" (story 22).
const NEAREST_PUB_COUNT = 3;

// Format a Date to a "HH:MM" wall-clock string in London local time (arrivals
// come back as absolute ISO instants; timetable fallback entries are already
// day-relative minutes. Both funnel through this so the card sees one shape).
function toLondonClock(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

// Live next departures for one line at one station, via TfL Arrivals. These are genuinely
// real-time (vehicles currently in service), unlike the static timetable. Sorted
// soonest-first and capped to DEPARTURES_PER_LINE. Returns [] (not null) when
// Arrivals has nothing for this line right now (service ended, or a quiet gap);
// the caller decides whether/how to fall back.
async function nextDeparturesForLine(
  lineId: string,
  stationId: string,
  signal?: AbortSignal,
): Promise<{ clock: string }[]> {
  const arrivals = await tflGet<ArrivalPrediction[]>(
    `/StopPoint/${encodeURIComponent(stationId)}/Arrivals`,
    { signal },
  );
  if (!arrivals) return [];
  return arrivals
    .filter((a) => a.lineId === lineId)
    .map((a) => {
      if (a.expectedArrival) {
        const d = new Date(a.expectedArrival);
        if (!Number.isNaN(d.getTime())) return { clock: toLondonClock(d), sortKey: d.getTime() };
      }
      const seconds = a.timeToStation ?? 0;
      const d = new Date(Date.now() + seconds * 1000);
      return { clock: toLondonClock(d), sortKey: d.getTime() };
    })
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, DEPARTURES_PER_LINE)
    .map(({ clock }) => ({ clock }));
}

// Timetable-based fallback for "next departures" when live Arrivals is empty for
// a line (e.g. after the last live vehicle but before we've given up on the
// night, or Arrivals is temporarily quiet). Reuses the same schedules the
// last-train lookup already collected, with no extra TfL calls, and picks the
// smallest-rank journeys that are still >= "now" (in minutes-since-midnight),
// falling back further to today's lastJourney alone if nothing else matches.
export function nextFromSchedulesAfter(
  schedules: Schedule[],
  dayType: DayType,
  nowMinutes: number,
): { clock: string }[] {
  const ranked: number[] = [];
  for (const schedule of schedules) {
    if (!schedule.name || !matchesDayType(schedule.name, dayType)) continue;
    if (!schedule.lastJourney) continue;
    const rank = journeyRank(schedule.lastJourney);
    if (rank !== null) ranked.push(rank);
  }
  const upcoming = ranked.filter((r) => r >= nowMinutes).sort((a, b) => a - b);
  const chosen = (upcoming.length > 0 ? upcoming : ranked.sort((a, b) => a - b)).slice(
    0,
    DEPARTURES_PER_LINE,
  );
  return chosen.map((rank) => {
    const { clock } = formatLastJourney({ hour: Math.floor(rank / 60), minute: rank % 60 });
    return { clock };
  });
}

// Combined "next departures" for one line: try live Arrivals first (real-time),
// and only fall back to the timetable when Arrivals comes back empty for this
// line. `live` on the returned shape tells the card (and the decision) which
// source won, since a timetable fallback is not a disruption signal on its own.
async function departuresForLine(
  lineId: string,
  lineName: string,
  stationId: string,
  dayType: DayType,
  nowMinutes: number,
  signal?: AbortSignal,
): Promise<NextDepartures> {
  const live = await nextDeparturesForLine(lineId, stationId, signal);
  if (live.length > 0) {
    return {
      lineId,
      lineName,
      colour: lineColour(lineId),
      times: live.map((l) => l.clock),
      live: true,
    };
  }
  return scheduledDeparturesForLine(lineId, lineName, stationId, dayType, nowMinutes, signal);
}

async function scheduledDeparturesForLine(
  lineId: string,
  lineName: string,
  stationId: string,
  dayType: DayType,
  nowMinutes: number,
  signal?: AbortSignal,
): Promise<NextDepartures> {
  const schedules = await collectSchedules(lineId, stationId, signal);
  const fallback = nextFromSchedulesAfter(schedules, dayType, nowMinutes);
  return {
    lineId,
    lineName,
    colour: lineColour(lineId),
    times: fallback.map((f) => f.clock),
    live: false,
  };
}

// Disruption summary for the served lines (user stories 21, 24): TfL Line
// Status, one call for all lineIds at once. Returns null when every line is
// "Good Service" (nothing to say) and a short human line when not. Also
// returns whether ANY of `neededLineIds` is affected, for the decision's
// train_risk trigger.
async function lineDisruptions(
  lineIds: string[],
  signal?: AbortSignal,
): Promise<{ summary: string | null; affectedLineIds: Set<string> }> {
  if (lineIds.length === 0) return { summary: null, affectedLineIds: new Set() };
  const statuses = await tflGet<LineStatusEntry[]>(
    `/Line/${encodeURIComponent(lineIds.join(","))}/Status`,
    { signal },
  );
  if (!statuses) return { summary: null, affectedLineIds: new Set() };

  return summarizeLineStatuses(statuses);
}

export function summarizeLineStatuses(
  statuses: LineStatusEntry[],
): { summary: string | null; affectedLineIds: Set<string> } {
  const affectedLineIds = new Set<string>();
  const notes: string[] = [];
  for (const line of statuses) {
    const worst = (line.lineStatuses ?? []).find(
      (s) => s.statusSeverityDescription && s.statusSeverityDescription !== "Good Service",
    );
    if (worst && line.id) {
      affectedLineIds.add(line.id);
      notes.push(`${line.name ?? line.id}: ${worst.statusSeverityDescription}`);
    }
  }
  return { summary: notes.length > 0 ? notes.join(" · ") : null, affectedLineIds };
}

// The 3 nearest pubs to the station (user story 22) reuse the shared
// haversine (lib/haversine.ts) against the bundled, price-carrying venue list
// (lib/venuePriceIndex.ts, memoized from the same dataset venueIndex.ts reads).
function nearestPubsToStation(stationLat: number, stationLng: number): NearestPub[] {
  const venues = peekPricedVenues();
  if (!venues) return [];
  const withDistance = venues.map((v) => ({
    v,
    km: haversineKm([stationLng, stationLat], [v.longitude, v.latitude]),
  }));
  withDistance.sort((a, b) => a.km - b.km);
  return withDistance.slice(0, NEAREST_PUB_COUNT).map(({ v }) => ({
    id: v.id,
    name: v.name,
    price: v.cheapestPrice,
  }));
}

// "Now" in London, so the weekday we pick the timetable for is the drinker's, not
// the server's. Intl gives us the London-local Y/M/D; we rebuild a Date whose
// getDay() is the London weekday (dayTypeForDate reads getDay()).
function londonNow(instant: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
  );
}

function json(body: unknown, opts: { status?: number; cache?: boolean } = {}): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? "public, s-maxage=3600, stale-while-revalidate=86400"
        : "no-store",
    },
  });
}

export async function runLastTrainRoute(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const stableOnly = params.get("scope") === "stable";
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lng = Number.parseFloat(params.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return publicApiError("Add valid lat and lng coordinates.", "INVALID_REQUEST", 400);
  }
  if (!pointInCityBounds(lat, lng, CITIES.london)) {
    const decision = computeLastPintDecision({
      minutesUntilLastTrain: null,
      walkMinutesEstimate: 0,
      stationName: "Nearest station",
      lineNames: [],
      disruptionOnNeededLine: false,
      destinationLabel: null,
      live: false,
    });
    return json({
      error: "Last Pint is only available for London pubs right now.",
      station: null,
      trains: [],
      departures: [],
      ...(stableOnly ? {} : { decision }),
      nearestPubs: [],
      generatedAt: new Date().toISOString(),
    });
  }
  if (await isLastRideLimited(request, stableOnly ? "last-train-stable" : "last-train")) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const routeController = new AbortController();
  const routeTimer = setTimeout(() => routeController.abort(), LAST_TRAIN_ROUTE_BUDGET_MS);
  try {
  // Destination is client-only (user story 23): the card keeps the label in
  // sessionStorage and never sends it here. Ignore any legacy ?destination=
  // query so home/station labels cannot land in access logs or edge caches.
  const destinationLabel = null;

  // 1) Nearest station. Retried once for transient failures; any failure here is
  // graceful (200 + error, NOT cached), never a 500. Degrade per user story 24.
  const nearest = await nearestStation(lat, lng, routeController.signal);
  if (!nearest?.id) {
    const staticStation = nearestStaticStation(lat, lng);
    if (staticStation) {
      const walkMinutesEstimate = walkMinutesForKm(staticStation.distanceKm);
      // Optional venue context is cache-only. A cold dataset read must never
      // start inside this bounded response path.
      const nearestPubs = nearestPubsToStation(staticStation.lat, staticStation.lon);
      const decision = computeLastPintDecision({
        minutesUntilLastTrain: null,
        walkMinutesEstimate,
        stationName: staticStation.name,
        lineNames: staticStation.lines,
        disruptionOnNeededLine: false,
        destinationLabel,
        live: false,
      });
      return json({
        error:
          "Couldn't reach TfL just now. Showing the nearest known station from our map. Check live times before you head out.",
        station: {
          id: staticStation.id,
          name: staticStation.name,
          distanceM: Math.round(staticStation.distanceM),
        },
        trains: [],
        departures: [],
        ...(stableOnly ? {} : { decision }),
        nearestPubs,
        generatedAt: new Date().toISOString(),
        staticFallback: true,
      });
    }

    const decision = computeLastPintDecision({
      minutesUntilLastTrain: null,
      walkMinutesEstimate: 0,
      stationName: "Nearest station",
      lineNames: [],
      disruptionOnNeededLine: false,
      destinationLabel,
      live: false,
    });
    return json({
      error: "Couldn't reach TfL just now. Check before you head out.",
      station: null,
      trains: [],
      departures: [],
      ...(stableOnly ? {} : { decision }),
      nearestPubs: [],
      generatedAt: new Date().toISOString(),
    });
  }

  const nowInstant = new Date();
  const now = londonNow(nowInstant);
  // Service-day rollback (C1): between midnight and ~04:00 the still-running
  // trains belong to the PREVIOUS calendar day's service (TfL encodes them as
  // hour>=24 on the prior day's schedule). Resolve the timetable against that
  // service day-type, not the raw weekday, or we drop the real last train.
  const dayType = serviceDayTypeForDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // 2) Unique serving lines, capped, resolved concurrently.
  const seen = new Set<string>();
  const lines: StopPointLine[] = [];
  for (const line of nearest.lines ?? []) {
    if (!line.id || seen.has(line.id)) continue;
    seen.add(line.id);
    lines.push(line);
    if (lines.length >= LINE_CAP) break;
  }
  const lineIds = lines.map((l) => l.id as string);

  const [lastTrainResults, departureResults, disruption] = await Promise.all([
    Promise.all(
        lines.map((line) =>
        lastTrainForLine(
          line.id as string,
          line.name ?? (line.id as string),
          nearest.id as string,
          dayType,
          routeController.signal,
        ),
      ),
    ),
    Promise.all(
      lines.map((line) =>
        stableOnly
          ? scheduledDeparturesForLine(
              line.id as string,
              line.name ?? (line.id as string),
              nearest.id as string,
              dayType,
              nowMinutes,
              routeController.signal,
            )
          : departuresForLine(
              line.id as string,
              line.name ?? (line.id as string),
              nearest.id as string,
              dayType,
              nowMinutes,
              routeController.signal,
            ),
      ),
    ),
    stableOnly
      ? Promise.resolve({ summary: null, affectedLineIds: new Set<string>() })
      : lineDisruptions(lineIds, routeController.signal),
  ]);

  // Venue enrichment is optional and cache-only. A cold dataset read must not
  // start inside this bounded response path, even when critical reads finish
  // early enough to leave apparent headroom.
  const nearestPubs =
    typeof nearest.lat === "number" &&
    typeof nearest.lon === "number" &&
    !routeController.signal.aborted
      ? nearestPubsToStation(nearest.lat, nearest.lon)
      : [];

  // Keep only lines we actually resolved; sort earliest-departing first so the
  // most urgent "leave now" line is at the top.
  const trains: LastTrain[] = lastTrainResults
    .filter((t): t is LastTrain => t !== null)
    .sort((a, b) => a.clock.localeCompare(b.clock));

  const departures: NextDepartures[] = departureResults.filter((d) => d.times.length > 0);

  if (stableOnly) {
    return json(
      {
        station: {
          id: nearest.id,
          name: nearest.commonName ?? "Nearest station",
          distanceM: Math.round(nearest.distance ?? 0),
        },
        trains,
        departures,
        nearestPubs,
        generatedAt: new Date().toISOString(),
      },
      { cache: trains.length > 0 },
    );
  }

  // Walk estimate: venue (the point the card was called with) → station,
  // straight-line haversine at a brisk walking pace. Labeled as straight-line in
  // the response shape so the card can be honest about it (no routed distance).
  const walkKm =
    typeof nearest.lat === "number" && typeof nearest.lon === "number"
      ? haversineKm([lng, lat], [nearest.lon, nearest.lat])
      : 0;
  const walkMinutesEstimate = walkMinutesForKm(walkKm);

  // Minutes until the last train that matters: the LATEST across all resolved
  // lines (any one of them gets the drinker home), measured from "now" by ACTUAL
  // clock time (C2). minutesUntilDeparture wraps a past-midnight train forward
  // only while we're still in the evening. A train that has already left tonight
  // reads negative (departed/withdrawn), never ~24h ahead.
  let minutesUntilLastTrain: number | null = null;
  for (const t of trains) {
    const [h, m] = t.clock.split(":").map(Number);
    const clockMinutes = h * 60 + m;
    const mins = minutesUntilDeparture(
      clockMinutes,
      t.pastMidnight,
      nowMinutes,
      nowInstant,
      t.serviceHour,
    );
    if (minutesUntilLastTrain === null || mins > minutesUntilLastTrain) minutesUntilLastTrain = mins;
  }

  const decision = computeLastPintDecision({
    minutesUntilLastTrain,
    walkMinutesEstimate,
    stationName: nearest.commonName ?? "Nearest station",
    lineNames: lines.map((l) => l.name ?? (l.id as string)),
    disruptionOnNeededLine: lineIds.some((id) => disruption.affectedLineIds.has(id)),
    disruptionSummary: disruption.summary,
    destinationLabel,
    // `live` here means "TfL was reachable" (drives live_data_unavailable), and
    // it is. We resolved a station and a last-train time. The card's "Live from
    // TfL" provenance label is a SEPARATE, honest signal driven by whether any
    // departures are genuinely live Arrivals, carried on the response's
    // `departures[].live` and read by the card (H5).
    live: true,
    now: nowInstant,
  });

  const result: LastTrainResult = {
    station: {
      id: nearest.id,
      name: nearest.commonName ?? "Nearest station",
      distanceM: Math.round(nearest.distance ?? 0),
    },
    trains,
    departures,
    decision,
    nearestPubs,
    generatedAt: new Date().toISOString(),
  };
  return json(result);
  } finally {
    clearTimeout(routeTimer);
  }
}
