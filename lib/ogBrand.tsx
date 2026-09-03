import "server-only";

import { readFileSync } from "fs";
import { join } from "path";
import type { ReactNode } from "react";

import { MARK_EMBER, MARK_POLYGONS, MARK_VIEWBOX } from "@/lib/brandMark.mjs";

// Shared brand kit for the dynamic `next/og` share cards (Wave S2). These cards
// render OUTSIDE the app's CSS — satori/@vercel/og only understands inline
// styles and a small flexbox subset — so every design token the app expresses
// as a CSS custom property is re-declared here as a literal value.
//
// Palette = the dark-elevation ladder from app/theme.css's
// `html[data-theme="dark"]` block + the Candle-Coral action accent from
// app/globals.css (`--brass: #ff5a5f`). satori can't read `var(--…)`, so the
// hexes are copied verbatim from those files. Keep this module the single
// source of truth for OG colour so the borough / city / homepage cards can
// never drift apart.
//
// Imported ONLY by `opengraph-image.tsx` route modules (Node runtime), never by
// a normal page — so it adds zero bytes to any client/page bundle.

export const OG = {
  // Elevation ladder (deepest well → paper → panel → raised → overlay),
  // from app/theme.css html[data-theme="dark"].
  inkDeep: "#060607", // --ink-deep — deepest near-black
  paper: "#0a0a0b", // --paper
  panel: "#141416", // --panel
  panelRaised: "#1c1c1f", // --panel-raised
  panelOverlay: "#242427", // --panel-overlay
  // Ink ramp.
  ink: "#eef3ef", // --ink — near-white
  inkSoft: "#c9c9ce", // --ink-soft
  muted: "#9a9aa0", // --muted
  line: "#2c2c30", // --line — hairlines
  // Accents. Coral (Candle Coral, app/globals.css --brass) owns the brand /
  // action; amber (app/theme.css dark --amber) is route + price energy.
  coral: "#ff5a5f", // --brass (light) — the brand accent
  coralBright: "#ff7a55", // --brass-bright
  amber: "#f0a01a", // --amber / --night-amber — price + route energy
  pint: "#5fb389", // --pint (cheap / positive go-green)
} as const;

export const OG_SIZE = { width: 1200, height: 630 } as const;

// Shared Cache-Control for every dynamic OG image (metadata `opengraph-image`
// routes + the `*-card` API routes). These render a font-loaded, fs-reading PNG
// on a Node function; the per-request CSP nonce (proxy.ts) forces dynamic
// rendering, so Next does NOT apply its static-image immutable cache — without
// this header every social-crawler refetch (facebookexternalhit / Slackbot /
// Twitterbot) re-rasterizes the card. A share card's content is stable-ish for a
// URL, so we let the CDN hold it for an hour with a long stale-while-revalidate
// window: the browser revalidates modestly (max-age=0) while the edge serves an
// instant hit, and a redraw after a data change lands within the SWR window.
// Applied via the `headers` option on `new ImageResponse(el, { ...size, headers })`.
export const OG_CACHE_CONTROL =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
export const OG_CACHE_HEADERS = { "cache-control": OG_CACHE_CONTROL } as const;

// The canonical page background: a near-black diagonal wash across the
// elevation ladder. Kept as one string so every card opens on the same surface.
export const OG_BG = `linear-gradient(150deg, ${OG.inkDeep} 0%, ${OG.panel} 52%, ${OG.paper} 100%)`;

// ── Fonts ────────────────────────────────────────────────────────────────────
// Space Grotesk is the PUBMAXX display face (see app/layout.tsx). satori needs
// the raw font bytes, so two static instances (500 Medium, 700 Bold) are
// vendored under public/fonts and read from disk at render. public/ is always
// present in the deployed output (the borough page already reads public/data
// via the same process.cwd() pattern in production), so the files are
// guaranteed traced — no fetch, no external dependency at render time.
//
// Registered weights: 500 (body / labels / wordmark) and 700 (headlines + the
// big price figure). satori resolves any requested weight to the nearest of
// these, so a fontWeight:400 node renders as Medium and 600+ as Bold.

type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 700;
  style: "normal";
};

let fontCache: OgFont[] | null = null;

export function loadOgFonts(): OgFont[] {
  if (fontCache) return fontCache;
  const dir = join(process.cwd(), "public", "fonts");
  const medium = readFileSync(join(dir, "SpaceGrotesk-Medium.ttf"));
  const bold = readFileSync(join(dir, "SpaceGrotesk-Bold.ttf"));
  fontCache = [
    { name: "Space Grotesk", data: medium, weight: 500, style: "normal" },
    { name: "Space Grotesk", data: bold, weight: 700, style: "normal" },
  ];
  return fontCache;
}

// Party accent for share-card vibe stamps (docs/VIBE_LAYER_SPEC_2026-07-19.md):
// Bungee Regular, vendored like the Space Grotesk instances above. Loaded ONLY
// by card routes that render a vibe stamp, and only alongside loadOgFonts() —
// satori resolves unknown font-family strings to the first registered font, so
// a card passing fonts must always register the Space Grotesk pair first and
// Bungee last, keeping Bungee from swallowing the card's base typography.
let partyFontCache: OgFont | null = null;

export function loadPartyFont(): OgFont {
  if (partyFontCache) return partyFontCache;
  const data = readFileSync(
    join(process.cwd(), "public", "fonts", "Bungee-Regular.ttf"),
  );
  partyFontCache = { name: "Bungee", data, weight: 400, style: "normal" };
  return partyFontCache;
}

export const OG_FONT_FAMILY = "Space Grotesk";

// GBP price stamp, or null when there is no honest, positive number to show.
export function priceStamp(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return `£${value.toFixed(2)}`;
}

// ── Shared marks ─────────────────────────────────────────────────────────────

// The one 64-grid geometry every mark on a card is cut from: the master
// double-struck X (docs/BRAND_MARK.md). It comes from lib/brandMark.mjs rather
// than from components/brand/PubmaxxMark.tsx because that module pulls a
// stylesheet and a client component into a Node OG route, and rather than from
// a literal here because a fourth copy of the coordinates is how the shipped
// home-screen icon drifted off the brand. Re-exported under this name so the
// ~17 card consumers stay untouched.
export { MARK_POLYGONS };

// The PUBMAXX X mark as an inline-literal SVG: one thick descending stroke (\)
// and two thin parallel ascending strokes (/) either side of it, plus a lit
// coral-bright ember at the crossing (kept here because these cards render the
// mark large, ≥46px). Filled polygons (not strokes) keep the flat-cut terminals
// crisp; satori renders <polygon> from the SVG subset directly. `ink` is the
// stroke colour so the mark can sit on any card surface.
export function CrossingMark({ ink, size = 46 }: { ink: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} fill="none">
      <polygon points={MARK_POLYGONS.thinA} fill={ink} />
      <polygon points={MARK_POLYGONS.thinB} fill={ink} />
      <polygon points={MARK_POLYGONS.thick} fill={ink} />
      <circle cx={MARK_EMBER.cx} cy={MARK_EMBER.cy} r={MARK_EMBER.r} fill={OG.coralBright} />
    </svg>
  );
}

// A wordmark `×`: the same master construction with NO ember, because these two
// are letterforms rather than the lit brand moment
// (components/brand/PubmaxxWordmark.tsx says the same).
function WordmarkGlyph({ ink, size }: { ink: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} fill="none">
      <polygon points={MARK_POLYGONS.thinA} fill={ink} />
      <polygon points={MARK_POLYGONS.thinB} fill={ink} />
      <polygon points={MARK_POLYGONS.thick} fill={ink} />
    </svg>
  );
}

// The PUBMAXX wordmark, drawn the way the site header draws it
// (components/brand/PubmaxxWordmark.tsx): PUBMA, the doubled `××` hero with the
// second glyph tinted coral, then ING. The proportions are that component's own
// CSS re-expressed in px, because satori reads neither `em` reliably nor the
// stylesheet: glyph 0.78 of the type size, tracking -0.045, 0.025 between the
// three parts, 0.005 between the two glyphs, the pair inset 0.015 / 0.03.
//
// There is no coral chip and no boxed mark here. The old lockup put an
// ink-deep X on a coral rounded square, which is the sanctioned plaque tile
// inverted, and it read on a share preview as another app's icon. `scale`
// shrinks the wordmark for tighter footers.
export function Wordmark({ scale = 1 }: { scale?: number }) {
  const size = Math.round(40 * scale);
  const glyph = Math.round(size * 0.78);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size * 0.025,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: size * -0.045,
        color: OG.ink,
      }}
    >
      <div style={{ display: "flex" }}>PUBMA</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: size * 0.005,
          marginLeft: size * 0.015,
          marginRight: size * 0.03,
        }}
      >
        <WordmarkGlyph ink={OG.ink} size={glyph} />
        <WordmarkGlyph ink={OG.coral} size={glyph} />
      </div>
      <div style={{ display: "flex" }}>ING</div>
    </div>
  );
}

// The near-black page shell every card opens on: the diagonal elevation wash, a
// soft coral glow bleeding in from the top-right, a fainter amber wash
// lower-left for depth, and a hairline inset frame. Children render above all of
// it. `padding` lets a card breathe wider or tighter.
export function CardShell({
  children,
  padding = 64,
}: {
  children: ReactNode;
  padding?: number;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: OG_BG,
        padding,
        fontFamily: OG_FONT_FAMILY,
        position: "relative",
      }}
    >
      {/* Coral glow, top-right — the one warm light source on the near-black. */}
      <div
        style={{
          position: "absolute",
          top: -160,
          right: -120,
          width: 620,
          height: 620,
          borderRadius: 999,
          background:
            "radial-gradient(circle, rgba(255,90,95,0.30) 0%, rgba(255,122,85,0.10) 40%, transparent 70%)",
          display: "flex",
        }}
      />
      {/* Faint amber wash, lower-left, for depth without noise. */}
      <div
        style={{
          position: "absolute",
          bottom: -220,
          left: -160,
          width: 560,
          height: 560,
          borderRadius: 999,
          background:
            "radial-gradient(circle, rgba(240,160,26,0.10) 0%, transparent 68%)",
          display: "flex",
        }}
      />
      {/* Hairline inset frame — contains the composition on the dark field. */}
      <div
        style={{
          position: "absolute",
          top: 26,
          left: 26,
          right: 26,
          bottom: 26,
          border: `1px solid ${OG.line}`,
          borderRadius: 22,
          display: "flex",
        }}
      />
      {children}
    </div>
  );
}
