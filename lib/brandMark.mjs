// The PUBMAXX mark, and the icon tiles cut from it.
//
// The mark is the double-struck X (docs/BRAND_MARK.md): one THICK descending
// stroke (\) drawn on top of two THIN parallel ascending strokes (/) with a
// clear channel between them where the thick stroke crosses.
//
// Four consumers need the SAME numbers and cannot share a TypeScript module:
// the in-app component (components/brand/PubmaxxMark.tsx), the satori OG cards
// (lib/ogBrand.tsx, a Node route that must not pull a stylesheet), and the two
// asset generators (scripts/gen-brand-assets.mjs, scripts/gen-native-app-icons.mjs)
// which run outside the bundler. Each of the four held its own copy of the
// coordinates, so the shipped home-screen icon could drift from the brand
// without a single test noticing. They now all import this file. Plain ESM, no
// imports, matching lib/pintIndexCanonical.mjs and lib/ukPlaceName.mjs.
//
// This module also owns the ICON POLICY, because the field colour and the mark
// inset are what make an icon read on a phone. They are not styling: an icon
// whose mark touches the tile edge reads cheap, and an icon whose mark leaves
// the platform safe zone gets cropped by the mask.

/** The grid every polygon below is drawn on. */
export const MARK_VIEWBOX = "0 0 64 64";

/**
 * The three strokes of the master mark. `points` feeds an SVG <polygon>
 * directly; filled polygons rather than stroked paths keep the flat-cut
 * terminals crisp at every raster tier.
 */
export const MARK_POLYGONS = {
  /** The ascending stroke (/), upper-left of the pair, ~5u wide. */
  thinA: "42,10 47,10 13,54 8,54",
  /** The ascending stroke (/), lower-right of the pair, ~5u wide. */
  thinB: "51,10 56,10 22,54 17,54",
  /** The descending stroke (\), ~12u wide, drawn on top of both thins. */
  thick: "9,10 21,10 55,54 43,54",
};

/**
 * The small-optics cut: a single ~8u ascending stroke replacing the thin pair.
 * Below about 24px the ~4u channel between the two thins closes up and the mark
 * turns to mud, so the 16px favicon.ico member takes this instead.
 */
export const MARK_SLASH_SIMPLE = "45,10 53,10 19,54 11,54";

/**
 * The lit spark at the crossing. It belongs to the in-app brand surfaces and
 * the OG cards only. Every static icon export drops it, because at icon sizes a
 * dot at centre fills the channel that makes the mark double-struck.
 */
export const MARK_EMBER = { cx: 32, cy: 32, r: 3.2 };

/** Corner radius of the rounded plaque tile on the 64 grid. */
export const MARK_PLAQUE_RADIUS = 15;

/**
 * Literal token values. Every surface this module feeds renders OUTSIDE the app
 * stylesheet (satori, sharp, a raw SVG file), so no `var(--brass)` can resolve
 * here. Keep these equal to the tokens they name in app/globals.css and
 * app/theme.css.
 */
export const BRAND_COLORS = {
  /** --brass, the brand accent. The mark is this colour on every icon. */
  coral: "#ff5a5f",
  /** --brass-bright, the ember. Never on an icon. */
  coralBright: "#ff7a55",
  /** --ink-deep, the dark field. */
  inkDeep: "#060607",
  /**
   * The light field. Pure white rather than the house warm paper #fffdf9:
   * owner verdict 2026-07-22, after rendering both at 180px. Pure white reads
   * crisper on a home screen and gives the coral its full contrast, and the
   * warm tint slightly softened the coral for no gain.
   */
  paper: "#ffffff",
};

/**
 * The two icon fields. An icon is one of these plus the coral mark, and nothing
 * else. `light` is what every linked icon ships as today; `dark` is the same
 * tile on ink for the surfaces that can actually select it.
 */
export const ICON_TILE_FIELDS = {
  light: BRAND_COLORS.paper,
  dark: BRAND_COLORS.inkDeep,
};

/**
 * How much of the tile the mark takes, as a fraction of the tile WIDTH, per
 * tier. These are the margins, and they are the difference between an icon that
 * reads and one that looks like a sticker.
 *
 * - `tile` (0.62): the home-screen and browser-tab tier. iOS draws its own
 *   superellipse mask over a full-bleed square, so the mark needs real air
 *   inside the tile or it collides with the rounded corners. 0.62 sits in the
 *   60 to 65 percent band Apple's own icon grid implies.
 * - `safeZone` (0.54): the maskable and monochrome tier. Android may crop the
 *   tile to a circle of 80 percent diameter, so what matters is not the mark's
 *   width but its CORNER radius from centre: the mark's extreme point sits at
 *   about 32.6u from centre on the 64 grid, further out than half its width,
 *   and a scale picked off the width alone pushes it past the mask.
 *   `markFitsSafeZone` below is the check, and the fence runs it.
 */
export const ICON_MARK_WIDTH = {
  tile: 0.62,
  safeZone: 0.54,
};

/** Diameter of the Android maskable safe circle, as a fraction of the icon. */
export const MASKABLE_SAFE_ZONE = 0.8;

function parsePoints(points) {
  return points.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x, y };
  });
}

function markPoints() {
  return [
    ...parsePoints(MARK_POLYGONS.thinA),
    ...parsePoints(MARK_POLYGONS.thinB),
    ...parsePoints(MARK_POLYGONS.thick),
  ];
}

/**
 * The mark's bounding box on the 64 grid, DERIVED from the polygons rather than
 * written down, so a coordinate change moves it and the fence sees the move.
 */
export const MARK_BOUNDS = (() => {
  const pts = markPoints();
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
})();

/**
 * The mark's furthest point from the grid centre. This, not the width, is what
 * a circular platform mask crops against.
 */
export const MARK_CORNER_RADIUS = (() => {
  const c = 32;
  return Math.max(...markPoints().map((p) => Math.hypot(p.x - c, p.y - c)));
})();

/**
 * The `scale()` factor that makes the mark `widthFraction` of the tile width.
 * The mark is already centred on (32,32), so the transform is a pure scale
 * about centre and never a translate. Rounded to 4 places because this number
 * is written into a committed SVG, where a raw float tail reads as a bug and
 * buys no accuracy at 512px.
 */
export function markScaleForWidth(widthFraction) {
  return Math.round(((widthFraction * 64) / MARK_BOUNDS.width) * 1e4) / 1e4;
}

/**
 * Whether a mark drawn at `scale` stays inside the Android maskable safe circle.
 * Used by the fence, so a future coordinate change that pushes a corner out of
 * the mask fails a test instead of shipping a clipped icon.
 */
export function markFitsSafeZone(scale) {
  return MARK_CORNER_RADIUS * scale <= (MASKABLE_SAFE_ZONE / 2) * 64;
}

/**
 * The mark as SVG polygons. `simple` takes the small-optics single-slash cut.
 * Never emits the ember: this function exists to cut icons.
 */
export function markPolygonsSvg(fill, { simple = false } = {}) {
  const ascending = simple
    ? `<polygon points="${MARK_SLASH_SIMPLE}" fill="${fill}"/>`
    : `<polygon points="${MARK_POLYGONS.thinA}" fill="${fill}"/>` +
      `<polygon points="${MARK_POLYGONS.thinB}" fill="${fill}"/>`;
  return ascending + `<polygon points="${MARK_POLYGONS.thick}" fill="${fill}"/>`;
}

/**
 * THE one icon cutter. Every favicon, PWA icon, maskable icon and apple-touch
 * icon in the tree is this function with different arguments, which is what
 * stops the home-screen icon from drifting away from the browser-tab one.
 *
 * - `field`: "light" | "dark", or a literal colour for the native generator.
 * - `radius`: 0 for a full-bleed square (apple-touch and maskable, where the
 *   platform supplies the mask), MARK_PLAQUE_RADIUS for the rounded plaque.
 * - `widthFraction`: from ICON_MARK_WIDTH.
 * - `px`: when given, the SVG carries explicit width/height attributes.
 */
export function iconTileSvg({
  field = "light",
  radius = MARK_PLAQUE_RADIUS,
  widthFraction = ICON_MARK_WIDTH.tile,
  fill = BRAND_COLORS.coral,
  simple = false,
  px = null,
} = {}) {
  const background = ICON_TILE_FIELDS[field] ?? field;
  const scale = markScaleForWidth(widthFraction);
  const mark = markPolygonsSvg(fill, { simple });
  const size = px == null ? "" : ` width="${px}" height="${px}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="${MARK_VIEWBOX}">` +
    `<rect width="64" height="64" rx="${radius}" fill="${background}"/>` +
    `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${mark}</g>` +
    `</svg>`
  );
}

/**
 * The mark alone on transparency: the Android adaptive foreground and the
 * `purpose: "monochrome"` themed icon, where the platform draws its own field.
 * It takes the safe-zone inset for the same reason the maskable tile does.
 */
export function iconMarkOnlySvg({
  fill = BRAND_COLORS.coral,
  widthFraction = ICON_MARK_WIDTH.safeZone,
  px = null,
} = {}) {
  const scale = markScaleForWidth(widthFraction);
  const size = px == null ? "" : ` width="${px}" height="${px}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="${MARK_VIEWBOX}">` +
    `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">` +
    `${markPolygonsSvg(fill)}</g></svg>`
  );
}
