// Canonical beer brands — a small, deterministic vocabulary that maps the messy
// dataset `pint_name` strings (478 variants like "GUINNESS", "Guinness",
// "BEVERTOWN NECK OIL", "ESTRELLA DAMM") onto a stable set of ids, so the map can
// answer "which pubs pour my favourite pint, and how cheaply?".
//
// This module is pure — no window, no Date, no random — so normalizeBeer and
// priceForBeer are unit-testable and give identical output for identical input.

import type { Venue } from "@/lib/venues";

export type Beer = {
  id: string;
  label: string;
  // Extra substrings that also resolve to this beer. Matched (like the label)
  // against the normalised pint name, so include short/common spellings and
  // obvious misspellings seen in the data (e.g. "bevertown").
  aliases?: string[];
  // Typical UK draught ABV (%). Optional — honestly unknown when absent.
  abv?: number;
};

// The ~20 most common London draught pints by dataset row-count. Order is only
// cosmetic (the picker renders in this order); identity is the `id`.
// ABV values are typical UK retail/draught strengths (researched).
export const BEERS: Beer[] = [
  { id: "guinness", label: "Guinness", abv: 4.2 },
  { id: "amstel", label: "Amstel", abv: 4.0 },
  { id: "estrella", label: "Estrella", aliases: ["estrella damm"], abv: 4.6 },
  { id: "peroni", label: "Peroni", abv: 5.0 },
  { id: "neck-oil", label: "Neck Oil", aliases: ["neck oil", "beavertown", "bevertown"], abv: 4.3 },
  { id: "birra-moretti", label: "Birra Moretti", aliases: ["moretti"], abv: 4.6 },
  { id: "madri", label: "Madrí", aliases: ["madri"], abv: 4.6 },
  { id: "pravha", label: "Pravha", abv: 4.0 },
  { id: "carling", label: "Carling", abv: 4.0 },
  { id: "fosters", label: "Fosters", aliases: ["foster's"], abv: 4.0 },
  { id: "corona", label: "Corona", abv: 4.5 },
  { id: "budweiser", label: "Budweiser", abv: 4.8 },
  { id: "carlsberg", label: "Carlsberg", abv: 3.8 },
  { id: "stella-artois", label: "Stella Artois", aliases: ["stella"], abv: 4.6 },
  { id: "san-miguel", label: "San Miguel", abv: 5.0 },
  { id: "asahi", label: "Asahi", abv: 5.2 },
  { id: "coors", label: "Coors", aliases: ["coors light"], abv: 4.0 },
  { id: "camden-hells", label: "Camden Hells", aliases: ["camden hell", "hells lager", "camden"], abv: 4.6 },
  { id: "kronenbourg", label: "Kronenbourg", aliases: ["1664"], abv: 5.0 },
  { id: "leffe-blonde", label: "Leffe Blonde", aliases: ["leffe"], abv: 6.6 },
  { id: "bud-light", label: "Bud Light", abv: 3.5 },
];

// Lowercase, trim, and collapse everything that isn't a letter/number/space into
// a single space so "Coors Light", "COORS-LIGHT" and "coors  light" all match.
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Map a raw dataset pint name to a canonical Beer id, or null if none matches.
// A beer matches when its normalised label OR any alias appears as a substring
// of the normalised pint name. Longer needles win, so "bud light" resolves to
// bud-light rather than budweiser, and "stella artois" beats bare "stella".
export function normalizeBeer(pintName: string): string | null {
  const hay = normalise(pintName);
  if (!hay) return null;

  let bestId: string | null = null;
  let bestLen = 0;
  for (const beer of BEERS) {
    const needles = [beer.label, ...(beer.aliases ?? [])].map(normalise);
    for (const needle of needles) {
      if (needle && hay.includes(needle) && needle.length > bestLen) {
        bestLen = needle.length;
        bestId = beer.id;
      }
    }
  }
  return bestId;
}

// The cheapest known price for `beerId` at this venue, or null when the venue
// serves no matching pint (the "dim it" signal for the map). Null prices are
// ignored; a venue that only has price-less rows for the beer returns null.
export function priceForBeer(venue: Venue, beerId: string): number | null {
  let min: number | null = null;
  for (const price of venue.prices) {
    if (price.price_gbp === null) continue;
    if (normalizeBeer(price.pint_name) !== beerId) continue;
    if (min === null || price.price_gbp < min) min = price.price_gbp;
  }
  return min;
}
