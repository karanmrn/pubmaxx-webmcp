// Shared "clamp/sanitise untrusted text for an OG share card" helper. All OG
// surfaces that accept untrusted text use this module, including API cards,
// route-convention cards, and recap data. Text on a share card can come from a
// URL query param or user content, so it is never rendered unbounded: strip
// control chars, optionally collapse whitespace, cap length with an ellipsis.

/**
 * @param collapseWhitespace Collapse runs of whitespace (including
 *   newlines/tabs) to a single space. Off by default to match the
 *   query-param clamp (crawl-card/list-card), where a param is already a
 *   single line; on for free-text sources (plan titles, venue names, cited
 *   pub copy) that can carry embedded newlines.
 * @param collapseBeforeFilter Only meaningful when `collapseWhitespace` is
 *   on. Collapsing BEFORE stripping control chars (the Historic Pubs card's
 *   original order) turns "Line1\nLine2" into "Line1 Line2". The newline
 *   leaves a space behind. Collapsing after (every other card's original
 *   order) strips the newline first and has nothing left to collapse, so the
 *   same input becomes "Line1Line2". Both are real, previously-shipped
 *   behaviours; this flag keeps each card unchanged rather than silently
 *   picking a winner.
 */
export function clampOgText(
  raw: string | null | undefined,
  max: number,
  fallback = "",
  {
    collapseWhitespace = false,
    collapseBeforeFilter = false,
  }: { collapseWhitespace?: boolean; collapseBeforeFilter?: boolean } = {},
): string {
  if (!raw) return fallback;
  const source = collapseWhitespace && collapseBeforeFilter ? raw.replace(/\s+/g, " ") : raw;
  let cleaned = Array.from(source)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("");
  if (collapseWhitespace && !collapseBeforeFilter) cleaned = cleaned.replace(/\s+/g, " ");
  cleaned = cleaned.trim();
  if (!cleaned) return fallback;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Clamp a query-param integer into [min, max], rounding, with a fallback for anything non-finite. */
export function clampOgInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
