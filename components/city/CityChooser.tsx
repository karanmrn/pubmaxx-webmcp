"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Beer, LocateFixed, MapPin, Search } from "lucide-react";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

import { listEnabledCities, type CityId } from "@/lib/cities";
import { MAIN_LANDMARK_ID } from "@/lib/a11yLandmarks";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import {
  buildCityChooserSearchResults,
  cityGuidesCoverageLine,
  cityGuidesSearchUnavailableLine,
} from "@/lib/cityChooserSearch";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";
import { resolveLocateMapDestination } from "@/lib/locateMapDestination";
import {
  UK_NATIONAL_ENTRY_LABEL,
  UK_NATIONAL_MAP_HREF,
} from "@/lib/ukNationalBrowse";
import {
  normaliseUkPlaceQuery,
  parseUkPlaceIndex,
  UK_PLACE_INDEX_PATH,
  type UkPlace,
} from "@/lib/ukPlaceSearch";

import "./cityChooser.css";

export type CityChooserProps = {
  variant?: "page" | "section";
  onSelect?: (cityId: CityId) => void;
  /** When true, focus the town search field on mount (national browse entry). */
  focusSearch?: boolean;
};

type LocateState = "idle" | "pending" | "error";
type PlaceIndexState =
  | { status: "idle" | "loading"; places: UkPlace[] }
  | { status: "ready"; places: UkPlace[] }
  | { status: "error"; places: UkPlace[] };

/**
 * Full-bleed city picker: enabled cities as map links, optional geolocation,
 * and preferred-city persistence for Map nav / landing CTAs.
 */
export default function CityChooser({
  variant = "page",
  onSelect,
  focusSearch = false,
}: CityChooserProps) {
  const cities = listEnabledCities();
  const listId = useId();
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [locateState, setLocateState] = useState<LocateState>("idle");
  const [locateMessage, setLocateMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [placeIndex, setPlaceIndex] = useState<PlaceIndexState>({
    status: "idle",
    places: [],
  });
  const placeIndexRequested = useRef(false);
  const placeIndexPromiseRef = useRef<Promise<UkPlace[]> | null>(null);
  const [, startTransition] = useTransition();
  const normalizedQuery = normaliseUkPlaceQuery(query);
  const results = useMemo(
    () => buildCityChooserSearchResults(query, cities, placeIndex.places),
    [cities, placeIndex.places, query],
  );

  const selectCity = useCallback(
    (cityId: CityId) => {
      writePreferredCity(cityId);
      onSelect?.(cityId);
    },
    [onSelect],
  );

  const loadPlaceIndex = useCallback((): Promise<UkPlace[]> => {
    if (placeIndexPromiseRef.current) return placeIndexPromiseRef.current;
    placeIndexRequested.current = true;
    setPlaceIndex({ status: "loading", places: [] });
    const pending = fetch(UK_PLACE_INDEX_PATH)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw: unknown = await response.json();
        const places = parseUkPlaceIndex(raw);
        setPlaceIndex({ status: "ready", places });
        return places;
      })
      .catch(() => {
        placeIndexRequested.current = false;
        placeIndexPromiseRef.current = null;
        setPlaceIndex({ status: "error", places: [] });
        return [] as UkPlace[];
      });
    placeIndexPromiseRef.current = pending;
    return pending;
  }, []);

  const useMyLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateState("error");
      setLocateMessage("Location isn’t available in this browser.");
      return;
    }

    setLocateState("pending");
    setLocateMessage("Finding the nearest place…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const cityFirst = resolveLocateMapDestination(lat, lng);
        if (cityFirst.kind === "city") {
          selectCity(cityFirst.cityId);
          setLocateState("idle");
          setLocateMessage(`Opening ${cityFirst.label}…`);
          startTransition(() => {
            router.push(cityFirst.href);
          });
          return;
        }
        void loadPlaceIndex().then((places) => {
          const dest = resolveLocateMapDestination(lat, lng, places);
          if (dest.kind === "city") {
            selectCity(dest.cityId);
            setLocateState("idle");
            setLocateMessage(`Opening ${dest.label}…`);
            startTransition(() => {
              router.push(dest.href);
            });
            return;
          }
          if (dest.kind === "place") {
            setLocateState("idle");
            setLocateMessage(`Opening ${dest.arrival.name}…`);
            startTransition(() => {
              router.push(dest.href);
            });
            return;
          }
          setLocateState("error");
          setLocateMessage(
            "You’re outside the priced city maps. Search a town above, or pick a city below.",
          );
        });
      },
      () => {
        setLocateState("error");
        setLocateMessage("Couldn’t read your location. Pick a city below.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, [loadPlaceIndex, router, selectCity, startTransition]);

  const changeQuery = useCallback(
    (value: string) => {
      setQuery(value);
      if (normaliseUkPlaceQuery(value).length >= 2) void loadPlaceIndex();
    },
    [loadPlaceIndex],
  );

  // National browse / deep link: put the caret in town search without scrolling past the cities.
  useEffect(() => {
    if (!focusSearch) return;
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
  }, [focusSearch]);

  const rootClass =
    variant === "section"
      ? "cityChooser cityChooser--section"
      : "cityChooser cityChooser--page";

  const Root = variant === "page" ? "main" : "section";

  return (
    <Root
      id={variant === "page" ? MAIN_LANDMARK_ID : undefined}
      className={rootClass}
      aria-labelledby={listId + "-title"}
    >
      <div className="cityChooserInner">
        <header className="cityChooserHead">
          {variant === "page" ? (
            <Link href="/" className="cityChooserBrand" aria-label="PUBMAXXING home">
              <span className="cityChooserBrandMark" aria-hidden="true">
                <Beer size={18} strokeWidth={1.5} />
              </span>
              <PubmaxxWordmark className="cityChooserBrandText" />
            </Link>
          ) : (
            <p className="cityChooserEyebrow">Cities</p>
          )}
          {variant === "page" ? (
            <h1
              id={listId + "-title"}
              className="cityChooserTitle cityChooserSerif"
            >
              Choose your city
            </h1>
          ) : (
            <h2
              id={listId + "-title"}
              className="cityChooserTitle cityChooserSerif"
            >
              Choose your city
            </h2>
          )}
          <p className="cityChooserLede">
            Open a price-aware pub map. Crawls and drink-shaped pins for the
            night you want.
          </p>
        </header>

        <div className="cityChooserSearch">
          <label htmlFor={`${listId}-search`} className="cityChooserSearchLabel">
            Find your town
          </label>
          <div className="cityChooserSearchField">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={searchInputRef}
              id={`${listId}-search`}
              className="cityChooserSearchInput"
              type="search"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="Search for a town or city"
              autoComplete="off"
              spellCheck="false"
              aria-controls={normalizedQuery.length >= 2 ? `${listId}-search-results` : undefined}
              aria-describedby={`${listId}-search-help`}
            />
          </div>
          <p id={`${listId}-search-help`} className="cityChooserSearchHelp">
            {cityGuidesCoverageLine(cities)}
          </p>
        </div>

        <div className="cityChooserToolbar">
          <button
            type="button"
            className="cityChooserLocate"
            onClick={useMyLocation}
            disabled={locateState === "pending"}
            aria-describedby={locateMessage ? `${listId}-locate-status` : undefined}
          >
            <LocateFixed size={16} strokeWidth={1.75} aria-hidden="true" />
            {locateState === "pending" ? "Locating…" : "Use my location"}
          </button>
          {locateMessage ? (
            <p
              id={`${listId}-locate-status`}
              className="cityChooserLocateStatus"
              data-tone={locateState === "error" ? "error" : "info"}
              role="status"
              aria-live="polite"
            >
              {locateMessage}
            </p>
          ) : null}
        </div>

        <p className="cityChooserNational">
          <Link href={UK_NATIONAL_MAP_HREF} className="cityChooserNationalLink">
            {UK_NATIONAL_ENTRY_LABEL}
          </Link>
        </p>

        {normalizedQuery.length >= 2 ? (
          <section
            id={`${listId}-search-results`}
            className="cityChooserSearchPanel"
            aria-label="Place search results"
            aria-live="polite"
          >
            <p className="cityChooserResultsLabel">Matches</p>
            {results.length > 0 ? (
              <ul className="cityChooserResults">
                {results.map((result) => (
                  <li
                    key={`${result.kind}-${result.name}-${result.href}`}
                    className="cityChooserResult"
                  >
                    <Link
                      href={result.href}
                      className="cityChooserResultLink"
                      onClick={
                        result.kind === "curated"
                          ? () => selectCity(result.cityId)
                          : undefined
                      }
                    >
                      <MapPin size={18} strokeWidth={1.65} aria-hidden="true" />
                      <span className="cityChooserResultCopy">
                        <span className="cityChooserResultTopline">
                          <strong className="cityChooserResultName">
                            {result.name}
                          </strong>
                          {result.kind === "uncovered" && result.context ? (
                            <span className="cityChooserResultContext">
                              {result.context}
                            </span>
                          ) : null}
                          <span
                            className="cityChooserResultBadge"
                            data-kind={result.kind}
                          >
                            {result.kind === "curated"
                              ? "City guide"
                              : "No prices yet"}
                          </span>
                        </span>
                        <span className="cityChooserResultDescription">
                          {result.description}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : placeIndex.status === "loading" ? (
              <p className="cityChooserSearchStatus" role="status">
                Looking across the UK pub map…
              </p>
            ) : placeIndex.status === "error" ? (
              <p className="cityChooserSearchStatus" role="status">
                {cityGuidesSearchUnavailableLine(cities.length)}
              </p>
            ) : (
              <p className="cityChooserSearchStatus">
                Can’t find that name yet. Try a nearby town.
              </p>
            )}
            {placeIndex.status === "ready" ? (
              <p className="cityChooserSearchSource">
                Place names from{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenStreetMap contributors
                </a>
                , ODbL.
              </p>
            ) : null}
          </section>
        ) : null}

        <nav aria-label="City maps">
          <ul id={listId} className="cityChooserList">
            {cities.map((city, i) => {
              const href = cityMapShareUrl(city.id);
              const profile = getCityCapabilityProfile(city.id);
              const isPreview = profile.releaseTier === "preview";
              return (
                <li
                  key={city.id}
                  className="cityChooserItem"
                  style={{ ["--cc-i" as string]: i }}
                >
                  <Link
                    href={href}
                    className="cityChooserLink"
                    onClick={() => selectCity(city.id)}
                    aria-label={`${city.displayName}${isPreview ? ", Preview" : ""}: ${city.tagline}. Open map.`}
                  >
                    <span className="cityChooserNameRow">
                      <span className="cityChooserName">{city.displayName}</span>
                      {isPreview ? (
                        <span className="cityChooserReleaseBadge">Preview</span>
                      ) : null}
                    </span>
                    <p className="cityChooserTagline">{city.tagline}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </Root>
  );
}
