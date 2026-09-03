import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MARK_GEOMETRY } from "@/components/brand/PubmaxxMark";
import {
  ICON_MARK_WIDTH,
  MARK_BOUNDS,
  MARK_POLYGONS,
  markFitsSafeZone,
  markScaleForWidth,
} from "@/lib/brandMark.mjs";
import {
  brandMirrorFiles,
  buildBrandIconFiles,
  readIcoMembers,
} from "@/lib/brandIconAssets.mjs";
import { MARK_POLYGONS as OG_MARK_POLYGONS } from "@/lib/ogBrand";

// The installed home-screen icon is the one brand surface nobody looks at
// twice, so it rotted quietly: four modules each kept their own copy of the
// mark coordinates, and only two of them fed an icon. This file is the fence
// that keeps the shipped icon set and the brand mark one thing.
//
// It works by REGENERATING the whole set from the same module the generator
// script writes from, then comparing against the committed bytes. A fence that
// restated the tier table would only ever prove itself right.
//
// Rasters are compared as decoded PIXELS rather than file bytes: a sharp or
// libvips upgrade re-encodes a PNG without changing one pixel, and a fence that
// failed on that would get muted rather than fixed. Geometry, colour and inset
// are what this file is actually about, and pixels carry all three.

const REPO_ROOT = join(__dirname, "..");
const PUBLIC = join(REPO_ROOT, "public");

function readPublic(name: string): Buffer {
  return readFileSync(join(PUBLIC, name));
}

async function rawPixels(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function expectSamePixels(committed: Buffer, regenerated: Buffer, name: string) {
  const a = await rawPixels(committed);
  const b = await rawPixels(regenerated);
  expect(`${name} ${a.width}x${a.height}x${a.channels}`).toBe(
    `${name} ${b.width}x${b.height}x${b.channels}`,
  );
  expect(`${name} pixels equal: ${a.data.equals(b.data)}`).toBe(`${name} pixels equal: true`);
}

const built = await buildBrandIconFiles();

describe("the icon set is cut from the master mark", () => {
  it("holds every copy of the geometry to one source", () => {
    // components/brand/PubmaxxMark.tsx (the in-app mark), lib/ogBrand.tsx (the
    // satori share cards) and lib/brandMark.mjs (the icon generators) each used
    // to write these numbers down. They are now one set, read three ways.
    expect(MARK_GEOMETRY.thick).toBe(MARK_POLYGONS.thick);
    expect(MARK_GEOMETRY.thinA).toBe(MARK_POLYGONS.thinA);
    expect(MARK_GEOMETRY.thinB).toBe(MARK_POLYGONS.thinB);
    expect(OG_MARK_POLYGONS.thick).toBe(MARK_POLYGONS.thick);
    expect(OG_MARK_POLYGONS.thinA).toBe(MARK_POLYGONS.thinA);
    expect(OG_MARK_POLYGONS.thinB).toBe(MARK_POLYGONS.thinB);
  });

  it("leaves no second copy of the coordinates in a generator", () => {
    // A generator that re-declares a polygon can ship an icon the brand never
    // approved, which is exactly how this lane started.
    for (const script of [
      "scripts/gen-brand-assets.mjs",
      "scripts/gen-native-app-icons.mjs",
      "lib/brandIconAssets.mjs",
    ]) {
      const source = readFileSync(join(REPO_ROOT, script), "utf8");
      const copied = Object.values(MARK_POLYGONS).filter((points) =>
        source.includes(points),
      );
      expect(`${script} restates ${copied.length} polygons`).toBe(
        `${script} restates 0 polygons`,
      );
    }
  });
});

describe("every committed icon matches a fresh regeneration", () => {
  it("stamps the files the generator declares and no others", () => {
    // The `-x` and versioned mirrors are in this list because app/layout.tsx
    // LINKS them. They were hand-copied before, so a regenerated icon could
    // reach public/ while the browser was still sent to the stale path.
    expect([...built.keys()].sort()).toEqual([
      "apple-touch-icon-dark.png",
      "apple-touch-icon-v2.png",
      "apple-touch-icon-x.png",
      "apple-touch-icon.png",
      "favicon-dark.svg",
      "favicon-x.svg",
      "favicon.ico",
      "favicon.svg",
      "icon-192.png",
      "icon-192.svg",
      "icon-512.png",
      "icon-512.svg",
      "icon-dark-192.png",
      "icon-dark-512.png",
      "icon-maskable-512.png",
      "icon-maskable-dark-512.png",
      "icon-maskable.svg",
      "icon-monochrome-512.png",
      "icon-monochrome.svg",
      "icon-x-192.png",
      "icon-x-512.png",
    ]);
  });

  for (const name of [
    "favicon.svg",
    "favicon-x.svg",
    "favicon-dark.svg",
    "icon-192.svg",
    "icon-512.svg",
    "icon-maskable.svg",
    "icon-monochrome.svg",
  ]) {
    it(`public/${name} is byte-identical to the regenerated markup`, () => {
      expect(readPublic(name).toString("utf8")).toBe(built.get(name));
    });
  }

  for (const name of [
    "apple-touch-icon.png",
    "apple-touch-icon-x.png",
    "apple-touch-icon-v2.png",
    "apple-touch-icon-dark.png",
    "icon-192.png",
    "icon-x-192.png",
    "icon-512.png",
    "icon-x-512.png",
    "icon-dark-192.png",
    "icon-dark-512.png",
    "icon-maskable-512.png",
    "icon-maskable-dark-512.png",
    "icon-monochrome-512.png",
  ]) {
    it(`public/${name} renders the same pixels as a regeneration`, async () => {
      await expectSamePixels(readPublic(name), built.get(name) as Buffer, name);
    });
  }

  it("public/favicon.ico carries the regenerated 16 / 32 / 48 members", async () => {
    const committed = readIcoMembers(readPublic("favicon.ico"));
    const fresh = readIcoMembers(built.get("favicon.ico") as Buffer);
    expect(committed.map((m) => m.size)).toEqual([16, 32, 48]);
    expect(fresh.map((m) => m.size)).toEqual([16, 32, 48]);
    for (let i = 0; i < committed.length; i += 1) {
      await expectSamePixels(committed[i].png, fresh[i].png, `ico ${committed[i].size}`);
    }
  });

  it("keeps the public/brand reference mirror in step", async () => {
    const mirror = brandMirrorFiles(built);
    for (const [name, data] of mirror) {
      const committed = readFileSync(join(PUBLIC, "brand", name));
      if (name.endsWith(".svg")) {
        expect(committed.toString("utf8")).toBe(data);
      } else {
        await expectSamePixels(committed, data as Buffer, `brand/${name}`);
      }
    }
  });
});

describe("the shipped tiles obey the icon policy", () => {
  /**
   * Measure the mark on a rendered tile: the box of every pixel that is not the
   * field colour. This reads the SHIPPED file, so it answers what a phone sees
   * rather than what a constant claims.
   */
  async function markBox(name: string) {
    const { data, width, height, channels } = await rawPixels(readPublic(name));
    const field = [data[0], data[1], data[2]];
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * channels;
        const off =
          Math.abs(data[i] - field[0]) +
          Math.abs(data[i + 1] - field[1]) +
          Math.abs(data[i + 2] - field[2]);
        if (off > 90) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { minX, maxX, minY, maxY, width, height };
  }

  it("gives the iOS Home Screen icon its margins, centred", async () => {
    // iOS draws its own superellipse over a full-bleed square, so a mark with
    // no air inside the tile collides with the rounded corner and reads cheap.
    const box = await markBox("apple-touch-icon.png");
    const coverage = (box.maxX - box.minX + 1) / box.width;
    expect(coverage).toBeGreaterThanOrEqual(0.6);
    expect(coverage).toBeLessThanOrEqual(0.65);
    // Centred: the margins on opposite sides match to within a pixel of
    // rounding, in both axes.
    expect(Math.abs(box.minX - (box.width - 1 - box.maxX))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.minY - (box.height - 1 - box.maxY))).toBeLessThanOrEqual(1);
  });

  it("keeps the maskable mark inside the Android safe circle", () => {
    // What a circular mask crops against is the mark's CORNER distance from
    // centre, not its width. The double-struck X is wider than it is tall, so a
    // scale picked off the width alone pushes a terminal past the mask.
    expect(markFitsSafeZone(markScaleForWidth(ICON_MARK_WIDTH.safeZone))).toBe(true);
    expect(markFitsSafeZone(markScaleForWidth(ICON_MARK_WIDTH.tile))).toBe(false);
  });

  it("keeps the mark centred on the grid it is cut from", () => {
    expect(MARK_BOUNDS.minX + MARK_BOUNDS.maxX).toBe(64);
    expect(MARK_BOUNDS.minY + MARK_BOUNDS.maxY).toBe(64);
  });

  it("ships no transparency where a platform composites the tile", async () => {
    // iOS composites a transparent apple-touch icon onto BLACK, which turns a
    // white tile into a dark smudge; Android expects a maskable icon to fill
    // its whole box.
    for (const name of [
      "apple-touch-icon.png",
      "apple-touch-icon-x.png",
      "apple-touch-icon-dark.png",
      "icon-maskable-512.png",
      "icon-maskable-dark-512.png",
    ]) {
      const meta = await sharp(readPublic(name)).metadata();
      expect(`${name} hasAlpha=${meta.hasAlpha}`).toBe(`${name} hasAlpha=false`);
    }
    // The themed icon is the opposite case: Android reads its ALPHA as the mask
    // and paints its own field, so an opaque one would come out a solid block.
    const themed = await sharp(readPublic("icon-monochrome-512.png")).metadata();
    expect(themed.hasAlpha).toBe(true);
  });

  it("sizes the apple-touch icon at the 180px iOS asks for", async () => {
    const meta = await sharp(readPublic("apple-touch-icon.png")).metadata();
    expect([meta.width, meta.height]).toEqual([180, 180]);
  });
});

describe("what the head and the manifest point at exists", () => {
  const manifest = JSON.parse(
    readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8"),
  ) as {
    name: string;
    short_name: string;
    start_url: string;
    icons: Array<{ src: string; purpose: string; sizes: string }>;
  };
  const layout = readFileSync(join(REPO_ROOT, "app", "layout.tsx"), "utf8");

  // The installed app is the site: it opens at the front door and carries the
  // site's own name. A start_url pointing at an inner tab means the icon on a
  // Home Screen is a shortcut to one surface rather than the app, and a
  // truncated name reads as a different product from the one that was
  // installed. Captain decision 2026-08-10.
  it("opens the installed app at the landing, under the site's own name", () => {
    expect(manifest.start_url).toBe("/");
    expect(manifest.name).toBe("PUBMAXXING");
    expect(manifest.short_name).toBe("PUBMAXXING");
  });

  // iOS takes the Home Screen label from apple-mobile-web-app-title, not from
  // the manifest, so the two platforms drift apart unless both are stated.
  it("gives iOS the same installed name the manifest gives Android", () => {
    const apple = layout.slice(layout.indexOf("appleWebApp: {"));
    expect(apple.slice(0, apple.indexOf("},"))).toContain('title: "PUBMAXXING"');
  });

  it("lists only generated files in the manifest", () => {
    for (const icon of manifest.icons) {
      const name = icon.src.split("?", 1)[0].replace(/^\//, "");
      expect(`${icon.src} is generated`).toBe(
        `${icon.src} is ${built.has(name) ? "generated" : "MISSING"}`,
      );
    }
  });

  it("carries a maskable and a themed icon, and no unselectable dark one", () => {
    const purposes = manifest.icons.map((i) => i.purpose);
    expect(purposes).toContain("maskable");
    // `monochrome` is the only variant selector the manifest spec actually has:
    // Android composites its own field and tint behind it, which is that
    // platform's answer to a tinted Home Screen.
    expect(purposes).toContain("monochrome");
    // There is NO dark-icon member in the manifest spec. A dark PNG listed
    // beside the light one at the same size and purpose is not a dark variant,
    // it is a coin toss the UA makes in a light context.
    expect(manifest.icons.some((i) => i.src.includes("dark"))).toBe(false);
  });

  it("links every icon the document declares", () => {
    const iconUrlPattern =
      /url: "(\/(?:favicon|icon|apple-touch-icon)[^"]+\.(?:png|svg|ico))(?:\?[^"]+)?"/g;
    for (const url of layout.matchAll(iconUrlPattern)) {
      const name = url[1].replace(/^\//, "");
      expect(`${url[1]} is generated`).toBe(
        `${url[1]} is ${built.has(name) ? "generated" : "MISSING"}`,
      );
    }
  });

  it("selects the dark favicon by media, and never the apple-touch icon", () => {
    expect(layout).toContain('url: "/favicon-dark.svg?v=2"');
    expect(layout).toContain('media: "(prefers-color-scheme: dark)"');
    // iOS ignores `media` on an apple-touch-icon link, so declaring one there
    // would promise an appearance switch that never happens.
    const appleLine = layout.slice(layout.indexOf("apple: ["));
    expect(appleLine.slice(0, appleLine.indexOf("]"))).not.toContain("media");
  });
});
