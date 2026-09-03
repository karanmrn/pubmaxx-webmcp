// The whole PUBMAXX icon set, as one table.
//
// Every file here is `iconTileSvg()` or `iconMarkOnlySvg()` from lib/brandMark.mjs
// with different arguments, rasterised by sharp. There is no geometry, no colour
// and no inset in this file: it is a list of TIERS, so a coordinate change in
// the master moves the favicon, the PWA icons, the maskable icon and the iOS
// home-screen icon together in one run.
//
// Two consumers share it, which is the point: scripts/gen-brand-assets.mjs
// writes the result to disk, and __tests__/brandIconAssets.test.ts builds the
// same result in memory and fails when a committed file no longer matches. A
// fence that re-implemented the table would only ever prove itself right.
//
// TWO FIELDS, one mark. The LIGHT tile (white field, coral mark) is what every
// linked icon ships as. The DARK tile (ink field, coral mark) ships beside it
// for the one selector the platforms honour today: a
// `media="(prefers-color-scheme: dark)"` favicon link. docs/BRAND_MARK.md says
// what iOS does and does not honour.
//
// No static icon export carries the ember: the double-struck crossing is
// already the event, and a dot at centre fills the channel that makes the mark
// double-struck. The 16px favicon.ico member takes the simplified single-slash
// cut, because that channel closes up below about 24px.

import sharp from "sharp";

import {
  BRAND_COLORS,
  ICON_MARK_WIDTH,
  ICON_TILE_FIELDS,
  MARK_PLAQUE_RADIUS,
  MARK_VIEWBOX,
  iconMarkOnlySvg,
  iconTileSvg,
  markPolygonsSvg,
} from "./brandMark.mjs";

// ── The tiers ─────────────────────────────────────────────────────────────────
// `plaque` is the rounded tile the browser tab and the PWA "any" icon wear.
// `bleed` is the full-bleed square: iOS and Android draw their own mask over
// it, so a corner radius of ours would show through as a second corner.
const plaque = (field) => iconTileSvg({ field, radius: MARK_PLAQUE_RADIUS });
const bleed = (field) => iconTileSvg({ field, radius: 0 });
const sizedPlaque = (field, px) => iconTileSvg({ field, radius: MARK_PLAQUE_RADIUS, px });

// The maskable tier: full-bleed square with the mark pulled in to the safe zone,
// so a circular Android mask cannot clip a stroke terminal.
const maskable = (field) =>
  iconTileSvg({ field, radius: 0, widthFraction: ICON_MARK_WIDTH.safeZone });

// The themed tier (`purpose: "monochrome"`): the mark alone on transparency.
// Android reads the ALPHA and paints its own field and tint, so the fill only
// matters to a consumer that renders the file literally, and coral keeps that
// render on brand.
const monochrome = () => iconMarkOnlySvg({ fill: BRAND_COLORS.coral });

/**
 * Rasterise one tile. `opaque` flattens onto the tile's own field. The
 * apple-touch and maskable icons must carry no alpha at all: iOS composites a
 * transparent apple-touch icon onto black, which turns a white tile into a dark
 * smudge, and Android expects a maskable icon to fill its whole box.
 */
async function pngBuffer(markup, size, { opaque = null } = {}) {
  let img = sharp(Buffer.from(markup)).resize(size, size);
  if (opaque) img = img.flatten({ background: opaque });
  return img.png().toBuffer();
}

/**
 * Build a classic multi-image ICO (PNG members): 6-byte ICONDIR + one 16-byte
 * ICONDIRENTRY per size + the PNG blobs. The repo has no ico tool, so we
 * assemble the container.
 */
export function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  entries.forEach((e, i) => {
    const b = dir.subarray(i * 16, i * 16 + 16);
    b.writeUInt8(e.size >= 256 ? 0 : e.size, 0); // width (0 => 256)
    b.writeUInt8(e.size >= 256 ? 0 : e.size, 1); // height
    b.writeUInt8(0, 2); // palette
    b.writeUInt8(0, 3); // reserved
    b.writeUInt16LE(1, 4); // colour planes
    b.writeUInt16LE(32, 6); // bits per pixel
    b.writeUInt32LE(e.png.length, 8); // bytes in resource
    b.writeUInt32LE(offset, 12); // offset from start of file
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/** Read the members back out of an ICO container, for the fence. */
export function readIcoMembers(buffer) {
  const count = buffer.readUInt16LE(4);
  const members = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const declared = buffer.readUInt8(entry);
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    members.push({
      size: declared === 0 ? 256 : declared,
      png: buffer.subarray(offset, offset + length),
    });
  }
  return members;
}

/**
 * Every file the icon set ships, keyed by its name under public/.
 *
 * The `-x` and versioned entries are byte-identical mirrors, not separate designs:
 * app/layout.tsx links the suffixed paths because a new PATH is the only
 * reliable way to move a returning browser off a cached retired mark (owner
 * ruling 2026-07-22), and generating them here is what stops a LINKED icon from
 * lagging the file it mirrors. They used to be hand-copied, so a regenerated
 * icon reached public/ while the browser kept being sent to the old bytes.
 */
export async function buildBrandIconFiles() {
  const files = new Map();
  const put = (name, data, mirrors = []) => {
    files.set(name, data);
    for (const m of mirrors) files.set(m, data);
  };

  // ── SVGs ────────────────────────────────────────────────────────────────────
  // A tile, rather than a bare coral X on transparency, keeps the mark legible
  // on dark browser-tab chrome and makes the tab identity match the home screen.
  put("favicon.svg", `${plaque("light")}\n`, ["favicon-x.svg"]);
  put("favicon-dark.svg", `${plaque("dark")}\n`);
  put("icon-192.svg", `${sizedPlaque("light", 192)}\n`);
  put("icon-512.svg", `${sizedPlaque("light", 512)}\n`);
  put("icon-maskable.svg", `${maskable("light")}\n`);
  put("icon-monochrome.svg", `${monochrome()}\n`);

  // ── PNGs ────────────────────────────────────────────────────────────────────
  const light = ICON_TILE_FIELDS.light;
  const dark = ICON_TILE_FIELDS.dark;

  put("icon-192.png", await pngBuffer(plaque("light"), 192), ["icon-x-192.png"]);
  put("icon-512.png", await pngBuffer(plaque("light"), 512), ["icon-x-512.png"]);
  put("icon-dark-192.png", await pngBuffer(plaque("dark"), 192));
  put("icon-dark-512.png", await pngBuffer(plaque("dark"), 512));
  put("icon-maskable-512.png", await pngBuffer(maskable("light"), 512, { opaque: light }));
  put("icon-maskable-dark-512.png", await pngBuffer(maskable("dark"), 512, { opaque: dark }));
  put("icon-monochrome-512.png", await pngBuffer(monochrome(), 512));
  put("apple-touch-icon.png", await pngBuffer(bleed("light"), 180, { opaque: light }), [
    "apple-touch-icon-x.png",
    "apple-touch-icon-v2.png",
  ]);
  put("apple-touch-icon-dark.png", await pngBuffer(bleed("dark"), 180, { opaque: dark }));

  // ── favicon.ico (16 simplified / 32 / 48) ───────────────────────────────────
  put(
    "favicon.ico",
    buildIco([
      { size: 16, png: await pngBuffer(iconTileSvg({ simple: true }), 16) },
      { size: 32, png: await pngBuffer(plaque("light"), 32) },
      { size: 48, png: await pngBuffer(plaque("light"), 48) },
    ]),
  );

  return files;
}

/**
 * The public/brand/ reference mirror docs/BRAND_MARK.md points at. `icon.svg` is
 * the plaque under its documented name; `mark-mono.svg` is the bare mark in
 * currentColor at its natural size on the grid, a paste-into-a-document
 * reference rather than a shipped icon.
 */
export function brandMirrorFiles(files) {
  const mirror = new Map();
  for (const name of [
    "favicon.svg",
    "favicon-dark.svg",
    "icon-maskable.svg",
    "icon-192.png",
    "icon-512.png",
    "icon-dark-512.png",
    "icon-maskable-512.png",
    "icon-monochrome-512.png",
    "apple-touch-icon.png",
    "apple-touch-icon-dark.png",
  ]) {
    mirror.set(name, files.get(name));
  }
  mirror.set("icon.svg", files.get("favicon.svg"));
  mirror.set(
    "mark-mono.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">` +
      `<g fill="currentColor">${markPolygonsSvg("currentColor")}</g></svg>\n`,
  );
  return mirror;
}
