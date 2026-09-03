import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import PintIndexEditions from "@/components/pintindex/PintIndexEditions";
import PintIndexLeagueTable from "@/components/pintindex/PintIndexLeagueTable";
import { buildLeagueTable, dearestFirst, formatPintIndexDate, indexSummary } from "@/lib/pintIndex";
import {
  pintIndexMonthLabel,
  pintIndexMonthTemporalCoverage,
  type ArchivedPintIndexSnapshot,
} from "@/lib/pintIndexArchive";
import {
  listPintIndexArchiveMonths,
  loadArchivedPintIndexMonth,
  loadPintIndexArchive,
} from "@/lib/pintIndexSnapshot.server";
import { formatPrice } from "@/lib/venues";

import "../pint-index.css";

// One dated edition of the public London Pint Index: /pint-index/2026-06.
//
// The live page moves as evidence lands, which is right for a reader and fatal
// for a citation. This page is the other half: a closed month, frozen the day
// it was published, reading ONLY its own file. Nothing that happens to the live
// index afterwards can change a figure here. If one of these figures turns out
// to be wrong, the fix is a correction the reader can see, listed below with
// its date, not a quiet edit (lib/pintIndexArchive.ts owns those rules).

const SITE_URL = "https://pubmaxxing.com";

type EditionPageProps = { params: Promise<{ month: string }> };

export async function generateStaticParams(): Promise<{ month: string }[]> {
  return (await listPintIndexArchiveMonths()).map((month) => ({ month }));
}

export async function generateMetadata({ params }: EditionPageProps): Promise<Metadata> {
  const { month } = await params;
  const edition = await loadArchivedPintIndexMonth(month);
  if (!edition) return { title: "Edition not found · PUBMAXX" };
  const label = pintIndexMonthLabel(month);
  const title = `The London Pint Index: ${label}`;
  const description = `The London Pint Index for ${label}, frozen on ${formatPintIndexDate(edition.archive.publishedAt)}. Sourced, dated prices only, and the figures never move again.`;
  return {
    title: `${title} · PUBMAXX`,
    description,
    alternates: { canonical: `/pint-index/${month}` },
    openGraph: { title, description, type: "article", url: `/pint-index/${month}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

function datasetJsonLd(edition: ArchivedPintIndexSnapshot, boroughCount: number, pubCount: number) {
  const { month, revision, publishedAt } = edition.archive;
  const label = pintIndexMonthLabel(month);
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `The London Pint Index, ${label}`,
    description: edition.observations.length === 0
      ? `The ${label} edition of the London Pint Index. No pint price met the publication rules in this window, so the edition publishes none.`
      : `A frozen ${label} edition covering ${pubCount} pubs across ${boroughCount} London boroughs.`,
    url: `${SITE_URL}/pint-index/${month}`,
    identifier: edition.snapshotId,
    version: String(revision),
    creator: { "@type": "Organization", name: "PUBMAXX", url: SITE_URL },
    isAccessibleForFree: true,
    datePublished: publishedAt,
    dateModified: publishedAt,
    temporalCoverage: pintIndexMonthTemporalCoverage(month),
    spatialCoverage: { "@type": "Place", name: "London, United Kingdom" },
    measurementTechnique: "Confirmed Pint Drops, official pub or brewery sources, and explicitly licensed open datasets with observed-at dates; classified by London borough point-in-polygon boundaries.",
    variableMeasured: "Observed pint price in GBP, aggregated per London borough",
    isBasedOn: `${SITE_URL}/pint-index`,
    distribution: [{
      "@type": "DataDownload",
      encodingFormat: "text/csv",
      contentUrl: `${SITE_URL}/pint-index/${month}/data.csv`,
    }],
  };
}

export default async function PintIndexEditionPage({ params }: EditionPageProps) {
  const { month } = await params;
  const edition = await loadArchivedPintIndexMonth(month);
  if (!edition) notFound();

  const editions = await loadPintIndexArchive();
  const rows = buildLeagueTable(edition);
  const summary = indexSummary(rows);
  const jsonLd = datasetJsonLd(edition, summary.boroughCount, summary.pubCount);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const label = pintIndexMonthLabel(month);
  const { corrections, revision, publishedAt } = edition.archive;

  return (
    <main id="main" className="pintIndexPage">
      <JsonLd data={jsonLd} nonce={nonce} />
      <SiteNav />

      <header className="pintIndexHead">
        <p className="pintIndexEyebrow">The London Pint Index</p>
        <h1 className="pintIndexTitle">London pint prices, {label}</h1>
        <p className="pintIndexStamp">
          {`Frozen on ${formatPintIndexDate(publishedAt)}. These figures stay put whatever the live index says next month.`}
        </p>

        {summary.averageGbp !== null ? (
          <dl className="pintIndexStats">
            <div className="pintIndexStat"><dt>Average pint</dt><dd>{formatPrice(summary.averageGbp)}</dd></div>
            <div className="pintIndexStat"><dt>Cheapest borough</dt><dd>{formatPrice(summary.cheapestBorough?.averageGbp ?? null)}<small>{summary.cheapestBorough?.name}</small></dd></div>
            <div className="pintIndexStat"><dt>Dearest borough</dt><dd>{formatPrice(summary.dearestBorough?.averageGbp ?? null)}<small>{summary.dearestBorough?.name}</small></dd></div>
            <div className="pintIndexStat"><dt>Eligible pubs</dt><dd>{summary.pubCount}<small>across {summary.boroughCount} boroughs</small></dd></div>
          </dl>
        ) : null}
      </header>

      {corrections.length > 0 ? (
        <section className="pintIndexSection" aria-labelledby="correctionsHeading">
          <h2 id="correctionsHeading" className="pintIndexSectionTitle">Corrections</h2>
          <p className="pintIndexSectionDek">
            This edition has been corrected {corrections.length === 1 ? "once" : `${corrections.length} times`}.
            You are reading revision {revision}. Nothing was quietly swapped: each
            change is dated and named here.
          </p>
          <ol className="pintIndexProse">
            {corrections.map((correction) => (
              <li key={correction.previousObservationsSha256}>
                <p>
                  <strong>{formatPintIndexDate(correction.issuedAt)}.</strong>{" "}
                  {correction.note}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="pintIndexSection" aria-labelledby="leagueHeading">
        <h2 id="leagueHeading" className="pintIndexSectionTitle">Borough league table</h2>
        {rows.length === 0 ? (
          <p className="pintIndexNote">
            <strong>No eligible prices in {label}.</strong> A price only
            gets into this league if it names a public source and the day it was
            seen. None did in this window, so this edition publishes none rather
            than fill the gap with the legacy prices the map still carries. It
            stays that way: an edition is written once, and a later price
            belongs to a later month.
          </p>
        ) : (
          <PintIndexLeagueTable
            rows={rows}
            caption={`London boroughs ranked by average published pint price, ${label}`}
          />
        )}
        <a className="pintIndexDownload" href={`/pint-index/${month}/data.csv`} download>
          Download {label} (CSV) ↓
        </a>
      </section>

      {/* The expensive end of this month, frozen with the rest of it. The live
          index's national block deliberately does NOT appear here: those
          figures move, and an edition that promises its numbers stay put may
          not carry one that does not. */}
      {summary.dearestPint ? (
        <section className="pintIndexSection" id="dearest" aria-labelledby="dearestHeading">
          <h2 id="dearestHeading" className="pintIndexSectionTitle">The dearest end</h2>
          <p className="pintIndexSectionDek">
            The same table the other way up, ranked on the priciest pint each
            borough had on record in {label}. Top of it:{" "}
            {formatPrice(summary.dearestPint.maxGbp)} at{" "}
            {summary.dearestPint.maxPubName}, {summary.dearestPint.name}.
          </p>
          <PintIndexLeagueTable
            rows={dearestFirst(rows)}
            caption={`London boroughs ranked by their dearest published pint price, ${label}`}
            highlight="dearest"
          />
        </section>
      ) : null}

      <section className="pintIndexSection" aria-labelledby="editionsHeading">
        <h2 id="editionsHeading" className="pintIndexSectionTitle">Every dated edition</h2>
        <p className="pintIndexSectionDek">
          Each closed month keeps its own page. Cite one and it still says the
          same thing a year later.
        </p>
        <PintIndexEditions editions={editions} current={month} />
      </section>

      <p className="pintIndexFootnote">
        <Link href="/pint-index">See the live index →</Link> · <Link href="/map">Open the map →</Link>
      </p>
    </main>
  );
}
