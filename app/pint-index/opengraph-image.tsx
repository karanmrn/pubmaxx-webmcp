import { ImageResponse } from "next/og";

import { loadPublicPintIndexSnapshot } from "@/lib/pintIndexSnapshot.server";
import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";

export const runtime = "nodejs";
export const alt = "The London Pint Index public data status · PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const snapshot = await loadPublicPintIndexSnapshot();
  const count = snapshot?.observations.length ?? 0;
  return new ImageResponse(
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <Wordmark />
        <div style={{ display: "flex", color: OG.coral, fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>Public data</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ display: "flex", color: OG.muted, fontSize: 25, fontWeight: 600, letterSpacing: 5, textTransform: "uppercase", marginBottom: 18 }}>The London Pint Index</div>
        <div style={{ display: "flex", color: OG.ink, fontSize: 82, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
          {count > 0 ? `${count} citable observations` : "Public release pending"}
        </div>
        <div style={{ display: "flex", color: OG.inkSoft, fontSize: 30, lineHeight: 1.35, marginTop: 26 }}>
          Only sourced, dated observations enter the public Index. Legacy baseline prices are excluded.
        </div>
      </div>
      <div style={{ display: "flex", color: OG.muted, fontSize: 21 }}>pubmaxxing.com/pint-index</div>
    </CardShell>,
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
