#!/usr/bin/env node
// Per-species writer for the Pub Pal mascot renditions.
//
// Masters stay outside the repo; only the renditions are committed. Every
// species writes the SAME set, so a surface never has to know which pal it is
// drawing: four square sizes and four circular-avatar sizes, each as webp and
// png. The species table is lib/palMascotAssets.mjs, shared with the app.
//
// Run: node scripts/gen-pubpal-mascot.mjs <species> <master.png>

import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  PAL_MASCOT_SIZES,
  PAL_MASCOT_WEBP_512_BUDGET,
  palMascotSlug,
  palMascotSpeciesList,
} from "../lib/palMascotAssets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "pal");

function circleSvg(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
}

// The masters are landscape with the pal centred, and every rendition is square,
// so the crop is taken ONCE here rather than left to each resize: an explicit
// centre square is the same picture at every size, where `fit: "cover"` alone
// re-derives it per call and would drift the day a master arrives in another
// shape.
async function centreSquare(source) {
  const image = sharp(source);
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error(`${basename(source)} has no readable dimensions`);
  const side = Math.min(width, height);
  return image
    .extract({
      left: Math.round((width - side) / 2),
      top: Math.round((height - side) / 2),
      width: side,
      height: side,
    })
    .toBuffer();
}

function webpQuality(size) {
  return size >= 512 ? 78 : 82;
}

async function writeSquare(square, slug, size) {
  const base = sharp(square).resize(size, size, { fit: "cover" });
  await base.clone().webp({ quality: webpQuality(size), effort: 6 }).toFile(join(OUT_DIR, `${slug}-${size}.webp`));
  await base.clone().png({ compressionLevel: 9 }).toFile(join(OUT_DIR, `${slug}-${size}.png`));
}

async function writeAvatar(square, slug, size) {
  const base = sharp(square)
    .resize(size, size, { fit: "cover" })
    .composite([{ input: circleSvg(size), blend: "dest-in" }]);
  await base.clone().webp({ quality: webpQuality(size), effort: 6 }).toFile(join(OUT_DIR, `${slug}-avatar-${size}.webp`));
  await base.clone().png({ compressionLevel: 9 }).toFile(join(OUT_DIR, `${slug}-avatar-${size}.png`));
}

async function main() {
  const [species, source] = argv.slice(2);
  if (!species || !source) {
    console.error("Usage: node scripts/gen-pubpal-mascot.mjs <species> <master.png>");
    console.error(`Species with a master: ${palMascotSpeciesList().join(", ")}`);
    exit(1);
  }
  const slug = palMascotSlug(species);
  if (!slug) {
    console.error(`${species} has no row in lib/palMascotAssets.mjs, so it falls back to its layered-SVG rig.`);
    console.error(`Add the row and name the same slug as its format in lib/pubPal.ts first.`);
    console.error(`Species with a master: ${palMascotSpeciesList().join(", ")}`);
    exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const square = await centreSquare(source);
  for (const size of PAL_MASCOT_SIZES) {
    await writeSquare(square, slug, size);
    await writeAvatar(square, slug, size);
  }

  const webp512 = join(OUT_DIR, `${slug}-512.webp`);
  const bytes = (await stat(webp512)).size;
  if (bytes >= PAL_MASCOT_WEBP_512_BUDGET) {
    console.error(`${basename(webp512)} is ${bytes} bytes; budget is ${PAL_MASCOT_WEBP_512_BUDGET}`);
    exit(1);
  }
  console.log(`wrote ${slug} to ${OUT_DIR} (${basename(webp512)} ${bytes} bytes)`);
}

await main();
