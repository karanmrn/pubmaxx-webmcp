"use client";

// The venue-sheet award badge. When a kind:"award" fact is venue-matched to this
// pin, it renders as an engraved brass plaque (the same price-plaque tokens the
// zone Pint Index uses) — the pub's own accolade in brass, source-linked. It
// renders NOTHING otherwise, and a wrong pub can never be badged because the
// match is exact-id (awardForVenue), never a name coincidence.

import { useEffect, useState } from "react";
import { Award } from "lucide-react";

import { formatAreaNewsDate, type AreaNewsEntry } from "@/lib/areaNews";
import "./venueAwardBadge.css";

export default function VenueAwardBadge({
  venueId,
}: {
  venueId: string;
}): React.JSX.Element | null {
  const [award, setAward] = useState<AreaNewsEntry | null>(null);
  const [forId, setForId] = useState<string | null>(null);

  useEffect(() => {
    if (!venueId) return;
    const controller = new AbortController();
    fetch(`/api/area-news?venueId=${encodeURIComponent(venueId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { award?: AreaNewsEntry | null } | null) => {
        setAward(body?.award ?? null);
        setForId(venueId);
      })
      .catch(() => {
        // Fail silent — no plaque rather than a broken one.
      });
    return () => controller.abort();
  }, [venueId]);

  if (!award || forId !== venueId) return null;

  return (
    <a
      className="venueAwardPlaque"
      href={award.sourceUrl}
      target="_blank"
      rel="noreferrer noopener"
    >
      <Award className="venueAwardIcon" size={16} aria-hidden="true" />
      <span className="venueAwardText">
        <span className="venueAwardTitle">{award.title}</span>
        <span className="venueAwardSource">
          {award.sourceName} · {formatAreaNewsDate(award.observedAt)}
        </span>
      </span>
    </a>
  );
}
