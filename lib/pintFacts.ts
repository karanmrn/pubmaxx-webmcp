// Programmatic fact layer (Wave S3.1 / S3.2) — the pure, React-free core behind
// the borough/city "Fact block" prose + stat table and the FAQ block.
//
// Provenance contract (PRD non-negotiable): every number here is DERIVED from
// the pint-price dataset the page already loads — average, minimum, maximum and
// counts over the per-pub cheapest tracked pint. Nothing is invented. When the
// data can't support an honest answer (no priced pub in the area) the stat is
// null and the caller renders nothing / skips the question — never a fabricated
// figure and never the word "live" (freshness is a dated observation window).
//
// The per-pub cheapest pint is the unit the borough table already shows the
// user, so the fact block's "average pint" and "cheapest pint" line up exactly
// with the visible ranking rather than introducing a second, confusing figure.

import { formatPrice } from "@/lib/venues";

// The minimal venue shape the stats need. Both the full Venue and the slim
// city SlimVenue satisfy it (name + per-pub cheapest tracked pint), so the same
// computation drives borough pages and city map pages.
export type PricedPubLike = {
  name: string;
  cheapestPrice: number | null;
};

export type PintFactStats = {
  /** Display name of the area (borough or city). */
  name: string;
  /** URL slug (borough slug or city id) — carried for link building. */
  slug: string;
  /** Pubs in the area carrying a usable (numeric) cheapest pint price. */
  pubCount: number;
  /** All pubs mapped in the area, priced or not. */
  totalPubCount: number;
  /** Mean of the per-pub cheapest tracked pints, GBP. null when none priced. */
  averageGbp: number | null;
  /** Cheapest tracked pint in the area, GBP. null when none priced. */
  minGbp: number | null;
  /** Pub with the cheapest tracked pint. null when none priced. */
  minPubName: string | null;
  /** Dearest tracked cheapest-pint in the area, GBP. null when none priced. */
  maxGbp: number | null;
  /** Pub with the dearest tracked cheapest-pint. null when none priced. */
  maxPubName: string | null;
};

// Round a mean to pence for display/serialisation. Kept separate so tests can
// assert the exact rounded figure the page renders.
function roundPence(value: number): number {
  return Math.round(value * 100) / 100;
}

// Compute the fact-block statistics for an area from its pubs. Pure and
// deterministic: min/max ties break on pub name (A–Z) so the same fixture
// always yields the same cheapest/dearest pub. Pubs with no numeric price are
// counted in totalPubCount but never move the average, min or max.
export function pintFactStats(
  pubs: PricedPubLike[],
  name: string,
  slug: string,
): PintFactStats {
  const priced = pubs
    .filter((pub) => typeof pub.cheapestPrice === "number")
    .map((pub) => ({ name: pub.name, price: pub.cheapestPrice as number }));

  const base: PintFactStats = {
    name,
    slug,
    pubCount: priced.length,
    totalPubCount: pubs.length,
    averageGbp: null,
    minGbp: null,
    minPubName: null,
    maxGbp: null,
    maxPubName: null,
  };
  if (priced.length === 0) return base;

  let min = priced[0];
  let max = priced[0];
  let sum = 0;
  for (const pub of priced) {
    sum += pub.price;
    if (
      pub.price < min.price ||
      (pub.price === min.price && pub.name.localeCompare(min.name) < 0)
    ) {
      min = pub;
    }
    if (
      pub.price > max.price ||
      (pub.price === max.price && pub.name.localeCompare(max.name) < 0)
    ) {
      max = pub;
    }
  }

  return {
    ...base,
    averageGbp: roundPence(sum / priced.length),
    minGbp: min.price,
    minPubName: min.name,
    maxGbp: max.price,
    maxPubName: max.name,
  };
}

/** True when the area has at least one priced pub — the block/FAQ can render. */
export function hasFactData(stats: PintFactStats): boolean {
  return stats.pubCount > 0 && stats.averageGbp !== null;
}

// The extractable fact-block prose, as discrete sentences so the caller can
// render each as its own <p> (better for AI extraction than one wall of text).
// Empty array when there's no priced data — caller renders nothing.
export function factBlockSentences(
  stats: PintFactStats,
  opts: { monthYear: string; observedDate: string },
): string[] {
  if (!hasFactData(stats)) return [];
  const { name } = stats;
  const avg = formatPrice(stats.averageGbp);
  const min = formatPrice(stats.minGbp);
  const sentences: string[] = [
    `As of ${opts.monthYear}, the average pint in ${name} costs ${avg} across ${stats.pubCount} tracked ${plural(stats.pubCount, "pub")}.`,
    `The cheapest tracked pint is ${min} at ${stats.minPubName}.`,
  ];
  // Range only reads honestly when min and max actually differ.
  if (
    stats.maxGbp !== null &&
    stats.minGbp !== null &&
    stats.maxGbp > stats.minGbp
  ) {
    sentences.push(
      `Tracked cheapest pints in ${name} range from ${min} to ${formatPrice(
        stats.maxGbp,
      )}.`,
    );
  }
  sentences.push(
    `Prices last collected ${opts.observedDate} for PUBMAXXING's tracked pint dataset, refreshed by community Pint Drops. Never a live feed.`,
  );
  return sentences;
}

export type FaqItem = { question: string; answer: string };

// 3–5 data-answerable FAQ questions for an area, each answered strictly from the
// stats. A question is SKIPPED whenever its answer data is missing, so a borough
// with no priced pub yields no FAQ (rather than an empty or invented answer).
export function faqItems(
  stats: PintFactStats,
  opts: { monthYear: string; year: string; observedDate: string },
): FaqItem[] {
  const items: FaqItem[] = [];
  const { name } = stats;

  if (stats.minGbp !== null && stats.minPubName) {
    items.push({
      question: `What is the cheapest pint in ${name}?`,
      answer: `The cheapest tracked pint in ${name} is ${formatPrice(
        stats.minGbp,
      )} at ${stats.minPubName}, as collected on ${opts.observedDate}.`,
    });
  }

  if (stats.averageGbp !== null) {
    items.push({
      question: `How much is a pint in ${name} in ${opts.year}?`,
      answer: `As of ${opts.monthYear}, the average pint in ${name} costs ${formatPrice(
        stats.averageGbp,
      )} across ${stats.pubCount} tracked ${plural(stats.pubCount, "pub")}.`,
    });
  }

  if (stats.pubCount > 0) {
    items.push({
      question: `How many pubs does ${name} have on PUBMAXXING?`,
      answer: `PUBMAXXING tracks a cheapest pint at ${stats.pubCount} ${plural(
        stats.pubCount,
        "pub",
      )} in ${name}${
        stats.totalPubCount > stats.pubCount
          ? ` (of ${stats.totalPubCount} mapped in the area)`
          : ""
      }.`,
    });
  }

  if (
    stats.maxGbp !== null &&
    stats.minGbp !== null &&
    stats.maxGbp > stats.minGbp
  ) {
    items.push({
      question: `What's the price range for a pint in ${name}?`,
      answer: `Tracked cheapest pints in ${name} range from ${formatPrice(
        stats.minGbp,
      )} to ${formatPrice(stats.maxGbp)}, collected on ${opts.observedDate}.`,
    });
  }

  return items;
}

// Build a schema.org FAQPage graph node from FAQ items. Returns null when there
// are no items so the caller omits the block entirely (no empty FAQPage).
export function faqPageJsonLd(items: FaqItem[]): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
