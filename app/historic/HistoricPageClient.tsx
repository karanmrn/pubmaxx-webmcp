// Flagship "Historic Pubs" discovery surface. Cards stay server-rendered so
// sourced heritage text and links are present in the first document without
// serialising the full venue dataset into a client boundary. Filter controls
// own URL state in HistoricFilters.tsx.
//
// Honest by construction: every card renders only what the record carries — an
// era chip only when era is present, a grade badge only when listed, the hook
// verbatim, and a citation link derived strictly from the data's own sourceRef.
// Nothing is fabricated; the subtitle names the sources and the count out loud.

import Link from "next/link";
import { ArrowUpRight, ExternalLink } from "lucide-react";

import { ProseDisclosure } from "@/components/Disclosure";
import SiteNav from "@/components/nav/SiteNav";
import type { HistoricPub } from "@/lib/historic";
import {
  citationHref,
  citationLabel,
  listedBadge,
  venueStatusBadge,
} from "@/lib/historicFilter";
import {
  historicIndexHref,
  INDEX_PAGE_SIZE,
  type HistoricFilterQuery,
} from "@/lib/pageFilters";
import HistoricFilters from "./HistoricFilters";

import "./historic.css";

export default function HistoricPageClient({
  pubs,
  totalPubs,
  matchingPubs,
  boroughs,
  filters,
  page,
  totalPages,
}: {
  pubs: HistoricPub[];
  totalPubs: number;
  matchingPubs: number;
  boroughs: string[];
  filters: HistoricFilterQuery;
  page: number;
  totalPages: number;
}): React.JSX.Element {
  const filtersActive =
    filters.borough !== null || filters.listedOnly || filters.hasDate;
  const firstShown = matchingPubs === 0 ? 0 : (page - 1) * INDEX_PAGE_SIZE + 1;
  const lastShown = matchingPubs === 0 ? 0 : firstShown + pubs.length - 1;

  return (
    <main id="main" className="historicPage">
      <SiteNav active="historic" />

      <header className="historicHead">
        <p className="historicEyebrow">Historic pubs</p>
        <h1 className="historicTitle">London&rsquo;s Historic Pubs</h1>
        <p className="historicLede">
          {totalPubs} notable pubs, cited from Wikipedia and Wikidata. Never
          invented.
        </p>
      </header>

      {totalPubs === 0 ? (
        <p className="historicStatus" role="status">
          The historic index isn&rsquo;t loading just now. The{" "}
          <Link href="/map">map</Link> is still up, and it still knows where the
          cheap pints are.
        </p>
      ) : (
        <>
          <HistoricFilters boroughs={boroughs} filters={filters} />

          <p className="historicCount" role="status" aria-live="polite">
            {matchingPubs === totalPubs
              ? `Showing ${firstShown}-${lastShown} of ${totalPubs} pubs`
              : `Showing ${firstShown}-${lastShown} of ${matchingPubs} matches`}
          </p>

          {pubs.length === 0 ? (
            <div className="historicEmpty" role="status">
              <p className="historicEmptyTitle">Nothing matches those filters.</p>
              <p className="historicEmptyBody">
                We only show pubs we can cite. Nothing is invented to fill the
                gap.{" "}
                {filtersActive ? (
                  <Link
                    className="historicInlineReset"
                    href="/historic"
                  >
                    Clear filters
                  </Link>
                ) : null}
              </p>
            </div>
          ) : (
            <ul className="historicGrid">
              {pubs.map((pub) => {
                const href = citationHref(pub);
                const grade = listedBadge(pub.listed);
                const status = venueStatusBadge(pub.venueStatus);
                return (
                  <li key={pub.slug} className="historicCard">
                    <div className="historicCardMeta">
                      {pub.era ? (
                        <span className="historicEra">{pub.era}</span>
                      ) : null}
                      {grade ? (
                        <span className="historicGrade">{grade}</span>
                      ) : null}
                      {status ? (
                        <span className="historicGrade">{status}</span>
                      ) : null}
                    </div>

                    <h2 className="historicCardName">{pub.name}</h2>

                    {pub.borough ? (
                      <p className="historicBorough">{pub.borough}</p>
                    ) : null}

                    <div className="historicHook">
                      <ProseDisclosure text={pub.hook} />
                    </div>

                    <div className="historicProvenance">
                      <span className="historicFactCount">
                        {pub.facts.length} on record
                      </span>
                      {href ? (
                        <a
                          className="historicCite"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {citationLabel(href)}
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>

                    <div className="historicActions">
                      <Link
                        className="historicMapLink pressable"
                        href={`/historic/${pub.slug}`}
                      >
                        Read the story
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                      {pub.venueId ? (
                        <Link
                          className="historicMapLink pressable"
                          href={`/map?sel=${pub.venueId}`}
                        >
                          See on map
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {totalPages > 1 ? (
            <nav className="historicPagination" aria-label="Historic pub pages">
              {page > 1 ? (
                <Link href={historicIndexHref(filters, page - 1)}>Previous</Link>
              ) : <span />}
              <span>Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Link href={historicIndexHref(filters, page + 1)}>Next</Link>
              ) : <span />}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}
