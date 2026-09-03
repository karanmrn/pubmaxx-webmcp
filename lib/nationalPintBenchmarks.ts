// The national yardstick - what a pint costs across the UK, as measured by
// other people.
//
// A price on our map means nothing on its own. £5.80 is only interesting next
// to something, and the something the whole country is already arguing about is
// the national average. So this module carries a small hand-curated set of
// national figures, each one traced to the body that actually counted it rather
// than to the paper that repeated the count.
//
// HARD RULE - a national figure is NOT one of our observations.
//
//   Nothing here was measured by us. It may never be aggregated with our own
//   prices, averaged into them, ranked beside them as if it were a London pub,
//   or written into any current-price feed: not the Pint Index or its dated
//   editions, not price bands or pin colour, not the pin price label, not
//   cheapest-pint buckets, not the freshness registry, not the community price
//   merge.
//
//   Mechanically that means this module exports NOTHING shaped like a
//   PintIndexObservation or a venue price - no venueId, no pricePence, no
//   observedAt, no boroughCode - and is imported by NOTHING on those paths. It
//   has exactly one consumer: the Pint Index page's national block.
//   __tests__/nationalPintBenchmarks.test.ts pins the import fence, the shape
//   fence and the citation rules.
//
// SECOND RULE - a cask ale is not a lager is not "a pint".
//
//   A national cask-ale average and a London draught pint are different
//   measurements. Every row therefore carries `measure` in plain words, and the
//   UI prints it beside the figure rather than tucking it into a footnote. A
//   row that will not say what it counted does not ship.
//
// What earns a row: a named publisher, a public URL, a publication day, and a
// method a reader can weigh. A tabloid summarising a trade body is weaker
// provenance than the trade body, so the citation here is the strongest link in
// the chain we could reach, not the one that ran the headline.

/** One national price, and the period it describes. */
export type NationalPintFigure = {
  priceGbp: number;
  /** When this price applied, as it reads on screen: "1990", "May 2026". */
  period: string;
  /** The calendar year of `period`, so a span can be counted rather than parsed. */
  year: number;
};

/**
 * One cited national figure. Two figures make a then-and-now line from a single
 * series; one figure is a benchmark on its own. Never mix publishers inside a
 * row: a then-and-now built from two different surveys is not a comparison.
 */
export type NationalPintBenchmark = {
  id: string;
  /** What was counted, in pub words. "A pint of cask ale, UK-wide." */
  measure: string;
  /** Oldest first. One or two: a third would be a chart, which is not this. */
  figures: NationalPintFigure[];
  publisher: string;
  /** The day the publisher put the figure out, `YYYY-MM-DD`. */
  publishedOn: string;
  sourceUrl: string;
  /** How the publisher arrived at it, one clause a reader can weigh. */
  method: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** A real calendar day, `YYYY-MM-DD`, that has already happened. */
export function isPublishedDay(value: unknown, now: number = Date.now()): value is string {
  if (!isNonEmptyString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return false;
  // Round-trip so "2026-02-31" is rejected rather than rolled forward.
  if (new Date(ms).toISOString().slice(0, 10) !== value) return false;
  return ms <= now;
}

/**
 * Hand-rolled row guard, in the shape of lib/priceHistory.ts: drop the bad row,
 * never throw. A figure with no publisher, no link or no day is not evidence,
 * so it is dropped rather than printed without its citation.
 */
export function isValidNationalPintBenchmark(
  value: unknown,
  now: number = Date.now(),
): value is NationalPintBenchmark {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.id)) return false;
  if (!isNonEmptyString(row.measure)) return false;
  if (!isNonEmptyString(row.publisher)) return false;
  if (!isNonEmptyString(row.method)) return false;
  if (!isHttpsUrl(row.sourceUrl)) return false;
  if (!isPublishedDay(row.publishedOn, now)) return false;
  const figures = row.figures;
  if (!Array.isArray(figures) || figures.length < 1 || figures.length > 2) return false;
  const wellFormed = figures.every((figure) => {
    if (typeof figure !== "object" || figure === null) return false;
    const f = figure as Record<string, unknown>;
    return typeof f.priceGbp === "number" && Number.isFinite(f.priceGbp) && f.priceGbp > 0 &&
      isNonEmptyString(f.period) &&
      typeof f.year === "number" && Number.isInteger(f.year) && f.year >= 1900;
  });
  if (!wellFormed) return false;
  // Oldest first, on the fence rather than on a reviewer. A row entered the
  // other way round reads as a fall that never happened, printed next to a real
  // citation, so it is dropped instead.
  if (figures.length === 2) {
    const [then, latest] = figures as NationalPintFigure[];
    if (latest.year < then.year) return false;
  }
  return true;
}

/** Keep only rows that carry a publisher, a link, a day and a stated measure. */
export function citableNationalBenchmarks(
  rows: readonly unknown[],
  now: number = Date.now(),
): NationalPintBenchmark[] {
  return rows.filter((row): row is NationalPintBenchmark =>
    isValidNationalPintBenchmark(row, now));
}

/**
 * The shipped set. Small on purpose: a smaller honest set beats a fuller
 * plausible one, and every row below was read at its source before it landed.
 *
 * Two claims that did NOT earn a row, so nobody re-adds them from a headline:
 *   - "Witney is the UK's dearest place for a pint" traces to a furniture
 *     retailer's PR study over crowdsourced Numbeo entries. No statistical
 *     agency, no trade body, no published method. Our own dearest-end view
 *     answers that question with prices we can show the working for.
 *   - The Sun's £4.91 cask figure is The Morning Advertiser's, so the trade
 *     title is cited here instead of the paper that repeated it.
 */
export const NATIONAL_PINT_BENCHMARKS: readonly NationalPintBenchmark[] = [
  {
    id: "ma-draught-pint-2026",
    measure: "a draught pint, UK-wide",
    figures: [{ priceGbp: 5.34, period: "May 2026", year: 2026 }],
    publisher: "The Morning Advertiser",
    publishedOn: "2026-05-21",
    sourceUrl:
      "https://www.morningadvertiser.co.uk/Article/2026/05/21/average-pint-price-rises-33-to-534-the-morning-advertiser-finds/",
    method: "Its own survey of pub operators, across more than 30 beer brands",
  },
  {
    id: "ma-cask-ale-2026",
    measure: "a pint of cask ale, UK-wide",
    figures: [{ priceGbp: 4.91, period: "July 2026", year: 2026 }],
    publisher: "The Morning Advertiser",
    publishedOn: "2026-07-23",
    sourceUrl:
      "https://www.morningadvertiser.co.uk/Article/2026/07/23/average-cask-ale-pint-price-reaches-491-as-beer-volumes-continue-to-decline/",
    method: "Its Beer Report 2026 reader survey. Cask ale only, so it sits below the draught figure above",
  },
  {
    // The then-and-now line, and the reason it is one series rather than two:
    // 1990 lager against 2026 cask would be two different drinks pretending to
    // be a trend. ONS series CZMS is the same measurement at both ends. It was
    // discontinued after January 2025, which is why "now" is dated to the month
    // the series stops rather than to today.
    id: "ons-draught-lager-czms",
    measure: "a draught lager, UK-wide",
    figures: [
      { priceGbp: 1.22, period: "1990", year: 1990 },
      { priceGbp: 4.83, period: "January 2025", year: 2025 },
    ],
    publisher: "Office for National Statistics",
    publishedOn: "2026-07-21",
    sourceUrl: "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/czms/mm23",
    method: "The RPI average price series for draught lager, which stops at January 2025",
  },
];

/**
 * The then-and-now arc, when a row carries two figures. Returns null for a
 * single-figure benchmark: one price is a benchmark, not a story about change.
 */
export type NationalPintArc = {
  then: NationalPintFigure;
  latest: NationalPintFigure;
  /** latest - then, rounded to the penny. Positive means it has gone up. */
  deltaGbp: number;
  /** Whole years between the two figures, never negative. */
  years: number;
};

export function nationalPintArc(row: NationalPintBenchmark): NationalPintArc | null {
  if (row.figures.length !== 2) return null;
  const [then, latest] = row.figures;
  return {
    then,
    latest,
    deltaGbp: Math.round((latest.priceGbp - then.priceGbp) * 100) / 100,
    years: Math.max(0, latest.year - then.year),
  };
}

const PUBLISHED_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "21 May 2026" - the day a citation is checked against. */
export function formatPublishedDay(publishedOn: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(publishedOn);
  if (!match) return publishedOn;
  const month = PUBLISHED_MONTHS[Number(match[2]) - 1];
  if (!month) return publishedOn;
  return `${Number(match[3])} ${month} ${match[1]}`;
}
