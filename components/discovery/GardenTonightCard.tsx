"use client";

// Discover beer-garden weather nudge — reads CityMCP London city_status
// weather and, ONLY when lib/gardenWeather says it's decent garden weather,
// surfaces 2-3 open beer-garden pubs from the places search. Honest empty:
// bad weather, missing weather, or zero open results → render NOTHING (no
// fake sunshine, no fabricated pubs).
//
// Fail-soft + React 19 safe, mirroring TonightNearbyLane: fetch failures hide
// the card, state writes are deferred with Promise.resolve().then, and an
// AbortController cancels in-flight requests on unmount.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, MapPin, Sun } from "lucide-react";

import { cityAwareMapPath } from "@/lib/curatedCrawls";
import {
  gardenWeatherHeadline,
  isGardenWeather,
  type GardenWeatherInput,
} from "@/lib/gardenWeather";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./gardenTonightCard.css";

type StatusResponse = {
  weather?: GardenWeatherInput | null;
  error?: string;
};

type PlaceRow = {
  id: string;
  name: string;
  area?: string;
  location?: { lat: number; lng: number };
  types?: string[];
  rating?: number;
  priceBand?: string;
  openNow?: boolean;
};

type PlacesResponse = {
  places?: PlaceRow[];
  error?: string;
};

const LONDON_CITY_ID = "london";
const PLACES_QUERY = "beer garden pub";
const MAX_PUBS = 3;
// Rows whose types include any of these count as garden-able pubs. Rows with
// no types at all pass too (the q already biases the search) — but rows typed
// as something else entirely (e.g. a garden centre) are dropped.
const GARDEN_TYPES = new Set(["beer_garden", "brewpub", "pub", "bar"]);

function isGardenPub(row: PlaceRow): boolean {
  if (row.openNow === false) return false;
  if (!Array.isArray(row.types) || row.types.length === 0) return true;
  return row.types.some((t) => GARDEN_TYPES.has(t));
}

function mapHref(row: PlaceRow): string | null {
  const loc = row.location;
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    return null;
  }
  const params = new URLSearchParams({
    lat: loc.lat.toFixed(5),
    lng: loc.lng.toFixed(5),
    zoom: "15",
    q: row.name,
  });
  return cityAwareMapPath(LONDON_CITY_ID, params);
}

export default function GardenTonightCard() {
  const [headline, setHeadline] = useState<string | null>(null);
  const [pubs, setPubs] = useState<PlaceRow[]>([]);
  const [status, setStatus] = useState<"idle" | "ready" | "hidden">("idle");

  useEffect(() => {
    const controller = new AbortController();
    const hide = () => {
      void Promise.resolve().then(() => {
        if (!controller.signal.aborted) setStatus("hidden");
      });
    };
    (async () => {
      const statusBox: { value: StatusResponse | null } = { value: null };
      const statusOutcome = await loadSurfaceJson<StatusResponse>(
        "/api/citymcp/status",
        {
          signal: controller.signal,
          init: { headers: { accept: "application/json" } },
          validate: (body) => Boolean(body && "weather" in body),
        },
        (body) => {
          statusBox.value = body;
        },
      );
      const statusAnswer = statusBox.value;
      if (statusOutcome === "failed" || !statusAnswer || controller.signal.aborted) {
        hide();
        return;
      }
      const weather = statusAnswer.weather ?? null;
      // Bad weather → hide immediately, without even asking for pubs.
      if (!isGardenWeather(weather)) {
        hide();
        return;
      }
      const line = gardenWeatherHeadline(weather);
      if (!line) {
        hide();
        return;
      }

      const placesBox: { value: PlacesResponse | null } = { value: null };
      const placesOutcome = await loadSurfaceJson<PlacesResponse>(
        `/api/citymcp/places?q=${encodeURIComponent(PLACES_QUERY)}&openNow=true&sort=rating&limit=6`,
        {
          signal: controller.signal,
          init: { headers: { accept: "application/json" } },
          validate: (body) => Array.isArray(body?.places),
        },
        (body) => {
          placesBox.value = body;
        },
      );
      const placesAnswer = placesBox.value;
      if (placesOutcome === "failed" || !placesAnswer || controller.signal.aborted) {
        hide();
        return;
      }
      const rows = Array.isArray(placesAnswer.places)
        ? placesAnswer.places.filter(
            (p) =>
              p &&
              typeof p.id === "string" &&
              typeof p.name === "string" &&
              isGardenPub(p),
          )
        : [];
      const picked = rows.slice(0, MAX_PUBS);
      // Good weather but nothing open → honest empty, render nothing.
      if (picked.length === 0) {
        hide();
        return;
      }

      void Promise.resolve().then(() => {
        if (controller.signal.aborted) return;
        setHeadline(line);
        setPubs(picked);
        setStatus("ready");
      });
    })();
    return () => {
      controller.abort();
    };
  }, []);

  if (status !== "ready" || !headline || pubs.length === 0) return null;

  return (
    <section
      className="discoverSection gardenTonightSection"
      aria-labelledby="gardenTonight-title"
    >
      <div className="gardenTonightCard">
        <p className="gardenTonightKicker">
          <Sun size={13} aria-hidden="true" />
          <span>Garden weather</span>
        </p>
        <h2 id="gardenTonight-title" className="gardenTonightHeadline">
          {headline}
        </h2>
        <p className="gardenTonightDek">
          Open beer-garden pubs in London right now, via CityMCP London.
        </p>
        <ul className="gardenTonightList">
          {pubs.map((pub) => {
            const href = mapHref(pub);
            return (
              <li key={pub.id} className="gardenTonightPub">
                <div className="gardenTonightPubBody">
                  <span className="gardenTonightPubName">{pub.name}</span>
                  <span className="gardenTonightPubMeta">
                    {pub.area ? (
                      <span className="gardenTonightPubArea">
                        <MapPin size={11} aria-hidden="true" />
                        {pub.area}
                      </span>
                    ) : null}
                    {typeof pub.rating === "number" ? (
                      <span className="gardenTonightPubRating">
                        ★ {pub.rating.toFixed(1)}
                      </span>
                    ) : null}
                    {pub.priceBand ? (
                      <span className="gardenTonightPubPrice">
                        {pub.priceBand}
                      </span>
                    ) : null}
                  </span>
                </div>
                {href ? (
                  <Link className="gardenTonightPubLink pressable" href={href}>
                    Map
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
