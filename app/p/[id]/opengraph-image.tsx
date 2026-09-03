import { ImageResponse } from "next/og";

import { getPintDropById } from "@/lib/pintDropLookup";
import { CrossingMark, OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";

// Per-drop OG share card (Next `opengraph-image` convention). Renders the Pint
// Drop as a collectible "pint memory card" — a beer-mat with a pressed brass
// price stamp as the one bold signature — in the app's printed-guidebook
// palette. Reads the public DTO (leak-proof: hidden drops resolve to null and
// fall back to sensible defaults). All text is clamped — it originates from
// user content, so it is never rendered unbounded.

export const runtime = "nodejs";
export const alt = "A Pint Drop on PUBMAXXING";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand palette (mirrors app/og.png/route.tsx — the "printed guidebook" look).
const PAPER = "#12100c"; // deep charcoal-green paper
const CREAM = "#ece3d2"; // warm cream ink
const CREAM_DIM = "#a99f8b"; // faded ink for supporting text
const BRASS = "#d3a44a"; // single accent
const RIVER = "#3f5566"; // muted Thames blue

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

function priceStamp(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return `£${value.toFixed(2)}`;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drop = await getPintDropById(id).catch(() => null);

  const venue = clampOgText(drop?.venueName, 44, "A London pub", { collapseWhitespace: true });
  const handle = clampOgText(drop?.handle, 24, "someone", { collapseWhitespace: true });
  const drink = clampOgText(drop?.drink, 40, "", { collapseWhitespace: true });
  const note = clampOgText(drop?.note, 120, "", { collapseWhitespace: true });
  const era = clampOgText(drop?.era, 24, "", { collapseWhitespace: true });
  const tag = clampOgText(drop?.vibeTags?.[0], 22, "", { collapseWhitespace: true });
  const price = priceStamp(drop?.priceGbp ?? null);
  const headline = drink || note || "A pint worth remembering";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: PAPER,
          color: CREAM,
          padding: 56,
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
            border: "2px solid rgba(211,164,74,0.42)",
            borderRadius: 6,
            display: "flex",
          }}
        />

        {/* A single Thames-ish river bend behind the card */}
        <svg
          width="1200"
          height="630"
          viewBox="0 0 1200 630"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <path
            d="M-40 470 C 260 400, 360 560, 640 510 S 980 420, 1260 500"
            stroke={RIVER}
            strokeWidth="26"
            fill="none"
            opacity="0.28"
            strokeLinecap="round"
          />
        </svg>

        {/* The collectible card body */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            zIndex: 1,
          }}
        >
          {/* Header: wordmark lockup + "a pint drop" edition line */}
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
                  width: 68,
                  height: 68,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 14,
                  background: BRASS,
                  marginRight: 24,
                }}
              >
                <CrossingMark ink={PAPER} />
              </div>
              <div
                style={{
                  fontFamily: serif,
                  fontSize: 40,
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
              A Pint Drop
            </div>
          </div>

          {/* Center: venue eyebrow, the pint (headline), price stamp signature */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", maxWidth: 800 }}>
              <div
                style={{
                  color: BRASS,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 5,
                  textTransform: "uppercase",
                  marginBottom: 18,
                  display: "flex",
                }}
              >
                {venue}
              </div>
              <div
                style={{
                  display: "flex",
                  fontFamily: serif,
                  fontSize: headline.length > 30 ? 64 : 80,
                  lineHeight: 1.03,
                  fontWeight: 700,
                }}
              >
                {headline}
              </div>
              {note && drink ? (
                <div
                  style={{
                    display: "flex",
                    fontFamily: serif,
                    fontStyle: "italic",
                    color: CREAM_DIM,
                    fontSize: 28,
                    lineHeight: 1.35,
                    marginTop: 22,
                    maxWidth: 760,
                  }}
                >
                  “{note}”
                </div>
              ) : null}
            </div>

            {/* The pressed brass price stamp — the one bold signature element */}
            {price ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 190,
                  height: 190,
                  marginLeft: 32,
                  borderRadius: 999,
                  border: `4px solid ${BRASS}`,
                  transform: "rotate(-9deg)",
                  color: BRASS,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Paid
                </div>
                <div style={{ fontFamily: serif, fontSize: 56, fontWeight: 700, lineHeight: 1 }}>
                  {price}
                </div>
                <div style={{ fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }}>
                  a pint
                </div>
              </div>
            ) : null}
          </div>

          {/* Footer: signature (@handle · era · tag) + URL */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: serif,
                  fontStyle: "italic",
                  color: CREAM,
                  fontSize: 30,
                }}
              >
                @{handle}
              </div>
              {era ? (
                <div style={{ display: "flex", color: CREAM_DIM, fontSize: 26 }}>· {era}</div>
              ) : null}
              {tag ? (
                <div
                  style={{
                    display: "flex",
                    color: BRASS,
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: 1,
                    border: `1px solid ${BRASS}`,
                    borderRadius: 6,
                    padding: "4px 14px",
                    textTransform: "lowercase",
                  }}
                >
                  {tag}
                </div>
              ) : null}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                color: BRASS,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              <div style={{ width: 40, height: 2, background: BRASS, marginRight: 16 }} />
              pubmaxxing.com
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
