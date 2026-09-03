"use client";

// "Around the web" — AI-synthesised third-party buzz on the venue sheet
// Overview (PRD What's On, task A3).
//
// PROVENANCE IS THE FEATURE: everything in this block is an AI summary of
// third-party press & reviews relayed by CityMCP London. It must NEVER read
// as PUBMAXXING editorial or community content — the eyebrow, source chip
// and footnote below say exactly what it is, every render.
//
// Resolve flow (same confidence gate as CityPlaceStrip): search_places by
// venue name near its borough, accept only a candidate whose coordinates sit
// within 250m of the venue's known lat/lng, then GET /api/citymcp/buzz for
// that id. A wrong pub's buzz is worse than none.
//
// Fail-soft: any error or no-confident-match renders nothing. Generation
// token drops stale writes on rapid venue switches. React 19 rule: all
// setState from the effect defers through Promise.resolve().then().
// No animation — trivially reduced-motion compliant.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, Newspaper } from "lucide-react";

import { discardBody } from "@/lib/responseBody";
import { haversineKm } from "@/lib/haversine";

import "./venueBuzz.css";

type CityBuzzMention = { label: string; url: string };
type CityBuzz = { summary?: string; mentions: CityBuzzMention[] };

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

async function fetchBuzz(
  id: string,
  signal: AbortSignal,
): Promise<CityBuzz | null> {
  const res = await fetch(`/api/citymcp/buzz?id=${encodeURIComponent(id)}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    discardBody(res);
    return null;
  }
  const body = (await res.json()) as { buzz?: CityBuzz | null };
  return body.buzz ?? null;
}

/** Belt-and-braces client gate — the route already drops non-https links. */
function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

// The CityMCP summary embeds numeric press citations inline as "[1][2][3]".
// Rendered raw they read as robotic mid-sentence brackets. Turn each marker
// into a real superscript link to its press mention: the number n maps to
// mentions[n-1] (the order the model cited), and only becomes a link when that
// source exists and is https. An out-of-range or non-https marker renders as a
// plain superscript number so the honest sourcing survives without a dead link.
const CITATION_RE = /\[(\d+)\]/g;

export function renderBuzzSummary(
  summary: string,
  mentions: CityBuzzMention[],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of summary.matchAll(CITATION_RE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(summary.slice(last, start));
    const n = Number(match[1]);
    const mention = mentions[n - 1];
    if (mention && isHttps(mention.url)) {
      nodes.push(
        <sup key={`cite-${key++}`} className="venueBuzzCite">
          <a
            href={mention.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Source ${n}: ${mention.label}`}
          >
            {n}
          </a>
        </sup>,
      );
    } else {
      nodes.push(
        <sup key={`cite-${key++}`} className="venueBuzzCite">
          {n}
        </sup>,
      );
    }
    last = start + match[0].length;
  }
  if (last < summary.length) nodes.push(summary.slice(last));
  return nodes;
}

export default function VenueBuzz({
  venueId,
  venueName,
  latitude,
  longitude,
  primaryBorough,
  cityId,
}: Props) {
  const isLondon = cityId === "london" || cityId === undefined;
  const [buzz, setBuzz] = useState<CityBuzz | null>(null);
  // Generation token: writes from a superseded venue are dropped rather than
  // racing into the newly-selected sheet.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!isLondon) return;
    if (!venueName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const generation = ++generationRef.current;
    // Reset immediately on venue change so the previous pub's buzz never
    // lingers (React 19: defer the setState off the effect body).
    void Promise.resolve().then(() => {
      if (generationRef.current === generation) setBuzz(null);
    });

    const controller = new AbortController();
    (async () => {
      try {
        const candidates = await searchByName(venueName, primaryBorough, controller.signal);
        if (controller.signal.aborted || candidates.length === 0) return;

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

        const next = await fetchBuzz(best.id, controller.signal);
        if (controller.signal.aborted || !next) return;

        void Promise.resolve().then(() => {
          if (generationRef.current === generation) setBuzz(next);
        });
      } catch {
        // Fail-soft: no buzz block is fine.
      }
    })();

    return () => {
      controller.abort();
    };
  }, [isLondon, venueId, venueName, latitude, longitude, primaryBorough]);

  if (!isLondon || !buzz) return null;
  const mentions = buzz.mentions.filter((m) => isHttps(m.url));
  if (!buzz.summary && mentions.length === 0) return null;

  return (
    <section
      className="venueBuzz"
      aria-label="Around the web: AI summary of press and reviews, via CityMCP"
    >
      <div className="venueBuzzHead">
        <span className="venueBuzzEyebrow">
          <Newspaper size={12} aria-hidden="true" />
          Around the web: AI summary of press &amp; reviews
        </span>
        <span
          className="venueBuzzSource"
          title="AI-synthesised digest sourced from CityMCP London"
        >
          CityMCP
        </span>
      </div>
      {buzz.summary ? (
        <p className="venueBuzzSummary">
          {renderBuzzSummary(buzz.summary, buzz.mentions)}
        </p>
      ) : null}
      {mentions.length > 0 ? (
        <ul className="venueBuzzMentions" aria-label="Press mentions">
          {mentions.map((m) => (
            <li key={m.url} className="venueBuzzMention">
              <a href={m.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={10} aria-hidden="true" />
                {m.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <small className="venueBuzzNote">
        AI-synthesised from third-party press and reviews via CityMCP London.
        Not community reports or PUBMAXXING editorial.
      </small>
    </section>
  );
}
