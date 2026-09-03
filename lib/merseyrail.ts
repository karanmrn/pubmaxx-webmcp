// Liverpool Merseyrail "Last Train" — static stations + typical last-service
// times. Honest v1: no live Merseytravel scrape. Times are conservative typical
// last departures by day-type; the API labels provenance clearly so the card
// never pretends this is a live board.
//
// Decision maths reuse computeLastPintDecision from lib/tfl.ts (transport-
// agnostic: walk + last departure + buffer). Mirror of lib/metrolink.ts.

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

export const MERSEYRAIL_PROVENANCE =
  "Typical Merseyrail last service (static). Not a live Merseytravel feed. Check boards before you leave.";

export const MERSEYRAIL_MODE_LABEL = "train";

/** Merseyrail network yellow (approx. brand / map colour). */
export const MERSEYRAIL_LINE_COLOUR = "#FECB00";

export type MerseyrailStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  lines: string[];
};

export type NearestMerseyrailStation = MerseyrailStation & {
  distanceKm: number;
  distanceM: number;
};

type StationsFile = {
  attribution?: string;
  source?: string;
  stations: MerseyrailStation[];
};

let cachedStations: MerseyrailStation[] | null = null;

function stationsPath(): string {
  return path.join(
    process.cwd(),
    "public",
    "data",
    "cities",
    "liverpool",
    "merseyrail_stations.json",
  );
}

/** Load and memoize the bundled Merseyrail station seed. */
export function loadMerseyrailStations(): MerseyrailStation[] {
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
export function resetMerseyrailStationsCache(): void {
  cachedStations = null;
}

/** Nearest Merseyrail stop to a point, or null when the seed is empty. */
export function nearestMerseyrailStation(
  lat: number,
  lng: number,
  stations: MerseyrailStation[] = loadMerseyrailStations(),
): NearestMerseyrailStation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || stations.length === 0) {
    return null;
  }
  let best: NearestMerseyrailStation | null = null;
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
// Merseyrail last trains vary by line and terminus. These are intentionally
// early-side "typical last service" clocks — not live Merseytravel times.
// Fri/Sat run later; Sun is earlier. Hours may be >= 24 for after-midnight
// services so formatLastJourney / minutesUntilDeparture work the same as TfL.
//
// Sources consulted conceptually: published Merseyrail evening patterns
// (core city loop ~00:00 Mon–Thu; later Fri–Sat; earlier Sun). Always verify.

type TypicalLast = { hour: number; minute: number };

const TYPICAL_LAST_BY_DAY: Record<DayType, TypicalLast> = {
  // Mon–Thu: last core loop / Northern–Wirral services typically wind down
  // around midnight — conservative ~23:50.
  "mon-thu": { hour: 23, minute: 50 },
  // Friday: later evening — conservative ~00:35.
  fri: { hour: 24, minute: 35 },
  // Saturday: similar late window — conservative ~00:50.
  sat: { hour: 24, minute: 50 },
  // Sunday: earlier finish — conservative ~23:20.
  sun: { hour: 23, minute: 20 },
};

/** Typical last-train clock for a day-type (shared across lines in v1). */
export function typicalLastTrainForDayType(dayType: DayType): TypicalLast {
  return TYPICAL_LAST_BY_DAY[dayType];
}

function slugLineId(lineName: string): string {
  return lineName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function trainsForStation(station: MerseyrailStation, dayType: DayType): LastTrain[] {
  const last = typicalLastTrainForDayType(dayType);
  const { clock, pastMidnight } = formatLastJourney(last);
  const lines = station.lines.length > 0 ? station.lines : ["Merseyrail"];
  return lines.map((lineName) => ({
    lineId: slugLineId(lineName),
    lineName,
    colour: MERSEYRAIL_LINE_COLOUR,
    clock,
    pastMidnight,
  }));
}

function departuresForStation(
  station: MerseyrailStation,
  dayType: DayType,
): NextDepartures[] {
  // Static v1: surface the typical last as the only "scheduled" time per line
  // (no invented mid-evening cadence). live: false always.
  const last = typicalLastTrainForDayType(dayType);
  const { clock } = formatLastJourney(last);
  const lines = station.lines.length > 0 ? station.lines : ["Merseyrail"];
  return lines.map((lineName) => ({
    lineId: slugLineId(lineName),
    lineName,
    colour: MERSEYRAIL_LINE_COLOUR,
    times: [clock],
    live: false,
  }));
}

/** "Now" in Europe/London — same approach as the TfL / Metrolink routes. */
export function liverpoolNow(base: Date = new Date()): Date {
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

export type ComputeMerseyrailLastRideInput = {
  lat: number;
  lng: number;
  now?: Date;
  nearestPubs?: NearestPub[];
  destinationLabel?: string | null;
  stations?: MerseyrailStation[];
};

/**
 * Full Last Train answer for a point: nearest stop, typical last services,
 * walk estimate, and a Last Pint–style decision. Never throws.
 */
export function computeMerseyrailLastRide(
  input: ComputeMerseyrailLastRideInput,
): LastRideResult & { error?: string } {
  const {
    lat,
    lng,
    now: nowInput,
    nearestPubs = [],
    destinationLabel = null,
    stations,
  } = input;

  const nearest = nearestMerseyrailStation(lat, lng, stations);
  if (!nearest) {
    const decision = computeLastPintDecision({
      minutesUntilLastTrain: null,
      walkMinutesEstimate: 0,
      stationName: "Nearest Merseyrail stop",
      lineNames: [],
      disruptionOnNeededLine: false,
      destinationLabel,
      live: false,
      now: nowInput ?? new Date(),
    });
    return {
      error:
        "No Merseyrail stops in our map for this area. Check before you head out.",
      station: { id: "", name: "Nearest Merseyrail stop", distanceM: 0 },
      trains: [],
      departures: [],
      decision,
      nearestPubs: [],
      generatedAt: new Date().toISOString(),
      staticFallback: true,
      provider: "merseyrail",
      modeLabel: MERSEYRAIL_MODE_LABEL,
      provenance: MERSEYRAIL_PROVENANCE,
    };
  }

  const now = liverpoolNow(nowInput ?? new Date());
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
    provider: "merseyrail",
    modeLabel: MERSEYRAIL_MODE_LABEL,
    provenance: MERSEYRAIL_PROVENANCE,
  };
}
