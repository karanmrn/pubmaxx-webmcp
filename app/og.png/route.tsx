import { ImageResponse } from "next/og";

import { CrossingMark, OG_CACHE_HEADERS } from "@/lib/ogBrand";

// The shared brand module loads bundled fonts from public/ with node:fs.
// Keep this route on the Node runtime so production builds and renders use the
// same font path as the other Open Graph cards.
export const runtime = "nodejs";

const size = {
  width: 1200,
  height: 630,
};

// Current PUBMAXX palette. Keep the social card on the same coral/peach
// identity as the product so shared links never fall back to the retired
// green field-guide brand.
const PAPER = "#fff1e6";
const INK = "#1c1412";
const INK_DIM = "#685d59";
const CORAL = "#ff5a5f";
const RIVER = "#6687a7";

const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

export async function GET() {
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
          color: INK,
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
            border: `2px solid rgba(255,90,95,0.28)`,
            borderRadius: 28,
            display: "flex",
          }}
        />

        {/* A single Thames-ish river bend + brass dashed route across the lower third */}
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
            stroke={CORAL}
            strokeWidth="3"
            strokeDasharray="2 14"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          {/* three price pins along the brass route */}
          <circle cx="230" cy="521" r="7" fill={CORAL} />
          <circle cx="700" cy="540" r="7" fill={CORAL} />
          <circle cx="1088" cy="509" r="7" fill={CORAL} />
        </svg>

        {/* Header: wordmark lockup + edition line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
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
                background: CORAL,
                marginRight: 26,
              }}
            >
              <CrossingMark ink={INK} size={52} />
            </div>
            <div
              style={{
                fontSize: 46,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              PUBMAXXING
            </div>
          </div>
          <div
            style={{
              color: CORAL,
              fontSize: 24,
              letterSpacing: 2,
            }}
          >
            London is live
          </div>
        </div>

        {/* Center: headline + tagline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: CORAL,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 22,
            }}
          >
            Real prices · Live plans · Proper nights
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 960,
              fontSize: 88,
              lineHeight: 1.02,
              fontWeight: 700,
            }}
          >
            Make tonight worth remembering.
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 780,
              color: INK_DIM,
              fontSize: 30,
              lineHeight: 1.4,
              marginTop: 26,
            }}
          >
            Find the right place for your mood, meet your Pub Pal, and turn a
            spontaneous night into a story worth keeping.
          </div>
        </div>

        {/* Footer: URL + brass rule */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              color: INK,
              fontSize: 30,
            }}
          >
            Your night. Your people. Your story.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: CORAL,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 46,
                height: 2,
                background: CORAL,
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
