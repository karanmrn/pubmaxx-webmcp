"use client";

// Compact desktop-rail summary for /tonight. The main column owns the full
// listing spine; this panel only counts kinds and names a few headlines, then
// hands off to #tonight-list. Never a second card list.

import Link from "next/link";
import { CalendarClock, Timer } from "lucide-react";

import { dealsEndingSoon } from "@/lib/dealsHonesty";
import type { WhatsOnKind, WhatsOnRow } from "@/lib/whatsOn";
import type { WhatsOnKindFacet } from "@/lib/whatsOnBadges";

export type TonightOnTonightSummaryProps = {
  facets: WhatsOnKindFacet[];
  /** Display rows in list order; only the first few titles are named. */
  rows: WhatsOnRow[];
  totalCount: number;
  /** Injectable clock for the ending-soon row. */
  now?: number;
};

const TOP_TITLE_LIMIT = 3;

// The chip labels are singular nouns, and two of them do not take a plain "s",
// so the count line carries its own pair rather than reading "3 deal".
const FACET_NOUNS: Record<WhatsOnKind, [one: string, many: string]> = {
  quiz: ["quiz", "quizzes"],
  sport: ["sport listing", "sport listings"],
  deal: ["deal", "deals"],
  music: ["live music listing", "live music listings"],
  event: ["listed night", "listed nights"],
};

function facetLine(facet: WhatsOnKindFacet): string {
  const [one, many] = FACET_NOUNS[facet.kind];
  return `${facet.count} ${facet.count === 1 ? one : many}`;
}

export default function TonightOnTonightSummary({
  facets,
  rows,
  totalCount,
  now,
}: TonightOnTonightSummaryProps) {
  if (totalCount === 0 || facets.length === 0) return null;

  // The one place money-saving gets pushed harder, and it only appears when the
  // rows say so: real deals, still on, closing inside the next two hours. It
  // counts them and hands the reader down to the list that holds them. No
  // saved-money figure rides here, because no row can prove one.
  const endingSoon = dealsEndingSoon(rows, now);
  const topTitles = rows.slice(0, TOP_TITLE_LIMIT);
  const facetKinds = new Set<WhatsOnKind>(facets.map((facet) => facet.kind));
  const headlineKinds = facets
    .filter((facet) => facet.kind === "music" || facet.kind === "deal")
    .map((facet) => facetLine(facet));
  const otherKinds = facets
    .filter((facet) => facet.kind !== "music" && facet.kind !== "deal")
    .map((facet) => facetLine(facet));
  const kindLines = [...headlineKinds, ...otherKinds];

  return (
    <section
      className="tonightOnTonightSummary"
      aria-labelledby="tonight-rail-summary-title"
      data-testid="tonight-rail-summary"
    >
      <div className="tonightOnTonightSummaryHead">
        <h2 id="tonight-rail-summary-title">
          <CalendarClock size={18} aria-hidden="true" />
          On tonight
        </h2>
        <span className="tonightOnTonightSummaryCount">
          {totalCount} listing{totalCount === 1 ? "" : "s"}
        </span>
      </div>
      {kindLines.length > 0 ? (
        <p className="tonightOnTonightSummaryKinds">{kindLines.join(" · ")}</p>
      ) : null}
      {endingSoon.length > 0 ? (
        <Link
          className="tonightOnTonightSummaryEnding pressable"
          href="#tonight-list"
          data-testid="tonight-deals-ending-soon"
        >
          <Timer size={14} aria-hidden="true" />
          <span>
            Deals ending soon <span aria-hidden="true">·</span> {endingSoon.length}
          </span>
        </Link>
      ) : null}
      {topTitles.length > 0 ? (
        <ul className="tonightOnTonightSummaryTitles" aria-label="Headline listings">
          {rows.slice(0, TOP_TITLE_LIMIT).map((row) => (
            <li key={row.id}>{row.title}</li>
          ))}
        </ul>
      ) : null}
      {facetKinds.has("music") || facetKinds.has("deal") ? (
        <p className="tonightOnTonightSummaryNote">
          Full cards, dates and sources sit in the main list.
        </p>
      ) : null}
      <Link className="tonightOnTonightSummaryLink pressable" href="#tonight-list">
        See tonight&apos;s listings
      </Link>
    </section>
  );
}
