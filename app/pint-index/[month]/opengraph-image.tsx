import { ImageResponse } from "next/og";

import { pintIndexMonthLabel } from "@/lib/pintIndexArchive";
import { loadArchivedPintIndexMonth } from "@/lib/pintIndexSnapshot.server";
import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";

// The card a dated edition shares as. It names the MONTH, because the whole
// point of the edition is that the figures belong to a window and stay there.

export const runtime = "nodejs";
export const alt = "A dated edition of The London Pint Index · PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const edition = await loadArchivedPintIndexMonth(month);
  // An unpublished month has no card, the same way it has no page and no CSV.
  // Rendering one would answer 200 for any segment and print it back.
  if (!edition) return new Response(null, { status: 404 });
  const label = pintIndexMonthLabel(month);
  const count = edition.observations.length;

  return new ImageResponse(
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <Wordmark />
        <div style={{ display: "flex", color: OG.coral, fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>{label}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ display: "flex", color: OG.muted, fontSize: 25, fontWeight: 600, letterSpacing: 5, textTransform: "uppercase", marginBottom: 18 }}>The London Pint Index</div>
        <div style={{ display: "flex", color: OG.ink, fontSize: 82, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
          {count > 0 ? `${count} cited prices, ${label}` : `${label}, no cited price`}
        </div>
        <div style={{ display: "flex", color: OG.inkSoft, fontSize: 30, lineHeight: 1.35, marginTop: 26 }}>
          A closed month, frozen the day it was published. The figures do not move again.
        </div>
      </div>
      <div style={{ display: "flex", color: OG.muted, fontSize: 21 }}>pubmaxxing.com/pint-index/{month}</div>
    </CardShell>,
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
