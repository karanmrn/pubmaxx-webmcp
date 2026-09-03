"use client";

import { useEffect, useRef } from "react";

import { trackEvent } from "@/lib/analytics";
import { ARRIVAL_PARAM, isPintIndexArrival } from "@/lib/pintIndexArrival";

/**
 * Records that a Pint Index arrival actually REACHED the map, rather than that
 * it tapped a link. The tap fires on the index page; this fires once the map
 * route has loaded with the arrival marker on it, so an abandoned navigation
 * cannot inflate the reach half of the funnel.
 *
 * Then it takes the marker back out of the URL. A map view is the most shared
 * thing on the site, and a marker left in the address bar would ride into
 * every copy of that link and report strangers as arrivals from the Index.
 * The URL is rewritten in place, keeping every other param and the history
 * state, so Back and the map's own selection history are untouched.
 *
 * Renders nothing and owns no map state: it is a sibling of the map shell,
 * never part of it.
 */
export default function PintIndexMapArrival() {
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current || typeof window === "undefined") return;
    if (!isPintIndexArrival(window.location.search)) return;
    recorded.current = true;
    trackEvent("pint_index_map_reached");

    const params = new URLSearchParams(window.location.search);
    params.delete(ARRIVAL_PARAM);
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);

  return null;
}
