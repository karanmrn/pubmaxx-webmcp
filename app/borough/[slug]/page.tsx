import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import JsonLd from "@/components/seo/JsonLd";
import FactBlock from "@/components/seo/FactBlock";
import FaqBlock from "@/components/seo/FaqBlock";
import PriceBadge from "@/components/PriceBadge";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";
import { pintFactStats, faqItems, faqPageJsonLd } from "@/lib/pintFacts";
import {
  formatMonthYear,
  formatObservedDate,
  PINT_DATASET_OBSERVED_AT,
} from "@/lib/dataFreshness";
import { groupVenuePrices, formatPrice, type Venue, type VenuePrice } from "@/lib/venues";
import { boroughFromSlug, pubsInBorough, slugifyBorough } from "@/lib/boroughs";
import { loadBoroughHeritage, NOTABLE_CAP } from "@/lib/boroughHeritage";
import { curatedCrawlMapHref, curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/EmptyState";
import { ProseDisclosure } from "@/components/Disclosure";
import BoroughPassportSlice from "@/components/borough/BoroughPassportSlice";
import BoroughPintPriceCard from "@/components/borough/BoroughPintPriceCard";
import AreaNewsList from "@/components/areanews/AreaNewsList";
import { entriesForBorough, freshAreaNews, NEW_ROUND_HERE_CAP } from "@/lib/areaNews";
import { loadAreaNews } from "@/lib/areaNews.server";

import "./borough.css";
import "@/components/seo/factLayer.css";

// Borough discovery / "night-out chapter" page: /borough/[slug]. A SERVER
// component (cc_plan2 §14/§25, story 28) — it reads the bundled dataset via
// getVenueIndex's underlying loader (venueIndex is server-only, which is fine
// here), groups it, resolves the borough from the slug, and renders a
// shareable page: a dek, cheapest-first pubs (each linking onto the map), the
// borough's story pubs, any curated/themed crawl that touches the borough, and
// a transport hint that links the map pre-filtered to the area. generateMetadata
// gives it a share-worthy title/description. An unknown slug resolves to
// notFound() — the page never crashes on a borough that doesn't exist.
//
// Next 16 dynamic route params are async — `params` is a Promise we await.

type PageProps = { params: Promise<{ slug: string }> };

// A curated/themed crawl "touches" a borough when at least one of its stops'
// primary/visible borough slugs matches the page's borough slug. Pure, reads
// only what's already loaded (no extra fetch) — a crawl with no matching stop
// just doesn't show up in the borough's chapter.
function crawlsTouchingBorough(
  crawls: CuratedCrawl[],
  venues: Venue[],
  slug: string,
): CuratedCrawl[] {
  const target = slugifyBorough(slug);
  if (!target) return [];
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));
  return crawls.filter((crawl) =>
    crawl.venueIds.some((id) => {
      const venue = venueById.get(id);
      if (!venue) return false;
      return (
        slugifyBorough(venue.primaryBorough) === target ||
        venue.visibleBoroughs.some((borough) => slugifyBorough(borough) === target)
      );
    }),
  );
}

// Cap the crawl deep-link to a shareable number of stops — a large borough's
// full pub list would make an unwieldy URL.
const MAP_LINK_STOP_CAP = 12;

/** Borough floor for Outer London honesty banner (Wave H4 / PRD P1). */
const BOROUGH_COVERAGE_FLOOR = 15;

// Browse the borough on the clean map via search (`?q=`), so outer areas like
// Barnet open without resurrecting a hand-built crawl into the planner.
function boroughBrowseMapUrl(name: string): string {
  const params = new URLSearchParams();
  params.set("q", name);
  return `/map?${params.toString()}`;
}

// Optional crawl deep-link: pre-build the same share-URL shape a hand-built
// crawl uses (mode=build&pubs=id1,id2). Honest: "here's where they are", not
// a routed transit itinerary.
function boroughMapUrl(pubs: Venue[]): string {
  if (pubs.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", pubs.slice(0, MAP_LINK_STOP_CAP).map((pub) => pub.id).join(","));
  return `/map?${params.toString()}`;
}

// Load the grouped venue set from disk. We reuse the same dataset getVenueIndex
// reads (via its build path) but need full Venue[] here, not the id→ref map, so
// we group the rows ourselves. Never throws: a read/parse failure yields [] so
// the page degrades to a friendly empty state rather than 500-ing. getVenueIndex
// is awaited first purely to keep the server-only import wired and the dataset
// warm in the same memoized path the rest of the app uses.
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const venues = await loadVenues();
  const name = boroughFromSlug(slug, venues);

  if (!name) {
    return {
      title: "Borough · PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }

  const title = `The cheapest pints and best pubs in ${name} · PUBMAXXING`;
  const pubs = pubsInBorough(venues, slug);
  const cheapest = pubs.find((pub) => typeof pub.cheapestPrice === "number")?.cheapestPrice;
  const description =
    typeof cheapest === "number"
      ? `${pubs.length} pubs in ${name}, ranked cheapest-first. Pints from ${formatPrice(
          cheapest,
        )}. Plan a crawl through the area on PUBMAXXING.`
      : `${pubs.length} pubs in ${name} on the map. Plan a crawl through the area on PUBMAXXING.`;

  return {
    title,
    description,
    alternates: { canonical: `/borough/${slugifyBorough(name)}` },
    // opengraph-image.tsx sits beside this route, so Next auto-attaches the
    // dynamic borough card to both OG and Twitter. summary_large_image makes X
    // render it as the full 1200×630 card rather than a thumbnail.
    openGraph: { title, description, type: "website", url: `/borough/${slugifyBorough(name)}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

const SITE_URL = "https://pubmaxxing.com";

// BreadcrumbList + ItemList structured data for this borough (Wave S1.3). Both
// are built strictly from what the page already renders: the breadcrumb mirrors
// the on-page "Boroughs · London" trail, and the ItemList is the cheapest-first
// pub table. Each pub links to its canonical, crawlable venue permalink
// (/ledger/{id}) — nothing invented; a pub with no price still lists, priced or
// not, exactly as the table shows it.
function boroughJsonLd(name: string, slug: string, pubs: Venue[]) {
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Boroughs", item: `${SITE_URL}/borough` },
      { "@type": "ListItem", position: 2, name, item: `${SITE_URL}/borough/${slug}` },
    ],
  };
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Pubs in ${name}`,
    numberOfItems: pubs.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: pubs.map((pub, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: pub.name,
      url: `${SITE_URL}/ledger/${pub.id}`,
    })),
  };
  return [breadcrumb, itemList];
}

export default async function BoroughPage({ params }: PageProps) {
  const { slug } = await params;
  const venues = await loadVenues();
  const name = boroughFromSlug(slug, venues);
  if (!name) notFound();

  const pubs = pubsInBorough(venues, slug);
  const storyPubs = pubs.filter((pub) => pub.hasStory);
  const touchingCrawls = crawlsTouchingBorough(curatedCrawls, venues, slug);
  // Cheapest-first sort already applied by pubsInBorough — first numeric
  // price is our dataset's cheapest pint here. Used only for the CityMCP
  // card's optional "vs our map" one-liner.
  const ourCheapestPrice =
    pubs.find((pub) => typeof pub.cheapestPrice === "number")?.cheapestPrice ?? null;
  // Borough-heritage rollup (Wave H): cited historic pubs in this area. null
  // when the borough has none — the section then renders nothing (no empty box).
  const heritage = await loadBoroughHeritage(slug);

  // Programmatic fact layer (Wave S3.1/S3.2): stats derived from the tracked
  // pint prices already loaded above, stamped with the dataset's observation
  // date (honest freshness — never "live"). FAQ items skip any question whose
  // answer data is missing, so a price-less borough renders neither block.
  // Honest stamp: the dataset's collection date, not the bundled file's mtime.
  const observedAt = PINT_DATASET_OBSERVED_AT;
  const boroughSlug = slugifyBorough(name);

  // Fresh-facts layer (Cycle 15 Lane A): dated, sourced pub news for this
  // borough. Successful empty reads and unavailable reads stay distinct.
  const areaNewsRead = await loadAreaNews();
  const areaNews = areaNewsRead.status === "ready" ? entriesForBorough(
    boroughSlug,
    freshAreaNews(areaNewsRead.entries),
  ).slice(0, NEW_ROUND_HERE_CAP) : [];
  const factStats = pintFactStats(pubs, name, boroughSlug);
  const faq = faqItems(factStats, {
    monthYear: formatMonthYear(observedAt),
    year: String(observedAt.getFullYear()),
    observedDate: formatObservedDate(observedAt),
  });
  const faqLd = faqPageJsonLd(faq);
  const jsonLdGraph = [
    ...boroughJsonLd(name, boroughSlug, pubs),
    ...(faqLd ? [faqLd] : []),
  ];


  // Per-request CSP nonce (proxy.ts) for the JSON-LD block below.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <main id="main" className="boroughPage">
      <JsonLd data={jsonLdGraph} nonce={nonce} />
      <SiteNav active="borough" />

      <header className="boroughHead">
        <p className="boroughEyebrow">
          <Link href="/borough">Boroughs</Link> · London
        </p>
        <h1 className="boroughTitle">Pubs in {name}</h1>
        <p className="boroughDek">
          {pubs.length === 0 ? (
            <>No pubs mapped in {name} just yet. The rest of London is on the map.</>
          ) : (
            <>
              {pubs.length} {pubs.length === 1 ? "pub" : "pubs"} in {name}, ranked
              cheapest pint first.
            </>
          )}
        </p>
        <BoroughPintPriceCard boroughName={name} ourCheapestPrice={ourCheapestPrice} />
        {pubs.length > 0 && pubs.length < BOROUGH_COVERAGE_FLOOR ? (
          <p className="boroughThinBanner" role="status">
            Only {pubs.length} pubs mapped in {name} so far. Every pin&rsquo;s a real
            pub. We just haven&rsquo;t covered every street yet.
          </p>
        ) : null}
        <div className="boroughMapLinks">
          <Link className="boroughCrawlLink" href={boroughBrowseMapUrl(name)}>
            {pubs.length > 0 ? `View ${name} on the map →` : "Open the map →"}
          </Link>
          {pubs.length > 0 ? (
            <Link className="boroughCrawlLink boroughCrawlLinkSecondary" href={boroughMapUrl(pubs)}>
              Start a crawl from cheapest pubs →
            </Link>
          ) : null}
        </div>
      </header>

      <AreaNewsList
        areaLabel={name}
        entries={areaNews}
        status={areaNewsRead.status}
        headingId="boroughAreaNewsHeading"
      />

      {pubs.length === 0 ? (
        <EmptyState
          eyebrow="Nothing pinned here yet"
          title={`No pubs mapped in ${name} yet.`}
          body="The rest of London is on the map already. This corner just hasn't been walked yet."
          action={<Link href="/borough">Browse other boroughs</Link>}
        />
      ) : (
        <table className="boroughTable">
          <caption className="srOnly">
            Pubs in {name}, ordered by cheapest pint price
          </caption>
          <thead>
            <tr>
              <th scope="col" className="boroughRankHead">
                #
              </th>
              <th scope="col" className="boroughNameHead">
                Pub
              </th>
              <th scope="col" className="boroughPriceHead">
                Cheapest pint
              </th>
            </tr>
          </thead>
          <tbody>
            {pubs.map((pub, index) => (
              <tr key={pub.id}>
                <th scope="row" className="boroughRank">
                  <span className="boroughRankNum">{index + 1}</span>
                </th>
                <td className="boroughName">
                  <Link href={venueMapUrl(pub.id)} className="boroughPub">
                    {pub.name}
                  </Link>
                  {pub.cheapestPint ? (
                    <span className="boroughPint">{pub.cheapestPint}</span>
                  ) : null}
                  <Link href={`/ledger/${pub.id}`} className="boroughLedgerLink">
                    Price history →
                  </Link>
                </td>
                <td className="boroughPriceCell">
                  {typeof pub.cheapestPrice === "number" ? (
                    <PriceBadge variant="current">
                      {formatPrice(pub.cheapestPrice)}
                    </PriceBadge>
                  ) : (
                    <span className="boroughNoPrice">No price</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {storyPubs.length > 0 ? (
        <section className="boroughSection" aria-labelledby="boroughStoryHeading">
          <h2 id="boroughStoryHeading" className="boroughSectionTitle">
            Story pubs in {name}
          </h2>
          <p className="boroughSectionDek">
            {storyPubs.length} {storyPubs.length === 1 ? "pub" : "pubs"} here carry a heritage
            note or a passed-down story. Each offers a reason to detour beyond price.
          </p>
          <ul className="boroughChipList" aria-label={`Story pubs in ${name}`}>
            {storyPubs.map((pub) => (
              <li key={pub.id}>
                <Link href={venueMapUrl(pub.id)} className="boroughChip">
                  {pub.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {touchingCrawls.length > 0 ? (
        <section className="boroughSection" aria-labelledby="boroughCrawlsHeading">
          <h2 id="boroughCrawlsHeading" className="boroughSectionTitle">
            Crawls through {name}
          </h2>
          <p className="boroughSectionDek">
            A listed route with at least one stop here. Plan it from its first stop to its last.
          </p>
          <ul className="boroughCrawlList" aria-label={`Crawls through ${name}`}>
            {touchingCrawls.map((crawl) => (
              <li key={crawl.id} className="boroughCrawlCard">
                <div>
                  <strong>{crawl.name}</strong>
                  <p>{crawl.blurb}</p>
                </div>
                <Link
                  href={curatedCrawlMapHref(crawl)}
                  className="boroughCrawlPlanLink"
                  aria-label={`Plan the ${crawl.name} crawl on the map`}
                >
                  Plan this crawl →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <BoroughPassportSlice boroughName={name} venueIds={pubs.map((pub) => pub.id)} />

      {heritage ? (
        <section className="boroughSection" aria-labelledby="boroughHeritageHeading">
          <h2 id="boroughHeritageHeading" className="boroughSectionTitle">
            Historic pubs in {name}
          </h2>
          <p className="boroughSectionDek">
            {heritage.count} notable {heritage.count === 1 ? "pub" : "pubs"} on record
            {heritage.oldest ? (
              <>
                {". The oldest is "}
                {heritage.oldest.name}
                {heritage.oldest.era ? <> ({heritage.oldest.era})</> : null}
              </>
            ) : null}
            {heritage.listedCount > 0 ? <> &middot; {heritage.listedCount} listed</> : null}.
          </p>
          <p className="boroughHeritageProvenance">Cited from Wikipedia.</p>
          <ul className="boroughHeritageList" aria-label={`Historic pubs in ${name}`}>
            {heritage.notable.slice(0, NOTABLE_CAP).map((pub) => (
              <li key={pub.slug} className="boroughHeritageCard">
                {pub.era || pub.listed ? (
                  <div className="boroughHeritageMeta">
                    {pub.era ? <span className="boroughHeritageEra">{pub.era}</span> : null}
                    {pub.listed ? (
                      <span className="boroughHeritageGrade">Grade {pub.listed}</span>
                    ) : null}
                  </div>
                ) : null}
                <h3 className="boroughHeritageName">{pub.name}</h3>
                {pub.hook ? (
                  <div className="boroughHeritageHook">
                    <ProseDisclosure text={pub.hook} />
                  </div>
                ) : null}
                {pub.venueId ? (
                  <Link
                    className="boroughHeritageMapLink"
                    href={`/map?sel=${pub.venueId}`}
                    aria-label={`See ${pub.name} on the map`}
                  >
                    See on map &rarr;
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="boroughHeritageFoot">
            <Link href="/historic">See all historic pubs &rarr;</Link>
          </p>
        </section>
      ) : null}

      <FactBlock
        stats={factStats}
        monthYear={formatMonthYear(observedAt)}
        observedDate={formatObservedDate(observedAt)}
        headingId="boroughFactHeading"
        title={`Pint prices in ${name}, by the numbers`}
      />

      <FaqBlock
        items={faq}
        headingId="boroughFaqHeading"
        title={`Pint prices in ${name}: questions`}
      />

      {/* Internal cross-links (Wave S3.5): let crawlers walk borough → map →
          Pint Index → historic via plain hrefs. Individual /ledger permalinks
          already sit in the pubs table above. */}
      <nav className="factLinks" aria-labelledby="boroughLinksHeading">
        <p className="factLinksTitle" id="boroughLinksHeading">
          Explore more
        </p>
        <ul className="factLinksList">
          <li>
            <Link href={boroughBrowseMapUrl(name)}>{name} on the map</Link>
          </li>
          <li>
            <Link href="/pint-index">London Pint Index</Link>
          </li>
          {heritage ? (
            <li>
              <Link href="/historic">Historic pubs</Link>
            </li>
          ) : null}
          <li>
            <Link href="/borough">All boroughs</Link>
          </li>
        </ul>
      </nav>

      <p className="boroughFootnote">
        Pubs, prices and stories by area. <Link href="/borough">See every borough →</Link>
      </p>
    </main>
  );
}
