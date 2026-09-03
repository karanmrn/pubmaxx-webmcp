import { ImageResponse } from "next/og";

import { getHistoricPubBySlug, loadHistoricPubs } from "@/lib/historic";
import { listedBadge } from "@/lib/historicFilter";
import { CrossingMark, OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";

// Per-pub Historic Pubs OG share card (Next `opengraph-image` convention).
// Renders the cited heritage of a single pub as a collectible "field-guide
// plate" in the app's printed-guidebook palette: the pub name as the one clear
// focal point, honest era / Grade / borough chips (each omitted when absent),
// the cited hook as the story teaser, and a "Cited from Wikipedia" provenance
// stamp. Provenance-honest and deterministic — nothing is invented, and an
// unknown slug falls back to a clean generic poster rather than throwing.
//
// runtime = "nodejs" (matches the sibling OG routes and is required here:
// loadHistoricPubs reads the filesystem via node:fs, which is edge-incompatible).

export const runtime = "nodejs";
export const alt = "A historic London pub. PUBMAXXING";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand palette (mirrors app/p/[id] + app/tonight — the "printed guidebook").
const PAPER = "#12100c"; // deep charcoal-green paper
const CREAM = "#ece3d2"; // warm cream ink
const CREAM_DIM = "#a99f8b"; // faded ink for supporting text
const BRASS = "#d3a44a"; // single accent

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

// A bordered brass chip. Only ever rendered for present, cited facts.
function Chip({ children }: { children: string }) {
  return (
    <div
      style={{
        display: "flex",
        color: BRASS,
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: 1,
        border: `1px solid ${BRASS}`,
        borderRadius: 8,
        padding: "6px 20px",
      }}
    >
      {children}
    </div>
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pub = getHistoricPubBySlug(slug, await loadHistoricPubs().catch(() => []));

  // Graceful generic fallback for an unknown/missing slug — never throw.
  const name = clampOgText(pub?.name, 40, "Historic London pubs", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const hook = clampOgText(
    pub?.hook,
    180,
    "Cited history from London's oldest pubs.",
    { collapseWhitespace: true, collapseBeforeFilter: true },
  );

  // Chips: only present, cited facts. Omit anything the pub doesn't have.
  const chips: string[] = [];
  const era = clampOgText(pub?.era, 20, "", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  if (era) chips.push(era);
  const grade = listedBadge(pub?.listed ?? null);
  if (grade) chips.push(grade);
  const borough = clampOgText(pub?.borough, 28, "", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  if (borough) chips.push(borough);

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

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            zIndex: 1,
          }}
        >
          {/* Header: wordmark lockup + "Historic Pub" edition line */}
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
              Historic Pub
            </div>
          </div>

          {/* Center: the pub name (focal), cited chips, cited hook teaser */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 1000 }}>
            <div
              style={{
                display: "flex",
                fontFamily: serif,
                fontSize: name.length > 22 ? 76 : 92,
                lineHeight: 1.03,
                fontWeight: 700,
              }}
            >
              {name}
            </div>

            {chips.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginTop: 28,
                }}
              >
                {chips.map((c, i) => (
                  <Chip key={i}>{c}</Chip>
                ))}
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                fontFamily: serif,
                fontStyle: "italic",
                color: CREAM_DIM,
                fontSize: 30,
                lineHeight: 1.4,
                marginTop: 32,
                maxWidth: 960,
              }}
            >
              {hook}
            </div>
          </div>

          {/* Footer: provenance stamp + URL, joined by the brass accent */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: `1px solid ${CREAM_DIM}`,
              paddingTop: 22,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                color: CREAM_DIM,
                fontSize: 24,
                letterSpacing: 1,
              }}
            >
              <div style={{ width: 40, height: 2, background: BRASS, marginRight: 16 }} />
              Cited from Wikipedia · PUBMAXXING
            </div>
            <div
              style={{
                display: "flex",
                color: BRASS,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              pubmaxxing.com
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
