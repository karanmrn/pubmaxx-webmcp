"use client";

import { PlusCircle } from "lucide-react";

import { formatPrice, type Venue } from "@/lib/venues";

// ponytail: cap the keyboard picker render; search narrows the rest.
const PICKER_LIMIT = 40;

type VenuePickerProps = {
  filteredVenues: Venue[];
  builtIds: string[];
  onSelectVenue: (id: string) => void;
  onToggleStop: (id: string) => void;
};

export default function VenuePicker({
  filteredVenues,
  builtIds,
  onSelectVenue,
  onToggleStop,
}: VenuePickerProps) {
  return (
    <section className="venuePicker">
      <div className="inspectorTitle">
        <PlusCircle size={16} />
        <span>Add stops</span>
      </div>
      <p className="description muted">
        Every filtered pub, keyboard-friendly. The map is optional. Use search and filters to
        narrow the list.
      </p>
      <ul className="venuePickerList">
        {filteredVenues.slice(0, PICKER_LIMIT).map((venue) => {
          const inCrawl = builtIds.includes(venue.id);
          return (
            <li key={venue.id}>
              <button
                type="button"
                aria-pressed={inCrawl}
                onClick={() => {
                  onSelectVenue(venue.id);
                  onToggleStop(venue.id);
                }}
              >
                <span>
                  <strong>{venue.name}</strong>
                  <small>
                    {formatPrice(venue.cheapestPrice)} ·{" "}
                    {venue.primaryBorough || venue.visibleBoroughs[0] || "London"}
                  </small>
                </span>
                <span className="pickAction">{inCrawl ? "Remove" : "Add"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {filteredVenues.length > PICKER_LIMIT ? (
        <small className="pickerNote">
          Showing {PICKER_LIMIT} of {filteredVenues.length}. Narrow the search to see more.
        </small>
      ) : null}
    </section>
  );
}
