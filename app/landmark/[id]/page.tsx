import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import LandmarkPhotoCredit from "@/components/LandmarkPhotoCredit";
import { metadataSiteName } from "@/lib/brandNaming";
import { landmarkById, nearestStoryPubs } from "@/lib/landmarks";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

import "./landmark.css";

type PageProps = { params: Promise<{ id: string }> };

let cachedVenues: Venue[] | null = null;

async function getVenues(): Promise<Venue[]> {
  if (cachedVenues) return cachedVenues;
  try {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const file = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    // Only cache a successful read. An I/O / parse failure must not permanently
    // hide nearby pubs for the lifetime of this lambda/process.
    cachedVenues = groupVenuePrices(Array.isArray(rows) ? rows : []);
    return cachedVenues;
  } catch {
    return [];
  }
}

function startCrawlHref(pubIds: string[]): string {
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", pubIds.join(","));
  return `/map?${params.toString()}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const landmark = landmarkById(id);
  if (!landmark) {
    return { title: "Landmark chapter · PUBMAXXING", robots: { index: false, follow: false } };
  }
  const title = `${landmark.name}: London story chapter · PUBMAXXING`;
  const description = landmark.history.slice(0, 155);
  const canonical = `/landmark/${landmark.id}`;
  return {
    title,
    description,
    alternates: { canonical },
    // App Router shallow-merges metadata: a child openGraph REPLACES the
    // layout's object wholesale, so the shared siteName + /og.png card must be
    // restated here or they'd be dropped on landmark shares. (This route has no
    // file-convention OG image of its own.)
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
      siteName: metadataSiteName(),
      images: ["/og.png"],
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function LandmarkChapterPage({ params }: PageProps) {
  const { id } = await params;
  const landmark = landmarkById(id);
  if (!landmark) notFound();

  const venues = await getVenues();
  const nearby = nearestStoryPubs(landmark, venues, 5);
  const crawlIds = nearby.map((row) => row.venue.id).slice(0, 3);
  const mapHref = `/map?landmark=${encodeURIComponent(landmark.id)}`;

  return (
    <main id="main" className="landmarkChapterPage">
      <SiteNav active="discover" />
      <header className="landmarkChapterHead">
        {/* Deep-link to THIS landmark on the map (?landmark= is the existing
            shareable-URL param PubMap seeds from) — a bare /map dead-ends with
            nothing selected. */}
        <Link className="landmarkChapterEyebrow" href={mapHref}>
          PUBMAXXING · London stories
        </Link>
        <h1 className="landmarkChapterTitle">{landmark.name}</h1>
      </header>

      {landmark.image ? (
        <figure className="landmarkChapterPhoto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={landmark.image.url} alt={landmark.name} loading="eager" decoding="async" />
          <LandmarkPhotoCredit image={landmark.image} />
        </figure>
      ) : null}

      <p className="landmarkChapterHistory">{landmark.history}</p>
      <a
        className="landmarkChapterSource"
        href={landmark.source.url}
        target="_blank"
        rel="noreferrer"
      >
        Source: {landmark.source.label}
        <ExternalLink size={13} aria-hidden="true" />
      </a>

      <div className="landmarkChapterActions">
        <Link className="landmarkChapterBtn" href={mapHref}>
          Open on the map
        </Link>
        {crawlIds.length > 0 ? (
          <Link className="landmarkChapterBtn landmarkChapterBtnPrimary" href={startCrawlHref(crawlIds)}>
            Start a crawl here
          </Link>
        ) : null}
      </div>

      {nearby.length > 0 ? (
        <section aria-labelledby="landmarkNearbyHeading">
          <h2 id="landmarkNearbyHeading" className="landmarkChapterSectionTitle">
            Story pubs nearby
          </h2>
          <p className="landmarkChapterFoot">
            Straight-line distances. Pavement walks will be longer.
          </p>
          <ul className="landmarkChapterPubList">
            {nearby.map(({ venue, km }) => (
              <li key={venue.id}>
                <Link href={`/map?sel=${encodeURIComponent(venue.id)}`}>
                  <span>{venue.name}</span>
                  <span className="landmarkChapterPubDist">{km.toFixed(2)} km</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="landmarkChapterFoot">
        Cited pub stories mapped into walks. <Link href="/crawls">Browse route packs →</Link>
      </p>
    </main>
  );
}
