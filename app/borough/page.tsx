import type { Metadata } from "next";
import Link from "next/link";

import { getVenueIndex } from "@/lib/venueIndex";
import { groupVenuePrices, formatPrice, type VenuePrice } from "@/lib/venues";
import { listBoroughs } from "@/lib/boroughs";
import { allBoroughHeritageCounts } from "@/lib/boroughHeritage";
import { loadHistoricPubs } from "@/lib/historic";
import PriceBadge from "@/components/PriceBadge";
import SiteNav from "@/components/nav/SiteNav";

import "./[slug]/borough.css";

// Borough index: /borough. A SERVER component listing every London borough in
// the dataset as a card (name, pub count, cheapest pint), each linking to its
// own /borough/[slug] page (cc_plan2 §14/§25). Shareable via generateMetadata.
// Reuses the detail page's stylesheet so both surfaces stay visually identical.

export const metadata: Metadata = {
  title: "London pubs by borough: PUBMAXXING",
  description:
    "Browse London's pubs the way locals do, by area. Camden, Soho, Hackney and every borough on the map, ranked by the cheapest pint.",
  alternates: { canonical: "/borough" },
  openGraph: {
    title: "London pubs by borough: PUBMAXXING",
    description:
      "Browse London's pubs by area. Every borough on the map, ranked by the cheapest pint.",
    type: "website",
  },
};

// Load the grouped venue set from disk (server-only). getVenueIndex is awaited
// first to keep the server-only import wired and the dataset warm on the same
// memoized path the app uses. Never throws: a failure yields [] so the index
// renders an empty state rather than 500-ing.
async function loadVenues() {
  try {
    await getVenueIndex();
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "pint_prices_app_dataset.json",
    );
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    return groupVenuePrices(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

export default async function BoroughIndexPage() {
  const venues = await loadVenues();
  const boroughs = listBoroughs(venues);
  // Cited historic-pub count per borough (borough-heritage rollup, Wave H).
  // Additive: shown as a subtle badge only where a borough has any on record.
  const heritageCounts = new Map(
    allBoroughHeritageCounts(await loadHistoricPubs()).map((h) => [h.slug, h.count]),
  );

  return (
    <main id="main" className="boroughPage">
      <SiteNav active="borough" />

      <header className="boroughHead">
        <p className="boroughEyebrow">Boroughs</p>
        <h1 className="boroughTitle">London, by the area you drink in</h1>
        <p className="boroughDek">
          Nobody says &ldquo;let&rsquo;s go to the pub in Greater London.&rdquo;
          They say Camden, or Soho, or Hackney. Pick a borough and see its pubs
          ranked by the cheapest pint on the map.
        </p>
      </header>

      {boroughs.length === 0 ? (
        <p className="boroughEmpty" role="status">
          We couldn&rsquo;t load the boroughs just now.{" "}
          <Link href="/map">Open the map</Link> instead.
        </p>
      ) : (
        <ul className="boroughGrid" aria-label="London boroughs">
          {boroughs.map((borough) => (
            <li key={borough.slug}>
              <Link className="boroughCard" href={`/borough/${borough.slug}`}>
                <span className="boroughCardName">{borough.name}</span>
                <span className="boroughCardMeta">
                  {borough.pubCount} {borough.pubCount === 1 ? "pub" : "pubs"}
                </span>
                {heritageCounts.get(borough.slug) ? (
                  <span className="boroughCardHistoric">
                    {heritageCounts.get(borough.slug)} historic
                  </span>
                ) : null}
                <span className="boroughCardPrice">
                  {borough.cheapestGbp === null ? (
                    <span className="boroughNoPrice">No price yet</span>
                  ) : (
                    <>
                      from{" "}
                      <PriceBadge variant="current">
                        {formatPrice(borough.cheapestGbp)}
                      </PriceBadge>
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
