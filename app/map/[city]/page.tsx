import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PubMaxingShell from "@/components/PubMaxingShell";
import { readTrustedHandoffFlags } from "@/lib/trustedHandoffFlags.server";
import { getCity, parseCityId } from "@/lib/cities";
import {
  cityMapOgAlt,
  cityMapOgDescription,
  cityMapOgImageUrl,
  cityMapOgTitle,
  cityMapShareUrl,
  firstSearchParam,
  stopCountFromPubsParam,
} from "@/lib/cityShare";

type CityMapPageProps = {
  params: Promise<{ city: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const mapWarmVersion = process.env.NEXT_PUBLIC_SW_VERSION?.trim() || "local";

export async function generateMetadata({ params, searchParams }: CityMapPageProps): Promise<Metadata> {
  const { city: raw } = await params;
  const cityId = parseCityId(raw);
  if (!cityId) return { title: "City map", robots: { index: false, follow: false } };
  const city = getCity(cityId);
  if (!city.enabled) return { title: "City map", robots: { index: false, follow: false } };
  const sp = searchParams ? await searchParams : undefined;
  const band = firstSearchParam(sp?.band);
  const crawl = firstSearchParam(sp?.crawl);
  const stopCount = stopCountFromPubsParam(firstSearchParam(sp?.pubs));
  const opts = { band, crawl, stopCount };
  const title = cityMapOgTitle(cityId, opts);
  const description = cityMapOgDescription(cityId, opts);
  const url = cityMapShareUrl(cityId, opts);
  const alt = cityMapOgAlt(cityId, opts);
  const image = band || crawl ? cityMapOgImageUrl(cityId, opts) : null;
  return {
    title,
    description,
    alternates: { canonical: cityId === "london" ? "/map" : `/map/${cityId}` },
    openGraph: { title, description, type: "website", url, ...(image ? { images: [{ url: image, width: 1200, height: 630, alt }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(image ? { images: [image] } : {}) },
  };
}
export default async function CityMapPage({ params }: CityMapPageProps) {
  const { city: raw } = await params;
  const cityId = parseCityId(raw);
  if (!cityId || !getCity(cityId).enabled) notFound();
  return (
    <>
      {cityId === "london" ? (
        // eslint-disable-next-line @next/next/no-sync-scripts
        <script src={`/map-first-paint-init.js?v=${encodeURIComponent(mapWarmVersion)}`} />
      ) : null}
      <PubMaxingShell cityId={cityId} flags={readTrustedHandoffFlags()} />
    </>
  );
}
