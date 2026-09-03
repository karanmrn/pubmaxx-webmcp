import { ImageResponse } from "next/og";

import { buildBarTab, normalizePintDrop, type PintDropDTO } from "@/lib/feed";
import {
  CardShell,
  OG,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
  priceStamp,
} from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { isSupabaseConfigured } from "@/lib/supabase";
import { memoryPintDropStore, supabasePintDropStore } from "@/lib/pintDropsStore";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";
import { getVenueIndex } from "@/lib/venueIndex";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

// Per-venue Bar Tab OG share card (Next `opengraph-image` convention) — the
// last shared night-object URL that had no card (WhatsApp-native share
// artifacts, Cycle 2 decision 5). Renders the venue's tab headline on the
// dark elevation ladder: the cheapest pint dropped on the tab as the coral
// hero figure, plus how many pints are on the tab. Provenance-honest: both
// numbers come from the SAME public listVisible read the page renders (issue
// #29 visibility applied server-side), so the card can never show a pint the
// page would hide — and a tab with no priced drops shows no figure at all.
// An unknown id degrades to a clean generic poster rather than throwing.
//
// runtime = "nodejs": the venue dataset and the Space Grotesk fonts are read
// from the filesystem via node:fs (edge-incompatible). Matches the sibling
// OG routes.

export const runtime = "nodejs";
export const alt = "Recent pints dropped at this London pub. PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

// Same loader shape the Bar Tab page uses: warm the memoized index, read the
// full price rows, group into Venue[], look up by id with merged-duplicate
// (D1) alias resolution. Never throws — a read failure yields null so the
// card still renders (generic poster).
async function getVenue(id: string): Promise<Venue | null> {
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
    const index = new Map<string, Venue>();
    for (const venue of groupVenuePrices(Array.isArray(rows) ? rows : [])) {
      index.set(venue.id, venue);
    }
    const direct = index.get(id);
    if (direct) return direct;
    const canonical = await resolveCanonicalVenueId(id);
    return canonical === id ? null : index.get(canonical) ?? null;
  } catch {
    return null;
  }
}

// The same public read the page makes — anonymous surface, visibility applied.
async function loadBarTab(venueId: string) {
  try {
    const store = isSupabaseConfigured() ? supabasePintDropStore : memoryPintDropStore;
    const drops = await store.listVisible(venueId);
    return buildBarTab((drops as PintDropDTO[]).map(normalizePintDrop));
  } catch {
    return { tileCount: 0, cheapestGbp: null };
  }
}

// A raised stat tile: a value over a muted label, on a panel step above the
// page (mirrors the borough card).
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
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const venue = await getVenue(id);
  const barTab = venue ? await loadBarTab(venue.id) : { tileCount: 0, cheapestGbp: null };

  const name = clampOgText(venue?.name, 36, "A London pub", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const borough = clampOgText(venue?.primaryBorough, 28, "London", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const cheapest = priceStamp(barTab.cheapestGbp);
  const pintCount = barTab.tileCount;

  // Venue name scales down as it gets longer so it never collides with the
  // frame ("The Princess Louise", "The Cittie of Yorke").
  const nameSize = name.length > 24 ? 60 : name.length > 16 ? 72 : 86;

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
            The Bar Tab
          </div>
        </div>

        {/* Middle: eyebrow → venue name → the hero figure + stat tile */}
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
            Recent pints dropped at
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
              {/* The cheapest pint on the tab — the one hero number */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 170,
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
                  the cheapest pint on the tab
                </div>
              </div>

              <div style={{ display: "flex", gap: 18, marginBottom: 6 }}>
                <StatTile
                  value={String(pintCount)}
                  label={pintCount === 1 ? "pint on the tab" : "pints on the tab"}
                />
              </div>
            </div>
          ) : (
            // No priced drops (or unknown id): honest, no invented figure.
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
                {pintCount > 0
                  ? `${pintCount} ${pintCount === 1 ? "pint" : "pints"} on the tab`
                  : "The tab is open"}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 26,
                  color: OG.muted,
                  marginTop: 14,
                }}
              >
                Photos, prices, and the stories behind them.
              </div>
            </div>
          )}
        </div>

        {/* Footer: borough + URL joined by the coral rule */}
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
            {borough} · pints as they were poured
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
    { ...size, fonts: loadOgFonts() },
  );
}
