import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import DrinkBrandLandingContent from "@/components/drinks/DrinkBrandLandingContent";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import {
  drinkBrandLandingJsonLd,
  loadDrinkBrandLanding,
  loadDrinkBrandLandings,
} from "@/lib/drinkBrandLanding.server";
import { loadDrinkBrandAreaLandingsForBrand } from "@/lib/drinkBrandAreaLanding.server";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import {
  formatPricedLandingPublisherStatus,
  pricedLandingBrandAreaLinks,
} from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

import "@/components/drinks/drinkBrandDirectory.css";

type PageProps = { params: Promise<{ slug: string }> };

// Every page here reads the per-request CSP nonce, so the document is dynamic
// and a `revalidate` window would bound nothing. `dynamicParams` is the real
// gate: only a slug the loader publishes renders at all.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await loadDrinkBrandLandings()).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const landing = await loadDrinkBrandLanding(slug);

  if (!landing) {
    return {
      title: "Drink",
      robots: { index: false, follow: false },
    };
  }

  const title = `Cheapest ${landing.brandLabel} pints in London`;
  const firstRow = landing.rows[0];
  const publisherStatus = formatPricedLandingPublisherStatus(
    firstRow.publisher,
  );
  const description = `${landing.totalPricedVenues} London pubs with listed ${landing.brandLabel} pints from ${formatPrice(firstRow.priceGbp)}. ${publisherStatus}.`;
  const canonical = `/drink/${encodeURIComponent(landing.slug)}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function DrinkBrandLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const landing = await loadDrinkBrandLanding(slug);
  if (!landing) notFound();

  const [nonce, mapSelectableVenueIds, areaLandings] = await Promise.all([
    headers().then((store) => store.get("x-nonce") ?? undefined),
    loadMapSelectableVenueIds(),
    loadDrinkBrandAreaLandingsForBrand(landing.slug),
  ]);

  return (
    <main id="main" className="drinkBrandLanding">
      <JsonLd data={drinkBrandLandingJsonLd(landing)} nonce={nonce} />
      <SiteNav />
      <DrinkBrandLandingContent
        landing={landing}
        mapSelectableVenueIds={mapSelectableVenueIds}
        areaPages={pricedLandingBrandAreaLinks(landing.slug, areaLandings)}
      />
    </main>
  );
}
