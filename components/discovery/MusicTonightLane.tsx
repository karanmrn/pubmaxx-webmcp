"use client";

// W4 Music vertical UI. Consumes /api/whats-on?kind=music with honest
// thin-coverage copy when the spine is sparse (CityMCP + chain listings).

import Link from "next/link";
import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel, WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";
import { preferredCityMapHref } from "@/lib/cityPreference";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./dealsTonightLane.css";

type MusicState = { rows: WhatsOnRow[]; asOf: string | null };

export type MusicTonightLaneProps = {
  /** When provided, render from these already-loaded rows (music families are
   *  filtered out here) and skip the self-fetch, so a host that already loaded the
   *  spine (Tonight) never fires a duplicate request. Omitted on Discover. */
  rows?: WhatsOnRow[];
  /** Freshest confirmation for MUSIC specifically. This lane is about one
   *  source, so it may not borrow the page's freshest date: if only July
   *  evidence exists for live music, July is what this line says however
   *  recently another feed was rebuilt. Absent means we cannot date it, and
   *  checkedLabel says exactly that. */
  asOf?: string | null;
};

/** Below this count we label coverage as thin rather than implying a full guide. */
const THIN_COVERAGE_MAX = 4;

export default function MusicTonightLane({ rows: providedRows, asOf: providedAsOf }: MusicTonightLaneProps = {}) {
  const provided = providedRows !== undefined;
  const [state, setState] = useState<MusicState>({ rows: [], asOf: null });

  useEffect(() => {
    if (provided) return; // reuse mode: the host already loaded the spine.
    const controller = new AbortController();
    void loadSurfaceJson<{
      rows?: unknown;
      asOf?: unknown;
      kindObservedAt?: unknown;
    }>(
      "/api/whats-on?kind=music&window=tonight&limit=8",
      {
        signal: controller.signal,
        validate: (body) => Array.isArray(body?.rows),
      },
      (body) => {
        const rows = (Array.isArray(body.rows) ? body.rows : [])
          .filter(isValidWhatsOnRow)
          .slice(0, 8);
        // Self-fetch mode asks for kind=music alone, so the response-level
        // freshness IS this source's freshness; kindObservedAt.music is the
        // same answer and is preferred when the server sends it.
        const musicObservedAt = (body.kindObservedAt as Record<string, unknown> | undefined)?.music;
        setState({
          rows,
          asOf:
            typeof musicObservedAt === "string"
              ? musicObservedAt
              : typeof body.asOf === "string"
                ? body.asOf
                : null,
        });
      },
    );
    return () => controller.abort();
  }, [provided]);

  const rows = provided
    ? providedRows.filter((row) => row.kind === "music").slice(0, 8)
    : state.rows;
  const asOf = provided ? (providedAsOf ?? null) : state.asOf;

  if (rows.length === 0) return null;

  const meta = WHATS_ON_KIND_META.music;
  const thin = rows.length <= THIN_COVERAGE_MAX;

  return (
    <section className="dealsTonight" aria-labelledby="music-tonight-title" data-coverage={thin ? "thin" : "ok"}>
      <div className="dealsTonightHead">
        <h2 id="music-tonight-title">
          <Music2 size={18} aria-hidden="true" /> Live music tonight
        </h2>
        <span className="dealsTonightChecked">{checkedLabel(asOf)}</span>
      </div>
      <p className="dealsTonightLead">
        {thin
          ? `Thin coverage tonight: ${rows.length} sourced listing${rows.length === 1 ? "" : "s"} only. Not a full gig guide.`
          : `${meta.badgeLabel} from sourced listings. Times and line-ups vary; check the source.`}
      </p>
      <ul className="dealsTonightList">
        {rows.map((row) => {
          const mapHref = row.venueId
            ? `/map?sel=${encodeURIComponent(row.venueId)}`
            : preferredCityMapHref();
          return (
            <li key={row.id}>
              <Link
                href={mapHref}
                className="dealsTonightCard"
                onClick={() => trackEvent("lane_card_tap")}
              >
                <strong>{row.title}</strong>
                <span className="dealsTonightPlace">{row.placeName}</span>
                {row.detail ? <span className="dealsTonightDetail">{row.detail}</span> : null}
                <span className="dealsTonightSource">
                  {row.source.label}
                  {row.source.url ? " · sourced" : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        className="dealsTonightMap"
        href="/map?src=whats-on-music"
        onClick={() => trackEvent("whats_on_filter")}
      >
        Open live music on the map
      </Link>
    </section>
  );
}
