import type { Metadata } from "next";

import { loadHistoricPubs } from "@/lib/historic";
import { metadataSiteName } from "@/lib/brandNaming";
import {
  allBoroughHeritageCounts,
  boroughHeritageForSlug,
} from "@/lib/boroughHeritage";
import { boroughFromSlug } from "@/lib/boroughs";
import {
  availableBoroughs,
  filterAndSortHistoric,
} from "@/lib/historicFilter";
import {
  paginateIndexRows,
  parseHistoricFilterQuery,
} from "@/lib/pageFilters";
import { loadGroupedVenues } from "@/lib/venueDataset";
import HistoricBoroughLinks, {
  type HistoricBoroughLink,
} from "@/components/seo/HistoricBoroughLinks";
import HistoricPageClient from "./HistoricPageClient";

import "./historic.css";

// Flagship "Historic Pubs" discovery surface (not the map). A browsable,
// provenance-honest index of London's notable pubs — every era, grade, and
// hook on a card is lifted from a cited Wikipedia/Wikidata fact, never invented.
// This server shell loads the pre-built, read-only dataset and hands it to the
// client component that owns filtering, sorting, and interactivity. Below it,
// the server-rendered "Oldest pubs by borough" rail (Wave S3.4) cross-links each
// borough's cited heritage section so crawlers can walk the graph.
const HISTORIC_TITLE =
  "London's Historic Pubs: cited from Wikipedia & Wikidata · PUBMAXXING";
const HISTORIC_DESCRIPTION =
  "A browsable index of London's notable, historic pubs. Dates, listed-building grades, and one cited sentence each, sourced from Wikipedia and Wikidata. Filter by borough, jump straight onto the map.";

export const metadata: Metadata = {
  title: HISTORIC_TITLE,
  description: HISTORIC_DESCRIPTION,
  alternates: { canonical: "/historic" },
  // Route-specific Open Graph so a shared /historic link shows this index (not
  // the homepage OG). siteName + the shared /og.png card carried over — this
  // index route has no file-convention OG image (only /historic/[slug] does).
  openGraph: {
    title: HISTORIC_TITLE,
    description: HISTORIC_DESCRIPTION,
    url: "/historic",
    siteName: metadataSiteName(),
    type: "website",
    images: ["/og.png"],
  },
};

// Build the "Oldest pubs in {borough}" rail (Wave S3.4). Only boroughs that
// (a) hold cited historic pubs AND (b) resolve to a real borough page in the
// pint dataset are linked, so no link ever 404s. Each row carries the borough's
// oldest cited pub + era — a real, sourced fact, never invented.
function buildBoroughLinks(
  historicPubs: Awaited<ReturnType<typeof loadHistoricPubs>>,
  venues: Awaited<ReturnType<typeof loadGroupedVenues>>,
): HistoricBoroughLink[] {
  return allBoroughHeritageCounts(historicPubs)
    .filter((row) => boroughFromSlug(row.slug, venues) !== null)
    .map((row) => {
      const heritage = boroughHeritageForSlug(row.slug, historicPubs);
      return {
        slug: row.slug,
        borough: row.borough,
        count: row.count,
        oldestName: heritage?.oldest?.name ?? null,
        oldestEra: heritage?.oldest?.era ?? null,
      };
    });
}

type HistoricPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HistoricPage({
  searchParams,
}: HistoricPageProps) {
  const [pubs, venues] = await Promise.all([
    loadHistoricPubs(),
    loadGroupedVenues(),
  ]);
  const boroughs = availableBoroughs(pubs);
  const parsedFilters = parseHistoricFilterQuery((await searchParams) ?? {});
  const filters = {
    ...parsedFilters,
    borough:
      parsedFilters.borough && boroughs.includes(parsedFilters.borough)
        ? parsedFilters.borough
        : null,
  };
  const matching = filterAndSortHistoric(pubs, filters);
  const pageResult = paginateIndexRows(matching, filters.page);
  const resolvedFilters = { ...filters, page: pageResult.page };
  const boroughLinks = buildBoroughLinks(pubs, venues);
  return (
    <>
      <HistoricPageClient
        pubs={pageResult.rows}
        totalPubs={pubs.length}
        matchingPubs={matching.length}
        boroughs={boroughs}
        filters={resolvedFilters}
        page={pageResult.page}
        totalPages={pageResult.totalPages}
      />
      <HistoricBoroughLinks boroughs={boroughLinks} />
    </>
  );
}
