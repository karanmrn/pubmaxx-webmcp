#!/usr/bin/env node
// Render the store PNG export set from the SVG masters in public/store-assets/
// (issue #440; mark re-branded to the Wave C white-tile + coral double-struck X
// identity, #520/#523: no text).
//
// Masters (hand-authored, the source of truth; keep geometry in lockstep with
// the canonical double-struck X polygons in components/brand/PubmaxxMark.tsx
// MARK_GEOMETRY, the same numbers scripts/gen-brand-assets.mjs and
// scripts/gen-native-app-icons.mjs stamp):
//   icon-square.svg               1024  white tile, coral X (iOS + Play icon)
//   icon-square-small.svg           64  small-optics cut (single-slash `slashSimple` + thick stroke)
//   play-adaptive-foreground.svg  1024  coral X on transparent, 66/108 safe zone
//   play-adaptive-background.svg  1024  solid white, deliberately flat
//   splash.svg                    2732  ink-deep field (splashes keep ink per #523), centred coral X
//
// Outputs (committed) under public/store-assets/png/:
//   ios/AppIcon-{20,29,40,58,60,76,80,87,120,152,167,180,1024}.png  opaque, no alpha
//   play/play-store-512.png                                          Play listing icon
//   play/adaptive-foreground-432.png                                 432 = 108dp @ xxxhdpi
//   play/adaptive-background-432.png
//   splash/splash-2732.png
//
// Exports at or under 64px come from icon-square-small.svg; everything larger
// from icon-square.svg. Every render is a downscale from the master's native
// size, never an upscale.
//
// Raster step needs sharp, already a dependency. If it fails to load, this
// script fails loudly and the manual export path in docs/STORE_READINESS.md
// ("Store visual identity") takes over; do NOT add a new raster dependency.
//
// Usage:  node scripts/gen-store-assets.mjs

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch (err) {
  process.stderr.write(
    "gen-store-assets: the raster step needs the `sharp` package and it failed to load.\n" +
      `  (${err instanceof Error ? err.message : String(err)})\n` +
      "  Do not add a raster dependency for this. Follow the manual export steps in\n" +
      '  docs/STORE_READINESS.md, section "Store visual identity", instead.\n',
  );
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public", "store-assets");
const OUT = join(SRC, "png");

const master = (name) => readFileSync(join(SRC, name));

// Full classic slot set so any Xcode vintage (and App Store Connect's 1024
// marketing slot) is covered; Capacitor's own AppIcon set only needs the 1024.
const IOS_SIZES = [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024];
const SMALL_OPTICS_MAX = 64;

async function render(svg, size, file, { alpha = true } = {}) {
  const dest = join(OUT, file);
  mkdirSync(dirname(dest), { recursive: true });
  let img = sharp(svg).resize(size, size);
  if (!alpha) img = img.removeAlpha();
  await img.png().toFile(dest);
  process.stdout.write(`  public/store-assets/png/${file}\n`);
}

process.stdout.write("Rendering store PNG export set from SVG masters:\n");

const icon = master("icon-square.svg");
const iconSmall = master("icon-square-small.svg");

for (const size of IOS_SIZES) {
  // iOS icons must be fully opaque; the 1024 marketing slot rejects an alpha
  // channel outright, so strip it on the whole set.
  const src = size <= SMALL_OPTICS_MAX ? iconSmall : icon;
  await render(src, size, `ios/AppIcon-${size}.png`, { alpha: false });
}

await render(icon, 512, "play/play-store-512.png", { alpha: false });
await render(master("play-adaptive-foreground.svg"), 432, "play/adaptive-foreground-432.png");
await render(master("play-adaptive-background.svg"), 432, "play/adaptive-background-432.png", {
  alpha: false,
});
await render(master("splash.svg"), 2732, "splash/splash-2732.png", { alpha: false });

process.stdout.write("Done. Inventory + wiring notes: docs/STORE_READINESS.md.\n");
