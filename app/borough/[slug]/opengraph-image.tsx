import { ImageResponse } from "next/og";

import { getVenueIndex } from "@/lib/venueIndex";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { boroughFromSlug, pubsInBorough } from "@/lib/boroughs";
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

// Per-borough OG share card (Wave S2.2, Next `opengraph-image` convention).
// Renders the borough's headline pint economics — the single cheapest tracked
// pint as the giant coral figure, the average pint, and how many pubs are
// tracked — on the dark elevation ladder. Provenance-honest: every number comes
// from the same bundled dataset the borough page reads, and a borough with no
// priced pubs (or an unknown slug) degrades to a clean generic poster rather
// than inventing a price.
//
// runtime = "nodejs": loadVenues reads the dataset from the filesystem via
// node:fs (edge-incompatible), and the Space Grotesk fonts are read from
// public/fonts the same way. Matches the sibling OG routes.

export const runtime = "nodejs";
export const alt = "The cheapest pints and best pubs in this London borough. PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

// Same loader shape the borough page uses: warm the memoized index, then read
// the full price rows and group them into Venue[]. Never throws — a read/parse
// failure yields [] so the card still renders (generic poster).
async function loadVenues() {
  try {
    await getVenueIndex();
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "pint_prices_app_dataset.json",
    );
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    return groupVenuePrices(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

// A raised stat tile: a value over a muted label, on a panel step above the
// page. Used for the average pint + tracked-pub count.
function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minWidth: 210,
        padding: "22px 30px",
        borderRadius: 18,
        background: OG.panelRaised,
        border: `1px solid ${OG.line}`,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 54,
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
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const venues = await loadVenues();
  const resolved = boroughFromSlug(slug, venues);
  const name = clampOgText(resolved, 22, "London", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });

  const pubs = resolved ? pubsInBorough(venues, slug) : [];
  const priced = pubs.filter((p) => typeof p.cheapestPrice === "number");
  // pubsInBorough already sorts cheapest-first, so the first priced pub carries
  // the borough's cheapest tracked pint.
  const cheapest = priceStamp(priced[0]?.cheapestPrice ?? null);
  const avgRaw = priced.length
    ? priced.reduce((sum, p) => sum + (p.averagePrice ?? p.cheapestPrice ?? 0), 0) /
      priced.length
    : null;
  const avg = priceStamp(avgRaw);
  const pubCount = pubs.length;

  // Borough name scales down as it gets longer so it never collides with the
  // frame ("City of London", "Kensington & Chelsea").
  const nameSize = name.length > 16 ? 66 : name.length > 11 ? 78 : 92;

  return new ImageResponse(
    (
      <CardShell>
        {/* Header: wordmark lockup + edition kicker */}
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

        {/* Middle: eyebrow → borough name → the giant price figure + stat tiles */}
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
            Cheapest pint in
          </div>
          <div
            style={{
              display: "flex",
              fontSize: nameSize,
              fontWeight: 700,
              letterSpacing: -1,
              lineHeight: 1.0,
              color: OG.ink,
            }}
          >
            {name}
          </div>

          {cheapest ? (
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                marginTop: 30,
                width: "100%",
              }}
            >
              {/* The giant cheapest-pint figure — the one hero number */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 180,
                    fontWeight: 700,
                    lineHeight: 0.9,
                    letterSpacing: -4,
                    color: OG.coral,
                  }}
                >
                  {cheapest}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 24,
                    color: OG.inkSoft,
                    marginTop: 14,
                    letterSpacing: 1,
                  }}
                >
                  the cheapest tracked pint
                </div>
              </div>

              {/* Supporting stat tiles */}
              <div style={{ display: "flex", gap: 18, marginBottom: 6 }}>
                {avg ? <StatTile value={avg} label="average pint" /> : null}
                <StatTile
                  value={String(pubCount)}
                  label={pubCount === 1 ? "pub tracked" : "pubs tracked"}
                />
              </div>
            </div>
          ) : (
            // No priced pubs (or unknown slug): honest, no invented figure.
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 34,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 40,
                  fontWeight: 700,
                  color: OG.inkSoft,
                }}
              >
                {pubCount > 0
                  ? `${pubCount} ${pubCount === 1 ? "pub" : "pubs"} on the map`
                  : "On the map across London"}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 26,
                  color: OG.muted,
                  marginTop: 14,
                }}
              >
                Real prices land as the area gets walked.
              </div>
            </div>
          )}
        </div>

        {/* Footer: honest ranking note + URL joined by the coral rule */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              color: OG.muted,
              fontSize: 24,
              letterSpacing: 0.5,
            }}
          >
            London · ranked cheapest pint first
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: OG.coral,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
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
