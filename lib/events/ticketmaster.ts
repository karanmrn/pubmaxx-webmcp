// Request-time Ticketmaster Discovery seam for /api/out.
// Reads TICKETMASTER_API_KEY at call time. Never logs the key.
// Everything shared with the Skiddle lane lives in lib/events/liveProvider.ts.

import { normaliseTicketmasterEvents } from "@/lib/whatson/eventNormalise.mjs";
import { createLiveEventsProvider, type LiveEventsProvider } from "@/lib/events/liveProvider";

function toTmInstant(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

let provider: LiveEventsProvider | null = null;

export function createTicketmasterProvider(): LiveEventsProvider {
  provider ??= createLiveEventsProvider({
    name: "ticketmaster",
    envVar: "TICKETMASTER_API_KEY",
    upstreamLabel: "Ticketmaster Discovery API",
    buildUrl: ({ key, geo, window }) => {
      const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
      url.search = new URLSearchParams({
        apikey: key,
        countryCode: "GB",
        latlong: `${geo.lat},${geo.lng}`,
        radius: String(geo.radiusMiles),
        unit: "miles",
        startDateTime: toTmInstant(window.startIso),
        endDateTime: toTmInstant(window.endIso),
        size: "100",
        sort: "date,asc",
      }).toString();
      return url;
    },
    normalise: (payload, opts) => normaliseTicketmasterEvents(payload, opts),
  });
  return provider;
}
