"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";

import {
  getCity,
  type CityId,
} from "@/lib/cities";
import { discardBody } from "@/lib/responseBody";
import { writePreferredCity } from "@/lib/cityPreference";
import { cityMapShareUrl } from "@/lib/cityShare";
import { resolveLocateMapDestination } from "@/lib/locateMapDestination";
import {
  dismissCitySuggest,
  getMapLocationControlAvailable,
  getMapLocationControlServerSnapshot,
  saveDataPreferred,
  subscribeMapLocationControl,
} from "@/lib/mapLocationPrompt";
import {
  parseUkPlaceIndex,
  ukPlaceMapUrl,
  UK_PLACE_INDEX_PATH,
  type UkPlace,
  type UkPlaceMapArrival,
} from "@/lib/ukPlaceSearch";


type CitySuggestBannerProps = {
  cityId: CityId;
  onLocationFound?: (location: { lat: number; lng: number }) => void;
};

/**
 * Opt-in geolocation city nudge. Does NOT call getCurrentPosition on mount —
 * the viewer taps "Near me?" first. Honours Save-Data and a session dismiss.
 * Fail-soft (permission denied / timeout / no geo) → no switch offer.
 * Outside curated cities, loads places.json and offers an uncovered arrival.
 * Kept below the CitySwitcher dropdown in z-order so city picks stay tappable.
 */
export default function CitySuggestBanner({
  cityId,
  onLocationFound,
}: CitySuggestBannerProps) {
  const visible = useSyncExternalStore(
    subscribeMapLocationControl,
    getMapLocationControlAvailable,
    getMapLocationControlServerSnapshot,
  );
  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [suggestedPlace, setSuggestedPlace] = useState<UkPlaceMapArrival | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [locatedHere, setLocatedHere] = useState(false);
  const checkGen = useRef(0);
  const placesCache = useRef<UkPlace[] | null>(null);

  const dismiss = useCallback(() => {
    dismissCitySuggest();
    setSuggested(null);
    setSuggestedPlace(null);
  }, []);

  const loadPlaces = useCallback(async (): Promise<UkPlace[]> => {
    if (placesCache.current) return placesCache.current;
    try {
      const response = await fetch(UK_PLACE_INDEX_PATH);
      if (!response.ok) {
        discardBody(response);
        return [];
      }
      const places = parseUkPlaceIndex(await response.json());
      placesCache.current = places;
      return places;
    } catch {
      return [];
    }
  }, []);

  const checkNearby = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (saveDataPreferred()) return;

    const gen = ++checkGen.current;
    setChecking(true);
    setSuggested(null);
    setSuggestedPlace(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (gen !== checkGen.current) return;
        const location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        const cityDest = resolveLocateMapDestination(location.lat, location.lng);
        if (cityDest.kind === "city") {
          void Promise.resolve().then(() => {
            if (gen !== checkGen.current) return;
            setChecking(false);
            if (cityDest.cityId !== cityId) {
              setSuggested(cityDest.cityId);
              setLocatedHere(false);
            } else {
              setLocatedHere(true);
              onLocationFound?.(location);
            }
          });
          return;
        }
        void loadPlaces().then((places) => {
          if (gen !== checkGen.current) return;
          const dest = resolveLocateMapDestination(
            location.lat,
            location.lng,
            places,
          );
          setChecking(false);
          if (dest.kind === "city" && dest.cityId !== cityId) {
            setSuggested(dest.cityId);
            setLocatedHere(false);
            return;
          }
          if (dest.kind === "city" && dest.cityId === cityId) {
            setLocatedHere(true);
            onLocationFound?.(location);
            return;
          }
          if (dest.kind === "place") {
            setSuggestedPlace(dest.arrival);
            setLocatedHere(false);
            onLocationFound?.(location);
          }
        });
      },
      () => {
        if (gen !== checkGen.current) return;
        void Promise.resolve().then(() => {
          if (gen === checkGen.current) setChecking(false);
        });
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 },
    );
  }, [cityId, loadPlaces, onLocationFound]);

  // Reuse an already-granted permission without prompting again. A first-time
  // visitor still has to tap Near me, preserving the Home Area privacy boundary.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (!cancelled && permission.state === "granted") checkNearby();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [checkNearby]);

  if (!visible) {
    return null;
  }

  if (suggested && suggested !== cityId) {
    const city = getCity(suggested);
    const href = cityMapShareUrl(suggested);

    return (
      <div className="citySuggestBanner" role="status" aria-live="polite">
        <p className="citySuggestBannerCopy">
          Looks like you&apos;re in {city.displayName}. Switch map?
        </p>
        <Link
          href={href}
          className="citySuggestBannerSwitch"
          onClick={() => writePreferredCity(suggested)}
        >
          Switch
        </Link>
        <button
          type="button"
          className="citySuggestBannerDismiss"
          aria-label="Dismiss city suggestion"
          onClick={dismiss}
        >
          <X size={14} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (suggestedPlace) {
    const href = ukPlaceMapUrl(suggestedPlace);
    return (
      <div className="citySuggestBanner" role="status" aria-live="polite">
        <p className="citySuggestBannerCopy">
          Looks like you&apos;re near {suggestedPlace.name}. Open the pub map?
        </p>
        <Link href={href} className="citySuggestBannerSwitch">
          Open
        </Link>
        <button
          type="button"
          className="citySuggestBannerDismiss"
          aria-label="Dismiss place suggestion"
          onClick={dismiss}
        >
          <X size={14} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="citySuggestBanner" role="status">
      <p className="citySuggestBannerCopy">
        {checking
          ? "Finding pubs near you…"
          : locatedHere
            ? "Showing pubs near you"
            : "Visiting another city?"}
      </p>
      <button
        type="button"
        className="citySuggestBannerSwitch"
        disabled={checking}
        onClick={checkNearby}
      >
        {checking ? "Checking…" : locatedHere ? "Refresh" : "Near me?"}
      </button>
      <button
        type="button"
        className="citySuggestBannerDismiss"
        aria-label="Dismiss city suggestion"
        onClick={dismiss}
      >
        <X size={14} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}
