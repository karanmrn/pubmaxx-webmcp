"use client";

// Food hygiene badge (FSA FHRS) on the venue sheet Overview.
//
// PROVENANCE IS THE FEATURE: this shows the FSA's own published rating, matched
// to the venue by postcode + fuzzy name server-side. The client only reads
// /api/hygiene — it never touches the FHRS upstream. Fail-soft: no confident
// match, an unparseable postcode, or any error renders nothing (no badge, no
// error text). Generation token drops stale writes on rapid venue switches,
// same idiom as VenueBuzz. No animation — reduced-motion compliant by default.

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { discardBody } from "@/lib/responseBody";

import "./venueHygiene.css";

type HygieneRating = {
  fhrsid: number;
  ratingValue: number;
  ratingDate: string | null;
  businessName: string;
  localAuthority: string | null;
};

type Props = {
  venueId: string;
  venueName: string;
  /** Free-text address; the postcode is extracted server-side. */
  address: string;
};

async function fetchRating(
  name: string,
  address: string,
  signal: AbortSignal,
): Promise<HygieneRating | null> {
  const params = new URLSearchParams({ name, postcode: address });
  const res = await fetch(`/api/hygiene?${params.toString()}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    discardBody(res);
    return null;
  }
  const body = (await res.json()) as { rating?: HygieneRating | null };
  return body.rating ?? null;
}

// Format the FSA rating date as a quiet "Jun 2025" month stamp for the title/aria
// provenance line. Returns null for a missing or unparseable date (fail-soft).
function formatRatedMonth(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export default function VenueHygiene({ venueId, venueName, address }: Props) {
  const [rating, setRating] = useState<HygieneRating | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!venueName || !address) return;
    const generation = ++generationRef.current;
    // Reset immediately on venue change so the previous pub's rating never
    // lingers (React 19: defer the setState off the effect body).
    void Promise.resolve().then(() => {
      if (generationRef.current === generation) setRating(null);
    });

    const controller = new AbortController();
    (async () => {
      try {
        const next = await fetchRating(venueName, address, controller.signal);
        if (controller.signal.aborted || !next) return;
        void Promise.resolve().then(() => {
          if (generationRef.current === generation) setRating(next);
        });
      } catch {
        // Fail-soft: no badge is fine.
      }
    })();

    return () => {
      controller.abort();
    };
  }, [venueId, venueName, address]);

  if (!rating) return null;

  // Quiet provenance: surface WHEN the FSA assessed the venue (month + year from
  // the ISO ratingDate) in the title/aria text only, no extra chrome on the chip.
  const rated = formatRatedMonth(rating.ratingDate);
  const base = rating.localAuthority
    ? `FSA food hygiene rating ${rating.ratingValue} out of 5, rated by ${rating.localAuthority}`
    : `FSA food hygiene rating ${rating.ratingValue} out of 5`;
  const title = rated ? `${base}, rated ${rated}` : base;

  return (
    <a
      className="venueHygiene"
      href={`https://ratings.food.gov.uk/business/${rating.fhrsid}`}
      target="_blank"
      rel="noreferrer noopener"
      title={title}
      aria-label={title}
    >
      <ShieldCheck size={14} aria-hidden="true" />
      <span className="venueHygieneLabel">Food hygiene</span>
      <span className="venueHygieneScore">{rating.ratingValue}</span>
      <span className="venueHygieneSource">FSA</span>
    </a>
  );
}
