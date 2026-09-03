import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import NationalPintBenchmarks from "@/components/pintindex/NationalPintBenchmarks";
import BoroughCoverageStatus from "@/components/pintindex/BoroughCoverageStatus";
import PintIndexArrival from "@/components/pintindex/PintIndexArrival";
import PintIndexEditions from "@/components/pintindex/PintIndexEditions";
import PintIndexLeagueTable from "@/components/pintindex/PintIndexLeagueTable";
import ZonePintIndexStrip from "@/components/zones/ZonePintIndexStrip";
import { loadSeedBoroughCoverage } from "@/lib/boroughCoverageStatus.server";
import { citableNationalBenchmarks, NATIONAL_PINT_BENCHMARKS } from "@/lib/nationalPintBenchmarks";
import { buildLeagueTable, dearestFirst, formatPintIndexDate, indexSummary, type PintIndexSnapshot } from "@/lib/pintIndex";
import { londonMonthOf, pintIndexMonthCloseDay, pintIndexMonthLabel } from "@/lib/pintIndexArchive";
import { arrivalAreas } from "@/lib/pintIndexArrival";
import { loadPintIndexArchive, loadPublicPintIndexSnapshot } from "@/lib/pintIndexSnapshot.server";
import { loadGroupedVenues } from "@/lib/venueDataset";
import { formatPrice } from "@/lib/venues";
import { loadZonePintIndex } from "@/lib/zonePintIndex.server";

import "./pint-index.css";

const SITE_URL = "https://pubmaxxing.com";

export const metadata: Metadata = {
  title: "The London Pint Index public data status · PUBMAXX",
  description: "The public London Pint Index, with named sources, licences and price dates. Older map-only prices stay out.",
  alternates: { canonical: "/pint-index" },
  openGraph: {
    title: "The London Pint Index public data status",
    description: "A London pint-price dataset built from prices with named sources and dates.",
    type: "website",
    url: "/pint-index",
  },
  twitter: {
    card: "summary_large_image",
    title: "The London Pint Index public data status",
    description: "Only pint prices with named sources and dates are published.",
  },
};

function datasetJsonLd(snapshot: PintIndexSnapshot, boroughCount: number, pubCount: number) {
  if (!snapshot.observationWindow || snapshot.observations.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "The London Pint Index",
    description: `A dated London pint-price dataset covering ${pubCount} pubs across ${boroughCount} boroughs.`,
    url: `${SITE_URL}/pint-index`,
    creator: { "@type": "Organization", name: "PUBMAXX", url: SITE_URL },
    isAccessibleForFree: true,
    dateModified: snapshot.generatedAt,
    temporalCoverage: `${snapshot.observationWindow.start}/${snapshot.observationWindow.end}`,
    measurementTechnique: "Confirmed Pint Drops, official pub or brewery sources, and licensed open datasets with price dates; assigned to London boroughs from map boundaries.",
    variableMeasured: "Pint price in GBP, grouped by London borough",
    distribution: [{
      "@type": "DataDownload",
      encodingFormat: "text/csv",
      contentUrl: `${SITE_URL}/pint-index/data.csv`,
    }],
  };
}

export default async function PintIndexPage() {
  const [snapshot, zoneIndex, editions, venues] = await Promise.all([
    loadPublicPintIndexSnapshot(),
    loadZonePintIndex(),
    loadPintIndexArchive(),
    loadGroupedVenues(),
  ]);
  const seedBoroughCoverage = await loadSeedBoroughCoverage(venues);
  const rows = snapshot ? buildLeagueTable(snapshot) : [];
  const summary = indexSummary(rows);
  const jsonLd = snapshot ? datasetJsonLd(snapshot, summary.boroughCount, summary.pubCount) : null;
  const nonce = jsonLd ? (await headers()).get("x-nonce") ?? undefined : undefined;
  const window = snapshot?.observationWindow;
  // The month currently filling, and the day it closes and gets its own dated
  // page. Read at render time on purpose: this is the one live claim on the
  // page, and it must move with the calendar rather than harden into a stale
  // promise about a month that already ended. Read on the London calendar the
  // closing date beside it is printed in, not in UTC.
  const openMonth = londonMonthOf(new Date());
  // Other people's figures, dropped unless they carry a publisher, a link and a
  // published day. They are rendered in their own block and never merged into
  // anything above: see the hard rule in lib/nationalPintBenchmarks.ts.
  const national = citableNationalBenchmarks(NATIONAL_PINT_BENCHMARKS);
  const dearestPint = summary.dearestPint;

  return (
    <main id="main" className="pintIndexPage">
      {jsonLd ? <JsonLd data={jsonLd} nonce={nonce} /> : null}
      <SiteNav />

      <header className="pintIndexHead">
        <p className="pintIndexEyebrow">The London Pint Index</p>
        <h1 className="pintIndexTitle">
          {rows.length ? "London pint prices, by borough" : "London pint prices, by fare zone"}
        </h1>
        {window ? (
          <p className="pintIndexStamp">
            {`Prices seen: ${formatPintIndexDate(window.start)} to ${formatPintIndexDate(window.end)}.`}
          </p>
        ) : null}

        {summary.averageGbp !== null ? (
          <dl className="pintIndexStats">
            <div className="pintIndexStat"><dt>Average pint</dt><dd>{formatPrice(summary.averageGbp)}</dd></div>
            <div className="pintIndexStat"><dt>Cheapest borough</dt><dd>{formatPrice(summary.cheapestBorough?.averageGbp ?? null)}<small>{summary.cheapestBorough?.name}</small></dd></div>
            <div className="pintIndexStat"><dt>Dearest borough</dt><dd>{formatPrice(summary.dearestBorough?.averageGbp ?? null)}<small>{summary.dearestBorough?.name}</small></dd></div>
            <div className="pintIndexStat"><dt>Eligible pubs</dt><dd>{summary.pubCount}<small>across {summary.boroughCount} boroughs</small></dd></div>
          </dl>
        ) : null}
      </header>

      {national.length > 0 ? (
        <section className="pintIndexSection" aria-labelledby="nationalHeading">
          <h2 id="nationalHeading" className="pintIndexSectionTitle">What a pint costs nationally</h2>
          <p className="pintIndexSectionDek">
            None of these figures are ours. They are here so the prices on this
            page have something to sit against, and each one names who counted
            it, when, and exactly what they counted. A national cask ale is not
            a London pint.
          </p>
          <NationalPintBenchmarks rows={national} headingId="nationalHeading" />
        </section>
      ) : null}

      <section className="pintIndexSection" aria-labelledby="zoneHeading">
        <h2 id="zoneHeading" className="pintIndexSectionTitle">The Zone pint index</h2>
        <p className="pintIndexNote">
          A pint in Zone 1 costs more than Zone 3. Here is by how much. Each pub
          is placed in its <strong>nearest station&rsquo;s</strong>{" "}TfL fare zone
          (a documented approximation, not an area boundary), then we take the
          median of every zone&rsquo;s listed cheapest pint.
        </p>
        <ZonePintIndexStrip index={zoneIndex} />
      </section>

      <PintIndexArrival
        areas={arrivalAreas(venues)}
        surface="index"
      />

      <BoroughCoverageStatus rows={seedBoroughCoverage} />

      <section className="pintIndexSection" aria-labelledby="leagueHeading">
        <h2 id="leagueHeading" className="pintIndexSectionTitle">Borough league table</h2>
        {rows.length === 0 ? (
          <p className="pintIndexNote">
            <strong>No borough league yet.</strong> The zone strip shows the
            wider price picture by fare zone. The league only ranks boroughs
            using dated prices with a public source.{" "}
            <Link className="pintIndexEmptyAction" href="/map">
              Find a pub and log a price.
            </Link>
          </p>
        ) : (
          <PintIndexLeagueTable
            rows={rows}
            caption="London boroughs ranked by average eligible pint price"
          />
        )}
        <a className="pintIndexDownload" href="/pint-index/data.csv" download>Download current data (CSV) ↓</a>
      </section>

      {dearestPint ? (
        <section className="pintIndexSection" id="dearest" aria-labelledby="dearestHeading">
          <h2 id="dearestHeading" className="pintIndexSectionTitle">The dearest end</h2>
          <p className="pintIndexSectionDek">
            Cheapest first is the default above, because that is what you want
            on a Friday. This is the same table the other way up, ranked on the
            priciest pint each borough has on record. At the top of this dataset:{" "}
            {formatPrice(dearestPint.maxGbp)} at {dearestPint.maxPubName},{" "}
            {dearestPint.name}.
          </p>
          <PintIndexLeagueTable
            rows={dearestFirst(rows)}
            caption="London boroughs ranked by their dearest eligible pint price"
            highlight="dearest"
          />
        </section>
      ) : null}

      <section className="pintIndexSection" aria-labelledby="editionsHeading">
        <h2 id="editionsHeading" className="pintIndexSectionTitle">Dated editions</h2>
        <p className="pintIndexSectionDek">
          This page moves as prices land, which is no use to anyone quoting it.
          So every closed month also gets its own page, frozen the day it goes
          up. {pintIndexMonthLabel(openMonth)} closes on{" "}
          {formatPintIndexDate(pintIndexMonthCloseDay(openMonth))} and gets
          one next. Eligible prices dated before then can enter it.
        </p>
        <PintIndexEditions editions={editions} />
      </section>

      <section className="pintIndexSection" aria-labelledby="methodHeading">
        <h2 id="methodHeading" className="pintIndexSectionTitle">Method and sources</h2>
        <p className="pintIndexNote pintIndexMethodLede">Only prices with a public source and date are published. Older map-only prices stay out.</p>
        <div className="pintIndexProse">
          <p><strong>What counts.</strong> Community submissions, a pub or brewery&rsquo;s own published material, and properly licensed open data may enter the public Index only with a public source URL and price date.</p>
          <p><strong>Boroughs.</strong> We place coordinates inside versioned Greater London boundary shapes. A point outside every shape gets no borough; we never assign it to an arbitrary nearby one.</p>
          <p><strong>What stays out.</strong> The map may still use an older price baseline. Those rows stay out of this public Index, its CSV and its structured data.</p>
          <p><strong>Dates.</strong> Price dates come from the source record. Build time and file modification time are never presented as when a price was seen.</p>
        </div>
      </section>

      <p className="pintIndexFootnote"><Link href="/historic">Explore cited historic pubs →</Link> · <Link href="/map">Open the map →</Link></p>
    </main>
  );
}
