import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import DrinkBrandAreaLandingContent from "@/components/drinks/DrinkBrandAreaLandingContent";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import {
  drinkBrandAreaLandingJsonLd,
  drinkBrandAreaLandingRoute,
  loadDrinkBrandAreaLanding,
  loadDrinkBrandAreaLandings,
} from "@/lib/drinkBrandAreaLanding.server";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import { formatPricedLandingPublisherStatus } from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

import "@/components/drinks/drinkBrandDirectory.css";

type PageProps = {
  params: Promise<{ slug: string; brand: string }>;
};

// See app/drink/[slug]/page.tsx: the nonce makes the document dynamic, so
// `dynamicParams` is the gate, not a revalidate window.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<
  Array<{ slug: string; brand: string }>
> {
  return (await loadDrinkBrandAreaLandings()).map(({ areaSlug, brandSlug }) => ({
    slug: areaSlug,
    brand: brandSlug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, brand } = await params;
  const landing = await loadDrinkBrandAreaLanding(slug, brand);

  if (!landing) {
    return {
      title: "Drink by area",
      robots: { index: false, follow: false },
    };
  }

  const firstRow = landing.rows[0];
  const title = `Cheapest ${landing.brandLabel} pints in ${landing.areaName}`;
  const description = `${landing.totalPricedVenues} ${landing.areaName} pubs with listed ${landing.brandLabel} pints from ${formatPrice(firstRow.priceGbp)}. ${formatPricedLandingPublisherStatus(firstRow.publisher)}.`;
  const canonical = drinkBrandAreaLandingRoute(landing);

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

export default async function DrinkBrandAreaLandingPage({
  params,
}: PageProps) {
  const { slug, brand } = await params;
  const landing = await loadDrinkBrandAreaLanding(slug, brand);
  if (!landing) notFound();

  const [nonce, mapSelectableVenueIds] = await Promise.all([
    headers().then((store) => store.get("x-nonce") ?? undefined),
    loadMapSelectableVenueIds(),
  ]);

  return (
    <main id="main" className="drinkBrandAreaLanding">
      <JsonLd data={drinkBrandAreaLandingJsonLd(landing)} nonce={nonce} />
      <SiteNav />
      <DrinkBrandAreaLandingContent
        landing={landing}
        mapSelectableVenueIds={mapSelectableVenueIds}
      />
    </main>
  );
}
