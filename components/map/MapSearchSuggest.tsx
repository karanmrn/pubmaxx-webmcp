"use client";

import { MapPin } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";

import { SearchField } from "@/components/ui/search-field";
import { trackEvent } from "@/lib/analytics";
import { listEnabledCities, type CityId } from "@/lib/cities";
import {
  loadMapSearchIndex,
} from "@/lib/mapSearchIndexLoader";
import {
  searchMapSearchIndex,
  type MapSearchIndex,
  type MapSearchIndexResult,
} from "@/lib/mapSearchIndex";
import {
  buildMapSearchSuggestions,
  type AreaSuggestion,
  type MapSearchAreaOption,
  type PlaceSuggestion,
  type PubSuggestion,
  type UkBasePubSuggestion,
  UK_BASE_SEARCH_GROUP_LABEL,
  UK_PLACE_SEARCH_GROUP_LABEL,
} from "@/lib/mapSearchSuggest";
import type { Locality } from "@/lib/localities";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { UkPlace } from "@/lib/ukPlaceSearch";
import type { Venue } from "@/lib/venues";
import CompactVenuePrice from "@/components/map/CompactVenuePrice";

import "./mapSearchSuggest.css";

// The map's as-you-type search: the house SearchField plus a suggestions popup
// beneath it, listing matching AREAS (the modelled areas + boroughs) and PUBS,
// each with an honest distance from the viewer (or the map centre). This is the
// same search surface PubMap already owns — same filters.query, same
// selectVenue fly, same flyToArea camera — extended, not forked.
//
// aria-combobox pattern: the input is the combobox, the panel is its listbox,
// options are addressed by aria-activedescendant so focus never leaves the
// input. Desktop gets arrow-key + Enter navigation; a tap works everywhere.

type FlatItem =
  | { type: "city"; item: Extract<MapSearchIndexResult, { kind: "city" }> }
  | { type: "indexedVenue"; item: Extract<MapSearchIndexResult, { kind: "venue" }> }
  | { type: "area"; item: AreaSuggestion }
  | { type: "pub"; item: PubSuggestion }
  | { type: "place"; item: PlaceSuggestion }
  | { type: "ukBase"; item: UkBasePubSuggestion };

const NO_RESULTS_MESSAGE = "Nothing matching that. Try a pub name or an area.";
const NO_RESULTS_ANNOUNCE_DELAY_MS = 300;

export type MapSearchSuggestProps = {
  id: string;
  mode?: "overlay" | "toolbar";
  cityId: CityId;
  query: string;
  onQueryChange: (query: string) => void;
  venues: Venue[];
  /** Greater London locality gazetteer; [] for other cities / before it loads. */
  localities: Locality[];
  /**
   * National place index (places.json). [] until the shell finishes loading it —
   * the UK places group then simply does not show.
   */
  places?: readonly UkPlace[];
  /**
   * When false, skip modelled areas / localities / boroughs / curated pubs so a
   * national or uncovered arrival answers with places + resident base pubs.
   */
  includeLocalResults?: boolean;
  /**
   * UK base pubs currently resident from the streamer. [] below the zoom gate
   * or before the first shard lands — the base group then simply does not show.
   */
  ukBasePubs?: readonly UkBasePub[];
  userLocation: { lat: number; lng: number } | null;
  mapCenter: [number, number];
  placeholder: string;
  /** Fly + open a pub's venue card (the same select a pin tap drives). */
  onSelectVenue: (id: string, cityId?: CityId) => void;
  /**
   * Open an unverified UK base pub sheet. Same seam MapVenueList uses; the
   * whole record rides because base pubs exist in no venue index.
   */
  onSelectUkBasePub?: (pub: UkBasePub) => void;
  /**
   * Navigate to a UK place or curated city guide (same hrefs as /choose-city).
   * The full suggestion rides so the shell can fly in-place when already on
   * that city guide.
   */
  onSelectPlace?: (place: PlaceSuggestion) => void;
  /** Switch to a city selected from the local search index. */
  onSelectCity?: (cityId: CityId) => void;
  /** Fly the map to an area/borough centre (reduced-motion safe in the canvas). */
  onFlyToArea: (option: MapSearchAreaOption) => void;
  /** Enter with nothing highlighted and no suggestions: keep the old behaviour. */
  onSubmitQuery?: () => void;
  /** Escape on the field: close the search overlay. */
  onClose?: () => void;
};

export default function MapSearchSuggest({
  id,
  mode = "overlay",
  cityId,
  query,
  onQueryChange,
  venues,
  localities,
  places = [],
  includeLocalResults = true,
  ukBasePubs = [],
  userLocation,
  mapCenter,
  placeholder,
  onSelectVenue,
  onSelectUkBasePub,
  onSelectPlace,
  onSelectCity,
  onFlyToArea,
  // onSubmitQuery intentionally not used: zero-result Enter keeps the miss
  // empty state open (hits use activate). Prop stays on the type for callers.
  onClose,
}: MapSearchSuggestProps) {

  const listboxId = useId();
  const emptyStateId = useId();
  const optionId = useCallback((index: number) => `${listboxId}-opt-${index}`, [listboxId]);
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const [announcedQuery, setAnnouncedQuery] = useState("");
  const lastAnnouncedQuery = useRef("");
  const closeToolbarPanel = useCallback(() => {
    if (mode !== "toolbar") return;
    setToolbarFocused(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [mode]);

  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 80);
    return () => window.clearTimeout(timer);
  }, [query]);
  const deferredQuery = useDeferredValue(debouncedQuery);
  const [searchIndex, setSearchIndex] = useState<MapSearchIndex | null>(null);
  const [searchIndexLoading, setSearchIndexLoading] = useState(false);
  const searchIndexPromiseRef = useRef<Promise<MapSearchIndex | null> | null>(null);
  const ensureSearchIndex = useCallback(() => {
    if (searchIndex || searchIndexPromiseRef.current) return;
    setSearchIndexLoading(true);
    const pending = loadMapSearchIndex({
      currentCityId: cityId,
      currentVenues: venues,
    })
      .then((index) => {
        setSearchIndex(index);
        return index;
      })
      .catch(() => null)
      .finally(() => {
        searchIndexPromiseRef.current = null;
        setSearchIndexLoading(false);
      });
    searchIndexPromiseRef.current = pending;
  }, [cityId, searchIndex, venues]);

  useEffect(() => {
    if (mode === "overlay") ensureSearchIndex();
  }, [cityId, ensureSearchIndex, mode]);

  const suggestions = useMemo(
    () =>
      buildMapSearchSuggestions({
        cityId,
        query: deferredQuery,
        venues,
        localities,
        places,
        includeLocalResults,
        ukBasePubs,
        userLocation,
        mapCenter,
      }),
    [
      cityId,
      deferredQuery,
      venues,
      localities,
      places,
      includeLocalResults,
      ukBasePubs,
      userLocation,
      mapCenter,
    ],
  );

  const indexedResults = useMemo(
    () => {
      const cityOnlyIndex = {
        cities: listEnabledCities().map((city) => ({
          id: city.id,
          name: city.displayName,
        })),
        venues: [],
      } satisfies MapSearchIndex;
      const cityResults = searchMapSearchIndex(cityOnlyIndex, deferredQuery);
      const venueResults = searchIndex
        ? searchMapSearchIndex(searchIndex, deferredQuery).filter(
            (result) => result.kind === "venue",
          )
        : [];
      return [...cityResults, ...venueResults];
    },
    [deferredQuery, searchIndex],
  );
  const indexedCities = useMemo(
    () => indexedResults.filter((result): result is Extract<MapSearchIndexResult, { kind: "city" }> => result.kind === "city"),
    [indexedResults],
  );
  const indexedVenues = useMemo(() => {
    const localVenueIds = new Set(suggestions.pubs.map((pub) => pub.id));
    return indexedResults.filter(
      (result): result is Extract<MapSearchIndexResult, { kind: "venue" }> =>
        result.kind === "venue" &&
        (result.cityId !== cityId || !localVenueIds.has(result.id)),
    );
  }, [cityId, indexedResults, suggestions.pubs]);

  const mergedUkBasePubs = useMemo(() => {
    return suggestions.ukBasePubs.slice(0, 12);
  }, [suggestions.ukBasePubs]);

  const items = useMemo<FlatItem[]>(
    () => [
      ...indexedCities.map((item) => ({ type: "city" as const, item })),
      ...suggestions.areas.map((item) => ({ type: "area" as const, item })),
      ...indexedVenues.map((item) => ({ type: "indexedVenue" as const, item })),
      ...suggestions.pubs.map((item) => ({ type: "pub" as const, item })),
      ...suggestions.places.map((item) => ({ type: "place" as const, item })),
      ...mergedUkBasePubs.map((item) => ({ type: "ukBase" as const, item })),
    ],
    [indexedCities, indexedVenues, mergedUkBasePubs, suggestions],
  );

  const [activeIndex, setActiveIndex] = useState(-1);
  // Keyboard events can arrive before React commits the previous highlight.
  // Keep the event-time value synchronous so ArrowDown then Enter activates
  // the row a keyboard user just chose, not the first stale render-time row.
  const activeIndexRef = useRef(-1);
  const chooseActiveIndex = useCallback((next: number) => {
    activeIndexRef.current = next;
    setActiveIndex(next);
  }, []);
  // The list underneath can shrink between renders (fewer matches); clamp the
  // highlight to what still exists so aria-activedescendant never dangles.
  const safeActive = activeIndex >= 0 && activeIndex < items.length ? activeIndex : -1;

  // Typing invalidates the highlight — reset it in the change handler (an event,
  // never an effect) so the list and its active row can't drift out of sync.
  const changeQuery = useCallback(
    (next: string) => {
      ensureSearchIndex();
      chooseActiveIndex(-1);
      if (mode === "toolbar") setToolbarFocused(true);
      onQueryChange(next);
    },
    [chooseActiveIndex, ensureSearchIndex, mode, onQueryChange],
  );

  const trimmed = query.trim();
  const deferredTrimmed = deferredQuery.trim();
  const querySettled = deferredTrimmed === trimmed;
  // Panel stays present for a typed miss so the combobox never collapses into a
  // silent empty state. Toolbar search still closes when focus deliberately
  // leaves the search surface; overlay search remains open until Escape/X.
  const panelEnabled = mode === "overlay" || toolbarFocused;
  const showPanel = panelEnabled && (trimmed.length > 0 || items.length > 0);
  const hasResults =
    suggestions.hasResults ||
    indexedCities.length > 0 ||
    indexedVenues.length > 0 ||
    mergedUkBasePubs.length > 0;
  const showEmptyLine =
    showPanel &&
    trimmed.length > 0 &&
    querySettled &&
    !searchIndexLoading &&
    !hasResults;

  useEffect(() => {
    if (!showEmptyLine) {
      if (trimmed.length === 0 || hasResults) lastAnnouncedQuery.current = "";
      return;
    }

    const normalized = deferredTrimmed.toLocaleLowerCase();
    if (lastAnnouncedQuery.current === normalized) return;

    const timer = window.setTimeout(() => {
      lastAnnouncedQuery.current = normalized;
      setAnnouncedQuery(normalized);
      // Fixed-schema, zero-property event: raw search text never enters telemetry.
      trackEvent("map_search_no_results");
    }, NO_RESULTS_ANNOUNCE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [deferredTrimmed, hasResults, showEmptyLine, trimmed.length]);

  const activate = useCallback(
    (entry: FlatItem | undefined) => {
      if (!entry) return;
      trackEvent("map_search_jump");
      if (entry.type === "city") {
        onSelectCity?.(entry.item.id);
        closeToolbarPanel();
        return;
      }
      if (entry.type === "indexedVenue") {
        onSelectVenue(entry.item.id, entry.item.cityId);
        closeToolbarPanel();
        return;
      }
      if (entry.type === "pub") {
        onSelectVenue(entry.item.id);
        closeToolbarPanel();
      } else if (entry.type === "ukBase") {
        // Prefer the dedicated seam (sets selectedBasePub + selectVenue) so the
        // unverified sheet opens; fall back to id-only select when unwired.
        if (onSelectUkBasePub) onSelectUkBasePub(entry.item.pub);
        else onSelectVenue(entry.item.id);
        closeToolbarPanel();
      } else if (entry.type === "place") {
        onSelectPlace?.(entry.item);
        closeToolbarPanel();
      } else {
        const { item } = entry;
        onFlyToArea({
          slug: item.slug,
          name: item.name,
          center: item.center,
          coverage: item.coverage,
          zoom: item.flyZoom,
          kind: item.kind,
          areaNewsArea: item.areaNewsArea,
        });
        closeToolbarPanel();
      }
    },
    [closeToolbarPanel, onFlyToArea, onSelectCity, onSelectPlace, onSelectUkBasePub, onSelectVenue],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const eventActive =
        activeIndexRef.current >= 0 && activeIndexRef.current < items.length
          ? activeIndexRef.current
          : -1;
      if (event.key === "ArrowDown" && items.length > 0) {
        event.preventDefault();
        chooseActiveIndex((eventActive + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp" && items.length > 0) {
        event.preventDefault();
        chooseActiveIndex(eventActive <= 0 ? items.length - 1 : eventActive - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (items.length > 0) {
          activate(eventActive >= 0 ? items[eventActive] : items[0]);
          return;
        }
        // Zero-result miss: keep the panel + empty state open and leave focus
        // on the combobox. Do not fire onSubmitQuery (that path flies/clears
        // and would hide the honest "nothing matching" message).
        return;
      }
      if (event.key === "Escape") {
        // Always preventDefault: type=search natively clears the value on Escape,
        // which would re-fire changeQuery, re-open the toolbar panel, and flash
        // the empty-query "nearby areas" prompt instead of a clean dismiss.
        event.preventDefault();
        if (eventActive >= 0) {
          chooseActiveIndex(-1);
          return;
        }
        if (mode === "toolbar") {
          setToolbarFocused(false);
          return;
        }
        onClose?.();
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[aria-label="Search the map"]')?.focus();
        });
      }
    },
    [activate, chooseActiveIndex, items, mode, onClose],
  );

  const areaStartIndex = indexedCities.length;
  const indexedVenueStartIndex = areaStartIndex + suggestions.areas.length;
  const pubStartIndex = indexedVenueStartIndex + indexedVenues.length;
  const placeStartIndex = pubStartIndex + suggestions.pubs.length;
  const ukBaseStartIndex = placeStartIndex + suggestions.places.length;
  const originNote =
    suggestions.origin === "user" ? "Distances from you" : "Distances from the map centre";
  const liveAnnouncement =
    showEmptyLine && announcedQuery === deferredTrimmed.toLocaleLowerCase() ? NO_RESULTS_MESSAGE : "";

  return (
    <div className={`mapSearchSuggest mapSearchSuggest--${mode}`}>
      <SearchField
        id={id}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-describedby={showEmptyLine ? emptyStateId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={safeActive >= 0 ? optionId(safeActive) : undefined}
        value={query}
        onChange={changeQuery}
        onFocus={() => {
          setToolbarFocused(true);
          ensureSearchIndex();
        }}
        onBlur={() => {
          if (mode === "toolbar") setToolbarFocused(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-busy={!querySettled || searchIndexLoading}
        autoFocus={mode === "overlay"}
      />

      {showPanel ? (
        <div className="mapSearchSuggestPanel">
          <div id={listboxId} role="listbox" aria-label="Search suggestions" className="mapSearchSuggestScroll">
            {indexedCities.length > 0 ? (
              <div role="group" aria-label="Cities" className="mapSearchSuggestGroup">
                <p className="mapSearchSuggestGroupHead">
                  <span>Cities</span>
                </p>
                {indexedCities.map((city, offset) => {
                  const index = offset;
                  return (
                    <div
                      key={city.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={safeActive === index}
                      className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => activate({ type: "city", item: city })}
                      onPointerEnter={() => chooseActiveIndex(index)}
                    >
                      <span className="mapSearchSuggestRowMain">
                        <MapPin size={15} aria-hidden="true" className="mapSearchSuggestRowIcon" />
                        <span className="mapSearchSuggestRowName">{city.name}</span>
                        <span className="mapSearchSuggestBorough">City map</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {suggestions.areas.length > 0 ? (
              <div role="group" aria-label="Areas" className="mapSearchSuggestGroup">
                <p className="mapSearchSuggestGroupHead">
                  <span>Areas</span>
                  <span className="mapSearchSuggestOrigin">{originNote}</span>
                </p>
                {suggestions.areas.map((area, index) => (
                  <div
                    key={area.key}
                    id={optionId(areaStartIndex + index)}
                    role="option"
                    aria-selected={safeActive === areaStartIndex + index}
                    className={`mapSearchSuggestRow${safeActive === areaStartIndex + index ? " isActive" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => activate({ type: "area", item: area })}
                    onPointerEnter={() => chooseActiveIndex(areaStartIndex + index)}
                  >
                    <span className="mapSearchSuggestRowMain">
                      <MapPin size={15} aria-hidden="true" className="mapSearchSuggestRowIcon" />
                      <span className="mapSearchSuggestRowName">{area.name}</span>
                      {area.contextLabel ? (
                        <span className="mapSearchSuggestBorough">{area.contextLabel}</span>
                      ) : null}
                      {/* No coverage chip here. A suggestion row is a place to
                          fly to, and the chip read "Plan with warnings" beside
                          every second name: planning words a reader cannot act
                          on, taking the width the name needs. The coverage still
                          travels with the pick (activate below) and the area
                          sheet says it there, where planning is the question. */}
                    </span>
                    {area.distanceLabel ? (
                      <span className="mapSearchSuggestDistance">{area.distanceLabel}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {indexedVenues.length > 0 ? (
              <div role="group" aria-label="Venues across city maps" className="mapSearchSuggestGroup">
                <p className="mapSearchSuggestGroupHead">
                  <span>Venues across city maps</span>
                </p>
                {indexedVenues.map((venue, offset) => {
                  const index = indexedVenueStartIndex + offset;
                  const cityName = searchIndex?.cities.find((city) => city.id === venue.cityId)?.name;
                  const locationLabel = venue.area && venue.area !== cityName
                    ? `${venue.area} · ${cityName ?? ""}`.trim()
                    : venue.area || cityName;
                  return (
                    <div
                      key={`${venue.cityId}:${venue.id}`}
                      id={optionId(index)}
                      role="option"
                      data-venue-id={venue.id}
                      aria-selected={safeActive === index}
                      className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => activate({ type: "indexedVenue", item: venue })}
                      onPointerEnter={() => chooseActiveIndex(index)}
                    >
                      <span className="mapSearchSuggestRowMain">
                        <span className="mapSearchSuggestRowName">{venue.name}</span>
                        {locationLabel ? <span className="mapSearchSuggestBorough">{locationLabel}</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {suggestions.pubs.length > 0 ? (
              <div role="group" aria-label="Venues" className="mapSearchSuggestGroup">
                <p className="mapSearchSuggestGroupHead">
                  <span>Venues</span>
                </p>
                {suggestions.pubs.map((pub, offset) => {
                  const index = pubStartIndex + offset;
                  return (
                    <div
                      key={pub.id}
                      id={optionId(index)}
                      role="option"
                      data-venue-id={pub.id}
                      aria-selected={safeActive === index}
                      className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => activate({ type: "pub", item: pub })}
                      onPointerEnter={() => chooseActiveIndex(index)}
                    >
                      <span className="mapSearchSuggestRowMain">
                        <span className="mapSearchSuggestRowName">{pub.name}</span>
                        <span className="mapSearchSuggestBorough">{pub.typeLabel}</span>
                        {pub.boroughLabel ? (
                          <span className="mapSearchSuggestBorough">{pub.boroughLabel}</span>
                        ) : null}
                      </span>
                      <span className="mapSearchSuggestMeta">
                        {pub.priceLabel ? (
                          <CompactVenuePrice
                            priceLabel={pub.priceLabel}
                            anchor={pub.anchor}
                            className="mapSearchSuggestPrice"
                            provenanceClassName="mapSearchSuggestPriceProvenance"
                          />
                        ) : null}
                        {pub.distanceLabel ? (
                          <span className="mapSearchSuggestDistance">{pub.distanceLabel}</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {suggestions.places.length > 0 ? (
              <div
                role="group"
                aria-label={UK_PLACE_SEARCH_GROUP_LABEL}
                className="mapSearchSuggestGroup"
              >
                <p className="mapSearchSuggestGroupHead">
                  <span>{UK_PLACE_SEARCH_GROUP_LABEL}</span>
                </p>
                {suggestions.places.map((place, offset) => {
                  const index = placeStartIndex + offset;
                  return (
                    <div
                      key={place.key}
                      id={optionId(index)}
                      role="option"
                      aria-selected={safeActive === index}
                      className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => activate({ type: "place", item: place })}
                      onPointerEnter={() => chooseActiveIndex(index)}
                    >
                      <span className="mapSearchSuggestRowMain">
                        <MapPin size={15} aria-hidden="true" className="mapSearchSuggestRowIcon" />
                        <span className="mapSearchSuggestRowName">{place.name}</span>
                        {place.contextLabel ? (
                          <span className="mapSearchSuggestBorough">{place.contextLabel}</span>
                        ) : null}
                        {place.description ? (
                          <span className="mapSearchSuggestBorough">{place.description}</span>
                        ) : null}
                      </span>
                      <span className="mapSearchSuggestMeta">
                        {place.distanceLabel ? (
                          <span className="mapSearchSuggestDistance">{place.distanceLabel}</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {mergedUkBasePubs.length > 0 ? (
              <div
                role="group"
                aria-label={UK_BASE_SEARCH_GROUP_LABEL}
                className="mapSearchSuggestGroup"
              >
                <p className="mapSearchSuggestGroupHead">
                  <span>{UK_BASE_SEARCH_GROUP_LABEL}</span>
                </p>
                {mergedUkBasePubs.map((pub, offset) => {
                  const index = ukBaseStartIndex + offset;
                  return (
                    <div
                      key={pub.id}
                      id={optionId(index)}
                      role="option"
                      data-venue-id={pub.id}
                      aria-selected={safeActive === index}
                      className={`mapSearchSuggestRow${safeActive === index ? " isActive" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => activate({ type: "ukBase", item: pub })}
                      onPointerEnter={() => chooseActiveIndex(index)}
                    >
                      <span className="mapSearchSuggestRowMain">
                        <span className="mapSearchSuggestRowName">{pub.name}</span>
                        <span className="mapSearchSuggestBorough">No listed price</span>
                        {pub.address ? (
                          <span className="mapSearchSuggestBorough">{pub.address}</span>
                        ) : null}
                      </span>
                      <span className="mapSearchSuggestMeta">
                        {pub.distanceLabel ? (
                          <span className="mapSearchSuggestDistance">{pub.distanceLabel}</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Empty state lives inside the listbox so the combobox panel keeps a
                non-zero accessible surface on a miss (Enter must not collapse it). */}
            {showEmptyLine ? (
              <div
                id={emptyStateId}
                className="mapSearchSuggestEmpty"
                data-testid="map-search-no-results"
                role="presentation"
              >
                <p className="mapSearchSuggestEmptyTitle">{NO_RESULTS_MESSAGE}</p>
                <p className="mapSearchSuggestEmptyHint">
                  Try Soho, Willesden, or The Crown. Clear search to see every venue.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <p
        className="mapSearchSuggestLive sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="map-search-no-results-live"
      >
        {liveAnnouncement}
      </p>
    </div>
  );
}
