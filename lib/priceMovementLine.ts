import { formatPrice } from "@/lib/venues";

// One sentence, said the same way everywhere a then-and-now pair is printed.
//
// The venue sheet's price history and the Pint Index's national yardstick both
// end their two figures with this line. They are different price lanes and stay
// fenced from each other, but a reader meets both, so the sentence itself is
// shared rather than copied: a copy drifts, and two wordings for one idea read
// as two different claims.
//
// A flat price gets its own sentence rather than a "+£0.00", and a gap under a
// year says "since then" instead of claiming "0 years".

/** "Up £2.90 in 12 years." */
export function priceMovementLine(deltaGbp: number, years: number): string {
  const span = years >= 1 ? `in ${years} ${years === 1 ? "year" : "years"}` : "since then";
  const pennies = Math.round(deltaGbp * 100);
  if (pennies === 0) return `Same price ${span}.`;
  const direction = pennies > 0 ? "Up" : "Down";
  return `${direction} ${formatPrice(Math.abs(deltaGbp))} ${span}.`;
}
