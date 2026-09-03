// Bundled Tube/rail stations for Last Pint static fallback (user story 24).
//
// When TfL StopPoint lookup fails, the /api/last-train route resolves the nearest
// entry here so the card still shows a station name, walk estimate, and the three
// nearest pubs by the platform — honest static context, not fake live timings.

import { haversineKm } from "@/lib/haversine";

export type StaticStation = {
  /** Stable id (TfL Naptan where known, else static:slug). */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Line names for display only — not live status. */
  lines: string[];
};

// Major central-London interchanges drinkers actually head for. Kept small and
// hand-curated; coordinates are approximate station entrances, good enough for
// straight-line walk estimates when TfL is down.
export const STATIC_STATIONS: StaticStation[] = [
  { id: "940GZZLUOXC", name: "Oxford Circus", lat: 51.515, lon: -0.141, lines: ["Central", "Victoria", "Bakerloo"] },
  { id: "940GZZLUPCC", name: "Piccadilly Circus", lat: 51.510, lon: -0.134, lines: ["Piccadilly", "Bakerloo"] },
  { id: "940GZZLUWMS", name: "Westminster", lat: 51.501, lon: -0.125, lines: ["District", "Circle", "Jubilee"] },
  { id: "940GZZLULEC", name: "Leicester Square", lat: 51.511, lon: -0.128, lines: ["Northern", "Piccadilly"] },
  { id: "940GZZLUCGN", name: "Covent Garden", lat: 51.513, lon: -0.124, lines: ["Piccadilly"] },
  { id: "940GZZLUKPK", name: "King's Cross St Pancras", lat: 51.530, lon: -0.124, lines: ["Northern", "Piccadilly", "Victoria", "Circle", "Metropolitan"] },
  { id: "940GZZLUEAE", name: "Euston", lat: 51.528, lon: -0.134, lines: ["Northern", "Victoria"] },
  { id: "940GZZLUVIC", name: "Victoria", lat: 51.496, lon: -0.144, lines: ["Victoria", "Circle", "District"] },
  { id: "940GZZLUBND", name: "Bank", lat: 51.513, lon: -0.089, lines: ["Central", "Northern", "Waterloo & City", "DLR"] },
  { id: "940GZZLULDG", name: "London Bridge", lat: 51.505, lon: -0.086, lines: ["Northern", "Jubilee"] },
  { id: "940GZZLULVT", name: "Liverpool Street", lat: 51.518, lon: -0.082, lines: ["Central", "Circle", "Metropolitan", "Hammersmith & City"] },
  { id: "940GZZLUBBN", name: "Baker Street", lat: 51.523, lon: -0.157, lines: ["Bakerloo", "Circle", "Hammersmith & City", "Jubilee", "Metropolitan"] },
  { id: "940GZZLUPAC", name: "Paddington", lat: 51.516, lon: -0.176, lines: ["Circle", "District", "Bakerloo", "Elizabeth line"] },
  { id: "940GZZLUSGT", name: "Southgate", lat: 51.632, lon: -0.128, lines: ["Piccadilly"] },
  { id: "940GZZLUARS", name: "Arnos Grove", lat: 51.616, lon: -0.132, lines: ["Piccadilly"] },
  { id: "940GZZLUCMD", name: "Camden Town", lat: 51.539, lon: -0.143, lines: ["Northern"] },
  { id: "940GZZLUGPS", name: "Green Park", lat: 51.507, lon: -0.142, lines: ["Piccadilly", "Victoria", "Jubilee"] },
  { id: "940GZZLUSWF", name: "Southwark", lat: 51.504, lon: -0.105, lines: ["Jubilee"] },
  { id: "940GZZLUBBB", name: "Borough", lat: 51.501, lon: -0.093, lines: ["Northern"] },
  { id: "940GZZLUSKS", name: "Stockwell", lat: 51.488, lon: -0.123, lines: ["Northern", "Victoria"] },
  { id: "940GZZLUCHX", name: "Charing Cross", lat: 51.508, lon: -0.124, lines: ["Northern", "Bakerloo"] },
  { id: "940GZZLUMMT", name: "Moorgate", lat: 51.518, lon: -0.089, lines: ["Northern", "Circle", "Hammersmith & City", "Metropolitan"] },
  { id: "940GZZLUBDT", name: "Bond Street", lat: 51.514, lon: -0.149, lines: ["Central", "Jubilee", "Elizabeth line"] },
  { id: "940GZZLUTCR", name: "Tottenham Court Road", lat: 51.516, lon: -0.131, lines: ["Central", "Northern", "Elizabeth line"] },
  { id: "940GZZLUHPC", name: "Holborn", lat: 51.517, lon: -0.120, lines: ["Central", "Piccadilly"] },
  { id: "940GZZLUFYC", name: "Finsbury Park", lat: 51.564, lon: -0.106, lines: ["Victoria", "Piccadilly"] },
  { id: "940GZZLUWLO", name: "Waterloo", lat: 51.503, lon: -0.113, lines: ["Northern", "Bakerloo", "Jubilee", "Waterloo & City"] },
  { id: "940GZZLUSFN", name: "Stratford", lat: 51.541, lon: -0.004, lines: ["Central", "Jubilee", "Elizabeth line"] },
  { id: "static:canary-wharf", name: "Canary Wharf", lat: 51.505, lon: -0.019, lines: ["Jubilee", "Elizabeth line"] },
];

export type NearestStaticStation = StaticStation & { distanceKm: number; distanceM: number };

/** Nearest bundled station to a point, or null when the list is empty. */
export function nearestStaticStation(lat: number, lng: number): NearestStaticStation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || STATIC_STATIONS.length === 0) {
    return null;
  }
  let best: NearestStaticStation | null = null;
  for (const station of STATIC_STATIONS) {
    const distanceKm = haversineKm([lng, lat], [station.lon, station.lat]);
    const distanceM = distanceKm * 1000;
    if (!best || distanceM < best.distanceM) {
      best = { ...station, distanceKm, distanceM };
    }
  }
  return best;
}
