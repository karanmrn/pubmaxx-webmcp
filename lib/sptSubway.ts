// Glasgow SPT Subway "Last Subway" — static stations + typical last-service
// times. Honest v1: no live SPT scrape. The Clockwork Orange typically winds
// down around 23:00; Fri/Sat are often similar (not a late-night Metrolink-style
// extension). The API labels provenance clearly so the card never pretends
// this is a live board.
//
// Decision maths reuse computeLastPintDecision from lib/tfl.ts (transport-
// agnostic: walk + last departure + buffer).

import "server-only";

import { readFileSync } from "fs";
import path from "path";

import { haversineKm } from "@/lib/haversine";
import type { LastRideResult } from "@/lib/lastRide";
import {
  computeLastPintDecision,
  formatLastJourney,
  minutesUntilDeparture,
  serviceDayTypeForDate,
  walkMinutesForKm,
  type DayType,
  type LastTrain,
  type NearestPub,
  type NextDepartures,
} from "@/lib/tfl";

export const SPT_SUBWAY_PROVENANCE =
  "Typical SPT Subway last service (static, ~23:00 close; Fri/Sat often similar). Not a live SPT feed. Check boards before you leave.";

export const SPT_SUBWAY_MODE_LABEL = "subway";

/** SPT Subway orange (Clockwork Orange network colour). */
export const SPT_SUBWAY_LINE_COLOUR = "#E87722";

export type SptSubwayStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  lines: string[];
};

export type NearestSptSubwayStation = SptSubwayStation & {
  distanceKm: number;
  distanceM: number;
};

type StationsFile = {
  attribution?: string;
  source?: string;
  stations: SptSubwayStation[];
};

let cachedStations: SptSubwayStation[] | null = null;

function stationsPath(): string {
  return path.join(
    process.cwd(),
    "public",
    "data",
    "cities",
    "glasgow",
    "subway_stations.json",
  );
}

/** Load and memoize the bundled SPT Subway station seed. */
export function loadSptSubwayStations(): SptSubwayStation[] {
  if (cachedStations) return cachedStations;
  try {
    const raw = readFileSync(stationsPath(), "utf8");
    const parsed = JSON.parse(raw) as StationsFile;
    const list = Array.isArray(parsed.stations) ? parsed.stations : [];
    cachedStations = list.filter(
      (s) =>
        typeof s?.id === "string" &&
        typeof s?.name === "string" &&
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lng) &&
        Array.isArray(s.lines),
    );
  } catch {
    cachedStations = [];
  }
  return cachedStations;
}

/** Test helper — reset memoized stations between cases. */
export function resetSptSubwayStationsCache(): void {
  cachedStations = null;
}

/** Nearest Subway stop to a point, or null when the seed is empty. */
export function nearestSptSubwayStation(
  lat: number,
  lng: number,
  stations: SptSubwayStation[] = loadSptSubwayStations(),
): NearestSptSubwayStation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || stations.length === 0) {
    return null;
  }
  let best: NearestSptSubwayStation | null = null;
  for (const station of stations) {
    const distanceKm = haversineKm([lng, lat], [station.lng, station.lat]);
    const distanceM = distanceKm * 1000;
    if (!best || distanceM < best.distanceM) {
      best = { ...station, distanceKm, distanceM };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Typical last-service times (conservative static approximation)
// ---------------------------------------------------------------------------
//
// SPT Subway last trains typically finish around 23:00 across the week.
// Unlike Metrolink, Friday/Saturday do not reliably run much later — treat
// them as similar to Mon–Thu. Sunday can finish a little earlier. Hours may
// be >= 24 for after-midnight services so formatLastJourney /
// minutesUntilDeparture work the same as TfL / Metrolink.
//
// Always verify live SPT boards / apps before you leave.

type TypicalLast = { hour: number; minute: number };

const TYPICAL_LAST_BY_DAY: Record<DayType, TypicalLast> = {
  // Mon–Thu: typical close around 23:00.
  "mon-thu": { hour: 23, minute: 0 },
  // Friday: often similar to weeknights — not a late Metrolink-style extension.
  fri: { hour: 23, minute: 0 },
  // Saturday: similar ~23:00 window.
  sat: { hour: 23, minute: 0 },
  // Sunday: slightly earlier finish — conservative ~22:45.
  sun: { hour: 22, minute: 45 },
};

/** Typical last-subway clock for a day-type (shared across circles in v1). */
export function typicalLastSubwayForDayType(dayType: DayType): TypicalLast {
  return TYPICAL_LAST_BY_DAY[dayType];
}

function slugLineId(lineName: string): string {
  return lineName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function trainsForStation(station: SptSubwayStation, dayType: DayType): LastTrain[] {
  const last = typicalLastSubwayForDayType(dayType);
  const { clock, pastMidnight } = formatLastJourney(last);
  const lines = station.lines.length > 0 ? station.lines : ["Subway"];
  return lines.map((lineName) => ({
    lineId: slugLineId(lineName),
    lineName,
    colour: SPT_SUBWAY_LINE_COLOUR,
    clock,
    pastMidnight,
  }));
}

function departuresForStation(
  station: SptSubwayStation,
  dayType: DayType,
): NextDepartures[] {
  // Static v1: surface the typical last as the only "scheduled" time per line
  // (no invented mid-evening cadence). live: false always.
  const last = typicalLastSubwayForDayType(dayType);
  const { clock } = formatLastJourney(last);
  const lines = station.lines.length > 0 ? station.lines : ["Subway"];
  return lines.map((lineName) => ({
    lineId: slugLineId(lineName),
    lineName,
    colour: SPT_SUBWAY_LINE_COLOUR,
    times: [clock],
    live: false,
  }));
}

/** "Now" in Europe/London — same approach as TfL / Metrolink last-ride routes. */
export function glasgowNow(base: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(base);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
  );
}

export type ComputeSptSubwayLastRideInput = {
  lat: number;
  lng: number;
  now?: Date;
  nearestPubs?: NearestPub[];
  destinationLabel?: string | null;
  stations?: SptSubwayStation[];
};

/**
 * Full Last Subway answer for a point: nearest stop, typical last services,
 * walk estimate, and a Last Pint–style decision. Never throws.
 */
export function computeSptSubwayLastRide(
  input: ComputeSptSubwayLastRideInput,
): LastRideResult & { error?: string } {
  const {
    lat,
    lng,
    now: nowInput,
    nearestPubs = [],
    destinationLabel = null,
    stations,
  } = input;

  const nearest = nearestSptSubwayStation(lat, lng, stations);
  if (!nearest) {
    const decision = computeLastPintDecision({
      minutesUntilLastTrain: null,
      walkMinutesEstimate: 0,
      stationName: "Nearest subway stop",
      lineNames: [],
      disruptionOnNeededLine: false,
      destinationLabel,
      live: false,
      now: nowInput ?? new Date(),
    });
    return {
      error: "No Subway stops in our map for this area. Check before you head out.",
      station: { id: "", name: "Nearest subway stop", distanceM: 0 },
      trains: [],
      departures: [],
      decision,
      nearestPubs: [],
      generatedAt: new Date().toISOString(),
      staticFallback: true,
      provider: "spt-subway",
      modeLabel: SPT_SUBWAY_MODE_LABEL,
      provenance: SPT_SUBWAY_PROVENANCE,
    };
  }

  const now = glasgowNow(nowInput ?? new Date());
  const dayType = serviceDayTypeForDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const trains = trainsForStation(nearest, dayType);
  const departures = departuresForStation(nearest, dayType);
  const walkMinutesEstimate = walkMinutesForKm(nearest.distanceKm);

  let minutesUntilLastTrain: number | null = null;
  for (const t of trains) {
    const [h, m] = t.clock.split(":").map(Number);
    const clockMinutes = h * 60 + m;
    const mins = minutesUntilDeparture(clockMinutes, t.pastMidnight, nowMinutes);
    if (minutesUntilLastTrain === null || mins > minutesUntilLastTrain) {
      minutesUntilLastTrain = mins;
    }
  }

  // `live: true` here means "we have a usable static timetable answer" so the
  // decision can leave live_data_unavailable. Provenance on the response still
  // says this is a typical static schedule, not a live board.
  const decision = computeLastPintDecision({
    minutesUntilLastTrain,
    walkMinutesEstimate,
    stationName: nearest.name,
    lineNames: nearest.lines,
    disruptionOnNeededLine: false,
    destinationLabel,
    live: true,
    now: nowInput ?? new Date(),
  });

  return {
    station: {
      id: nearest.id,
      name: nearest.name,
      distanceM: Math.round(nearest.distanceM),
    },
    trains,
    departures,
    decision,
    nearestPubs,
    generatedAt: new Date().toISOString(),
    staticFallback: true,
    provider: "spt-subway",
    modeLabel: SPT_SUBWAY_MODE_LABEL,
    provenance: SPT_SUBWAY_PROVENANCE,
  };
}
