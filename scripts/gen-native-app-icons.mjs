#!/usr/bin/env node
// Generate the @capacitor/assets SOURCE images for the native iOS + Android
// icon / splash sets from the single PUBMAXX X brand geometry (the same source
// of truth as scripts/gen-brand-assets.mjs and components/brand/PubmaxxMark.tsx).
// The mark is the double-struck X; the native icon/splash exports carry no
// ember, matching the static web icons (the crossing is already the event).
//
// Outputs to assets/ — the default input directory @capacitor/assets reads:
//   icon-only.png        1024  full-bleed white tile + coral X (iOS icon)
//   icon-foreground.png  1024  transparent, coral X only (Android adaptive fg)
//   icon-background.png  1024  solid white (Android adaptive bg)
//   splash.png           2732  coral field, centred ink mark (light splash)
//   splash-dark.png      2732  ink-deep field, coral mark (dark splash)
//
// Then run:  npx @capacitor/assets@3 generate
// to stamp every platform-specific size into ios/ and android/. The tool is
// intentionally NOT a pinned devDependency — its transitive tree carries high
// npm-audit advisories that would fail `npm run ci`, and the generated output
// is committed anyway, so it is fetched ephemerally via npx only when the mark
// changes. (If the nested sharp binary fails to load under a blocked-install
// sandbox, `rm -rf node_modules/@capacitor/assets/node_modules/sharp` once so
// it resolves the hoisted sharp. When npx cannot fetch the tool at all, the
// committed ios/ + android/ PNGs can be re-stamped from these sources directly
// with the hoisted sharp — see the activation notes in docs/BRAND_MARK.md.)
//
// Usage:  node scripts/gen-native-app-icons.mjs

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { BRAND_COLORS, MARK_VIEWBOX, markPolygonsSvg } from "../lib/brandMark.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets");
mkdirSync(OUT, { recursive: true });

// Tokens and geometry come from lib/brandMark.mjs, the one master the in-app
// mark, the OG cards and the web icon set also read. `paper` is the Wave C
// app-icon field (owner verdict 2026-07-22): the icon set is a clean white tile
// + coral X. `inkDeep` is the dark splash field (a splash is NOT an icon and
// keeps the coral-on-ink treatment).
const C = BRAND_COLORS;

// The X group on the 64 grid, scaled about centre. `armColor` lets the dark
// splash flip the strokes to coral on an ink field. No ember on native icons.
function clink(armColor, scale = 1) {
  return (
    `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">` +
    `${markPolygonsSvg(armColor)}</g>`
  );
}

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">${body}</svg>`;
}

async function png(markup, size, file) {
  await sharp(Buffer.from(markup)).resize(size, size).png().toFile(join(OUT, file));
  process.stdout.write(`  assets/${file}\n`);
}

const jobs = [
  // iOS app icon: full-bleed WHITE square + coral X (no alpha, no rounding —
  // iOS masks). Wave C flips the field from coral to white and the mark to coral.
  ["icon-only.png", 1024, svg(`<rect width="64" height="64" fill="${C.paper}"/>${clink(C.coral, 0.82)}`)],
  // Android adaptive background: flat WHITE (the system clips it to the mask).
  ["icon-background.png", 1024, svg(`<rect width="64" height="64" fill="${C.paper}"/>`)],
  // Android adaptive foreground: coral X on transparent. The generated
  // adaptive-icon XML already insets this layer 16.7%, so the mark must fill a
  // good part of the source or it lands tiny in the launcher. The double-struck
  // X is wide (its strokes span ~75% of the 64 grid), so scale 0.8 keeps the
  // mark's ~60% span comfortably inside the 66/108 adaptive safe zone. Coral so
  // it reads on the white background layer.
  ["icon-foreground.png", 1024, svg(`${clink(C.coral, 0.8)}`)],
  // Light splash: centred mark on the coral field, small (scale 0.28).
  ["splash.png", 2732, svg(`<rect width="64" height="64" fill="${C.coral}"/>${clink(C.inkDeep, 0.28)}`)],
  // Dark splash: coral mark on the ink-deep field.
  ["splash-dark.png", 2732, svg(`<rect width="64" height="64" fill="${C.inkDeep}"/>${clink(C.coral, 0.28)}`)],
];

process.stdout.write("Generating native icon/splash source assets:\n");
for (const [file, size, markup] of jobs) {
  await png(markup, size, file);
}
process.stdout.write("Done. Next: npx capacitor-assets generate\n");
