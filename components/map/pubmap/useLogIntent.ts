import { useEffect, useRef } from "react";

import { resolveMapLogIntent, shouldRunMapLogIntent } from "@/lib/mapLogIntent";
import { markPubmaxTiming } from "@/lib/performanceMarks";

// §log-drop intent: react to a ?log= arrival by selecting a target venue and
// opening the drop composer once the map is ready, else surface the fallback.
// The `handled` ref guards against re-firing; the 9-dep effect array is kept
// exactly as it was in PubMap so react-compiler lint stays green.
// Extracted verbatim from PubMap (F1).
export function useLogIntent(deps: {
  hasLogIntent: boolean;
  loaded: boolean;
  firstFilteredVenueId: string;
  firstRouteId: string;
  selectedVenueId: string;
  selectedVenueResolvable: boolean;
  selectedVenueIsPub: boolean;
  selectVenue: (id: string) => void;
  openComposerForLog: () => void;
  setFallbackVisible: (visible: boolean) => void;
}) {
  const {
    hasLogIntent,
    loaded,
    firstFilteredVenueId,
    firstRouteId,
    selectedVenueId,
    selectedVenueResolvable,
    selectedVenueIsPub,
    selectVenue,
    openComposerForLog,
    setFallbackVisible,
  } = deps;
  const handled = useRef(false);

  useEffect(() => {
    if (!hasLogIntent) {
      handled.current = false;
      setFallbackVisible(false);
      return;
    }
    if (!shouldRunMapLogIntent({ hasLogIntent, handled: handled.current })) return;
    const resolution = resolveMapLogIntent({
      hasLogIntent,
      loaded,
      selectedVenueId,
      selectedVenueResolvable,
      selectedVenueIsPub,
      firstRouteId,
      firstFilteredVenueId,
    });
    if (resolution.status === "inactive" || resolution.status === "pending") return;
    if (resolution.status === "fallback") {
      setFallbackVisible(true);
      return;
    }
    handled.current = true;
    setFallbackVisible(false);
    markPubmaxTiming("pubmax:drop-route-ready");
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      selectVenue(resolution.venueId);
      openComposerForLog();
    });
    return () => {
      active = false;
    };
  }, [
    hasLogIntent,
    loaded,
    firstFilteredVenueId,
    firstRouteId,
    openComposerForLog,
    selectVenue,
    selectedVenueId,
    selectedVenueIsPub,
    selectedVenueResolvable,
    setFallbackVisible,
  ]);
}
