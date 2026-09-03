import {
  BRAND_COLORS,
  MARK_EMBER,
  MARK_PLAQUE_RADIUS,
  MARK_POLYGONS,
  MARK_SLASH_SIMPLE,
  MARK_VIEWBOX,
} from "@/lib/brandMark.mjs";

import "./pubmaxxMark.css";

// ── PUBMAXX mark: "The Crossing X" ────────────────────────────────────────────
// A blackboard-bold / double-struck X, built on the X Corp construction: one
// THICK solid descending stroke (\, top-left → bottom-right) and an ascending
// stroke (/, bottom-left → top-right) SPLIT INTO TWO thin parallel strokes that
// pass either side of the thick one, leaving a clear channel where they cross.
// Flat sharp terminals, zero ornament — a confident, distinctly PUBMAXX X that
// survives down to a 16px favicon (where it falls back to the simplified single
// ascending stroke, `slashSimple`, since the double-stroke channel closes up).
//
// Geometry lives on a 64x64 grid and comes from lib/brandMark.mjs, the single
// source of truth this component, the satori OG cards (lib/ogBrand.tsx) and the
// two asset generators (scripts/gen-brand-assets.mjs,
// scripts/gen-native-app-icons.mjs) all import. Each of them used to keep its
// own copy of the coordinates, which is how the shipped home-screen icon could
// drift off the brand with no test failing. Change a coordinate there and
// re-run the generators. The strokes are filled polygons, not stroked paths, so
// the flat-cut terminals stay crisp at every raster tier.
//
// This shape is kept for the ~40 in-app readers of MARK_GEOMETRY; it is a view
// of the master, never a second copy of it.

export const MARK_GEOMETRY = {
  viewBox: MARK_VIEWBOX,
  thick: MARK_POLYGONS.thick,
  thinA: MARK_POLYGONS.thinA,
  thinB: MARK_POLYGONS.thinB,
  slashSimple: MARK_SLASH_SIMPLE,
  // The ember: a lit spark at the crossing. It is NOT part of the icon
  // silhouette - the static favicon / PWA / app-icon exports drop it (the
  // double-struck crossing is already the event, and a dot muddies it). It is
  // kept only on the lit in-app brand surfaces (duo / plaque variants, the
  // Strike pop, the night seal, the loading ember) as a personality touch.
  node: MARK_EMBER,
  // Full-bleed tile radius for the standalone/plaque variant.
  plaqueRadius: MARK_PLAQUE_RADIUS,
} as const;

// Token colours with literal fallbacks so the mark also renders correctly
// outside the app's CSS (Storybook, emails, satori is handled separately in
// lib/ogBrand.tsx). Inside the app these resolve to the live theme tokens.
// Exported so the Strike animation family (PubmaxxMarkStrike) can single-source
// the same palette without re-declaring the tokens — a drift here would ship a
// mark whose animated draw finishes in a different colour than the static rest.
export const MARK_COLORS = {
  coral: `var(--brass, ${BRAND_COLORS.coral})`,
  bright: `var(--brass-bright, ${BRAND_COLORS.coralBright})`,
  inkDeep: `var(--ink-deep, ${BRAND_COLORS.inkDeep})`,
} as const;

const COL = MARK_COLORS;

export type PubmaxxMarkVariant = "mono" | "duo" | "plaque";

export interface PubmaxxMarkProps {
  /** Rendered pixel size (width & height). Default 28. */
  size?: number;
  /**
   * mono   — single-colour X in `currentColor`; inherits theme ink. Default.
   * duo    — coral X with a lit coral-bright ember at the crossing, transparent bg.
   * plaque — ink-deep rounded-square tile with the coral X + ember on it.
   */
  variant?: PubmaxxMarkVariant;
  /**
   * Accessible name. When provided the SVG is exposed as an image with this
   * label; when omitted the mark is decorative (aria-hidden) — pair it with
   * adjacent text (e.g. the wordmark) that already names the brand.
   */
  title?: string;
  className?: string;
}

const g = MARK_GEOMETRY;

export default function PubmaxxMark({
  size = 28,
  variant = "mono",
  title,
  className = "",
}: PubmaxxMarkProps) {
  const labelled = Boolean(title);
  // Strokes are coral on the duo/plaque variants and inherit ink via
  // currentColor on mono. The plaque lays them on an ink-deep tile; duo/mono
  // are transparent.
  const armFill = variant === "mono" ? "currentColor" : COL.coral;
  const showTile = variant === "plaque";
  const showNode = variant !== "mono";

  return (
    <svg
      className={`pubmaxxMark ${className}`.trim()}
      width={size}
      height={size}
      viewBox={g.viewBox}
      fill="none"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {showTile ? (
        <rect width="64" height="64" rx={g.plaqueRadius} fill={COL.inkDeep} />
      ) : null}
      {/* Two thin ascending strokes first, then the thick descending stroke on
          top — the double-struck crossing. */}
      <polygon points={g.thinA} fill={armFill} />
      <polygon points={g.thinB} fill={armFill} />
      <polygon points={g.thick} fill={armFill} />
      {showNode ? <circle cx={g.node.cx} cy={g.node.cy} r={g.node.r} fill={COL.bright} /> : null}
    </svg>
  );
}
