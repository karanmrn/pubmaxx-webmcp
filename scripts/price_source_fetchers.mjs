// Server-safe first-party price source fetchers shared by the manual refresh
// script and Vercel cron route.
//
// This module also owns the ONE allowlist filter both callers use, so the
// manual script and the scheduled route can never disagree about which sources
// are permissible.
//
// Each source-specific parser belongs here once its official source contract is
// implemented. Until then, returning no rows is the only honest behavior.

export const PERMISSIBLE_PRICE_SOURCE_KINDS = new Set([
  "first-party-official",
  "open-data",
]);

/** @param {unknown} value */
export function isHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Filter a raw price_sources.json `sources` array down to the entries a fetcher
 * is allowed to read: a permissible kind AND an http(s) URL. Anything else is
 * reported through `onSkip` and dropped, never handed to a fetcher.
 *
 * @param {unknown} sources
 * @param {{ onSkip?: (message: string) => void }} [options]
 * @returns {Array<{ id: string, label: string, kind: string, url: string }>}
 */
export function filterPermissiblePriceSources(sources, options = {}) {
  const onSkip = options.onSkip ?? (() => {});
  const permissible = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    if (typeof source !== "object" || source === null) {
      onSkip("SKIP source: entry is not an object");
      continue;
    }
    if (!PERMISSIBLE_PRICE_SOURCE_KINDS.has(source.kind)) {
      onSkip(`SKIP source "${source.id}": kind "${source.kind}" is not permissible`);
      continue;
    }
    if (!isHttpUrl(source.url)) {
      onSkip(`SKIP source "${source.id}": url is not an http(s) URL`);
      continue;
    }
    permissible.push({
      id: source.id,
      label: source.label,
      kind: source.kind,
      url: source.url,
    });
  }
  return permissible;
}

// --- STUB: per-source fetch ---------------------------------------------------
//
// Implement real parsers here. Each must:
//   - fetch ONLY `source.url` (already allowlist-verified by
//     filterPermissiblePriceSources: permissible kind + http(s) URL);
//   - map the venue to its canonical venueKey (lib/venues.ts venueGroupingKey);
//   - stamp { source: { label: source.label, url: source.url }, observedAt }.
// Return [] to contribute nothing (the default below) — a safe no-op.
/**
 * @param {{ id: string, label: string, kind: string, url: string }} source
 * @returns {Promise<unknown[]>}
 */
export async function fetchFromSource(source) {
  void source;
  return [];
}
