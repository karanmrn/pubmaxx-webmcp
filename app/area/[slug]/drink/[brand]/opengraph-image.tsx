import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import {
  drinkBrandAreaLandingRoute,
  loadDrinkBrandAreaLanding,
} from "@/lib/drinkBrandAreaLanding.server";
import {
  CardShell,
  OG,
  OG_CACHE_HEADERS,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
  priceStamp,
} from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { formatPricedLandingPublisherStatus } from "@/lib/pricedLanding";

// This page owns its own card. Without one Next serves the nearest ancestor's,
// which would show the area card on a one-brand page while the page declares
// `twitter: summary_large_image`.

export const runtime = "nodejs";
export const alt = "London brand pint prices by area. PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string; brand: string }>;
}) {
  const { slug, brand } = await params;
  const landing = await loadDrinkBrandAreaLanding(slug, brand);
  if (!landing) notFound();

  const firstRow = landing.rows[0];
  const heading = clampOgText(
    `Cheapest listed ${landing.brandLabel} pints in ${landing.areaName}`,
    58,
    "",
    { collapseWhitespace: true, collapseBeforeFilter: true },
  );
  const publisherStatus = formatPricedLandingPublisherStatus(firstRow.publisher);
  const route = drinkBrandAreaLandingRoute(landing);

  return new ImageResponse(
    <CardShell>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Wordmark />
        <div
          style={{
            display: "flex",
            color: OG.coral,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          Pint prices
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            color: OG.muted,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          {heading}
        </div>
        <div
          style={{
            display: "flex",
            color: OG.coral,
            fontSize: 166,
            fontWeight: 700,
            letterSpacing: -5,
            lineHeight: 0.9,
          }}
        >
          {priceStamp(firstRow.priceGbp)}
        </div>
        <div
          style={{
            display: "flex",
            color: OG.inkSoft,
            fontSize: 32,
            marginTop: 26,
          }}
        >
          {landing.totalPricedVenues} priced pubs
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          color: OG.muted,
          fontSize: 22,
        }}
      >
        <div style={{ display: "flex" }}>{publisherStatus}</div>
        <div style={{ display: "flex", color: OG.inkSoft }}>{`pubmaxxing.com${route}`}</div>
      </div>
    </CardShell>,
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
