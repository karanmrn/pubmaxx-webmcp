// Nicholson's Pubs (nicholsonspubs.co.uk) helpers — slug → display name and
// conservative venue matching against our London dataset. PURE: no network.
// Menu/price scraping is first-party-permissible; this module only shapes
// identity + match. Drink prices are NOT invented here (foodmenu scrapes are
// often image-only with no £ text).

export type NicholsonDatasetVenue = {
  venueKey: string;
  venueId: string;
  name: string;
  address: string;
  website?: string;
};

export type NicholsonPubIdentity = {
  slug: string;
  name: string;
  baseUrl: string;
  foodmenuUrl: string;
  bookingsUrl: string;
  drinksUrl: string;
  localityHint: string;
};

export type NicholsonVenueMatch = {
  venueKey: string;
  venueId: string;
  score: number;
  matchedName: string;
  method: "website" | "fuzzy-name";
};

/** Known London locality suffixes glued onto Nicholson's restaurant slugs. */
const LOCALITY_SUFFIXES = [
  "cambridgecircus",
  "claphamjunction",
  "leicestersquare",
  "liverpoolstreet",
  "oxfordcircus",
  "oxfordstreet",
  "charingcross",
  "canarywharf",
  "coventgarden",
  "carnabystreet",
  "hattongarden",
  "brewerstreet",
  "kinglystreet",
  "bishopsgate",
  "rathbonestreet",
  "fleetstreet",
  "watlingstreet",
  "grovelandcourt",
  "talbotcourt",
  "londonbridge",
  "cannonstreet",
  "blackfriars",
  "kensington",
  "westminster",
  "hammersmith",
  "moorgate",
  "islington",
  "southbank",
  "monument",
  "mayfair",
  "victoria",
  "aldgate",
  "strand",
  "soho",
] as const;

/** Hand-tuned display names for known London slugs (prefer over heuristics). */
const SLUG_DISPLAY_NAMES: Record<string, string> = {
  doggettscoatandbadgesouthbanklondon: "Doggett's Coat and Badge",
  theargyllarmsoxfordcircuslondon: "The Argyll Arms",
  thebearandstaffleicestersquarelondon: "The Bear and Staff",
  theblackfriarblackfriarslondon: "The Blackfriar",
  thecambridgecambridgecircuslondon: "The Cambridge",
  theclachankinglystreetlondon: "The Clachan",
  theclarencemayfairlondon: "The Clarence",
  thecoalholestrandlondon: "The Coal Hole",
  thecrownbrewerstreetlondon: "The Crown",
  thedogandducksoholondon: "The Dog and Duck",
  theelephantandcastlekensingtonlondon: "The Elephant and Castle",
  thefalconclaphamjunctionlondon: "The Falcon",
  thefeatherswestminsterlondon: "The Feathers",
  theflyinghorseoxfordstreetlondon: "The Flying Horse",
  theglobemoorgatelondon: "The Globe",
  thehenryaddingtoncanarywharflondon: "The Henry Addington",
  thehoopandgrapesaldgatelondon: "The Hoop and Grapes",
  thehornimanathayslondonbridge: "The Horniman at Hays",
  thekingsheadmayfairlondon: "The Kings Head",
  thelordaberconwayliverpoolstreetlondon: "The Lord Aberconway",
  themagpiebishopsgatelondon: "The Magpie",
  themarquisofgranbyrathbonestreetlondon: "The Marquis of Granby",
  themarquisofgranbywestminsterlondon: "The Marquis of Granby",
  themudlarklondonbridge: "The Mudlark",
  theobservatory: "The Observatory",
  theoldbelltavernfleetstreetlondon: "The Old Bell Tavern",
  theoldthamesideinnlondonbridge: "The Old Thameside Inn",
  theporcupineleicestersquarelondon: "The Porcupine",
  theprincessofwalescharingcrosslondon: "The Princess of Wales",
  theshiptalbotcourtlondon: "The Ship",
  thesirchristopherhattonhattongardenlondon: "The Sir Christopher Hatton",
  thestgeorgestavernvictorialondon: "The St George's Tavern",
  thesugarloafcannonstreet: "The Sugar Loaf",
  theswanhammersmithlondon: "The Swan",
  thethreegreyhoundssoholondon: "The Three Greyhounds",
  thewalrusandthecarpentermonumentlondon: "The Walrus and the Carpenter",
  thewellingtonstrandlondon: "The Wellington",
  thewhitehorsecarnabystreetlondon: "The White Horse",
  thewhitelioncoventgardenlondon: "The White Lion",
  thewhiteswanlondon: "The White Swan",
  thewoodinsshadesbishopsgatelondon: "The Woodins Shades",
  theyorkislingtonlondon: "The York",
  williamsonstaverngrovelandcourtlondon: "Williamson's Tavern",
  yeoldewatlingwatlingstreetlondon: "Ye Olde Watling",
};

function titleCaseWords(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^(and|at|of|the)$/i.test(word)) return word.toLowerCase();
      if (/^st$/i.test(word)) return "St";
      if (/^ye$/i.test(word)) return "Ye";
      if (/^olde$/i.test(word)) return "Olde";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/^the /i, "The ")
    .replace(/^ye /i, "Ye ");
}

/**
 * Convert a Nicholson's London restaurant slug into a human pub name.
 * Prefers the curated map; falls back to stripping locality suffixes.
 */
export function nicholsonSlugToName(slug: string): string {
  const key = slug.trim().toLowerCase();
  if (!key) return "";
  const curated = SLUG_DISPLAY_NAMES[key];
  if (curated) return curated;

  let body = key.replace(/\/+$/, "");
  if (body.endsWith("london")) body = body.slice(0, -"london".length);
  let locality = "";
  for (const suffix of LOCALITY_SUFFIXES) {
    if (body.endsWith(suffix)) {
      locality = suffix;
      body = body.slice(0, -suffix.length);
      break;
    }
  }
  // Soft word breaks for common compounds when no curated name exists.
  const spaced = body
    .replace(/^yeolde/, "ye olde ")
    .replace(/^the/, "the ")
    .replace(/and/g, " and ")
    .replace(/arms$/, " arms")
    .replace(/tavern$/, " tavern")
    .replace(/inn$/, " inn")
    .replace(/hole$/, " hole")
    .replace(/head$/, " head")
    .replace(/horse$/, " horse")
    .replace(/lion$/, " lion")
    .replace(/swan$/, " swan")
    .replace(/castle$/, " castle")
    .replace(/\s+/g, " ")
    .trim();
  const name = titleCaseWords(spaced || body);
  void locality;
  return name || slug;
}

/** Locality hint stripped from a slug (e.g. "soho", "strand") for fuzzy match. */
export function nicholsonSlugLocality(slug: string): string {
  let body = slug.trim().toLowerCase();
  if (body.endsWith("london")) body = body.slice(0, -"london".length);
  for (const suffix of LOCALITY_SUFFIXES) {
    if (body.endsWith(suffix)) return suffix;
  }
  return "";
}

export function nicholsonIdentityFromSlug(slug: string): NicholsonPubIdentity {
  const clean = slug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  const base = `https://www.nicholsonspubs.co.uk/restaurants/london/${clean}`;
  return {
    slug: clean,
    name: nicholsonSlugToName(clean),
    baseUrl: base,
    foodmenuUrl: `${base}/foodmenu`,
    bookingsUrl: `${base}/bookings`,
    drinksUrl: `${base}/drinks`,
    localityHint: nicholsonSlugLocality(clean),
  };
}

export function nicholsonSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.replace(/^www\./, "").includes("nicholsonspubs.co.uk")) {
      return null;
    }
    const m = u.pathname.match(/\/restaurants\/london\/([^/]+)/i);
    return m?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|pub|bar|tavern|inn|hotel)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalise(value).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const GENERIC_LOCALITY_TOKENS = new Set([
  "street",
  "square",
  "road",
  "lane",
  "hill",
  "court",
  "garden",
  "bridge",
  "bank",
  "fair",
  "gate",
  "circus",
  "wharf",
  "london",
]);

function localityTokens(hint: string): string[] {
  // cambridgecircus → ["cambridge", "circus"] style soft splits for address check.
  // Drop generic tokens ("street", "square") — they match almost any London address.
  const raw = hint
    .replace(/circus/g, " circus")
    .replace(/street/g, " street")
    .replace(/square/g, " square")
    .replace(/wharf/g, " wharf")
    .replace(/garden/g, " garden")
    .replace(/bridge/g, " bridge")
    .replace(/court/g, " court")
    .replace(/bank/g, " bank")
    .replace(/fair/g, " fair")
    .replace(/gate/g, " gate")
    .replace(/\s+/g, " ")
    .trim();
  return raw
    .split(" ")
    .filter((t) => t.length > 2 && !GENERIC_LOCALITY_TOKENS.has(t));
}

/**
 * Match a Nicholson's pub to one dataset venue, or null.
 * Prefer website containing nicholsonspubs + slug; else fuzzy name + London locality.
 */
export function matchNicholsonVenue(
  identity: NicholsonPubIdentity,
  dataset: NicholsonDatasetVenue[],
  minScore = 0.6,
): NicholsonVenueMatch | null {
  const slug = identity.slug.toLowerCase();

  const byWebsite: NicholsonVenueMatch[] = [];
  for (const venue of dataset) {
    const web = (venue.website ?? "").toLowerCase();
    if (!web.includes("nicholsonspubs")) continue;
    if (web.includes(slug) || web.includes(`/london/${slug}`)) {
      byWebsite.push({
        venueKey: venue.venueKey,
        venueId: venue.venueId,
        score: 1,
        matchedName: venue.name,
        method: "website",
      });
    }
  }
  if (byWebsite.length === 1) return byWebsite[0];
  if (byWebsite.length > 1) {
    // Identical slug hits should share a key; otherwise refuse.
    const keys = new Set(byWebsite.map((m) => m.venueKey));
    if (keys.size === 1) return byWebsite[0];
    return null;
  }

  const nameToks = tokens(identity.name);
  if (nameToks.size === 0) return null;
  const locParts = localityTokens(identity.localityHint);
  // Short names ("Crown", "Ship") without a distinctive locality are too ambiguous.
  if (nameToks.size <= 1 && locParts.length === 0) return null;

  const scored: NicholsonVenueMatch[] = [];
  for (const venue of dataset) {
    const score = jaccard(nameToks, tokens(venue.name));
    // Short pub names need a near-exact name match plus locality.
    const effectiveMin = nameToks.size <= 1 ? Math.max(minScore, 0.85) : minScore;
    if (score < effectiveMin) continue;
    const addr = normalise(venue.address);
    if (locParts.length > 0) {
      const locOk = locParts.some((part) => addr.includes(part));
      // Distinctive multi-word names may omit the marketing locality from the
      // postal address (e.g. Lord Aberconway / Liverpool Street → Old Broad St).
      // Require a long unique token AND 2+ name tokens so single-word names like
      // "Wellington" cannot drift across London.
      const distinctive = nameToks.size >= 2 && [...nameToks].some((t) => t.length >= 8);
      if (!locOk && !(score >= 0.85 && distinctive)) continue;
      if (
        !locOk &&
        !/\blondon\b|\bec\d|\bw\d|\bsw\d|\bse\d|\bn\d|\be\d|\bnw\d/i.test(venue.address)
      ) {
        continue;
      }
    } else {
      // No locality: require London-ish address signal to avoid out-of-city hits.
      if (!/\blondon\b|\bec\d|\bw\d|\bsw\d|\bse\d|\bn\d|\be\d|\bnw\d/i.test(venue.address)) {
        continue;
      }
    }
    scored.push({
      venueKey: venue.venueKey,
      venueId: venue.venueId,
      score,
      matchedName: venue.name,
      method: "fuzzy-name",
    });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tie = scored[1];
  if (tie && tie.score === top.score && tie.venueKey !== top.venueKey) {
    return null;
  }
  return top;
}
