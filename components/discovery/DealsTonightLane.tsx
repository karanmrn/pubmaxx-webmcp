"use client";

// W3 - Deals vertical UI. Consumes /api/whats-on?kind=deal so
// Discover surfaces the 384-row deals spine instead of leaving it invisible.

import Link from "next/link";
import { useEffect, useState } from "react";
import { PoundSterling } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";
import { WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";
import {
  dealEndsCaption,
  dealListingAgeCaption,
  liveDeals,
  orderDeals,
  type DealProximityAnchor,
} from "@/lib/dealsHonesty";
import { preferredCityMapHref } from "@/lib/cityPreference";
import { WhatsOnUrgencyBadge } from "@/components/map/WhatsOnUrgencyBadge";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./dealsTonightLane.css";

const CARD_LIMIT = 8;

export type DealsTonightLaneProps = {
  /** When provided, render from these already-loaded rows (deal families are
   *  filtered out here) and skip the self-fetch, so a host that already loaded the
   *  spine (Tonight) never fires a duplicate request. Omitted on Discover, which
   *  self-fetches exactly as before. */
  rows?: WhatsOnRow[];
  /** Retained for host compatibility. Card-derived copy does not use it. */
  asOf?: string | null;
  /** Coarse point the cards are ordered from, from lib/dealsHonesty's
   *  dealProximityAnchor. The host resolves it; this lane never reads a
   *  location and never sends one. Absent orders by closing time alone. */
  anchor?: DealProximityAnchor | null;
  /** Injectable clock, so the ending and listing-age captions are testable. */
  now?: number;
};

/** Every valid deal row that is still running: the candidate set, uncapped. */
function liveDealRowsFrom(value: unknown, now: number = Date.now()): WhatsOnRow[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter((row): row is WhatsOnRow => isValidWhatsOnRow(row, now));
  return liveDeals(valid, now);
}

/**
 * Order, then cap. The other way round picks the eight cards before the viewer's
 * patch has had a say, which would leave a lane full of far-off deals that
 * happen to close early.
 */
function dealCards(
  rows: readonly WhatsOnRow[],
  anchor: DealProximityAnchor | null,
  now: number = Date.now(),
): WhatsOnRow[] {
  return orderDeals(liveDeals(rows, now), anchor).slice(0, CARD_LIMIT);
}

export function dealsTonightRowsFromResponse(body: unknown): WhatsOnRow[] {
  if (typeof body !== "object" || body === null) return [];
  return liveDealRowsFrom((body as { rows?: unknown }).rows);
}

export default function DealsTonightLane({
  rows: providedRows,
  anchor = null,
  now,
}: DealsTonightLaneProps) {
  const provided = providedRows !== undefined;
  const [fetchedRows, setFetchedRows] = useState<WhatsOnRow[]>([]);

  useEffect(() => {
    if (provided) return; // reuse mode: the host already loaded the spine.
    const controller = new AbortController();
    void loadSurfaceJson<unknown>(
      "/api/whats-on?kind=deal&window=tonight&limit=8",
      {
        signal: controller.signal,
        validate: (body) =>
          Boolean(
            body &&
              typeof body === "object" &&
              Array.isArray((body as { rows?: unknown }).rows),
          ),
      },
      (body) => {
        setFetchedRows(dealsTonightRowsFromResponse(body));
      },
    );
    return () => controller.abort();
  }, [provided]);

  // Selection re-reads the clock on every render, so a deal that closes while
  // the page is open leaves the lane rather than sitting there as a promise
  // nobody can keep. The helpers own the clock; the component stays pure.
  const rows = dealCards(
    provided ? liveDealRowsFrom(providedRows, now) : fetchedRows,
    anchor,
    now,
  );
  const badgeNow = now === undefined ? undefined : new Date(now);

  if (rows.length === 0) return null;

  const meta = WHATS_ON_KIND_META.deal;

  return (
    <section className="dealsTonight" aria-labelledby="deals-tonight-title">
      <div className="dealsTonightHead">
        <h2 id="deals-tonight-title">
          <PoundSterling size={18} aria-hidden="true" /> Deals tonight
        </h2>
        <span className="dealsTonightChecked">
          {rows.length} listed deal{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="dealsTonightLead">
        Listed offers and other deals, {meta.badgeLabel.toLowerCase()}.
        Prices and inclusions vary; check the source.
      </p>
      <ul className="dealsTonightList">
        {rows.map((row) => {
          const mapHref = row.venueId
            ? `/map?sel=${encodeURIComponent(row.venueId)}`
            : preferredCityMapHref();
          const ends = dealEndsCaption(row, now);
          const listingAge = dealListingAgeCaption(row, now);
          return (
            <li key={row.id}>
              <Link
                href={mapHref}
                className="dealsTonightCard"
                onClick={() => trackEvent("lane_card_tap")}
              >
                <div className="dealsTonightCardHead">
                  <strong>{row.title}</strong>
                  <WhatsOnUrgencyBadge row={row} now={badgeNow} />
                </div>
                <span className="dealsTonightPlace">{row.placeName}</span>
                {ends ? <span className="dealsTonightEnds">{ends}</span> : null}
                {row.detail ? <span className="dealsTonightDetail">{row.detail}</span> : null}
                <span className="dealsTonightSource">
                  {row.source.label}
                  {row.source.url ? " · sourced" : ""}
                </span>
                {listingAge ? (
                  <span className="dealsTonightListingAge">{listingAge}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        className="dealsTonightMap"
        href="/map?src=whats-on-deal"
        onClick={() => trackEvent("whats_on_filter")}
      >
        Open deals on the map
      </Link>
    </section>
  );
}
