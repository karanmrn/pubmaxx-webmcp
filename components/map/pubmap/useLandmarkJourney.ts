import { useCallback } from "react";

import type { CrawlMode } from "@/components/map/ControlRail";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import { crawlStopsFromPubIds } from "@/lib/pubMap";

// Issue #15: the landmark card's two journey actions, hoisted into their own
// hook so their branches live off PubMap's complexity budget.
//   • startCrawlFromPubs — drop the nearest pubs into Build mode (shareable via
//     ?mode=build&pubs=…, reusing the curated-crawl path), then leave the route
//     list visible on mobile.
//   • askPubmaxxerAtPub — select the nearest story pub so its inspector opens
//     with the grounded "Ask the PUBMAXXER" panel a tap away. Seeding a question
//     straight into that panel is invasive (another agent owns VenueInspector),
//     so selecting the pub is the documented ceiling.
// Extracted verbatim from PubMap (F1).
export function useLandmarkJourney(deps: {
  selectVenue: (id: string) => void;
  showLoadedRoute: (firstStopId: string) => void;
  dismissOnboarding: () => void;
  setMode: (mode: CrawlMode) => void;
  setBuiltIds: (ids: string[]) => void;
  setRouteMapped: (mapped: boolean) => void;
  setActiveCrawl: (crawl: CuratedCrawl | null) => void;
  setPlanningOpen: (open: boolean) => void;
}) {
  const {
    selectVenue,
    showLoadedRoute,
    dismissOnboarding,
    setMode,
    setBuiltIds,
    setRouteMapped,
    setActiveCrawl,
    setPlanningOpen,
  } =
    deps;
  const startCrawlFromPubs = useCallback(
    (ids: string[]) => {
      const stops = crawlStopsFromPubIds(ids);
      if (stops.length) {
        setMode("build");
        setBuiltIds(stops);
        setRouteMapped(true);
        setActiveCrawl(null); // a landmark-seeded crawl isn't a curated one
        showLoadedRoute(stops[0]);
        dismissOnboarding();
      }
    },
    [
      dismissOnboarding,
      setMode,
      setBuiltIds,
      setRouteMapped,
      setActiveCrawl,
      showLoadedRoute,
    ],
  );
  const askPubmaxxerAtPub = useCallback(
    (venueId: string) => {
      setPlanningOpen(true);
      selectVenue(venueId);
    },
    [selectVenue, setPlanningOpen],
  );
  return { startCrawlFromPubs, askPubmaxxerAtPub };
}
