// Request-time Skiddle Events seam for /api/out.
// Reads SKIDDLE_API_KEY at call time. Absent key = not-configured, never
// an empty-market claim. Never logs the key.
// Everything shared with the Ticketmaster lane lives in lib/events/liveProvider.ts.

import {
  SKIDDLE_EVENTCODE_KIND,
  normaliseSkiddleEvents,
  skiddleLaneFenced,
} from "@/lib/whatson/eventNormalise.mjs";
import { createLiveEventsProvider, type LiveEventsProvider } from "@/lib/events/liveProvider";

const SKIDDLE_FETCH_CODES = Object.keys(SKIDDLE_EVENTCODE_KIND).join(",");

let provider: LiveEventsProvider | null = null;

export function createSkiddleProvider(): LiveEventsProvider {
  provider ??= createLiveEventsProvider({
    name: "skiddle",
    envVar: "SKIDDLE_API_KEY",
    // The licence obligation, not the key, is what holds this lane shut today:
    // Skiddle's own logo asset is absent, so a Skiddle row may not be served
    // however configured the lane becomes. See lib/whatson/eventNormalise.mjs.
    available: () => !skiddleLaneFenced(),
    upstreamLabel: "Skiddle Events API",
    buildUrl: ({ key, geo, window }) => {
      const url = new URL("https://www.skiddle.com/api/v1/events/search/");
      url.search = new URLSearchParams({
        api_key: key,
        latitude: String(geo.lat),
        longitude: String(geo.lng),
        radius: String(geo.radiusMiles),
        eventcode: SKIDDLE_FETCH_CODES,
        minDate: window.startIso.slice(0, 10),
        maxDate: window.endIso.slice(0, 10),
        order: "date",
        limit: "100",
        description: "1",
      }).toString();
      return url;
    },
    normalise: (payload, opts) => normaliseSkiddleEvents(payload, opts),
  });
  return provider;
}
