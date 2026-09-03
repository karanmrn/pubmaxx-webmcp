"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";

import {
  DEFAULT_CITY_ID,
  listEnabledCities,
  type CityId,
} from "@/lib/cities";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";
import { trackEvent } from "@/lib/analytics";
import {
  UK_CHOOSE_CITY_SEARCH_HREF,
  UK_NATIONAL_ENTRY_LABEL,
  UK_NATIONAL_MAP_HREF,
} from "@/lib/ukNationalBrowse";

import "./citySwitcher.css";

export type CitySwitcherProps = {
  cityId?: CityId;
  variant?: "trigger" | "list";
  /** Keep a longer live area claim in the mobile map pill. */
  triggerLabel?: string;
  className?: string;
  /** Optional first row for the reader's own location. */
  onUseMyLocation?: () => void;
  locationBusy?: boolean;
  /** Open the map's current-area sheet from the city menu. */
  onOpenArea?: () => void;
  onClose?: () => void;
  /** Soften the trigger label when the camera is outside the priced city box. */
  outsideCurated?: boolean;
};

function cityShortLabel(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  }
  return displayName.trim().slice(0, 3).toUpperCase();
}

type CitySwitcherListProps = {
  cityId: CityId;
  listId: string;
  onUseMyLocation?: () => void;
  locationBusy: boolean;
  onOpenArea?: () => void;
  onClose?: () => void;
  outsideCurated: boolean;
};

function CitySwitcherList({
  cityId,
  listId,
  onUseMyLocation,
  locationBusy,
  onOpenArea,
  onClose,
  outsideCurated,
}: CitySwitcherListProps) {
  const cities = listEnabledCities();
  const current = cities.find((city) => city.id === cityId) ?? cities[0];
  if (!current) return null;

  return (
    <ul
      id={listId}
      className="citySwitcherList"
      role="listbox"
      aria-label="Choose city map"
    >
      {onUseMyLocation ? (
        <li role="option" aria-selected={false} className="citySwitcherLocation">
          <button
            type="button"
            className="citySwitcherLink citySwitcherLocationLink"
            disabled={locationBusy}
            onClick={() => {
              onClose?.();
              onUseMyLocation();
            }}
          >
            <LocateFixed size={16} aria-hidden="true" />
            <span>{locationBusy ? "Locating" : "Use my location"}</span>
          </button>
        </li>
      ) : null}
      {onOpenArea ? (
        <li role="option" aria-selected={false} className="citySwitcherArea">
          <button
            type="button"
            className="citySwitcherLink citySwitcherAreaLink"
            onClick={() => {
              onClose?.();
              onOpenArea();
            }}
          >
            This area
          </button>
        </li>
      ) : null}
      {cities.map((city) => {
        const selected = city.id === current.id && !outsideCurated;
        return (
          <li key={city.id} role="option" aria-selected={selected}>
            <Link
              href={cityMapShareUrl(city.id)}
              className={selected ? "citySwitcherLink isActive" : "citySwitcherLink"}
              onClick={() => {
                writePreferredCity(city.id);
                onClose?.();
                if (city.id !== current.id) trackEvent("map_area_switched");
              }}
            >
              {city.displayName}
            </Link>
          </li>
        );
      })}
      <li role="option" aria-selected={false} className="citySwitcherNational">
        <Link
          href={UK_NATIONAL_MAP_HREF}
          className="citySwitcherLink citySwitcherNationalLink"
          onClick={() => onClose?.()}
        >
          {UK_NATIONAL_ENTRY_LABEL}
        </Link>
        <Link
          href={UK_CHOOSE_CITY_SEARCH_HREF}
          className="citySwitcherLink citySwitcherNationalLink"
          onClick={() => onClose?.()}
        >
          Search a UK town
        </Link>
      </li>
    </ul>
  );
}

function CitySwitcherTrigger({
  cityId,
  triggerLabel,
  className,
  onUseMyLocation,
  locationBusy = false,
  onOpenArea,
  outsideCurated = false,
}: CitySwitcherProps) {
  const cities = listEnabledCities();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = cities.find((city) => city.id === cityId) ?? cities[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (cities.length < 2 || !current) return null;

  // A chosen area is a NAME, and the chip's own sentence is a claim about it.
  // The three-letter city code is the plain city's affordance for a narrow
  // desktop; it may not stand in for an area, because "CAM" is not contained in
  // "Map area: Camden", so a voice-control reader would say the wrong word and
  // the reader who picked Camden would still be looking at LON.
  //
  // The question is whether the label names something OTHER than this city, not
  // whether a label was supplied: the map hands one down on every render and it
  // falls back to the city's own display name, so "a label exists" would answer
  // yes always and retire the code even when nobody has chosen anything.
  const suppliedLabel = triggerLabel?.trim() ?? "";
  const namedArea =
    suppliedLabel && suppliedLabel !== current.displayName ? suppliedLabel : null;

  return (
    <div
      ref={rootRef}
      className={`${className ?? ""} ${
        open ? "citySwitcher isOpen" : "citySwitcher"
      }${namedArea ? " citySwitcher--named" : ""}`.trim()}
    >
      <button
        type="button"
        className="citySwitcherTrigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Map area: ${namedArea ?? current.displayName}. Change city`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="citySwitcherLabel citySwitcherLabelFull">
          {namedArea ?? current.displayName}
        </span>
        {namedArea ? null : (
          <span className="citySwitcherLabel citySwitcherLabelShort" aria-hidden="true">
            {cityShortLabel(current.displayName)}
          </span>
        )}
        <span className="citySwitcherCaret" aria-hidden="true" />
      </button>
      {open ? (
        <CitySwitcherList
          cityId={current.id}
          listId={listId}
          onUseMyLocation={onUseMyLocation}
          locationBusy={locationBusy}
          onOpenArea={onOpenArea}
          onClose={() => setOpen(false)}
          outsideCurated={outsideCurated ?? false}
        />
      ) : null}
    </div>
  );
}

/**
 * Compact city picker for map chrome. The list variant is also used inside the
 * mobile Area sheet, so it has no router hook and remains renderable in tests.
 */
export default function CitySwitcher(props: CitySwitcherProps) {
  const {
    cityId = DEFAULT_CITY_ID,
    variant = "trigger",
    locationBusy = false,
    outsideCurated = false,
    onUseMyLocation,
    onClose,
    onOpenArea,
  } = props;

  if (variant === "list") {
    return (
      <div className="citySwitcher citySwitcher--list">
        <CitySwitcherList
          cityId={cityId}
          listId="citySwitcherList"
          onUseMyLocation={onUseMyLocation}
          locationBusy={locationBusy}
          onOpenArea={onOpenArea}
          onClose={onClose}
          outsideCurated={outsideCurated}
        />
      </div>
    );
  }

  return <CitySwitcherTrigger {...props} cityId={cityId} locationBusy={locationBusy} outsideCurated={outsideCurated} />;
}
