import { ImageResponse } from "next/og";

import { resolveChaosCardParams } from "@/lib/chaosCardParams";
import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { clampOgText } from "@/lib/ogCardText";
import { OG_CACHE_HEADERS } from "@/lib/ogBrand";

export const runtime = "nodejs";

const size = {
  width: 1200,
  height: 630,
};

// Brand palette (mirrors app/api/crawl-card/route.tsx — the "printed
// guidebook" look, brass on ink). Keeping this in lockstep with the crawl
// card is deliberate: the Chaos Card is a sibling artifact, not a new brand.
const PAPER = "#12100c"; // deep charcoal-green paper
const CREAM = "#ece3d2"; // warm cream ink
const BRASS = "#d3a44a"; // single accent
const RIVER = "#3f5566"; // muted Thames blue

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

// A small dice/flame-ish "chaos" glyph — inline SVG, no external asset, no
// emoji font (copy stays dry/witty per the rubric; the mark carries the fun).
function ChaosGlyph() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <path
        d="M26 4 L46 16 V36 L26 48 L6 36 V16 Z"
        stroke={PAPER}
        strokeWidth="3"
        fill="none"
      />
      <circle cx="26" cy="26" r="5" fill={PAPER} />
      <circle cx="16" cy="18" r="3" fill={PAPER} />
      <circle cx="36" cy="34" r="3" fill={PAPER} />
    </svg>
  );
}

export async function GET(request: Request) {
  const limited = await ogCardRateLimitedResponse(request, "og-chaos-card");
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const title = clampOgText(searchParams.get("title"), 64, "A London crawl");
  const { score, grade, oneLiner } = resolveChaosCardParams(searchParams);

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
        {/* Hairline field-guide border — matches crawl-card's frame language */}
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

        {/* Faint river bend, quieter than crawl-card's since the score is the
            hero here, not a route map. */}
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
            opacity="0.2"
            strokeLinecap="round"
          />
        </svg>

        {/* Header: wordmark lockup + card label */}
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
              <ChaosGlyph />
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
            Chaos Score
          </div>
        </div>

        {/* Center: the score itself — bold serif, the hero of the card */}
        <div style={{ display: "flex", flexDirection: "column", zIndex: 1 }}>
          <div
            style={{
              color: BRASS,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 10,
              display: "flex",
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              fontFamily: serif,
            }}
          >
            <div style={{ display: "flex", fontSize: 220, lineHeight: 1, fontWeight: 700 }}>
              {score}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 44,
                marginLeft: 12,
                color: BRASS,
                fontWeight: 700,
              }}
            >
              /100
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: serif,
              fontStyle: "italic",
              fontSize: 40,
              color: BRASS,
              marginTop: 8,
            }}
          >
            {grade}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: serif,
              fontSize: 30,
              color: CREAM,
              marginTop: 18,
              maxWidth: 900,
            }}
          >
            {oneLiner}
          </div>
        </div>

        {/* Footer: url on the right, matching crawl-card */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            zIndex: 1,
          }}
        >
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
