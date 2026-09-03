import { X } from "lucide-react";

import {
  formatLogNearbyDistance,
  type LogNearbyCandidate,
  type LogNearbyOriginSource,
} from "@/lib/mapLogIntent";

// Log-drop fallback panel: shown when a ?log= arrival can't auto-pick a venue.
// Offers the nearby-pub list, a search action, and a "show all pubs" escape
// when filters hide everything.
// Global CSS (logIntentFallback / logIntent*) is already imported by PubMap.
// Extracted verbatim from PubMap (F1); the logIntentFallbackVisible guard
// stays in PubMap. Owns formatLogNearbyDistance.
//
// D1 — the list names its own origin. `origin` says what the order is measured
// from: the reader's GPS fix, or the centre of the map they are looking at.
// With neither, there is no list and the panel leads with search and the map.
export function LogIntentFallback({
  candidates,
  origin,
  filteredPubVenueCount,
  onPickVenue,
  onPrefetchVenue,
  onFocusSearch,
  onResetFilters,
  onDismiss,
}: {
  candidates: LogNearbyCandidate[];
  origin: LogNearbyOriginSource | null;
  filteredPubVenueCount: number;
  onPickVenue: (id: string) => void;
  onPrefetchVenue: (id: string) => void;
  onFocusSearch: () => void;
  onResetFilters: () => void;
  /** D4 — the desktop panel's own way out. The phone sheet already has one. */
  onDismiss?: () => void;
}) {
  const listed = candidates.length > 0 && origin !== null;
  return (
    <div className="logIntentFallback" role="status" aria-live="polite">
      <div>
        <div className="logIntentHead">
          <strong>Pick a pub to log a Pint Drop</strong>
          {onDismiss ? (
            <button
              type="button"
              className="logIntentClose"
              onClick={onDismiss}
              aria-label="Close the pub picker"
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p className="description">
          {!listed
            ? "We won’t guess which pub you’re in. Search for it, or tap it on the map. Then we’ll open the Pint Drop composer."
            : origin === "user"
              ? "Nearest pubs to you first. Choose one, search, or tap the map. Then we’ll open the Pint Drop composer."
              : "Nearest pubs to the map centre. Choose one, search, or tap the map. Then we’ll open the Pint Drop composer."}
        </p>
      </div>
      {listed ? (
        /* U6e — only claim "nearby" when we actually have a location fix;
           the map-centre order names the map instead. */
        <ul
          className="logIntentNearbyList"
          aria-label={origin === "user" ? "Nearby pubs to log" : "Pubs near the map centre"}
        >
          {candidates.map((candidate) => {
            const dist =
              typeof candidate.distanceKm === "number" &&
              Number.isFinite(candidate.distanceKm)
                ? formatLogNearbyDistance(candidate.distanceKm)
                : "";
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="logIntentNearbyBtn"
                  onClick={() => onPickVenue(candidate.id)}
                  onPointerEnter={() => onPrefetchVenue(candidate.id)}
                  onTouchStart={() => onPrefetchVenue(candidate.id)}
                >
                  <span>{candidate.name}</span>
                  <span className="logIntentNearbyMeta">
                    {dist ? <span className="logIntentNearbyDist">{dist}</span> : null}
                    <span>{candidate.priceLabel}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="logIntentActions">
        <button type="button" className="addStopBtn" onClick={onFocusSearch}>
          Search pubs
        </button>
        {filteredPubVenueCount === 0 ? (
          <button type="button" className="addStopBtn" onClick={onResetFilters}>
            Show all pubs
          </button>
        ) : null}
      </div>
    </div>
  );
}
