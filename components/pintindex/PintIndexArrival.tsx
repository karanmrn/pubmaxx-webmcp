"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

import { analyticsCollectionAllowed, trackEvent } from "@/lib/analytics";
import { formatPintDatasetAsOf } from "@/lib/dataFreshness";
import {
  ARRIVAL_VISIT_MARKER,
  ARRIVAL_VISIT_STORAGE_KEY,
  arrivalMapHref,
  visitFromMarker,
  type ArrivalArea,
} from "@/lib/pintIndexArrival";
import type { PintIndexSurface } from "@/lib/analyticsEvents";
import { formatPrice } from "@/lib/venues";

import "./pintIndexArrival.css";

// The one tap between "interesting London number" and "what about my patch".
//
// Someone gets here from a press link or a card someone shared. The page they
// land on is about a city; this strip is the door to the pub at the end of
// their road. It asks for nothing: no account, no location permission, no
// modal in the way. Every chip is a real area the map has enough priced pubs
// in to be worth opening (lib/pintIndexArrival.ts holds that floor).
//
// The figures here are the map's own recorded prices, not the cited Index
// observations above them, so their source and baseline as-of date are stamped
// once underneath, like every other number on the page.

type PintIndexArrivalProps = {
  areas: ArrivalArea[];
  surface: PintIndexSurface;
};

export default function PintIndexArrival({ areas, surface }: PintIndexArrivalProps) {
  // One arrival per page view. The ref (not the effect alone) is what keeps it
  // one: a re-running effect would inflate the denominator every ratio below
  // this funnel is measured against.
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    try {
      // The first/repeat marker is analytics state, so it is only read or
      // written once analytics consent exists - same rule as the daily pulse.
      if (typeof window === "undefined" || !analyticsCollectionAllowed()) return;
      const visit = visitFromMarker(window.localStorage.getItem(ARRIVAL_VISIT_STORAGE_KEY));
      trackEvent("pint_index_viewed", { surface, visit });
      window.localStorage.setItem(ARRIVAL_VISIT_STORAGE_KEY, ARRIVAL_VISIT_MARKER);
    } catch {
      // Blocked storage costs this visit its return signal, never the page.
    }
  }, [surface]);

  if (areas.length === 0) return null;

  return (
    <section className="pintArrival" aria-labelledby="pintArrivalHeading">
      <h2 id="pintArrivalHeading" className="pintArrivalTitle">Right, what about your patch?</h2>
      <p className="pintArrivalDek">
        London&rsquo;s figures are one thing. What you pay on your own road is
        another. Pick an area and the map opens on the cheapest pint we have on
        record there. No sign-up, and we won&rsquo;t ask where you are.
      </p>
      <ul className="pintArrivalAreas" aria-label="Open an area on the map">
        {areas.map((area) => (
          <li key={area.slug}>
            {/* A plain anchor, deliberately, where the rest of the site routes
                client-side. The map freezes at mount whether this arrival is
                intentional (lib/explicitMapIntent) and what the camera owes
                it, both read from the URL it mounted with. Reached by a soft
                navigation from here it inherits THIS page's empty query, so it
                opens on all of London and stacks the first-run welcome over
                it. A full load hands the map its real arrival, which is the
                whole promise of the tap. */}
            <a
              className="pintArrivalArea"
              href={arrivalMapHref(area)}
              onClick={() => trackEvent("pint_index_area_opened", { surface, area: area.slug })}
            >
              <span className="pintArrivalAreaName">{area.name}</span>
              <span className="pintArrivalAreaMeta">
                {`${formatPrice(area.cheapestGbp)} cheapest of ${area.pricedCount} priced pubs`}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="pintArrivalSource">
        Prices and counts from the London pint-price dataset, {formatPintDatasetAsOf()}.{" "}
        <Link href="/borough">Somewhere else in mind? Every borough is here</Link>
      </p>
    </section>
  );
}
