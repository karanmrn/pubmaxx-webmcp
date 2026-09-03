import { ImageResponse } from "next/og";

import { getCity, parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { curatedCrawlByIdForCity } from "@/lib/cityCuratedCrawls";
import { bandByIdForCity } from "@/lib/cityStoryBands";
import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { CrossingMark, OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { readOgCityPriceBandCounts } from "@/lib/ogCityPriceBands.server";
import { clampOgText } from "@/lib/ogCardText";
import {
  buildOgMapCardWaveLayers,
  waveColour,
} from "@/lib/cityMapCardWaves";

// City map OG share card — cult / Freshers deep links (`?band=subcrawl`) and
// curated crawl shares (`?crawl=victorian-soho`). Query-aware because
// opengraph-image.tsx cannot read searchParams.
// Palette: ink + coral (app tokens), not brass-cream guidebook or purple AI defaults.

export const runtime = "nodejs";

const size = {
  width: 1200,
  height: 630,
};

const INK = "#191927";
const INK_DEEP = "#16122a";
const PAPER = "#fff4e8";
const PAPER_DIM = "#d8cfc2";
const CORAL = "#ff5a5f";
const RIVER = "#3f5566";

const display = 'Helvetica, "Helvetica Neue", Arial, sans-serif';
const body = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

export async function GET(request: Request) {
  const limited = await ogCardRateLimitedResponse(request, "og-city-map-card");
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const cityRaw = clampOgText(searchParams.get("city"), 32, DEFAULT_CITY_ID, {
    collapseWhitespace: true,
  });
  const cityId = parseCityId(cityRaw) ?? DEFAULT_CITY_ID;
  const city = getCity(cityId);
  const crawlRaw = clampOgText(searchParams.get("crawl"), 64, "", {
    collapseWhitespace: true,
  });
  const crawl = crawlRaw ? curatedCrawlByIdForCity(cityId, crawlRaw) : undefined;
  const bandRaw = clampOgText(searchParams.get("band"), 64, "", {
    collapseWhitespace: true,
  });
  const band = !crawl && bandRaw ? bandByIdForCity(cityId, bandRaw) : undefined;

  const cityName = clampOgText(city.displayName, 40, "London", {
    collapseWhitespace: true,
  });
  const tagline = crawl
    ? clampOgText(
        crawl.venueIds.length > 0
          ? `${crawl.venueIds.length}-stop crawl · ${city.tagline}`
          : city.tagline,
        72,
        "Price-aware pub crawls",
        { collapseWhitespace: true },
      )
    : clampOgText(city.tagline, 72, "Price-aware pub crawls", {
        collapseWhitespace: true,
      });
  // Crawl name wins over band chip when both are present (share URLs often carry both).
  const highlightTitle = crawl
    ? clampOgText(crawl.name, 48, "", { collapseWhitespace: true })
    : band
      ? clampOgText(band.title, 48, "", { collapseWhitespace: true })
      : "";
  const eyebrow = crawl ? "Crawl" : "City map";

  const priceBandCounts = await readOgCityPriceBandCounts(cityId);
  const waveLayers = buildOgMapCardWaveLayers(priceBandCounts);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `linear-gradient(145deg, ${INK_DEEP} 0%, ${INK} 48%, ${RIVER} 100%)`,
          color: PAPER,
          padding: 64,
          fontFamily: body,
          position: "relative",
        }}
      >
        {/* Soft coral wash — atmosphere, not a sticker overlay */}
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -40,
            width: 520,
            height: 520,
            borderRadius: 999,
            background: `radial-gradient(circle, rgba(255,90,95,0.28) 0%, transparent 68%)`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -120,
            left: -60,
            width: 480,
            height: 480,
            borderRadius: 999,
            background: `radial-gradient(circle, rgba(63,85,102,0.45) 0%, transparent 70%)`,
            display: "flex",
          }}
        />

        {/* Price-band waves — every layer traces a real, corroborated pint-price
            distribution for this city; never decorative randomness. */}
        {waveLayers.length > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            {waveLayers.map((layer) => (
              <path key={layer.band} d={layer.path} fill={waveColour(layer.band)} />
            ))}
          </svg>
        ) : null}

        {/* Hairline frame */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: "2px solid rgba(255,90,95,0.35)",
            borderRadius: 8,
            display: "flex",
          }}
        />

        {/* Header: wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 68,
                height: 68,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                background: CORAL,
                marginRight: 22,
              }}
            >
              <CrossingMark ink={INK_DEEP} size={44} />
            </div>
            <div
              style={{
                fontFamily: display,
                fontSize: 42,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              PUBMAXXING
            </div>
          </div>
          <div
            style={{
              color: CORAL,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </div>
        </div>

        {/* Hero: city name + optional crawl/band chip + tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            zIndex: 1,
            maxWidth: 980,
          }}
        >
          {highlightTitle ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 22,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: INK_DEEP,
                  background: CORAL,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  padding: "10px 20px",
                  borderRadius: 8,
                }}
              >
                {highlightTitle}
              </div>
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontFamily: display,
              fontSize: cityName.length > 12 ? 88 : 104,
              lineHeight: 1.02,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            {cityName}
          </div>
          <div
            style={{
              display: "flex",
              color: PAPER_DIM,
              fontSize: 30,
              lineHeight: 1.35,
              marginTop: 22,
              maxWidth: 820,
            }}
          >
            {tagline}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          <div
            style={{
              color: PAPER_DIM,
              fontSize: 26,
              fontStyle: "italic",
            }}
          >
            Listed prices on PUBMAXX.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: CORAL,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 40,
                height: 2,
                background: CORAL,
                marginRight: 16,
              }}
            />
            pubmaxxing.com
          </div>
        </div>
      </div>
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
