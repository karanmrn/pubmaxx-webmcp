// Soft cuisine / plate tags for food-serving pubs (Wave E — food light).
//
// Tags are lowercase tokens shown as chips in the venue overview and used by
// Discover's "Hungry?" deep-link. They NEVER invent amenity flags — a venue
// without food still won't pass requireFood. Membership is:
//   1. curated map by venue id (small, hand-picked), OR
//   2. keyword hits in searchText / name (roast, thai, pizza, …).
//
// Pure helpers — unit-tested in __tests__/cuisineTags.test.ts.

/** Soft plate / cuisine tokens we recognise in copy and the curated seed. */
export const KNOWN_CUISINE_TAGS = [
  "roast",
  "thai",
  "pizza",
  "burger",
  "tapas",
  "italian",
  "indian",
  "steak",
  "grill",
  "pie",
  "fish",
  "kitchen",
  "gastropub",
  "chinese",
  "mexican",
] as const;

export type CuisineTag = (typeof KNOWN_CUISINE_TAGS)[number];

const KNOWN_SET = new Set<string>(KNOWN_CUISINE_TAGS);

// Small curated map for well-known food pubs (ids from venues_slim / crawls).
// Keep honest: only venues that actually serve food in the dataset.
export const CURATED_CUISINE_BY_VENUE_ID: Readonly<Record<string, readonly string[]>> = {
  "venue-1ufn31x": ["roast", "gastropub"], // The Nellie Dean
  "venue-1t8siin": ["gastropub"], // The Crown & Two Chairmen
  "venue-xiesdn": ["gastropub"], // The Dog & Duck
  "venue-phqazo": ["gastropub"], // The Coach & Horses
  "venue-15i2wst": ["roast", "gastropub"], // Golden Lion (Soho)
  "venue-16ze6b1": ["roast", "pie"], // The George (Borough)
  "venue-2e3otf": ["gastropub"], // The Barrowboy & Banker
  "venue-ral8ik": ["burger"], // Honest Burger Tower Hill
  "venue-140rjwt": ["tapas"], // Tapas Brindisa London Bridge
  "venue-xmy0sb": ["italian"], // Symposium Italian
  "venue-17zuc81": ["italian"], // Bacco Ristorante Italiano
  "venue-11lnj4t": ["steak"], // Bar + Block Steakhouse
  "venue-pzbwmw": ["burger", "kitchen"], // Cask Pub & Kitchen
  "venue-1226a9v": ["gastropub", "kitchen"], // Brewhouse & Kitchen Highbury
  "venue-1ie3w8u": ["grill"], // North Pole Bar and Grill
  "venue-11n82fd": ["burger"], // The Seven Stars
  "venue-1u2v4eh": ["burger"], // The Waterloo Tap
  "venue-16s3et4": ["burger"], // The Jolly Gardeners
  "venue-1y5lg8a": ["pie"], // The Lord Napier Star
  "venue-7g6jxt": ["pie"], // The New Fairlop Oak
  "venue-we3mzn": ["kitchen"], // German Gymnasium
  "venue-5zogu6": ["kitchen"], // Hicce Hart
  // Wave F1 — denser food coverage on central crawl pubs (still light tags).
  "venue-1yd70c7": ["gastropub", "roast"], // The Lamb
  "venue-fr71bp": ["gastropub"], // Museum Tavern
  "venue-gv8lwa": ["gastropub", "fish"], // Anchor Bankside
  "venue-1x50b6d": ["gastropub"], // Old Thameside Inn
  "venue-16pnwmm": ["gastropub", "fish"], // Prospect of Whitby
  "venue-ekvkuv": ["gastropub"], // The Grapes
  "venue-1d8a5xb": ["gastropub"], // Captain Kidd
  "venue-fpmfjs": ["gastropub"], // The Rake
  "venue-133uf6h": ["gastropub", "kitchen"], // Katzenjammers
  "venue-dbukrn": ["gastropub"], // The Coal Hole
  "venue-lrlyh8": ["gastropub", "roast"], // Old Bank of England
  "venue-1sx1vco": ["gastropub"], // Ye Olde Cock Tavern
  "venue-erabed": ["gastropub"], // The Perseverance
};

/** Normalise a raw tag: trim, lowercase, drop empties / unknowns. */
export function normaliseCuisineTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase();
  if (!tag || !KNOWN_SET.has(tag)) return null;
  return tag;
}

/** Dedupe + keep only known tags, stable order matching KNOWN_CUISINE_TAGS. */
export function normaliseCuisineTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const found = new Set<string>();
  for (const raw of tags) {
    const tag = normaliseCuisineTag(raw);
    if (tag) found.add(tag);
  }
  return KNOWN_CUISINE_TAGS.filter((tag) => found.has(tag));
}

/** Pull known cuisine keywords out of free text (name / searchText). */
export function cuisineTagsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return KNOWN_CUISINE_TAGS.filter((tag) => {
    // Word-ish match: tag as whole word or hyphenated compound.
    const re = new RegExp(`(?:^|[^a-z])${tag}(?:[^a-z]|$)`);
    return re.test(lower);
  });
}

export type CuisineLookupInput = {
  id: string;
  name?: string;
  searchText?: string;
  /** Optional tags already on VenueFilterHints.cuisineTags. */
  hintTags?: readonly string[];
};

/**
 * Resolve soft cuisine tags for a venue: curated id map ∪ hint tags ∪
 * keyword hits in name/searchText. Always returns a normalised, deduped list.
 */
export function cuisineTagsForVenue(input: CuisineLookupInput): string[] {
  const curated = CURATED_CUISINE_BY_VENUE_ID[input.id] ?? [];
  const fromHints = input.hintTags ?? [];
  const fromText = cuisineTagsFromText(
    [input.name, input.searchText].filter(Boolean).join(" "),
  );
  return normaliseCuisineTags([...curated, ...fromHints, ...fromText]);
}
