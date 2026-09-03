import { ImageResponse } from "next/og";

import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { CrossingMark, OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { clampOgText, clampOgInt } from "@/lib/ogCardText";

export const runtime = "nodejs";

const size = {
  width: 1200,
  height: 630,
};

// Brand palette (mirrors app/og.png/route.tsx — the "printed guidebook" look).
const PAPER = "#12100c"; // deep charcoal-green paper
const CREAM = "#ece3d2"; // warm cream ink
const BRASS = "#d3a44a"; // single accent
const RIVER = "#3f5566"; // muted Thames blue

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

export async function GET(request: Request) {
  const limited = await ogCardRateLimitedResponse(request, "og-crawl-card");
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const title = clampOgText(searchParams.get("title"), 64, "A London crawl");
  const tag = clampOgText(searchParams.get("tag"), 28);
  const stops = clampOgInt(searchParams.get("stops"), 0, 12, 0);
  const totalRaw = clampOgText(searchParams.get("total"), 12);
  // `total` may arrive as a formatted string or a number — normalise to £x.xx.
  const totalNum = Number(totalRaw.replace(/[^0-9.]/g, ""));
  const total = Number.isFinite(totalNum) && totalNum > 0 ? `£${totalNum.toFixed(2)}` : null;

  const stopLabel = stops > 0 ? `${stops} stop${stops === 1 ? "" : "s"}` : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: CREAM,
          padding: 68,
          fontFamily: sans,
          position: "relative",
        }}
      >
        {/* Hairline field-guide border */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: `2px solid rgba(211,164,74,0.42)`,
            borderRadius: 6,
            display: "flex",
          }}
        />

        {/* Thames-ish river bend + brass dashed route with price pins */}
        <svg
          width="1200"
          height="630"
          viewBox="0 0 1200 630"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <path
            d="M-40 430 C 260 360, 360 520, 640 470 S 980 380, 1260 460"
            stroke={RIVER}
            strokeWidth="26"
            fill="none"
            opacity="0.32"
            strokeLinecap="round"
          />
          <path
            d="M120 545 C 340 500, 470 588, 700 540 S 1010 470, 1120 512"
            stroke={BRASS}
            strokeWidth="3"
            strokeDasharray="2 14"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          <circle cx="230" cy="521" r="7" fill={BRASS} />
          <circle cx="700" cy="540" r="7" fill={BRASS} />
          <circle cx="1088" cy="509" r="7" fill={BRASS} />
        </svg>

        {/* Header: wordmark lockup + edition line */}
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
                width: 76,
                height: 76,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                background: BRASS,
                marginRight: 26,
              }}
            >
              <CrossingMark ink={PAPER} size={52} />
            </div>
            <div
              style={{
                fontFamily: serif,
                fontSize: 42,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              PUBMAXXING
            </div>
          </div>
          <div
            style={{
              fontFamily: serif,
              fontStyle: "italic",
              color: BRASS,
              fontSize: 24,
              letterSpacing: 2,
            }}
          >
            A Crawl Story
          </div>
        </div>

        {/* Center: eyebrow + crawl title */}
        <div style={{ display: "flex", flexDirection: "column", zIndex: 1 }}>
          <div
            style={{
              color: BRASS,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 22,
              display: "flex",
            }}
          >
            {tag ? tag : "A London pub crawl"}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: serif,
              maxWidth: 980,
              fontSize: title.length > 34 ? 76 : 92,
              lineHeight: 1.02,
              fontWeight: 700,
            }}
          >
            {title}
          </div>
        </div>

        {/* Footer: stops + receipt total on the left, URL on the right */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {stopLabel ? (
              <div
                style={{
                  display: "flex",
                  fontFamily: serif,
                  fontStyle: "italic",
                  color: CREAM,
                  fontSize: 30,
                }}
              >
                {stopLabel}
              </div>
            ) : null}
            {total ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: BRASS,
                  fontFamily: serif,
                  fontSize: 34,
                  fontWeight: 700,
                }}
              >
                {total} round
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: BRASS,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 46,
                height: 2,
                background: BRASS,
                marginRight: 18,
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
