// Pure model for the shareable "Tonight in London" OG poster (Wave D · D1).
// Kept free of next/og and Node imports so vitest can exercise the text
// derivation directly; the opengraph-image route consumes this and only owns
// the layout.
//
// Honest by construction: the poster never claims more than the upstream gave.
// Counts and provenance come straight from the CityMCP `things_to_do` result;
// an empty/absent result yields a clean generic poster rather than a fabricated
// line, and every title is clamped (upstream text is untrusted).

import { coverageLabel, provenanceLabel, type TonightOpportunity } from "@/lib/tonight";

export type TonightPosterModel = {
  /** Fixed brand headline. */
  title: string;
  /** Coverage summary, e.g. "7 things on tonight" / "Thin tonight — 1 confirmed". */
  coverage: string;
  /** Up to three clamped event titles to tease on the card (may be empty). */
  titles: string[];
  /** Provenance line, always ending "· via CityMCP London". */
  provenance: string;
};

const TITLE = "Tonight in London";
const MAX_TITLES = 3;
const MAX_TITLE_LEN = 42;

/** Clamp/sanitise untrusted upstream text for a poster line. */
export function clampPosterText(raw: string | null | undefined, max = MAX_TITLE_LEN): string {
  if (!raw) return "";
  // Collapse ALL whitespace (incl. tabs/newlines) to single spaces first, so
  // stripping control chars can't fuse two words together, then drop any
  // remaining non-printing chars.
  const cleaned = Array.from(raw.replace(/\s+/g, " "))
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export function buildTonightPosterModel(
  result: { asOf?: string | null; opportunities?: TonightOpportunity[] } | null | undefined,
): TonightPosterModel {
  const ops = Array.isArray(result?.opportunities) ? result!.opportunities : [];
  const titles: string[] = [];
  for (const op of ops) {
    const t = clampPosterText(op.title);
    if (t) titles.push(t);
    if (titles.length >= MAX_TITLES) break;
  }
  return {
    title: TITLE,
    coverage: coverageLabel(ops.length),
    titles,
    provenance: `${provenanceLabel(result?.asOf)} · via CityMCP London`,
  };
}
