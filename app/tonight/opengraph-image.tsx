import { ImageResponse } from "next/og";

import { OG_CACHE_HEADERS } from "@/lib/ogBrand";

import { fetchThingsToDo } from "@/lib/citymcp/client";
import { buildTonightPosterModel } from "@/lib/tonightPoster";

// Shareable "Tonight in London" OG poster (Wave D · D1, Next `opengraph-image`
// convention). A collectible card in the app's printed-guidebook palette that
// teases what's on tonight with an honest provenance stamp. Fail-soft: any
// upstream error renders the clean generic poster (buildTonightPosterModel of
// null), never a broken image.

export const runtime = "nodejs";
export const alt = "What's on in London tonight. PUBMAXXING";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand palette (mirrors app/p/[id]/opengraph-image — the "printed guidebook").
const PAPER = "#12100c";
const CREAM = "#ece3d2";
const CREAM_DIM = "#a99f8b";
const BRASS = "#d3a44a";

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

export default async function Image() {
  const result = await fetchThingsToDo({ window: "tonight", limit: 12 }).catch(
    () => null,
  );
  const poster = buildTonightPosterModel(result);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: PAPER,
          color: CREAM,
          fontFamily: sans,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: BRASS,
              fontWeight: 700,
            }}
          >
            PUBMAXXING
          </div>
          <div style={{ fontSize: 82, fontFamily: serif, fontWeight: 700, lineHeight: 1.02 }}>
            {poster.title}
          </div>
          <div style={{ fontSize: 34, color: CREAM_DIM }}>{poster.coverage}</div>
        </div>

        {poster.titles.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {poster.titles.map((t, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 36 }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 12,
                    background: BRASS,
                    display: "flex",
                  }}
                />
                {t}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 36, color: CREAM_DIM }}>
            A sourced read of what&rsquo;s on across London tonight.
          </div>
        )}

        <div
          style={{
            fontSize: 24,
            color: CREAM_DIM,
            borderTop: `1px solid ${CREAM_DIM}`,
            paddingTop: 20,
          }}
        >
          {poster.provenance}
        </div>
      </div>
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
