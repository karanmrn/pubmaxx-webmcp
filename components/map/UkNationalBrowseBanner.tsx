"use client";

import { MapPin, X } from "lucide-react";
import { useState } from "react";

import {
  UK_NATIONAL_BROWSE_COPY,
  UK_OUTSIDE_CITY_COPY,
} from "@/lib/ukNationalBrowse";

import "./ukPlaceArrivalBanner.css";

type UkNationalBrowseBannerProps = {
  /** `national` is `/map?uk=1`; `outside` is camera past the active city box. */
  variant?: "national" | "outside";
};

/** Coverage note for national browse or pan-outside-city — no priced promises. */
export default function UkNationalBrowseBanner({
  variant = "national",
}: UkNationalBrowseBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const copy =
    variant === "outside" ? UK_OUTSIDE_CITY_COPY : UK_NATIONAL_BROWSE_COPY;
  const label = variant === "outside" ? "Outside priced city map" : "UK pub map";

  return (
    <aside className="ukPlaceArrival" aria-label={label}>
      <MapPin className="ukPlaceArrivalIcon" size={18} aria-hidden="true" />
      <span className="ukPlaceArrivalCopy">
        <strong>{copy.title}</strong>
        <span>{copy.body}</span>
      </span>
      <button
        type="button"
        className="ukPlaceArrivalDismiss"
        onClick={() => setDismissed(true)}
        aria-label={`Dismiss ${label} note`}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
