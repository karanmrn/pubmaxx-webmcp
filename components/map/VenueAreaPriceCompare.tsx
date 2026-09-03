"use client";

import { useEffect, useState } from "react";

import { loadPintIndexLeagueRows } from "@/lib/pintIndexLeagueLoader";
import {
  venueAreaPriceCompareLine,
} from "@/lib/venueAreaPriceCompare";
import type { LeagueRow } from "@/lib/pintIndex";
import type { ZonePintIndex } from "@/lib/zones";

import "./venueAreaPriceCompare.css";

type LoadedLeague = { rows: LeagueRow[] };

/**
 * One compare line under the venue Overview price block.
 *
 * Borough average from the public Pint Index league when that borough has a
 * row; otherwise the fare-zone median when the zone index cleared its gate.
 * Renders nothing when the pub has no displayable pint or the patch has no
 * publishable yardstick. Jokes stay off — this sits beside a figure.
 */
export default function VenueAreaPriceCompare({
  priceGbp,
  primaryBorough,
  zone,
  zoneIndex,
}: {
  priceGbp: number | null | undefined;
  primaryBorough?: string | null;
  zone?: number | null;
  zoneIndex?: ZonePintIndex | null;
}) {
  const [league, setLeague] = useState<LoadedLeague | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPintIndexLeagueRows()
      .then((rows) => {
        if (!cancelled) setLeague({ rows });
      })
      .catch(() => {
        if (!cancelled) setLeague({ rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Silence until the league fetch settles — zone must not flash ahead of borough.
  if (league === null) return null;

  const line = venueAreaPriceCompareLine({
    priceGbp,
    primaryBorough,
    zone,
    leagueRows: league.rows,
    zoneIndex: zoneIndex ?? null,
  });
  if (!line) return null;

  return (
    <p className="venueAreaPriceCompare" role="status">
      {line}
    </p>
  );
}
