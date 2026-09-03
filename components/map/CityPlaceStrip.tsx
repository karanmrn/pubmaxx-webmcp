"use client";

// London-only "Around now" strip on the venue sheet Overview.
//
// Enriches the venue with CityMCP data (rating / open now / hygiene / transit)
// via a two-step lookup: search_places by venue name near the venue's
// area/borough, filter by proximity to the venue coords, then get_place with
// deep:true on the best match. Never invents fields — if any of the below is
// absent from the upstream, the chip simply doesn't render:
//
//   - rating (+ userRatingCount)
//   - openNow
//   - hygiene rating (only from get_place deep:true)
//   - a one-line transit snippet
//
// Fail-soft: any error or no-confident-match yields a hidden strip. Uses a
// generation token so rapid venue-sheet switches don't race stale writes into
// the newly-selected venue. Follows the React 19 "no setState in effect body"
// rule by deferring all writes through Promise.resolve().then().

import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Info,
  Star,
  TrainFront,
  UtensilsCrossed,
} from "lucide-react";

import { discardBody } from "@/lib/responseBody";
import { haversineKm } from "@/lib/haversine";
import { firstHttp } from "@/lib/httpUrl";

import "./cityPlaceStrip.css";

type CityPlaceEnrichment = {
  id: string;
  name?: string;
  address?: string;
  area?: string;
  location?: { lat: number; lng: number };
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
  hygiene?: {
    value?: { businessName?: string; rating?: string | number };
    source?: string;
  };
  transit?: {
    value?: {
      nearbyStops?: Array<{ name: string; modes?: string[]; distanceM?: number }>;
      nearest?: string;
      lines?: string[];
      walkMinutes?: number;
      summary?: string;
    };
    source?: string;
  };
};

type Props = {
  venueId: string;
  venueName: string;
  latitude: number;
  longitude: number;
  primaryBorough?: string;
  /** Explicit gate; when omitted defaults to London-on. */
  cityId?: string;
};

async function searchByName(
  name: string,
  borough: string | undefined,
  signal: AbortSignal,
): Promise<Array<{ id: string; location?: { lat: number; lng: number } }>> {
  const params = new URLSearchParams();
  const q = borough ? `${name} ${borough}` : name;
  params.set("q", q);
  params.set("limit", "5");
  const res = await fetch(`/api/citymcp/places?${params.toString()}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    discardBody(res);
    return [];
  }
  const body = (await res.json()) as {
    places?: Array<{ id?: string; location?: { lat?: number; lng?: number } }>;
    error?: string;
  };
  if (!Array.isArray(body.places)) return [];
  return body.places
    .filter(
      (p): p is { id: string; location?: { lat: number; lng: number } } =>
        typeof p?.id === "string" && p.id.length > 0,
    )
    .map((p) => ({
      id: p.id,
      location:
        p.location &&
        typeof p.location.lat === "number" &&
        typeof p.location.lng === "number"
          ? { lat: p.location.lat, lng: p.location.lng }
          : undefined,
    }));
}

async function fetchPlace(
  id: string,
  signal: AbortSignal,
): Promise<CityPlaceEnrichment | null> {
  const res = await fetch(
    `/api/citymcp/place?id=${encodeURIComponent(id)}&deep=1`,
    { signal, headers: { accept: "application/json" } },
  );
  if (!res.ok) {
    discardBody(res);
    return null;
  }
  const body = (await res.json()) as {
    place?: CityPlaceEnrichment | null;
    error?: string;
  };
  return body.place ?? null;
}

// Live shape first: one compact line per nearby stop ("Old Street · Tube ·
// 210m"), max 3. Falls back to the legacy single-line summary format so old
// payloads still render.
function formatTransitStops(
  transit: CityPlaceEnrichment["transit"],
): string[] {
  if (!transit?.value) return [];
  const stops = transit.value.nearbyStops;
  if (Array.isArray(stops) && stops.length > 0) {
    return stops.slice(0, 3).flatMap((stop) => {
      if (!stop || typeof stop.name !== "string" || !stop.name) return [];
      const parts: string[] = [stop.name];
      if (Array.isArray(stop.modes) && stop.modes.length > 0) {
        parts.push(
          stop.modes
            .slice(0, 2)
            .map((m) => (m === "tube" ? "Tube" : m.charAt(0).toUpperCase() + m.slice(1)))
            .join("/"),
        );
      }
      if (typeof stop.distanceM === "number" && Number.isFinite(stop.distanceM)) {
        parts.push(`${Math.round(stop.distanceM)}m`);
      }
      return [parts.join(" · ")];
    });
  }
  const { nearest, walkMinutes, summary, lines } = transit.value;
  if (summary && summary.length > 0) return [summary];
  const parts: string[] = [];
  if (nearest) parts.push(nearest);
  if (Array.isArray(lines) && lines.length > 0) {
    parts.push(lines.slice(0, 2).join(", "));
  }
  if (typeof walkMinutes === "number") {
    parts.push(`${Math.round(walkMinutes)} min walk`);
  }
  return parts.length > 0 ? [parts.join(" · ")] : [];
}

function formatHygiene(
  hygiene: CityPlaceEnrichment["hygiene"],
): { text: string; sourceLabel?: string } | null {
  if (!hygiene?.value) return null;
  const rating = hygiene.value.rating;
  if (rating === undefined || rating === null || rating === "") return null;
  const text =
    typeof rating === "number"
      ? `Food hygiene ${rating}/5`
      : `Food hygiene ${rating}`;
  return {
    text,
    sourceLabel: hygiene.source ?? undefined,
  };
}

export default function CityPlaceStrip({
  venueId,
  venueName,
  latitude,
  longitude,
  primaryBorough,
  cityId,
}: Props) {
  const isLondon = cityId === "london" || cityId === undefined;
  const [enrichment, setEnrichment] = useState<CityPlaceEnrichment | null>(null);
  // Generation token: any writes from a superseded venue are dropped rather
  // than racing into the newly-selected sheet.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!isLondon) return;
    if (!venueName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const generation = ++generationRef.current;
    // Reset immediately on venue change so the previous strip never lingers
    // (React 19: defer the setState off the effect body).
    void Promise.resolve().then(() => {
      if (generationRef.current === generation) setEnrichment(null);
    });

    const controller = new AbortController();
    (async () => {
      try {
        const candidates = await searchByName(venueName, primaryBorough, controller.signal);
        if (controller.signal.aborted || candidates.length === 0) return;

        // Confidence: pick the candidate whose coordinates are within 250m of
        // the venue's known lat/lng. We *never* enrich without confirming the
        // match — a wrong dossier is worse than none.
        const target = { lat: latitude, lng: longitude };
        let best: { id: string; km: number } | null = null;
        for (const c of candidates) {
          if (!c.location) continue;
          const km = haversineKm(
            [target.lng, target.lat],
            [c.location.lng, c.location.lat],
          );
          if (best === null || km < best.km) best = { id: c.id, km };
        }
        if (!best || best.km > 0.25) return;

        const place = await fetchPlace(best.id, controller.signal);
        if (controller.signal.aborted || !place) return;

        void Promise.resolve().then(() => {
          if (generationRef.current === generation) setEnrichment(place);
        });
      } catch {
        // Fail-soft: no strip is fine.
      }
    })();

    return () => {
      controller.abort();
    };
  }, [isLondon, venueId, venueName, latitude, longitude, primaryBorough]);

  if (!isLondon || !enrichment) return null;

  const rating = enrichment.rating;
  const userRatingCount = enrichment.userRatingCount;
  const openNow = enrichment.openNow;
  const hygiene = formatHygiene(enrichment.hygiene);
  const transitLines = formatTransitStops(enrichment.transit);
  const transitSource = enrichment.transit?.source;
  const hygieneSourceHref = firstHttp(hygiene?.sourceLabel) || undefined;

  const hasAny =
    typeof rating === "number" ||
    typeof openNow === "boolean" ||
    hygiene !== null ||
    transitLines.length > 0;
  if (!hasAny) return null;

  return (
    <section
      className="cityPlaceStrip"
      aria-label="Around now: CityMCP London context"
    >
      <div className="cityPlaceStripHead">
        <span className="cityPlaceStripEyebrow">Around now</span>
        <span className="cityPlaceStripSource" title="Sourced from CityMCP London">
          CityMCP
        </span>
      </div>
      <div className="cityPlaceStripChips">
        {typeof rating === "number" ? (
          <span className="cityPlaceStripChip" data-kind="rating">
            <Star size={12} aria-hidden="true" />
            <span>
              {rating.toFixed(1)}
              {typeof userRatingCount === "number" && userRatingCount > 0 ? (
                <small> ({userRatingCount.toLocaleString()})</small>
              ) : null}
            </span>
          </span>
        ) : null}
        {typeof openNow === "boolean" ? (
          <span
            className="cityPlaceStripChip"
            data-kind={openNow ? "open" : "closed"}
            aria-label={openNow ? "Open now" : "Closed now"}
          >
            <Info size={12} aria-hidden="true" />
            <span>{openNow ? "Open now" : "Closed now"}</span>
          </span>
        ) : null}
        {hygiene ? (
          <span className="cityPlaceStripChip" data-kind="hygiene">
            <UtensilsCrossed size={12} aria-hidden="true" />
            {hygieneSourceHref ? (
              <a
                href={hygieneSourceHref}
                target="_blank"
                rel="noreferrer noopener"
              >
                {hygiene.text}
              </a>
            ) : (
              <span>{hygiene.text}</span>
            )}
          </span>
        ) : null}
        {transitLines.length > 0 ? (
          <span className="cityPlaceStripChip" data-kind="transit">
            <TrainFront size={12} aria-hidden="true" />
            <span title={transitSource ? `Source: ${transitSource}` : undefined}>
              {transitLines.join("  ·  ")}
            </span>
            {transitSource && firstHttp(transitSource) ? (
              <a
                className="cityPlaceStripSrc"
                href={firstHttp(transitSource) || undefined}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Transit source"
              >
                <ExternalLink size={10} aria-hidden="true" />
              </a>
            ) : null}
          </span>
        ) : null}
      </div>
    </section>
  );
}
