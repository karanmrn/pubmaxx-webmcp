"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, X } from "lucide-react";

import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import type { CityId } from "@/lib/cities";
import type { Locality } from "@/lib/localities";
import {
  filterChooseAreaNeighbourhoods,
  londonNeighbourhoodRows,
  otherCityRows,
  type ChooseAreaNeighbourhood,
} from "@/lib/mapAreaPicker";
import type { Venue } from "@/lib/venues";

import "./chooseAreaSheet.css";

export type ChooseAreaPick =
  | { kind: "near-me" }
  | { kind: "night-area"; row: ChooseAreaNeighbourhood }
  | { kind: "city"; cityId: CityId; name: string };

type ChooseAreaSheetProps = {
  cityId: CityId;
  venues: readonly Venue[];
  localities?: readonly Locality[];
  /** Areas whose shards have all landed, so their pub count is the whole truth. */
  completeCountSlugs?: ReadonlySet<string> | null;
  locationNote?: string | null;
  locationBusy?: boolean;
  onPick: (pick: ChooseAreaPick) => void;
};

function pubCountLabel(count: number): string {
  if (count === 1) return "1 pub";
  return `${count} pubs`;
}

export default function ChooseAreaSheet({
  cityId,
  venues,
  localities = [],
  completeCountSlugs = null,
  locationNote,
  locationBusy = false,
  onPick,
}: ChooseAreaSheetProps) {
  const [query, setQuery] = useState("");
  const neighbourhoods = useMemo(
    () => londonNeighbourhoodRows(venues, cityId, completeCountSlugs),
    [cityId, completeCountSlugs, venues],
  );
  const filtered = useMemo(
    () => filterChooseAreaNeighbourhoods(neighbourhoods, query, localities),
    [localities, neighbourhoods, query],
  );
  const cities = useMemo(() => otherCityRows(cityId), [cityId]);

  return (
    <div className="chooseAreaSheet">
      <div className="chooseAreaSearch">
        <label htmlFor="choose-area-search">Search areas and postcodes</label>
        <input
          id="choose-area-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Camden, N1, Willesden…"
          autoComplete="off"
        />
      </div>
      {locationNote ? <p className="chooseAreaNote">{locationNote}</p> : null}
      <section aria-labelledby="choose-area-london">
        <h3 id="choose-area-london" className="chooseAreaSectionTitle">
          London
        </h3>
        <ul className="chooseAreaList">
          <li>
            <button
              type="button"
              className="chooseAreaRow"
              disabled={locationBusy}
              onClick={() => onPick({ kind: "near-me" })}
            >
              <span className="chooseAreaRowName">
                <LocateFixed size={16} aria-hidden="true" />{" "}
                {locationBusy ? "Locating" : "Near me"}
              </span>
            </button>
          </li>
          {filtered.map((row) => (
            <li key={row.slug}>
              <button
                type="button"
                className="chooseAreaRow"
                onClick={() => onPick({ kind: "night-area", row })}
              >
                <span className="chooseAreaRowName">{row.name}</span>
                {row.pubCount !== null && row.pubCount > 0 ? (
                  <span className="chooseAreaRowMeta">{pubCountLabel(row.pubCount)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {cities.length > 0 ? (
        <section aria-labelledby="choose-area-cities">
          <h3 id="choose-area-cities" className="chooseAreaSectionTitle">
            Other cities
          </h3>
          <ul className="chooseAreaList">
            {cities.map((city) => (
              <li key={city.cityId}>
                <button
                  type="button"
                  className="chooseAreaRow"
                  onClick={() =>
                    onPick({ kind: "city", cityId: city.cityId, name: city.name })
                  }
                >
                  <span className="chooseAreaRowName">{city.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * The desktop shape of the same picker. It is a centred modal over a scrim
 * rather than a panel anchored to a visible trigger, so it owes more than the
 * outside dismiss it shipped with: Escape (lib/useDismissOnEscape.ts), focus
 * moved in on open and handed back on close, a named Close, and a Tab cycle
 * that keeps the keyboard inside the dialog it just covered the map with. The
 * phone path gets all of that from Sheet; this one had none of it.
 */
export function ChooseAreaDesktopDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useDismissOnEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  const cycleTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const node = dialogRef.current;
    if (!node) return;
    const stops = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null || element === node,
    );
    if (stops.length === 0) return;
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === node)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        type="button"
        className="chooseAreaDesktopScrim"
        aria-label="Close choose area"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="chooseAreaDesktop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choose-area-desktop-title"
        tabIndex={-1}
        onKeyDown={cycleTab}
      >
        <div className="chooseAreaDesktopHead">
          <h2 id="choose-area-desktop-title" className="chooseAreaSectionTitle">
            Choose an area
          </h2>
          <button
            type="button"
            className="chooseAreaDesktopClose"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
