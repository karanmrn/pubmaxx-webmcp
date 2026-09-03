// What a DM photo is actually STORED as, run through the real pipeline.
//
// THE DEFECT: a message photo was re-encoded into a 1080x1350 box at the shared
// default quality, so a photograph off a modern phone reached the thread
// visibly softer than the one the sender chose. The constants moved (a 2048
// longest edge at quality 85), but a constant is not a stored image:
// `prepareMessagePhoto` is the only thing that decides what the recipient
// downloads, so this file hands it a real photograph-sized JPEG and measures
// the bytes that come back.
//
// Deliberately NOT a read of the constant table. It decodes the output with
// sharp and asserts the pixels, and it re-encodes the SAME source through the
// retired box so the detail claim is a comparison against the picture the
// sender chose rather than a number nobody can picture.

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  MESSAGE_PHOTO_ASPECT_RATIO,
  MESSAGE_PHOTO_OUTPUT_HEIGHT,
  MESSAGE_PHOTO_OUTPUT_WIDTH,
} from "@/lib/messageAttachments";
import { prepareMessagePhoto } from "@/lib/messagePhotoMedia.server";

/** The box a message photo used to be squeezed into, before this fix. */
const RETIRED_BOX = { width: 1_080, height: 1_350 } as const;
const RETIRED_QUALITY = 84;

const SOURCE = { width: 2_448, height: 3_060 } as const;

/**
 * A portrait source at the size a phone camera really produces, carrying fine
 * detail (thin strokes, hard edges, a large soft shape) so a downscale is
 * measurable rather than a matter of taste. Fully deterministic.
 */
async function phonePhoto(): Promise<Buffer> {
  const { width, height } = SOURCE;
  const strokes: string[] = [];
  for (let x = 0; x < width; x += 24) {
    strokes.push(`<rect x="${x}" y="0" width="10" height="${height}" fill="#101820"/>`);
  }
  for (let y = 0; y < height; y += 48) {
    strokes.push(`<rect x="0" y="${y}" width="${width}" height="8" fill="#f4efe6"/>`);
  }
  strokes.push(
    `<circle cx="${width * 0.62}" cy="${height * 0.3}" r="${width * 0.18}" fill="#c47a2e"/>`,
  );
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<rect width="${width}" height="${height}" fill="#8fa6b2"/>${strokes.join("")}</svg>`,
    ),
  )
    .jpeg({ quality: 96 })
    .toBuffer();
}

function asFile(bytes: Buffer): File {
  return new File([new Uint8Array(bytes)], "phone-photo.jpg", { type: "image/jpeg" });
}

/**
 * Mean per-channel distance from the picture the sender chose, both compared at
 * the SOURCE's own size - which is the reader's question, since a thread photo
 * is opened full frame and zoomed into. A stored image that threw pixels away
 * cannot answer it as well.
 */
async function distanceFromSource(stored: Buffer, source: Buffer): Promise<number> {
  const reference = await sharp(source).raw().toBuffer();
  const pixels = await sharp(stored)
    .resize({ width: SOURCE.width, height: SOURCE.height, fit: "fill" })
    .raw()
    .toBuffer();
  let total = 0;
  for (let at = 0; at < reference.length; at += 1) {
    total += Math.abs(reference[at]! - pixels[at]!);
  }
  return total / reference.length;
}

describe("a DM photo is stored at phone resolution, not a 1080 box", () => {
  it("keeps a 2048 longest edge on the thread's portrait frame", async () => {
    const source = await phonePhoto();
    const prepared = await prepareMessagePhoto(asFile(source));

    const decoded = await sharp(prepared.bytes).metadata();
    expect(decoded.format).toBe("jpeg");
    // The stored pixels, not the constants: the retired pipeline answered
    // 1080x1350 here, which is what made a photograph look soft in a thread.
    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: MESSAGE_PHOTO_OUTPUT_WIDTH,
      height: MESSAGE_PHOTO_OUTPUT_HEIGHT,
    });
    expect(decoded.height).toBe(2_048);
    expect(decoded.height).toBeGreaterThan(RETIRED_BOX.height);
    // And it is still the thread's portrait column, never a landscape tile.
    expect(decoded.width! / decoded.height!).toBeCloseTo(MESSAGE_PHOTO_ASPECT_RATIO, 3);
  }, 60_000);

  it("lands closer to the picture the sender chose than the retired box did", async () => {
    const source = await phonePhoto();
    const prepared = await prepareMessagePhoto(asFile(source));
    const retired = await sharp(source)
      .rotate()
      .resize({ ...RETIRED_BOX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: RETIRED_QUALITY, mozjpeg: true })
      .toBuffer();

    const [now, before] = await Promise.all([
      distanceFromSource(Buffer.from(prepared.bytes), source),
      distanceFromSource(retired, source),
    ]);

    expect(now).toBeLessThan(before);
  }, 60_000);

  it("refuses to enlarge a small photo into the new box", async () => {
    const small = await sharp({
      create: { width: 400, height: 500, channels: 3, background: { r: 20, g: 40, b: 60 } },
    })
      .jpeg()
      .toBuffer();

    const prepared = await prepareMessagePhoto(asFile(small));
    const decoded = await sharp(prepared.bytes).metadata();
    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: 400,
      height: 500,
    });
  }, 30_000);
});
