"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { LocateFixed } from "lucide-react";
import CitySwitcher from "@/components/map/CitySwitcher";

import type { CityId } from "@/lib/cities";
import {
  AREA_SHEET_LEAD_ROWS,
  areaElsewhereOptions,
  areaSheetOverflowLabel,
  cheapestDrinksInArea,
  cheapestDrinksNearPoint,
  type AreaDistanceFrom,
  type AreaElsewhereOption,
} from "@/lib/areaButton";
import { drinkLaneLogInvite, drinkLaneNoun } from "@/lib/drinkLanes";
import { CATEGORY_META, type DrinkCategory } from "@/lib/drinks";
import type { NightArea } from "@/lib/nightAreas";
import {
  drinkLensCoverageNote,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import type { Venue } from "@/lib/venues";

import "./areaSheet.css";

/**
 * An ad-hoc place (a locality or borough a map search flew to) that is NOT one
 * of the modelled Night Areas: the sheet derives its pubs from a walkable ring
 * around this centroid instead of an area's own region. When set it takes
 * precedence over `area`, and the header names this place.
 */
export type AreaSheetPlaceFocus = {
  name: string;
  /** [lng, lat] the map flew to — the ring centre + distance origin. */
  center: [number, number];
  radiusKm: number;
};

// Body of the map's Area sheet (the house bottom Sheet the mobile top-bar Area
// button opens). Two sections: the current area's cheapest pints, and a "go
// somewhere else" grid of the modelled areas. All the logic lives in
// lib/areaButton.ts — this is a thin, hermetic render over those models.
//
// The price list prints a LEAD of AREA_SHEET_LEAD_ROWS rows, not all ten, so
// the picker below it stays on the first screen. See that constant for why.
type AreaSheetProps = {
  cityId: CityId;
  /** The Night Area under the map centre, or null before the map settles. */
  area: NightArea | null;
  /** A searched locality/borough to show instead of `area` — the ad-hoc ring.
   *  null (the Area button) keeps the modelled `area` behaviour. */
  placeFocus?: AreaSheetPlaceFocus | null;
  /** Full on-map venue set (unfiltered) — the price pins the map loaded. */
  venues: Venue[];
  /** Trusted prices for selected non-pint drink, or null for pint default. */
  lensPrices?: ReadonlyMap<string, MapLensPrice> | null;
  /**
   * The drink lane the map is under, or null for the pint default. ONE prop,
   * because this sheet needs the drink twice and in two shapes: the menu-section
   * label beside a figure ("Cocktails") and the singular sentence noun before
   * the word price ("No cocktail prices in this area yet"). Two caller-supplied
   * words could disagree, and a heading naming one drink over a list of another
   * is worse than either word alone.
   */
  drinkCategory?: DrinkCategory | null;
  /** How complete the selected drink's cross-venue read was. A failed or
   *  truncated index may never be rendered as "none here yet". */
  lensStatus?: CategoryPriceIndexStatus;
  /**
   * The point every row distance is measured from, carried with WHOSE point it
   * is. A granted location makes it the reader's, and only then may a row say
   * "away"; otherwise it is the live map centre and the row says so. The two
   * travel together so a reader-measured row can never be worded as a
   * map-measured one, or the other way about.
   */
  distanceFrom: AreaDistanceFrom;
  /** Fly + open a pub's venue card — the same selection a pin tap drives. */
  onSelectVenue: (id: string) => void;
  /** Fly the map to another area's centre (reduced-motion safe in the canvas). */
  onFlyToArea: (option: AreaElsewhereOption) => void;
  /**
   * Hand the map the reader's real location. This is the map's ONE Near me
   * path (PubMap's showNearbyMap), passed in rather than repeated here: a
   * second getCurrentPosition would be a second set of request options, a
   * second timeout, and a second story about what went wrong. Omit it and the
   * action is not offered, which is right for any host that cannot locate.
   */
  onUseMyLocation?: () => void;
  /** That request is running. The action waits rather than firing twice. */
  locationBusy?: boolean;
  /**
   * Why the last location request could not place the reader, already worded
   * by lib/nearMeLocation.ts. The sheet prints it and writes none of its own.
   * Every one of those sentences names picking an area as the way on, and the
   * picker is the next thing under it.
   */
  locationNote?: string | null;
  /**
   * Camera is outside the priced city pack (UK base layer is primary). Soften
   * cheapest-pint empty promises; never invent prices for the base map.
   */
  baseLed?: boolean;
  /** Close the sheet (the map is already in view). */
  onClose: () => void;
};

// The sheet lingers one beat after a "go somewhere else" tap so the fly reads,
// then closes itself.
const AREA_HOP_CLOSE_MS = 900;

/**
 * Why this list is empty, in the reader's terms. Five different findings, and
 * they are five different sentences: the base map is not loaded in, no area is
 * under the camera yet, the drink's index did not finish, or the area really
 * has no price for this drink. Only the last is a fact about the place.
 */
/**
 * The lane's two words. The label heads the list and tags a figure ("Cocktails"),
 * the noun goes inside a sentence about a price ("No cocktail prices here yet").
 * Both come off the one lane table, so a heading can never name a different
 * drink from the sentence under it.
 */
function areaSheetDrinkWords(category: DrinkCategory | null): {
  label: string;
  noun: string;
} {
  if (!category) return { label: "Pints", noun: "pint" };
  return { label: CATEGORY_META[category].label, noun: drinkLaneNoun(category) };
}

function areaSheetEmptyNote(input: {
  baseLed: boolean;
  hasFocus: boolean;
  isPlace: boolean;
  coverageNote: string | null;
  drinkPlural: string;
  drinkNoun: string;
}): string {
  if (input.baseLed) {
    return "Zoom in to load pubs. Prices only where people have logged them.";
  }
  if (!input.hasFocus) {
    return `Pan the map over an area to see its cheapest ${input.drinkPlural}.`;
  }
  if (input.coverageNote) return "Try somewhere else below.";
  const where = input.isPlace ? "nearby" : "in this area";
  return `No ${input.drinkNoun} prices ${where} yet. Try somewhere else below.`;
}

export default function AreaSheet({
  cityId,
  area,
  placeFocus = null,
  venues,
  lensPrices = null,
  drinkCategory = null,
  lensStatus = "ready",
  distanceFrom,
  onSelectVenue,
  onFlyToArea,
  onUseMyLocation,
  locationBusy = false,
  locationNote = null,
  baseLed = false,
  onClose,
}: AreaSheetProps) {
  const closeTimer = useRef<number | null>(null);
  const elsewhere = useMemo(() => areaElsewhereOptions(cityId), [cityId]);
  const drinkWords = useMemo(
    () => areaSheetDrinkWords(drinkCategory),
    [drinkCategory],
  );
  const drinkLabel = drinkWords.label;
  const drinkNoun = drinkWords.noun;
  // A searched locality/borough (placeFocus) derives its pubs from a walkable
  // ring around its centroid; otherwise the modelled area under the map centre
  // owns the list. The name shown in the header follows the same precedence.
  const pubs = useMemo(
    () =>
      placeFocus
        ? cheapestDrinksNearPoint(
            placeFocus.center,
            venues,
            placeFocus.radiusKm,
            undefined,
            lensPrices,
            drinkLabel,
            lensStatus,
          )
        : area
          ? cheapestDrinksInArea(
              area,
              venues,
              distanceFrom,
              undefined,
              lensPrices,
              drinkLabel,
              lensStatus,
            )
          : [],
    [placeFocus, area, venues, distanceFrom, lensPrices, drinkLabel, lensStatus],
  );
  // The lead the sheet prints. The rest stay on the map, and the row below the
  // lead says how many they are.
  const leadPubs = useMemo(
    () => pubs.slice(0, AREA_SHEET_LEAD_ROWS),
    [pubs],
  );
  const focusName = placeFocus?.name ?? area?.name ?? null;
  // What the LIST is called, and what a sentence about a price calls the same
  // drink. "Cheapest cocktails here" heads a list; "No cocktail prices" states
  // a fact. Neither word can do the other's job.
  const drinkPlural = lensPrices === null ? "pints" : drinkLabel.toLowerCase();
  // The rows below list unpriced pubs too, so an index that failed or was cut
  // short would otherwise read as a settled "none here". Say which it was.
  const coverageNote =
    lensPrices === null ? null : drinkLensCoverageNote(drinkNoun, lensStatus);
  // An empty lane is where this map grows, so it says how. Only after a read
  // that answered: inviting a contribution off our own failed lookup would
  // claim an emptiness we never established.
  const logInvite = drinkLaneLogInvite(drinkNoun, lensStatus);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const pickPub = useCallback(
    (id: string) => {
      clearCloseTimer();
      onSelectVenue(id);
      onClose();
    },
    [clearCloseTimer, onClose, onSelectVenue],
  );

  const hopToArea = useCallback(
    (option: AreaElsewhereOption) => {
      onFlyToArea(option);
      clearCloseTimer();
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        onClose();
      }, AREA_HOP_CLOSE_MS);
    },
    [clearCloseTimer, onClose, onFlyToArea],
  );

  return (
    <div className="areaSheet">
      <section
        className="areaSheetSection"
        aria-label={
          baseLed
            ? "Pubs in this area"
            : `Cheapest ${drinkPlural} in this area`
        }
      >
        <h3 className="areaSheetHeading">
          {baseLed
            ? focusName
              ? `Pubs around ${focusName}`
              : "Pubs on the base map"
            : focusName
              ? `Cheapest ${drinkPlural} in ${focusName}`
              : `Cheapest ${drinkPlural} here`}
        </h3>
        {coverageNote && !baseLed ? (
          <p className="areaSheetEmpty areaSheetCoverage" role="status">
            {coverageNote}
          </p>
        ) : null}
        {focusName && pubs.length > 0 && !baseLed ? (
          <ul className="areaSheetList">
            {leadPubs.map((pub) => (
              <li key={pub.id}>
                <button
                  type="button"
                  className="areaSheetPub"
                  onClick={() => pickPub(pub.id)}
                >
                  <span className="areaSheetPubName">{pub.name}</span>
                  <span className="areaSheetPubMeta">
                    <span
                      className={
                        pub.price !== null
                          ? "areaSheetPrice"
                          : "areaSheetPrice isUnpriced"
                      }
                    >
                      {pub.priceLabel}
                    </span>
                    {pub.distanceLabel ? (
                      <span className="areaSheetDistance">{pub.distanceLabel}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="areaSheetSeeAll" onClick={onClose}>
                {areaSheetOverflowLabel(pubs.length)}
              </button>
            </li>
          </ul>
        ) : (
          <p className="areaSheetEmpty">
            {areaSheetEmptyNote({
              baseLed,
              hasFocus: Boolean(placeFocus || area),
              isPlace: Boolean(placeFocus),
              coverageNote,
              drinkPlural,
              drinkNoun,
            })}
          </p>
        )}
        {/* An area with no price for the chosen drink is not a dead end, and
            the way out of it is a drinker at a bar. One line, under the empty
            state it belongs to, and never beside a list that already answered. */}
        {!baseLed && pubs.length === 0 && (placeFocus || area) && logInvite ? (
          <p className="areaSheetEmpty areaSheetInvite">{logInvite}</p>
        ) : null}
      </section>

      <section className="areaSheetSection" aria-label="Go somewhere else">
        <h3 className="areaSheetHeading">Go somewhere else</h3>
        {/* The reader's own spot is the first way out, above the twenty fixed
            choices: /plan and /near both offer it, and a reader whose Near me
            just failed arrives here looking for exactly this. */}
        {onUseMyLocation ? (
          <button
            type="button"
            className="areaSheetLocate"
            disabled={locationBusy}
            onClick={onUseMyLocation}
          >
            <LocateFixed size={17} aria-hidden="true" />
            <span>{locationBusy ? "Locating" : "Use my location"}</span>
          </button>
        ) : null}
        {onUseMyLocation && locationNote ? (
          <p className="areaSheetLocateNote">{locationNote}</p>
        ) : null}
        <h4 className="areaSheetSubheading">City maps</h4>
        <CitySwitcher
          cityId={cityId}
          variant="list"
          onClose={onClose}
        />
        <ul className="areaSheetGrid">
          {elsewhere.map((option) => {
            const isCurrent = option.slug === area?.slug;
            return (
              <li key={option.slug}>
                <button
                  type="button"
                  className={isCurrent ? "areaSheetChip isCurrent" : "areaSheetChip"}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => hopToArea(option)}
                >
                  <span className="areaSheetChipName">{option.name}</span>
                  {option.coverage ? (
                    <span
                      className="areaSheetChipCoverage"
                      data-tone={option.coverage.tone}
                    >
                      {option.coverage.label}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
