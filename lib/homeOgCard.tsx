import { ImageResponse } from "next/og";

import { loadAboutStats, type AboutStats } from "@/lib/aboutStats";
import {
  CardShell,
  OG,
  OG_CACHE_HEADERS,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
} from "@/lib/ogBrand";

// The homepage OG hero card (Wave S2.5). The route half is
// app/api/home-card/route.tsx, which explains why this card is served from a
// route rather than from a root `opengraph-image.tsx`: every heavy import below
// would otherwise ride inside the deployed function of every page on the site.
//
// The card is the most-forwarded surface the product has: a referral link
// (/r/<code>) lands on /#referral=…, whose head is the homepage's, so an invite
// preview IS this image. Two rules follow from that.
//
// FIRST, the numbers are read from lib/aboutStats, the SAME derived figures the
// landing hero and /about print. Not a copy of the read: this card used to
// group the price dataset itself, and because that count did not drop the rows
// carrying no price it claimed 1,908 pubs tracked beside a chip promising
// listed prices, while the site's own pages said 953. One claim, one source. A
// figure typed in here as a literal would rot the day the dataset moved.
//
// SECOND, the brand on it is the site header's wordmark (lib/ogBrand
// `Wordmark`), never a boxed mark.
//
// The route declares runtime = "nodejs": the counts are read from the
// filesystem and the Space Grotesk fonts are read from public/fonts, both
// edge-incompatible.

// The coverage line under the hero. Every entry is a real count or it is
// absent: a zeroed figure is dropped rather than printed as "0 pubs", which is
// the same guard the landing footer applies (components/landing/LandingPage
// footerFacts). London is the flagship, so the cities figure is stated as the
// capital plus the rest.
export function homeCardCoverage(stats: AboutStats): string[] {
  const bits: string[] = [];
  if (stats.pubsTracked > 0) {
    bits.push(`${stats.pubsTracked.toLocaleString("en-GB")} pubs tracked`);
  }
  if (stats.pintPricesObserved > 0) {
    bits.push(
      `${stats.pintPricesObserved.toLocaleString("en-GB")} prices on record`,
    );
  }
  const otherCities = Math.max(0, stats.citiesCovered - 1);
  if (otherCities > 0) bits.push(`London + ${otherCities} cities`);
  else if (stats.citiesCovered > 0) bits.push("London");
  return bits;
}

// The hero, kept in step with the landing page it fronts: the h1 line the
// product already owns, then the lede under it. No jokes on this card, because
// a figure sits four lines below (docs/VOICE.md, "Where the jokes live").
export const HOME_CARD_EYEBROW = "Real prices · One map · Nobody pays to rank";
export const HOME_CARD_HERO_LEAD = "London pints";
export const HOME_CARD_HERO_TAIL = "can cost";
export const HOME_CARD_HERO_ACCENT = "eight quid.";
export const HOME_CARD_SUPPORT =
  "Choose its form and voice in five steps. Sign in to keep it, then talk or type while it shapes a night from PUBMAXX prices, venues, and events.";

export function HomeOgCard({ stats }: { stats: AboutStats }) {
  const coverageBits = homeCardCoverage(stats);

  return (
    <CardShell>
      {/* Header: wordmark + live coverage kicker */}
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
            alignItems: "center",
            color: OG.coral,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: OG.pint,
              marginRight: 12,
              display: "flex",
            }}
          />
          London is live
        </div>
      </div>

      {/* Middle: eyebrow, the hero, supporting line */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            color: OG.coral,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          {HOME_CARD_EYEBROW}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: -3,
            lineHeight: 0.98,
            color: OG.ink,
            maxWidth: 1060,
          }}
        >
          <div style={{ display: "flex" }}>{HOME_CARD_HERO_LEAD}</div>
          <div style={{ display: "flex" }}>
            {HOME_CARD_HERO_TAIL}
            <span style={{ color: OG.coral, display: "flex", marginLeft: 22 }}>
              {HOME_CARD_HERO_ACCENT}
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            color: OG.inkSoft,
            fontSize: 28,
            lineHeight: 1.35,
            marginTop: 26,
            maxWidth: 1060,
          }}
        >
          {HOME_CARD_SUPPORT}
        </div>
      </div>

      {/* Footer: derived coverage chips + URL. Three real counts plus the URL
          fill the width, so the chips run a size under the URL and the row
          keeps a gap the eye can read as a break rather than a collision. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {coverageBits.map((bit, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 ? (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: OG.muted,
                    margin: "0 14px",
                    display: "flex",
                  }}
                />
              ) : null}
              <div
                style={{
                  display: "flex",
                  color: i === 0 ? OG.inkSoft : OG.muted,
                  fontSize: 23,
                  fontWeight: i === 0 ? 700 : 500,
                }}
              >
                {bit}
              </div>
            </div>
          ))}
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
  );
}

export async function renderHomeOgCard() {
  const stats = await loadAboutStats();

  return new ImageResponse(<HomeOgCard stats={stats} />, {
    ...OG_SIZE,
    fonts: loadOgFonts(),
    headers: OG_CACHE_HEADERS,
  });
}
