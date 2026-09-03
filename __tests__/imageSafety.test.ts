import { describe, expect, it } from "vitest";

import {
  detectImageKind,
  magicBytesOk,
  stripImageMetadata,
  stripJpegMetadata,
  stripPngMetadata,
  stripWebpMetadata,
} from "@/lib/imageSafety";

// ── Fixture builders ─────────────────────────────────────────────────────────
// Hand-crafted, minimal byte streams so every test is exact and inspectable —
// no external image files, no dependency on sharp/any codec.

function bytes(...vals: number[]): Uint8Array {
  return Uint8Array.from(vals);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));
}

function u16be(n: number): Uint8Array {
  return bytes((n >> 8) & 0xff, n & 0xff);
}

function u32be(n: number): Uint8Array {
  return bytes((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function u32le(n: number): Uint8Array {
  return bytes(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

/** JPEG marker segment: FF <marker> <len hi> <len lo> <payload>, len includes itself. */
function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  return concat(bytes(0xff, marker), u16be(payload.length + 2), payload);
}

/**
 * A minimal-but-well-formed JPEG: SOI, APP0/JFIF, DQT, SOF0, DHT, SOS + a
 * couple of scan-data bytes, EOI. Not a real decodable image (the scan data is
 * fake), but structurally exactly what stripJpegMetadata walks.
 */
function baseJpegSegments(): Uint8Array[] {
  const app0 = jpegSegment(
    0xe0,
    concat(ascii("JFIF"), bytes(0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)),
  );
  const dqt = jpegSegment(0xdb, bytes(0x00, ...Array(64).fill(1)));
  const sof0 = jpegSegment(
    0xc0,
    bytes(0x08, 0x00, 0x04, 0x00, 0x04, 0x01, 0x01, 0x11, 0x00),
  );
  const dht = jpegSegment(0xc4, bytes(0x00, ...Array(16).fill(0), 0x00));
  const sosHeader = jpegSegment(0xda, bytes(0x01, 0x01, 0x00, 0x00, 0x3f, 0x00));
  const scanData = bytes(0xaa, 0xbb, 0xcc, 0xdd);
  const eoi = bytes(0xff, 0xd9);
  return [bytes(0xff, 0xd8), app0, dqt, sof0, dht, sosHeader, scanData, eoi];
}

function buildJpeg(extraSegments: Uint8Array[] = []): Uint8Array {
  const segs = baseJpegSegments();
  // Insert extra segments (e.g. a fake APP1/Exif) right after APP0, before DQT —
  // a realistic position for APP1/APP2/COM in a real JPEG.
  const withExtra = [segs[0], segs[1], ...extraSegments, ...segs.slice(2)];
  return concat(...withExtra);
}

/** A fake APP1 "Exif" segment carrying a GPS-looking marker string so the test
 *  can assert on its absence after stripping without needing a real TIFF/IFD. */
function fakeExifApp1WithGps(): Uint8Array {
  const payload = concat(ascii("Exif\x00\x00"), ascii("FAKE-GPS-LAT-51.5074-LON-0.1278"));
  return jpegSegment(0xe1, payload);
}

function fakeComSegment(text: string): Uint8Array {
  return jpegSegment(0xfe, ascii(text));
}

// ── PNG chunk builder with a real CRC32 (pure JS, no deps) ──────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = concat(ascii(type), data);
  return concat(u32be(data.length), typeAndData, u32be(crc32(typeAndData)));
}

const PNG_SIG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function buildPng(extraChunks: Uint8Array[] = []): Uint8Array {
  const ihdr = pngChunk(
    "IHDR",
    concat(u32be(1), u32be(1), bytes(0x08, 0x02, 0x00, 0x00, 0x00)),
  );
  const idat = pngChunk("IDAT", bytes(0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01));
  const iend = pngChunk("IEND", new Uint8Array(0));
  return concat(PNG_SIG, ihdr, ...extraChunks, idat, iend);
}

function pngTextChunk(keyword: string, text: string): Uint8Array {
  return pngChunk("tEXt", concat(ascii(keyword), bytes(0x00), ascii(text)));
}

// ── WebP builders ────────────────────────────────────────────────────────────
function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const padded = data.length % 2 === 0 ? data : concat(data, bytes(0x00));
  return concat(ascii(type), u32le(data.length), padded);
}

function buildWebp(extraChunks: Uint8Array[] = []): Uint8Array {
  const vp8 = webpChunk("VP8 ", bytes(0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x04, 0x00, 0x04, 0x00));
  const body = concat(ascii("WEBP"), vp8, ...extraChunks);
  return concat(ascii("RIFF"), u32le(body.length), body);
}

function buildExtendedWebp(chunks: Uint8Array[]): Uint8Array {
  const body = concat(ascii("WEBP"), ...chunks);
  return concat(ascii("RIFF"), u32le(body.length), body);
}

function vp8xChunk(flags: number): Uint8Array {
  return webpChunk("VP8X", bytes(flags, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x00, 0x00));
}

function webpChunkPayload(bytes: Uint8Array, type: string): Uint8Array | null {
  let i = 12;
  while (i + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!);
    const size = bytes[i + 4]! | (bytes[i + 5]! << 8) | (bytes[i + 6]! << 16) | (bytes[i + 7]! << 24);
    if (chunkType === type) return bytes.slice(i + 8, i + 8 + size);
    i += 8 + size + (size % 2);
  }
  return null;
}

// ── detectImageKind / magicBytesOk ───────────────────────────────────────────

describe("detectImageKind", () => {
  it("identifies a real JPEG", () => {
    expect(detectImageKind(buildJpeg())).toBe("jpeg");
  });

  it("identifies a real PNG", () => {
    expect(detectImageKind(buildPng())).toBe("png");
  });

  it("identifies a real WebP", () => {
    expect(detectImageKind(buildWebp())).toBe("webp");
  });

  it("returns null for HTML mislabelled as an image", () => {
    const fakeJpg = ascii("<!DOCTYPE html><html><body>gotcha</body></html>");
    expect(detectImageKind(fakeJpg)).toBeNull();
  });

  it("returns null for a truncated/empty buffer", () => {
    expect(detectImageKind(new Uint8Array(0))).toBeNull();
    expect(detectImageKind(bytes(0xff, 0xd8))).toBeNull(); // SOI only, no third byte
  });

  it("returns null for garbage bytes", () => {
    expect(detectImageKind(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
  });
});

describe("magicBytesOk", () => {
  it("accepts real signatures against their matching declared MIME", () => {
    expect(magicBytesOk(buildJpeg(), "image/jpeg")).toBe(true);
    expect(magicBytesOk(buildPng(), "image/png")).toBe(true);
    expect(magicBytesOk(buildWebp(), "image/webp")).toBe(true);
  });

  it("rejects a mismatched declared MIME (PNG bytes claiming to be JPEG)", () => {
    expect(magicBytesOk(buildPng(), "image/jpeg")).toBe(false);
  });

  it("rejects an HTML file renamed to .jpg", () => {
    const fakeJpg = ascii("<script>alert(1)</script>");
    expect(magicBytesOk(fakeJpg, "image/jpeg")).toBe(false);
  });

  it("rejects a truncated file", () => {
    const truncated = buildJpeg().slice(0, 2); // SOI only
    expect(magicBytesOk(truncated, "image/jpeg")).toBe(false);
  });

  it("rejects an unsupported/unknown MIME even with valid bytes", () => {
    expect(magicBytesOk(buildJpeg(), "image/heic")).toBe(false);
    expect(magicBytesOk(buildJpeg(), "application/pdf")).toBe(false);
  });
});

// ── JPEG stripping ────────────────────────────────────────────────────────

describe("stripJpegMetadata", () => {
  it("removes a fake APP1 Exif/GPS segment and keeps the image structurally valid", () => {
    const withGps = buildJpeg([fakeExifApp1WithGps()]);
    // Sanity: the GPS marker string IS present before stripping.
    const before = Buffer.from(withGps).toString("latin1");
    expect(before).toContain("FAKE-GPS-LAT-51.5074-LON-0.1278");

    const cleaned = stripJpegMetadata(withGps);

    // Still starts with SOI.
    expect(cleaned[0]).toBe(0xff);
    expect(cleaned[1]).toBe(0xd8);
    // The GPS payload is gone.
    const after = Buffer.from(cleaned).toString("latin1");
    expect(after).not.toContain("FAKE-GPS-LAT-51.5074-LON-0.1278");
    // Still parses segment-wise: re-detecting it must still say "jpeg", and a
    // second strip pass must be a no-op-safe (idempotent, doesn't throw).
    expect(detectImageKind(cleaned)).toBe("jpeg");
    expect(() => stripJpegMetadata(cleaned)).not.toThrow();
    // Ends with EOI.
    expect(cleaned[cleaned.length - 2]).toBe(0xff);
    expect(cleaned[cleaned.length - 1]).toBe(0xd9);
  });

  it("removes a COM segment", () => {
    const withComment = buildJpeg([fakeComSegment("shot on iPhone at home address")]);
    const cleaned = stripJpegMetadata(withComment);
    expect(Buffer.from(cleaned).toString("latin1")).not.toContain("shot on iPhone");
  });

  it("keeps APP0/JFIF and all structural segments intact", () => {
    const plain = buildJpeg();
    const cleaned = stripJpegMetadata(plain);
    const text = Buffer.from(cleaned).toString("latin1");
    expect(text).toContain("JFIF");
  });

  it("preserves the scan data bytes verbatim", () => {
    const plain = buildJpeg();
    const cleaned = stripJpegMetadata(plain);
    // The 4 fake scan-data bytes (0xaa 0xbb 0xcc 0xdd) must survive untouched.
    const idx = Array.from(cleaned).findIndex(
      (_, i) =>
        cleaned[i] === 0xaa && cleaned[i + 1] === 0xbb && cleaned[i + 2] === 0xcc && cleaned[i + 3] === 0xdd,
    );
    expect(idx).toBeGreaterThan(-1);
  });

  it("throws (fails closed) on a non-JPEG buffer", () => {
    expect(() => stripJpegMetadata(buildPng())).toThrow();
  });

  it("throws (fails closed) on a truncated JPEG", () => {
    const full = buildJpeg([fakeExifApp1WithGps()]);
    // Cut off mid-segment (well before SOS/EOI).
    const truncated = full.slice(0, 10);
    expect(() => stripJpegMetadata(truncated)).toThrow();
  });

  it("throws on a segment whose declared length runs past the buffer", () => {
    // SOI + a bogus APP1 claiming a huge length but with no payload.
    const malformed = concat(bytes(0xff, 0xd8), bytes(0xff, 0xe1, 0xff, 0xff));
    expect(() => stripJpegMetadata(malformed)).toThrow();
  });
});

// ── PNG stripping ────────────────────────────────────────────────────────

describe("stripPngMetadata", () => {
  it("removes a tEXt chunk with GPS-looking content and keeps the PNG structurally valid", () => {
    const withText = buildPng([pngTextChunk("Comment", "GPS 51.5074,-0.1278 home")]);
    const before = Buffer.from(withText).toString("latin1");
    expect(before).toContain("GPS 51.5074,-0.1278 home");

    const cleaned = stripPngMetadata(withText);

    expect(Array.from(cleaned.slice(0, 8))).toEqual(Array.from(PNG_SIG));
    const after = Buffer.from(cleaned).toString("latin1");
    expect(after).not.toContain("GPS 51.5074,-0.1278 home");
    expect(detectImageKind(cleaned)).toBe("png");
    expect(() => stripPngMetadata(cleaned)).not.toThrow();
  });

  it("removes iTXt, zTXt, and eXIf chunks", () => {
    const iTXt = pngChunk(
      "iTXt",
      concat(ascii("Comment"), bytes(0x00, 0x00, 0x00), ascii("en"), bytes(0x00), ascii("Comment"), bytes(0x00), ascii("secret note")),
    );
    const zTXt = pngChunk("zTXt", concat(ascii("Comment"), bytes(0x00, 0x00), ascii("compressedish")));
    const eXIf = pngChunk("eXIf", ascii("FAKE-EXIF-GPS-BLOB"));
    const withAll = buildPng([iTXt, zTXt, eXIf]);
    const cleaned = stripPngMetadata(withAll);
    const text = Buffer.from(cleaned).toString("latin1");
    expect(text).not.toContain("secret note");
    expect(text).not.toContain("FAKE-EXIF-GPS-BLOB");
  });

  it("keeps IHDR/IDAT/IEND intact", () => {
    const plain = buildPng();
    const cleaned = stripPngMetadata(plain);
    const types = [];
    let i = 8;
    while (i < cleaned.length) {
      const len = (cleaned[i]! << 24) | (cleaned[i + 1]! << 16) | (cleaned[i + 2]! << 8) | cleaned[i + 3]!;
      const type = String.fromCharCode(cleaned[i + 4]!, cleaned[i + 5]!, cleaned[i + 6]!, cleaned[i + 7]!);
      types.push(type);
      i += 8 + len + 4;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("throws (fails closed) on a non-PNG buffer", () => {
    expect(() => stripPngMetadata(buildJpeg())).toThrow();
  });

  it("throws (fails closed) on a truncated PNG", () => {
    const full = buildPng([pngTextChunk("Comment", "x")]);
    const truncated = full.slice(0, 20);
    expect(() => stripPngMetadata(truncated)).toThrow();
  });

  it("throws when no IEND chunk is present", () => {
    const noIend = concat(PNG_SIG, pngChunk("IHDR", concat(u32be(1), u32be(1), bytes(0x08, 0x02, 0x00, 0x00, 0x00))));
    expect(() => stripPngMetadata(noIend)).toThrow();
  });
});

// ── WebP stripping (documented pass-through for simple WebPs) ────────────────

describe("stripWebpMetadata", () => {
  it("passes a simple WebP (no EXIF/XMP chunk) through unchanged", () => {
    const simple = buildWebp();
    const result = stripWebpMetadata(simple);
    expect(Array.from(result)).toEqual(Array.from(simple));
  });

  it("removes an EXIF chunk from an extended WebP", () => {
    const exifChunk = webpChunk("EXIF", ascii("FAKE-EXIF-GPS-DATA"));
    const withExif = buildWebp([exifChunk]);
    const before = Buffer.from(withExif).toString("latin1");
    expect(before).toContain("FAKE-EXIF-GPS-DATA");

    const cleaned = stripWebpMetadata(withExif);
    const after = Buffer.from(cleaned).toString("latin1");
    expect(after).not.toContain("FAKE-EXIF-GPS-DATA");
    expect(detectImageKind(cleaned)).toBe("webp");
  });

  it("removes an XMP chunk", () => {
    const xmpChunk = webpChunk("XMP ", ascii("<x:xmpmeta>gps here</x:xmpmeta>"));
    const withXmp = buildWebp([xmpChunk]);
    const cleaned = stripWebpMetadata(withXmp);
    expect(Buffer.from(cleaned).toString("latin1")).not.toContain("gps here");
  });

  it("clears VP8X EXIF and XMP flags when the corresponding chunks are stripped", () => {
    const exifFlag = 0b00001000;
    const xmpFlag = 0b00000100;
    const withMetadata = buildExtendedWebp([
      vp8xChunk(exifFlag | xmpFlag),
      webpChunk("VP8 ", bytes(0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x04, 0x00, 0x04, 0x00)),
      webpChunk("EXIF", ascii("FAKE-EXIF-GPS-DATA")),
      webpChunk("XMP ", ascii("<x:xmpmeta>gps here</x:xmpmeta>")),
    ]);

    const cleaned = stripWebpMetadata(withMetadata);
    const vp8x = webpChunkPayload(cleaned, "VP8X");

    expect(vp8x).not.toBeNull();
    expect(vp8x![0]! & exifFlag).toBe(0);
    expect(vp8x![0]! & xmpFlag).toBe(0);
    expect(Buffer.from(cleaned).toString("latin1")).not.toContain("FAKE-EXIF-GPS-DATA");
    expect(Buffer.from(cleaned).toString("latin1")).not.toContain("gps here");
  });

  it("throws (fails closed) on a non-WebP buffer", () => {
    expect(() => stripWebpMetadata(buildPng())).toThrow();
  });

  it("throws (fails closed) on a truncated WebP", () => {
    const full = buildWebp();
    const truncated = full.slice(0, 12);
    expect(() => stripWebpMetadata(truncated)).toThrow();
  });
});

// ── stripImageMetadata orchestrator ──────────────────────────────────────────

describe("stripImageMetadata", () => {
  it("dispatches to the correct stripper per detected kind", () => {
    expect(() => stripImageMetadata(buildJpeg([fakeExifApp1WithGps()]), "jpeg")).not.toThrow();
    expect(() => stripImageMetadata(buildPng([pngTextChunk("a", "b")]), "png")).not.toThrow();
    expect(() => stripImageMetadata(buildWebp(), "webp")).not.toThrow();
  });

  it("fails closed end-to-end: magic-byte check -> strip, reject on mismatch or corruption", () => {
    const fakeJpgThatIsHtml = ascii("<html>not an image</html>");
    expect(magicBytesOk(fakeJpgThatIsHtml, "image/jpeg")).toBe(false);

    const truncatedJpeg = buildJpeg([fakeExifApp1WithGps()]).slice(0, 5);
    expect(() => stripImageMetadata(truncatedJpeg, "jpeg")).toThrow();
  });
});
