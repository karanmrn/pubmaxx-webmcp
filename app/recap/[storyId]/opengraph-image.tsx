import { ImageResponse } from "next/og";

import {
  CardShell,
  CrossingMark,
  OG,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
} from "@/lib/ogBrand";
import {
  recapOgCacheHeaders,
  selectRecapCardData,
  type RecapCardData,
} from "@/lib/recapCard";
import { recapCardStats } from "@/lib/recapCardStats.server";
import { getNightStory } from "@/lib/nightMemoryStore";

// The shared-recap OG image — the WhatsApp/iMessage preview that makes people
// tap. Co-located with the public recap page (app/recap/[storyId], owned by
// Lane 2). Two variants:
//
//  • RICH  — an approved-shared NightStory: night title + date, a stylised route
//            line with the stop count, a headline stat row (pints, boroughs,
//            ending), an optional pressed-brass cheapest-pint plaque, wordmark.
//  • FALLBACK — anything unapproved/private/missing: a brand-generic card with
//            NO night details. Crawlers always get an image, never a 404.
//
// The RICH/FALLBACK decision is the privacy gate in `selectRecapCardData`; this
// route only fetches the public-safe inputs and paints. No photos (privacy + og
// render cost) and no crew handles unless the approval flow cleared them.

export const runtime = "nodejs";
export const alt = "A night on PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ storyId: string }> };

async function loadCardData(storyId: string): Promise<RecapCardData> {
  try {
    // actorId = null → the public accessor only returns a story once it is
    // approved-shared (published + not private); private/draft/missing → null.
    const story = await getNightStory(storyId, null);
    const stats = story ? await recapCardStats(storyId).catch(() => null) : null;
    return selectRecapCardData({
      story,
      stats,
      nightDate: stats?.nightDateIso ?? null,
    });
  } catch {
    // Never leak, never 500 a crawler.
    return { variant: "fallback" };
  }
}

// A single headline stat tile: big figure over a small uppercase label.
function StatTile({ figure, label }: { figure: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", color: OG.ink, fontSize: 68, fontWeight: 700, lineHeight: 1, letterSpacing: -1 }}>
        {figure}
      </div>
      <div style={{ display: "flex", color: OG.muted, fontSize: 20, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", marginTop: 10 }}>
        {label}
      </div>
    </div>
  );
}

// The ending tile: a small eyebrow over the ending's short label set in coral —
// the emotional punctuation of the stat row, not a number.
function EndingTile({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", color: OG.muted, fontSize: 20, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase" }}>
        The night
      </div>
      <div style={{ display: "flex", color: OG.coralBright, fontSize: 42, fontWeight: 700, lineHeight: 1, letterSpacing: -1, marginTop: 12 }}>
        {label}
      </div>
    </div>
  );
}

// A stylised route line: filled coral node → hairline → … → amber end node, with
// the stop count pressed into the middle. Legible as a "journey" at thumbnail
// size without any map data.
function RouteLine({ stopCount }: { stopCount: number }) {
  const nodes = Math.min(Math.max(stopCount, 2), 6);
  return (
    <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
      {Array.from({ length: nodes }).map((_, i) => {
        const isFirst = i === 0;
        const isLast = i === nodes - 1;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : "1 1 0" }}>
            <div
              style={{
                width: isFirst || isLast ? 20 : 13,
                height: isFirst || isLast ? 20 : 13,
                borderRadius: 999,
                background: isFirst ? OG.coral : isLast ? OG.amber : OG.inkSoft,
                display: "flex",
                boxShadow: isFirst ? "0 0 22px rgba(255,90,95,0.6)" : isLast ? "0 0 22px rgba(240,160,26,0.55)" : "none",
              }}
            />
            {!isLast ? (
              <div style={{ flex: "1 1 0", height: 3, background: OG.line, marginLeft: 6, marginRight: 6, borderRadius: 2, display: "flex" }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// The pressed-brass cheapest-pint plaque — the one signature accent, echoing the
// Pint Drop card. Only rendered when there is an honest cheapest-pint figure.
function PricePlaque({ price }: { price: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: 172,
        height: 172,
        borderRadius: 999,
        border: `4px solid ${OG.amber}`,
        transform: "rotate(-8deg)",
        color: OG.amber,
        flexShrink: 0,
        boxShadow: "0 0 34px rgba(240,160,26,0.28)",
      }}
    >
      <div style={{ display: "flex", fontSize: 15, letterSpacing: 3, textTransform: "uppercase", fontWeight: 700 }}>Cheapest</div>
      <div style={{ display: "flex", fontSize: 54, fontWeight: 700, lineHeight: 1 }}>{price}</div>
      <div style={{ display: "flex", fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }}>a pint</div>
    </div>
  );
}

function FallbackCard() {
  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <Wordmark />
        <div style={{ display: "flex", color: OG.coral, fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>
          Night recap
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 960 }}>
        <div style={{ display: "flex", color: OG.ink, fontSize: 82, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
          Plan the night. Walk it. Keep it.
        </div>
        <div style={{ display: "flex", color: OG.inkSoft, fontSize: 30, lineHeight: 1.35, marginTop: 24 }}>
          Recaps stay private until their crew approves the share.
        </div>
      </div>
      <div style={{ display: "flex", color: OG.muted, fontSize: 21 }}>pubmaxxing.com</div>
    </CardShell>
  );
}

function RichCard({ data }: { data: Extract<RecapCardData, { variant: "rich" }> }) {
  const numericStats: Array<{ figure: string; label: string }> = [];
  if (data.pintsLogged != null) numericStats.push({ figure: String(data.pintsLogged), label: data.pintsLogged === 1 ? "Pint" : "Pints" });
  if (data.boroughsCrossed != null) numericStats.push({ figure: String(data.boroughsCrossed), label: data.boroughsCrossed === 1 ? "Borough" : "Boroughs" });

  const showRoute = data.stopCount != null && data.stopCount >= 2;

  return (
    <CardShell>
      {/* Header: wordmark + eyebrow */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <Wordmark />
        <div style={{ display: "flex", alignItems: "center", color: OG.coral, fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>
          <div style={{ display: "flex", marginRight: 12 }}>
            <CrossingMark ink={OG.coral} size={26} />
          </div>
          Night recap
        </div>
      </div>

      {/* Hero: date eyebrow → title → route line + stop count */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 1000 }}>
        {data.dateLabel ? (
          <div style={{ display: "flex", color: OG.muted, fontSize: 24, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", marginBottom: 16 }}>
            {data.dateLabel}
          </div>
        ) : null}
        <div style={{ display: "flex", color: OG.ink, fontSize: data.title.length > 34 ? 68 : 88, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
          {data.title}
        </div>
        {showRoute ? (
          <div style={{ display: "flex", alignItems: "center", width: "100%", marginTop: 34 }}>
            <div style={{ display: "flex", flex: "1 1 0", marginRight: 26 }}>
              <RouteLine stopCount={data.stopCount as number} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", flexShrink: 0 }}>
              <div style={{ display: "flex", color: OG.coral, fontSize: 40, fontWeight: 700, marginRight: 10 }}>{data.stopCount}</div>
              <div style={{ display: "flex", color: OG.muted, fontSize: 22, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }}>stops</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer: stat row (+ crew) on the left, brass plaque on the right */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 56 }}>
            {numericStats.map((s, i) => (
              <StatTile key={i} figure={s.figure} label={s.label} />
            ))}
            {data.endingLabel ? <EndingTile label={data.endingLabel} /> : null}
          </div>
          {data.crew.length > 0 ? (
            <div style={{ display: "flex", color: OG.inkSoft, fontSize: 22, marginTop: 26 }}>
              with {data.crew.join(" · ")}
            </div>
          ) : null}
        </div>
        {data.cheapestPint ? <PricePlaque price={data.cheapestPint} /> : null}
      </div>
    </CardShell>
  );
}

export default async function Image({ params }: Params) {
  const { storyId } = await params;
  const data = await loadCardData(storyId);
  const body = data.variant === "rich" ? <RichCard data={data} /> : <FallbackCard />;
  return new ImageResponse(body, {
    ...size,
    fonts: loadOgFonts(),
    headers: recapOgCacheHeaders(data.variant),
  });
}
