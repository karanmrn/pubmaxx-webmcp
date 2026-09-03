// Media hardening (Issue #33 / PRD §7.2, §7.7 follow-up): pure, dependency-free
// image safety checks for the Pint Drop upload path. Two responsibilities:
//
//   1. Magic-byte validation — verify the ACTUAL bytes match the declared MIME,
//      not just the extension/Content-Type a client can freely lie about.
//   2. Metadata stripping — remove EXIF (incl. GPS) and other ancillary
//      metadata by walking the container format's own segment/chunk structure,
//      entirely in TypeScript. No image-processing dependency: this is a
//      byte-level rewrite, not a decode/re-encode.
//
// Every function here is pure (Uint8Array/Buffer in, Uint8Array/Buffer or
// boolean out) so it is unit-testable against hand-crafted byte arrays with no
// real image files, no filesystem, and no native deps.
//
// Allow-list: JPEG, PNG, WebP — exactly what the Pint Drop composer accepts
// today (components/map/PintDropComposer.tsx uses accept="image/*", but the
// server-side allow-list in lib/pintDropsStore.ts's ALLOWED_TYPES has only
// ever been these three). HEIC is deliberately NOT included: it isn't in the
// server allow-list, so accepting its magic bytes here would silently widen
// the upload surface beyond what the rest of the stack validates for.
export type ImageKind = "jpeg" | "png" | "webp";

const at = (bytes: Uint8Array, i: number): number | undefined => bytes[i];

/**
 * Magic-byte signatures, checked against the FULL allow-list (independent of
 * any client-declared MIME) — used by detectImageKind. Kept in sync with the
 * per-MIME check below.
 */
function isJpegSignature(bytes: Uint8Array): boolean {
  return at(bytes, 0) === 0xff && at(bytes, 1) === 0xd8 && at(bytes, 2) === 0xff;
}

function isPngSignature(bytes: Uint8Array): boolean {
  return (
    at(bytes, 0) === 0x89 &&
    at(bytes, 1) === 0x50 &&
    at(bytes, 2) === 0x4e &&
    at(bytes, 3) === 0x47 &&
    at(bytes, 4) === 0x0d &&
    at(bytes, 5) === 0x0a &&
    at(bytes, 6) === 0x1a &&
    at(bytes, 7) === 0x0a
  );
}

function isWebpSignature(bytes: Uint8Array): boolean {
  // "RIFF" at 0..3, 4 bytes of little-endian size, "WEBP" at 8..11.
  return (
    at(bytes, 0) === 0x52 &&
    at(bytes, 1) === 0x49 &&
    at(bytes, 2) === 0x46 &&
    at(bytes, 3) === 0x46 &&
    at(bytes, 8) === 0x57 &&
    at(bytes, 9) === 0x45 &&
    at(bytes, 10) === 0x42 &&
    at(bytes, 11) === 0x50
  );
}

/**
 * Sniff the real container format from the leading bytes, independent of any
 * client-declared MIME. Returns null when the bytes don't match any allowed
 * signature (truncated file, HTML mislabelled as an image, garbage, etc).
 */
export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (isJpegSignature(bytes)) return "jpeg";
  if (isPngSignature(bytes)) return "png";
  if (isWebpSignature(bytes)) return "webp";
  return null;
}

const MIME_TO_KIND: Record<string, ImageKind> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Content-sniff the leading bytes against the declared MIME so a client can't
 * pass the type/size check with a mislabelled or crafted file (e.g. a script
 * renamed .jpg). Pure over Uint8Array — no File needed. Unknown MIME is
 * rejected outright: this is defence-in-depth on top of the same allow-list a
 * caller has already gated (e.g. lib/pintDropsStore.ts's validatePhoto).
 */
export function magicBytesOk(bytes: Uint8Array, mime: string): boolean {
  const expected = MIME_TO_KIND[mime];
  if (!expected) return false;
  return detectImageKind(bytes) === expected;
}

// ── JPEG segment walking ─────────────────────────────────────────────────────
//
// JPEG is a stream of marker segments: 0xFF followed by a marker byte, then
// (for most markers) a big-endian 2-byte length INCLUDING the length field
// itself, then that many bytes of payload. SOS (Start of Scan, 0xDA) is the
// last segment with a length; everything after it (the entropy-coded scan
// data, plus any trailing RST markers) runs to EOI (0xFF 0xD9) and is copied
// through verbatim — we never try to parse compressed scan data.
//
// We KEEP: SOI (D8), APP0/JFIF (E0), DQT (DB), SOF0-2 (C0-C2), DHT (C4), SOS
// (DA) + its scan data, EOI (D9), and any other structural marker needed to
// decode the image (DRI, etc).
// We DROP: APP1 (E1 — Exif, incl. GPS), APP2 (E2 — often ICC/MPF but treated
// as metadata here per the issue spec), COM (FE — free-text comments, which
// have carried stray PII in the wild).
const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_SOS = 0xda;
const JPEG_APP1 = 0xe1;
const JPEG_APP2 = 0xe2;
const JPEG_COM = 0xfe;
// Markers with no length/payload (standalone) — RST0-7 and a couple of others.
// These are only ever seen inside/around scan data in practice; listed for
// completeness/robustness of the walker, not because we expect to hit them
// before SOS.
const JPEG_STANDALONE_MARKERS = new Set<number>([
  0x01, // TEM
  ...Array.from({ length: 8 }, (_, i) => 0xd0 + i), // RST0-7
]);

const DROPPED_JPEG_MARKERS = new Set<number>([JPEG_APP1, JPEG_APP2, JPEG_COM]);

/**
 * Strip EXIF/GPS-bearing and free-text metadata segments from a JPEG byte
 * stream by rewriting the marker-segment sequence. Keeps SOI, APP0/JFIF, all
 * structural segments (DQT/SOF/DHT/DRI/...), SOS, the scan data, and EOI.
 * Drops APP1 (Exif), APP2, and COM segments entirely.
 *
 * Fails closed: throws on a malformed/truncated stream (no valid SOI, a
 * segment whose declared length runs past the buffer, no SOS ever found)
 * rather than returning a partially-parsed or guessed result — callers MUST
 * treat a throw as "reject the upload", never "upload the original bytes".
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (!isJpegSignature(bytes)) {
    throw new Error("Not a JPEG byte stream.");
  }
  const out: number[] = [0xff, JPEG_SOI];
  let i = 2;

  for (;;) {
    if (i >= bytes.length) {
      throw new Error("Truncated JPEG: no SOS/EOI found.");
    }
    if (bytes[i] !== 0xff) {
      throw new Error(`Malformed JPEG: expected marker at offset ${i}.`);
    }
    // Marker padding: a run of extra 0xFF bytes before the real marker byte is
    // legal: skip them.
    let markerPos = i + 1;
    while (bytes[markerPos] === 0xff) markerPos++;
    const marker = bytes[markerPos];
    if (marker === undefined) {
      throw new Error("Truncated JPEG: marker byte missing.");
    }

    if (marker === JPEG_EOI) {
      out.push(0xff, JPEG_EOI);
      return Uint8Array.from(out);
    }

    if (JPEG_STANDALONE_MARKERS.has(marker)) {
      out.push(0xff, marker);
      i = markerPos + 1;
      continue;
    }

    if (marker === JPEG_SOS) {
      // SOS has its own length-prefixed header, then raw entropy-coded scan
      // data through to EOI (which may contain RST markers — 0xFF followed by
      // a byte that is NOT a "real" marker in the entropy stream, but we don't
      // need to distinguish: we scan for the next 0xFF byte that is EOI and
      // copy everything else through verbatim, since we never re-encode).
      const lenPos = markerPos + 1;
      if (lenPos + 1 >= bytes.length) throw new Error("Truncated JPEG: SOS header cut off.");
      const segLen = (bytes[lenPos]! << 8) | bytes[lenPos + 1]!;
      const headerEnd = lenPos + segLen;
      if (segLen < 2 || headerEnd > bytes.length) {
        throw new Error("Malformed JPEG: SOS header length out of range.");
      }
      // Copy marker + full SOS header (length field included).
      for (let p = i; p < headerEnd; p++) out.push(bytes[p]!);

      // Copy scan data verbatim until we hit the real EOI marker. A 0xFF
      // followed by 0x00 is a stuffed byte (part of the data); 0xFF followed
      // by 0xD0-0xD7 is an RST marker (also part of the scan, keep as-is);
      // 0xFF followed by 0xD9 is EOI, which ends the stream.
      let p = headerEnd;
      while (p < bytes.length) {
        if (bytes[p] === 0xff) {
          const next = bytes[p + 1];
          if (next === JPEG_EOI) {
            out.push(0xff, JPEG_EOI);
            return Uint8Array.from(out);
          }
          // Stuffed 0x00 or an RST marker (or trailing 0xFF padding) — copy
          // both bytes and continue.
          out.push(bytes[p]!);
          p++;
          continue;
        }
        out.push(bytes[p]!);
        p++;
      }
      // Ran off the end of the buffer without an EOI — tolerate it (some
      // producers omit a trailing EOI) by treating end-of-buffer as the end
      // of the stream, but only if we actually copied scan data.
      return Uint8Array.from(out);
    }

    // Generic length-prefixed segment (APPn, COM, DQT, SOF, DHT, DRI, ...).
    const lenPos = markerPos + 1;
    if (lenPos + 1 >= bytes.length) {
      throw new Error("Truncated JPEG: segment length cut off.");
    }
    const segLen = (bytes[lenPos]! << 8) | bytes[lenPos + 1]!;
    if (segLen < 2 || lenPos + segLen > bytes.length) {
      throw new Error("Malformed JPEG: segment length out of range.");
    }
    const segmentEnd = lenPos + segLen;

    if (!DROPPED_JPEG_MARKERS.has(marker)) {
      for (let p = i; p < segmentEnd; p++) out.push(bytes[p]!);
    }
    // else: drop the whole segment (APP1/APP2/COM) — advance without copying.

    i = segmentEnd;
  }
}

// ── PNG chunk walking ────────────────────────────────────────────────────────
//
// PNG is the 8-byte signature followed by a stream of chunks: 4-byte
// big-endian length (payload only), 4-byte ASCII type, `length` bytes of
// payload, 4-byte CRC. We drop ancillary text/metadata chunk types (tEXt,
// iTXt, zTXt, eXIf) and keep everything else (IHDR, PLTE, IDAT, IEND, and any
// other chunk we don't recognise — safest default for an unknown chunk is to
// keep it, since dropping an unrecognised critical chunk could break
// decoding).
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DROPPED_PNG_CHUNK_TYPES = new Set(["tEXt", "iTXt", "zTXt", "eXIf"]);

function chunkTypeString(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

/**
 * Strip ancillary text/EXIF chunks (tEXt/iTXt/zTXt/eXIf) from a PNG byte
 * stream by rewriting the chunk sequence. Fails closed on a malformed/
 * truncated stream (bad signature, a chunk whose length runs past the
 * buffer, no IEND found) — callers must treat a throw as "reject the upload".
 */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (!isPngSignature(bytes)) {
    throw new Error("Not a PNG byte stream.");
  }
  const out: number[] = PNG_SIGNATURE.slice();
  let i = 8;
  let sawIend = false;

  while (i < bytes.length) {
    if (i + 8 > bytes.length) {
      throw new Error("Truncated PNG: chunk header cut off.");
    }
    const length = (bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 0) {
      throw new Error("Malformed PNG: negative chunk length.");
    }
    const type = chunkTypeString(bytes, i + 4);
    const chunkTotal = 4 + 4 + length + 4; // length + type + payload + CRC
    if (i + chunkTotal > bytes.length) {
      throw new Error(`Truncated PNG: ${type} chunk runs past end of buffer.`);
    }

    if (!DROPPED_PNG_CHUNK_TYPES.has(type)) {
      for (let p = i; p < i + chunkTotal; p++) out.push(bytes[p]!);
    }
    if (type === "IEND") sawIend = true;

    i += chunkTotal;
    if (sawIend) break;
  }

  if (!sawIend) {
    throw new Error("Malformed PNG: no IEND chunk found.");
  }
  return Uint8Array.from(out);
}

// ── WebP chunk walking (best-effort) ─────────────────────────────────────────
//
// A "simple" (non-extended) lossy/lossless WebP — RIFF/WEBP with a single
// VP8/VP8L chunk and no EXIF/XMP — carries no metadata to strip; it is
// returned unchanged. An EXTENDED WebP (VP8X container) CAN carry an "EXIF"
// and/or "XMP " chunk alongside the image data chunks (VP8/VP8L/ALPH/ANIM/
// ANMF); those two chunk types are stripped here the same way as the JPEG/PNG
// paths. We do not attempt to renegotiate the VP8X flag bits that announce
// EXIF/XMP presence (bits 3/2 of the flags byte) beyond clearing them when we
// drop the corresponding chunk, since a stale "present" flag with no chunk is
// a spec violation some decoders tolerate but should not be produced here.
//
// This is intentionally a straightforward RIFF walk (like the PNG chunk walk
// above), not a full WebP/VP8X validator — anything we don't recognise as
// EXIF/XMP is passed through untouched (documented pass-through), matching
// the issue's guidance to keep WebP simple or explicitly document the gap.
const DROPPED_WEBP_CHUNK_TYPES = new Set(["EXIF", "XMP "]);
const WEBP_VP8X_EXIF_FLAG = 0x08;
const WEBP_VP8X_XMP_FLAG = 0x04;

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function writeUint32LE(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/**
 * Strip EXIF/XMP RIFF sub-chunks from a WebP byte stream. Simple (VP8/VP8L,
 * no VP8X) WebPs carry no such chunks and pass through unchanged. Fails
 * closed on a malformed/truncated RIFF container.
 */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (!isWebpSignature(bytes)) {
    throw new Error("Not a WebP byte stream.");
  }
  if (bytes.length < 12) {
    throw new Error("Truncated WebP: header cut off.");
  }
  const riffSize = readUint32LE(bytes, 4);
  const declaredEnd = 8 + riffSize;
  if (declaredEnd > bytes.length) {
    throw new Error("Malformed WebP: RIFF size runs past end of buffer.");
  }

  const chunks: { type: string; start: number; total: number }[] = [];
  let i = 12; // past "RIFF" + size + "WEBP"
  let sawAnyMetadata = false;
  while (i < declaredEnd) {
    if (i + 8 > declaredEnd) {
      throw new Error("Truncated WebP: chunk header cut off.");
    }
    const type = chunkTypeString(bytes, i);
    const size = readUint32LE(bytes, i + 4);
    const padded = size + (size % 2); // chunks are padded to even length
    const total = 8 + padded;
    if (i + total > declaredEnd) {
      throw new Error(`Truncated WebP: ${type} chunk runs past end of buffer.`);
    }
    if (DROPPED_WEBP_CHUNK_TYPES.has(type)) sawAnyMetadata = true;
    chunks.push({ type, start: i, total });
    i += total;
  }

  if (!sawAnyMetadata) {
    // Nothing to strip (simple WebP, or an extended one with no EXIF/XMP) —
    // pass through unchanged, byte-for-byte.
    return bytes;
  }

  const removedExif = chunks.some((c) => c.type === "EXIF");
  const removedXmp = chunks.some((c) => c.type === "XMP ");
  const staleVp8xFlags =
    (removedExif ? WEBP_VP8X_EXIF_FLAG : 0) | (removedXmp ? WEBP_VP8X_XMP_FLAG : 0);
  const keptChunks = chunks.filter((c) => !DROPPED_WEBP_CHUNK_TYPES.has(c.type));
  const bodyLength = keptChunks.reduce((sum, c) => sum + c.total, 0);
  const newRiffSize = 4 + bodyLength; // "WEBP" + chunks
  const out: number[] = [
    0x52,
    0x49,
    0x46,
    0x46, // "RIFF"
    ...writeUint32LE(newRiffSize),
    0x57,
    0x45,
    0x42,
    0x50, // "WEBP"
  ];
  for (const c of keptChunks) {
    const vp8xFlagsOffset = c.type === "VP8X" ? c.start + 8 : -1;
    for (let p = c.start; p < c.start + c.total; p++) {
      out.push(p === vp8xFlagsOffset ? bytes[p]! & ~staleVp8xFlags : bytes[p]!);
    }
  }
  return Uint8Array.from(out);
}

/**
 * The one orchestration point: strip privacy-sensitive metadata from an image
 * whose kind has ALREADY been confirmed by magicBytesOk/detectImageKind.
 * Fail-closed by construction — every per-format stripper throws rather than
 * returning a guessed/partial result, and this function does not swallow
 * those throws; callers must treat a throw as "reject the upload," never
 * "upload the original (unstripped) bytes."
 */
export function stripImageMetadata(bytes: Uint8Array, kind: ImageKind): Uint8Array {
  switch (kind) {
    case "jpeg":
      return stripJpegMetadata(bytes);
    case "png":
      return stripPngMetadata(bytes);
    case "webp":
      return stripWebpMetadata(bytes);
  }
}
