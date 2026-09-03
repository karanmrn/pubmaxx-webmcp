import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ExternalLink } from "lucide-react";

import { PubPalMascot } from "@/components/pal/PubPalMascot";

import JsonLd from "@/components/seo/JsonLd";
import SiteNav from "@/components/nav/SiteNav";
import ShareBar from "@/components/share/ShareBar";
import { slugifyBorough } from "@/lib/boroughs";
import { buildHistoricPubShareText } from "@/lib/shareArtifacts";
import {
  getHistoricPubBySlug,
  loadHistoricPubs,
  type HistoricPub,
} from "@/lib/historic";
import {
  citationLabel,
  heritageSourceLabel,
  listedBadge,
  venueStatusBadge,
} from "@/lib/historicFilter";

import "./historic-detail.css";

// Per-pub heritage DETAIL page: /historic/[slug]. The canonical, shareable,
// SEO-first surface for one notable London pub — the FULL cited heritage story.
//
// Provenance-honest by construction: every fact is rendered verbatim with its
// source named and a citation link derived strictly from the record's own
// sourceRef. Nothing is invented; the metadata description is the pub's own hook,
// not a fabricated claim. A parallel agent owns the colocated opengraph-image, so
// this file only writes honest metadata — it never references the OG asset.
//
// Next 15/16 dynamic route params are async: `params` is a Promise we await.
// generateStaticParams pre-renders one static page per slug for clean SEO.

type PageProps = { params: Promise<{ slug: string }> };

// Trim + collapse the hook into a clean meta description, capped for SEO. Never
// invents copy — an empty hook falls back to a neutral, honest sentence.
function metaDescription(pub: HistoricPub): string {
  const hook = pub.hook?.replace(/\s+/g, " ").trim() ?? "";
  const base =
    hook || `${pub.name}, a notable London pub. Cited from Wikipedia and Wikidata.`;
  return base.length > 155 ? `${base.slice(0, 154).trimEnd()}…` : base;
}

// Pre-render every notable pub as its own static page (SEO surface).
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const pubs = await loadHistoricPubs();
  return pubs.map((pub) => ({ slug: pub.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const pub = getHistoricPubBySlug(slug, await loadHistoricPubs());

  if (!pub) {
    return {
      title: "Historic pub. PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }

  const title = `${pub.name}. Historic London pub | PUBMAXXING`;
  const description = metaDescription(pub);
  const canonical = `/historic/${pub.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const SITE_URL = "https://pubmaxxing.com";

// LandmarksOrHistoricalBuildings structured data for a cited historic pub
// (Wave S1.3). Every field is lifted verbatim from the record — name, the
// borough it sits in, its coordinates, its own hook — and `sameAs` carries the
// Wikipedia/Wikidata citation URLs from the pub's cited facts, so an AI engine
// can follow provenance straight to the source. Nothing invented: a field only
// appears when the record actually carries it.
function historicPubJsonLd(pub: HistoricPub) {
  const sameAs = Array.from(
    new Set(
      pub.facts
        .map((fact) => fact.sourceRef)
        .filter((ref): ref is string => typeof ref === "string" && /^https?:\/\//.test(ref)),
    ),
  );
  return {
    "@context": "https://schema.org",
    "@type": "LandmarksOrHistoricalBuildings",
    name: pub.name,
    url: `${SITE_URL}/historic/${pub.slug}`,
    ...(pub.hook ? { description: pub.hook } : {}),
    ...(pub.borough
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: pub.borough,
            addressRegion: "London",
            addressCountry: "GB",
          },
        }
      : {}),
    ...(typeof pub.lat === "number" && typeof pub.lng === "number"
      ? { geo: { "@type": "GeoCoordinates", latitude: pub.lat, longitude: pub.lng } }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export default async function HistoricDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const pub = getHistoricPubBySlug(slug, await loadHistoricPubs());
  if (!pub) notFound();

  // Per-request CSP nonce (proxy.ts) for the JSON-LD block.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const grade = listedBadge(pub.listed);
  const status = venueStatusBadge(pub.venueStatus);
  const boroughSlug = pub.borough ? slugifyBorough(pub.borough) : null;
  const mapHref = pub.venueId ? `/map?sel=${pub.venueId}` : null;
  const canonical = `/historic/${pub.slug}`;
  const shareText = buildHistoricPubShareText({ name: pub.name, hook: pub.hook });

  return (
    <main id="main" className="hdPage">
      <JsonLd data={historicPubJsonLd(pub)} nonce={nonce} />
      <SiteNav active="historic" />

      <p className="hdBack">
        <Link href="/historic" className="hdBackLink">
          &larr; All historic pubs
        </Link>
      </p>

      <header className="hdHead">
        {pub.era || grade || status ? (
          <div className="hdMeta">
            {pub.era ? <span className="hdEra">{pub.era}</span> : null}
            {grade ? <span className="hdGrade">{grade}</span> : null}
            {status ? <span className="hdGrade">{status}</span> : null}
          </div>
        ) : null}

        <h1 className="hdTitle">{pub.name}</h1>

        {pub.borough ? (
          <p className="hdBorough">
            {boroughSlug ? (
              <Link href={`/borough/${boroughSlug}`} className="hdBoroughLink">
                {pub.borough}
              </Link>
            ) : (
              pub.borough
            )}
          </p>
        ) : null}

        {pub.hook ? <p className="hdHook">{pub.hook}</p> : null}
      </header>

      <section className="hdStory" aria-labelledby="hdStoryHeading">
        <h2 id="hdStoryHeading" className="hdStoryHeading">
          The record
        </h2>

        {pub.facts.length === 0 ? (
          <p className="hdEmpty" role="status">
            No fuller story on record. Every claim here is cited, and we
            won&rsquo;t invent one to fill the gap.
          </p>
        ) : (
          <ol className="hdFacts">
            {pub.facts.map((fact, i) => (
              <li key={`${fact.source}-${i}`} className="hdFact">
                <p className="hdFactText">{fact.fact}</p>
                <div className="hdFactProvenance">
                  <span className="hdSource">{heritageSourceLabel(fact.source)}</span>
                  {fact.sourceRef ? (
                    <a
                      className="hdCite"
                      href={fact.sourceRef}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {citationLabel(fact.sourceRef)}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="hdActions" aria-label="Explore this pub">
        {mapHref ? (
          <div className="hdActionRow">
            <Link className="hdAction hdActionPrimary pressable" href={mapHref}>
              See on map
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
            <Link className="hdAction pressable" href={mapHref}>
              <PubPalMascot size={14} circular lazy />
              Ask your Pub Pal
            </Link>
          </div>
        ) : null}

        <ShareBar url={canonical} title={pub.name} text={shareText} />
      </section>

      <footer className="hdProvenance">
        Cited from Wikipedia and Wikidata. Never invented.
      </footer>
    </main>
  );
}
