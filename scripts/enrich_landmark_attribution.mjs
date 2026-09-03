// Enrich landmark photos with Wikimedia Commons CC attribution.
//
// Usage:
//   node scripts/enrich_landmark_attribution.mjs
//
// CC-BY / CC-BY-SA require author + licence + link. lib/landmarks.ts only
// carried `credit: "Wikimedia Commons"` (the platform name), which is NOT
// compliant attribution (see docs/IMAGE_RIGHTS_AUDIT_2026-07-21.md finding 2).
//
// This reads the `commons("<encoded file>")` calls out of lib/landmarks.ts,
// asks the Commons API for each file's imageinfo extmetadata (Artist,
// LicenseShortName, LicenseUrl) plus the canonical file-page URL, cleans the
// Artist HTML down to plain text, and writes the observed-at attribution table
// to public/data/landmark_image_attribution.json keyed by the exact encoded
// filename as it appears in the source. lib/landmarks.ts merges that table in
// at module load, so nothing is fetched at render time.
//
// Network is wrapped so a miss is reported and skipped, never fatal: the
// committed JSON is what ships. Re-running refreshes the table and its date.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LANDMARKS = join(ROOT, "lib/landmarks.ts");
const OUT = join(ROOT, "public/data/landmark_image_attribution.json");
const API = "https://commons.wikimedia.org/w/api.php";

// Pull every commons("<encoded file>") argument out of the data module.
function landmarkFiles() {
  const src = readFileSync(LANDMARKS, "utf8");
  const files = new Set();
  const re = /commons\("([^"]+)"\)/g;
  let m;
  while ((m = re.exec(src)) !== null) files.add(m[1]);
  return [...files];
}

// Commons Artist metadata is an HTML fragment (often an <a> to the uploader,
// sometimes nested markup). Reduce it to a single plain-text line: drop tags,
// decode the handful of entities that actually appear, collapse whitespace.
function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchAttribution(encodedFile) {
  // The key in landmarks.ts is URL-encoded (spaces as %20, etc). Decode to the
  // real File title for the API, e.g. "Camden_Lock_London.jpg".
  const title = `File:${decodeURIComponent(encodedFile)}`;
  const params = new URLSearchParams({
    action: "query",
    prop: "imageinfo",
    iiprop: "extmetadata|url",
    titles: title,
    format: "json",
    formatversion: "2",
  });
  // Commons rate-limits bursts (429). Retry a few times with growing backoff,
  // honouring Retry-After when present, so a one-off full run completes.
  let res;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    res = await fetch(`${API}?${params.toString()}`, {
      headers: {
        "user-agent":
          "pubmaxxing-attribution-enrich/1.0 (landmark CC attribution; contact via repo)",
        accept: "application/json",
      },
    });
    if (res.status !== 429) break;
    const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const page = body?.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error("no imageinfo");
  const meta = info.extmetadata ?? {};
  const author = htmlToText(meta.Artist?.value ?? "");
  const licenseShortName = htmlToText(meta.LicenseShortName?.value ?? "");
  const licenseUrl = (meta.LicenseUrl?.value ?? "").trim();
  const sourcePageUrl = (info.descriptionurl ?? "").trim();
  return { author, licenseShortName, licenseUrl, sourcePageUrl };
}

async function main() {
  const files = landmarkFiles();
  const table = {};
  let ok = 0;
  const misses = [];
  for (const file of files) {
    try {
      const attr = await fetchAttribution(file);
      // A row is only useful with at least an author or a licence. A bare miss
      // is listed so the doc/PR can record the honest drop.
      if (!attr.author && !attr.licenseShortName) {
        misses.push(file);
        continue;
      }
      table[file] = attr;
      ok += 1;
      console.log(`ok  ${file} -> ${attr.author} | ${attr.licenseShortName}`);
    } catch (err) {
      misses.push(file);
      console.warn(`miss ${file} (${err.message})`);
    }
    // Be a polite client to the shared Commons API.
    await new Promise((r) => setTimeout(r, 1200));
  }

  const payload = {
    observedAt: new Date().toISOString().slice(0, 10),
    source: "Wikimedia Commons API (action=query&prop=imageinfo&iiprop=extmetadata)",
    note: "Author + licence + file-page link for each landmark Commons photo. Rendered as the compliant attribution line; do not fetch at render time.",
    files: table,
  };
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nwrote ${OUT}: ${ok} enriched, ${misses.length} missed`);
  if (misses.length) console.log(`missed files: ${misses.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
