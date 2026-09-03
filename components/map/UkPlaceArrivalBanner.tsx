"use client";

import { MapPin, X } from "lucide-react";
import { useState } from "react";

import type { UkPlaceMapArrival } from "@/lib/ukPlaceSearch";

import "./ukPlaceArrivalBanner.css";

export default function UkPlaceArrivalBanner({
  arrival,
}: {
  arrival: UkPlaceMapArrival;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <aside
      className="ukPlaceArrival"
      aria-label={`${arrival.name} map coverage`}
    >
      <MapPin className="ukPlaceArrivalIcon" size={18} aria-hidden="true" />
      <span className="ukPlaceArrivalCopy">
        <strong>{arrival.name} pubs are on the map.</strong>
        <span>
          No prices logged here yet. Tap a pub and you could be first.
        </span>
      </span>
      <button
        type="button"
        className="ukPlaceArrivalDismiss"
        onClick={() => setDismissed(true)}
        aria-label={`Dismiss ${arrival.name} map note`}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
