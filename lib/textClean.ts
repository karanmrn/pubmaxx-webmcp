// Shared untrusted-text helpers. These consolidate the byte-identical `readString`
// / `clean*` definitions that were copy-pasted across the community write paths
// (pint-drops, comments, reactions, saved-pubs, profiles). One place so the trust
// boundary can't drift between routes.
//
// NOTE: lib/pintDrops.ts keeps its OWN private clean() on purpose — it is a
// load-bearing validator and is intentionally left untouched to avoid behaviour
// drift there. This module reproduces the SAME behaviour, verbatim, for the
// callers that duplicated it.

/**
 * Read an untrusted value as a non-empty string, or undefined. The exact shape
 * (`typeof === "string" && value.trim() ? value : undefined`) used verbatim by
 * the pint-drops / comments / reactions / saved-pubs routes. Note: it returns
 * the ORIGINAL (untrimmed) value — trimming is only the emptiness test.
 */
export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Trust boundary for free text. Strip anything that could be inline HTML angle
 * brackets, drop ASCII control chars (U+0000–U+001F and U+007F), collapse runs
 * of whitespace, trim, then cap to `cap` characters. Returns "" for a non-string.
 * Byte-identical to the clean/cleanText/cleanNote helpers it replaces.
 */
export function cleanText(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "") // no inline user HTML
    .replace(/[\u0000-\u001F\u007F]/g, " ") // strip control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

/**
 * Validate an untrusted avatar/link URL. Returns the trimmed URL when it is a
 * well-formed http(s) URL within `cap` characters, otherwise undefined. Rejects
 * javascript:/data: schemes, bare strings, and over-long URLs so nothing that
 * isn't a real remote URL is ever stored. An empty/blank value returns undefined
 * (callers treat that as "cleared"). Consolidates the profile route + store
 * avatar checks.
 */
export function isHttpUrl(value: unknown, cap: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > cap) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return trimmed;
}
