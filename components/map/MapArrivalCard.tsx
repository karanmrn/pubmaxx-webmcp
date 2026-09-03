"use client";

import { useEffect, useRef } from "react";
import { LocateFixed, X } from "lucide-react";

import {
  dismissMapFirstVisitArrival,
  setMapFirstVisitArrivalCardVisible,
} from "@/lib/mapFirstVisitArrival";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./mapArrivalCard.css";

export default function MapArrivalCard({
  onUseLocation,
  onChooseArea,
  onDismiss,
}: {
  onUseLocation: () => void;
  onChooseArea: () => void;
  onDismiss?: () => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMapFirstVisitArrivalCardVisible(true);
    return () => setMapFirstVisitArrivalCardVisible(false);
  }, []);

  // A live region announces a CHANGE to content already on screen. This card
  // arrives whole, with three actions on it, so it is a labelled landmark that
  // takes focus once instead - otherwise a screen reader read the heading, the
  // lead and all three buttons as one announcement and left the reader parked
  // on the map with no way to reach any of them. It only takes focus nobody
  // else holds: the card lands a second or two after paint, and pulling a
  // caret out of a field somebody is already typing in would be worse than
  // saying nothing.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    cardRef.current?.focus();
  }, []);

  const dismiss = () => {
    dismissMapFirstVisitArrival();
    onDismiss?.();
  };

  useDismissOnEscape(true, dismiss);

  return (
    <aside
      ref={cardRef}
      className="mapArrivalCard"
      aria-label="First visit"
      tabIndex={-1}
    >
      <button
        type="button"
        className="mapArrivalCardClose"
        aria-label="Close"
        onClick={dismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
      <p className="mapArrivalCardEyebrow">First visit</p>
      <h2 className="mapArrivalCardTitle">Cheapest pints near you?</h2>
      <p className="mapArrivalCardLead">
        Location is used only while the map is open. Or pick an area.
      </p>
      <div className="mapArrivalCardActions">
        <button
          type="button"
          className="mapArrivalCardPrimary"
          onClick={() => {
            dismissMapFirstVisitArrival();
            onUseLocation();
          }}
        >
          <LocateFixed size={16} aria-hidden="true" /> Use my location
        </button>
        <button
          type="button"
          className="mapArrivalCardSecondary"
          onClick={() => {
            dismissMapFirstVisitArrival();
            onChooseArea();
          }}
        >
          Choose an area
        </button>
      </div>
    </aside>
  );
}
