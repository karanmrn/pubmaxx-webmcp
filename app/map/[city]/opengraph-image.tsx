import { ImageResponse } from "next/og";

import { getCity, parseCityId } from "@/lib/cities";
import { summarizeCityPubCoverage } from "@/lib/cityMapCoverage";
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

// City-scoped OG card (Wave S2, Next `opengraph-image` convention). Base
// per-city card on the dark elevation ladder: the city name, its tagline, and
// honest coverage (venues mapped + observed price range) read from that city's
// slim venue pack. Band- and crawl-aware variants are still served by
// `/api/city-map-card` and attached in generateMetadata only when `?band=` /
// `?crawl=` is present (opengraph-image.tsx cannot read searchParams).
//
// runtime = "nodejs": the slim pack + Space Grotesk fonts are read from the
// filesystem (edge-incompatible).

export const runtime = "nodejs";
export const alt = "A city pub map on PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

// Read a city's slim venue pack and derive coverage: how many pubs are mapped
// and the observed cheapest-pint range. Never throws — on any failure the card
// still renders (name + tagline only).
async function cityCoverage(
  slimVenuesPath: string,
): Promise<{ count: number; min: number | null; max: number | null }> {
  try {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    // slimVenuesPath is a public URL path (e.g. "/data/venues_slim.json").
    const file = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "public",
      slimVenuesPath.replace(/^\//, ""),
    );
    return summarizeCityPubCoverage(
      JSON.parse(
        await fs.readFile(/* turbopackIgnore: true */ file, "utf8"),
      ),
    );
  } catch {
    return { count: 0, min: null, max: null };
  }
}

// A raised stat tile: value over a muted label, on a panel step above the page.
function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "22px 30px",
        borderRadius: 18,
        background: OG.panelRaised,
        border: `1px solid ${OG.line}`,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 52,
          fontWeight: 700,
          color: OG.ink,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 22,
          color: OG.muted,
          marginTop: 12,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: raw } = await params;
  const cityId = parseCityId(raw);
  const city = cityId ? getCity(cityId) : null;
  const cityName = clampOgText(city?.displayName, 20, "City", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const tagline = clampOgText(city?.tagline, 72, "Price-aware pub crawls", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });

  const coverage = city
    ? await cityCoverage(city.slimVenuesPath)
    : { count: 0, min: null, max: null };
  const priceRange =
    coverage.min !== null && coverage.max !== null
      ? coverage.min === coverage.max
        ? priceStamp(coverage.min)
        : `${priceStamp(coverage.min)}–${priceStamp(coverage.max)}`
      : null;

  const nameSize = cityName.length > 12 ? 92 : cityName.length > 8 ? 108 : 122;

  return new ImageResponse(
    (
      <CardShell>
        {/* Header: wordmark + edition kicker */}
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
            Pub map
          </div>
        </div>

        {/* Middle: city name (hero) + tagline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap" }}>
            <div
              style={{
                display: "flex",
                fontSize: nameSize,
                fontWeight: 700,
                letterSpacing: -2,
                lineHeight: 0.98,
                color: OG.ink,
              }}
            >
              {cityName}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 44,
                fontWeight: 500,
                color: OG.muted,
                marginLeft: 22,
              }}
            >
              pub map
            </div>
          </div>
          <div
            style={{
              display: "flex",
              color: OG.inkSoft,
              fontSize: 30,
              lineHeight: 1.35,
              marginTop: 22,
              maxWidth: 900,
            }}
          >
            {tagline}
          </div>
        </div>

        {/* Coverage tiles + URL */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: 18 }}>
            {coverage.count > 0 ? (
              <StatTile
                value={coverage.count.toLocaleString("en-GB")}
                label={coverage.count === 1 ? "pub mapped" : "pubs mapped"}
              />
            ) : null}
            {priceRange ? <StatTile value={priceRange} label="pint range" /> : null}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: OG.coral,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 44,
                height: 2,
                background: OG.coral,
                marginRight: 16,
              }}
            />
            pubmaxxing.com
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
