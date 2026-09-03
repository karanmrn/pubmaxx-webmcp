import type { Metadata } from "next";
import Link from "next/link";

import PubsGallery from "@/components/pubs/PubsGallery";
import SiteNav from "@/components/nav/SiteNav";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import {
  countScrapedPubsBySource,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";
import { readScrapedPubsForPage } from "@/lib/scrapedPubs.server";
import { paginateIndexRows, parsePubsFilterQuery } from "@/lib/pageFilters";
import { venueMatchesZone, ZONE_IDS } from "@/lib/zones";

import "@/components/pubs/pubsGallery.css";

const CHAINS_DESCRIPTION =
  "Chain pub menus we have checked: Young's, Nicholson's, and Greene King. Each card links to the map pin.";

function chainsHeading(count: number | null): string {
  if (count === null) return "Chains";
  return `Chains (${count} chain pubs)`;
}

export async function generateMetadata(): Promise<Metadata> {
  const { pubs, complete } = await readScrapedPubsForPage();
  const count = complete ? pubs.length : null;
  const pageTitle = chainsHeading(count);
  return {
    title: pageTitle,
    description: CHAINS_DESCRIPTION,
    alternates: { canonical: "/pubs" },
    openGraph: {
      title: appPageTitle(pageTitle),
      description: CHAINS_DESCRIPTION,
      url: "/pubs",
      siteName: metadataSiteName(),
      type: "website",
      images: ["/og.png"],
    },
  };
}

type PubsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PubsPage({
  searchParams,
}: PubsPageProps) {
  const { pubs, complete } = await readScrapedPubsForPage();
  const count = complete ? pubs.length : null;
  const filters = parsePubsFilterQuery((await searchParams) ?? {});
  const sourceCounts = countScrapedPubsBySource(pubs);
  const counts = {
    all: pubs.length,
    ...sourceCounts,
  };
  const zonesPresent = ZONE_IDS.filter((zone) =>
    pubs.some((pub) => pub.zone === zone),
  );
  const matchingPubs = pubs.filter(
    (pub) =>
      (filters.source === "all" || pub.source === filters.source) &&
      venueMatchesZone(pub.zone, filters.zone ?? "all"),
  );
  const pageResult = paginateIndexRows(matchingPubs, filters.page);

  return (
    <main id="main" className="pubsShell">
      <SiteNav active="pubs" />
      <div className="pubsPage">
        <header className="pubsHead">
          <p className="pubsEyebrow">On the map</p>
          <h1>{chainsHeading(count)}</h1>
          <p className="pubsDek">
            Young&apos;s gardens, Nicholson&apos;s historic rooms, and Greene King
            menus we&apos;ve pulled onto the London map. Open a pub, check the
            menu, or jump straight onto the pin.
          </p>
          <p className="pubsDek">
            <Link href="/map">Browse every listed pub on the map</Link> for the
            full priced set.
          </p>
        </header>
        <PubsGallery
          pubs={pageResult.rows}
          matchingPubs={matchingPubs.length}
          filter={filters.source as "all" | ScrapedPubSourceId}
          zone={filters.zone ?? "all"}
          counts={counts}
          zonesPresent={zonesPresent}
          page={pageResult.page}
          totalPages={pageResult.totalPages}
          complete={complete}
        />
      </div>
    </main>
  );
}
