import type { VenuePrice } from "@/lib/venues";

// Every heritage/story claim carries where it came from, so the UI can always
// show a Sourced / Contributor / Anecdote / Demo badge and they never blur.
// "demo" marks seeded example content: rendered for day-one liveliness but
// never allowed to masquerade as organic community data.
export type Provenance = "sourced" | "contributor" | "anecdote" | "demo";

// A claim is one labelled, provenance-stamped statement about a venue. The
// venue detail renders the whole list — a Sourced editorial claim and an
// Anecdote Pint Drop are separate entries and never merge into one note.
export type ClaimKind =
  | "baseline"
  | "sourced"
  | "contributor"
  | "anecdote"
  | "needs-source";

export type VenueClaim = {
  kind: ClaimKind;
  label: string;
  content: string;
  sourceRef?: string;
  era?: string;
};

// Structural shape of a Pint Drop as buildVenueClaims needs it. Kept local so
// curation.ts stays free of lib/pintDrops (which imports node `crypto`).
export type ClaimDrop = {
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  provenance: Provenance;
};

export type VenueCuration = {
  nearWater?: boolean;
  heritageEra?: string;
  heritageNote?: string;
  writerPick?: boolean;
  storyTag?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  provenance?: Provenance;
};

export type PubSource = {
  title: string;
  detail: string;
  url: string;
};

export const writerProfile = {
  name: "Alastair Hilton",
  handle: "@London_W4",
  role: "London photographer, narrowboat resident, historic pub walker",
  bookTitle: "The Greatest Pubs",
  bookUrl: "https://www.alastairhiltonphotographer.com/product-page/the-greatest-pubs",
  xUrl: "https://x.com/London_W4",
  summary:
    "A photographer-led view of pubs: what they look like, why they are loved, and why people should still visit them.",
  proofPoints: [
    "The book is a 156-page signed hardback covering 44 pubs.",
    "His guide profiles describe private historic London pub tours with stories and history facts.",
    "His shop includes pub prints such as The City Barge, The Grapes, The Sun Tavern, and The Queens.",
  ],
};

export const pubSources: PubSource[] = [
  {
    title: "The Greatest Pubs",
    detail: "Book by Alastair Hilton: 156 pages, 44 pubs, photos and personal notes.",
    url: writerProfile.bookUrl,
  },
  {
    title: "London_W4 on X",
    detail: "Public profile used for the writer identity and current pub commentary.",
    url: writerProfile.xUrl,
  },
  {
    title: "Historic pub tours",
    detail: "Guide profile describing Alastair's historic London pub walks.",
    url: "https://camdenguidedwalks.co.uk/london-tour-guide-alastair.php",
  },
];

export const writerTrail = [
  "The City Barge",
  "The Grapes",
  "The Sun Tavern",
  "The Queens",
];

const curatedVenues: Record<string, VenueCuration> = {
  "prospect of whitby": {
    nearWater: true,
    heritageEra: "Tudor",
    heritageNote:
      "Riverside Wapping pub usually dated to 1520; a strong fit for the heritage-by-water demo.",
    storyTag: "Old riverside London",
  },
  "the grapes": {
    nearWater: true,
    heritageEra: "Georgian riverside",
    heritageNote:
      "Limehouse pub on Narrow Street with a long river-facing history and a visible place in Hilton's pub print shop.",
    writerPick: true,
    storyTag: "Hilton print trail",
    sourceLabel: "The Grapes print",
    sourceUrl: "https://www.alastairhiltonphotographer.com/product-page/the-grapes",
  },
  "the dove": {
    nearWater: true,
    heritageEra: "Georgian",
    heritageNote:
      "Upper Mall riverside pub in Hammersmith; useful as a west London water-side heritage stop.",
    storyTag: "Thames-side room",
  },
  "the old pack horse": {
    heritageEra: "Edwardian",
    heritageNote:
      "Chiswick High Road pub noted for its Edwardian exterior and strong local character.",
    storyTag: "Chiswick landmark",
  },
  "the lamb": {
    heritageEra: "Victorian",
    heritageNote:
      "Victorian Bloomsbury pub with the kind of preserved interior detail that suits a heritage crawl.",
    storyTag: "Victorian room",
  },
  "the sun tavern": {
    heritageEra: "East End",
    heritageNote:
      "Bethnal Green pub included in Hilton's visible pub print shop, useful for a writer-inspired crawl seed.",
    writerPick: true,
    storyTag: "Hilton print trail",
    sourceLabel: "All Products - Alastair Hilton",
    sourceUrl: "https://www.alastairhiltonphotographer.com/category/all-products",
  },
  "the queens head": {
    heritageEra: "Victorian",
    heritageNote:
      "One of the app's closest matches for Hilton's visible The Queens print; keep as a soft match until the exact pub is verified.",
    writerPick: true,
    storyTag: "Possible Queens match",
    sourceLabel: "The Queens print",
    sourceUrl: "https://www.alastairhiltonphotographer.com/product-page/the-queens",
  },
  "the queens arms": {
    heritageEra: "Victorian",
    heritageNote:
      "Pimlico pub from 1846; a useful Victorian reference stop for the seeded heritage route.",
    storyTag: "Victorian pub",
  },
  // Eating Europe "London's Pubs" guide — editorial / heritage only (never prices).
  // https://www.eatingeurope.com/blog/londons-pubs/
  "the mayflower": {
    nearWater: true,
    heritageEra: "Riverside historic",
    heritageNote:
      "Rotherhithe riverside pub highlighted by Eating Europe for its deck views and old-English snack menu, a classic Thames-side stop.",
    storyTag: "Eating Europe guide",
    sourceLabel: "Eating Europe",
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    provenance: "sourced",
  },
  "lord wargrave": {
    heritageEra: "Marylebone",
    heritageNote:
      "Marylebone whisky pub picked by Eating Europe for its eclectic dram list and St. Louis pork ribs, a food-and-whisky guide stop.",
    storyTag: "Eating Europe guide",
    sourceLabel: "Eating Europe",
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    provenance: "sourced",
  },
  "ye old mitre": {
    heritageEra: "Historic Holborn",
    heritageNote:
      "Ely Court hideaway praised by Eating Europe as the classic London pub room. Red carpets, stools, a real fireplace, and board games on request.",
    storyTag: "Eating Europe guide",
    sourceLabel: "Eating Europe",
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    provenance: "sourced",
  },
  "ye olde mitre": {
    heritageEra: "Historic Holborn",
    heritageNote:
      "Ely Court hideaway praised by Eating Europe as the classic London pub room. Red carpets, stools, a real fireplace, and board games on request.",
    storyTag: "Eating Europe guide",
    sourceLabel: "Eating Europe",
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    provenance: "sourced",
  },
  // Islington N1 Albion only — address token avoids mis-labelling other Albions.
  "the albion|barnsbury": {
    heritageEra: "Islington historic",
    heritageNote:
      "Barnsbury local tipped by Eating Europe for its garden and village-pub feel just north of the Angel.",
    storyTag: "Eating Europe guide",
    sourceLabel: "Eating Europe",
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    provenance: "sourced",
  },
  "the spaniards inn": {
    heritageEra: "Hampstead historic",
    heritageNote:
      "Hampstead gastropub outside the centre, recommended by Eating Europe for British charm and a blanket-ready outdoor garden.",
    storyTag: "Eating Europe guide",
    sourceLabel: "Eating Europe",
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    provenance: "sourced",
  },
  "the ship soho": {
    heritageEra: "Soho historic",
    heritageNote:
      "Soho historic pub with a warm wooden room and musical past, Eating Europe's guide pick for an always-on atmosphere.",
    storyTag: "Eating Europe guide",
    sourceLabel: "Eating Europe",
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    provenance: "sourced",
  },
  "the grenadier": {
    heritageEra: "Belgravia historic",
    heritageNote:
      "Belgrave Square boozer tipped by Eating Europe for beef Wellington and famous Bloody Marys, a grand old local for locals and visitors alike.",
    storyTag: "Eating Europe guide",
    sourceLabel: "Eating Europe",
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    provenance: "sourced",
  },
};

const waterTerms = [
  "riverside",
  "river",
  "thames",
  "strand-on-the-green",
  "strand on the green",
  "wapping wall",
  "narrow st",
  "narrow street",
  "upper mall",
  "wharf",
  "dock",
  "canal",
  "waterside",
];

// Strong period signals only. "historic"/"traditional"/"cool" were removed —
// they appear in most pub blurbs and flooded the map with fake heritage badges.
const heritageTerms = [
  "victorian",
  "georgian",
  "edwardian",
  "tudor",
  "grade ii listed",
  "grade i listed",
  "oldest pub",
  "dating back",
  "since 18",
  "since 17",
  "since 16",
];

export function normaliseVenueName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Look up editorial curation. Keys may be bare names (`the grenadier`) or
 * address-qualified (`the albion|barnsbury`) so common pub names do not
 * mis-label the wrong venue.
 */
export function lookupCuratedVenue(
  pubName: string,
  address = "",
): VenueCuration {
  const name = normaliseVenueName(pubName);
  const addr = normaliseVenueName(address);
  for (const [key, value] of Object.entries(curatedVenues)) {
    const pipe = key.indexOf("|");
    if (pipe === -1) continue;
    const base = key.slice(0, pipe);
    const token = key.slice(pipe + 1);
    if (base === name && token && addr.includes(token)) return value;
  }
  return curatedVenues[name] ?? {};
}

export function getVenueCuration(prices: VenuePrice[]): VenueCuration {
  const first = prices[0];
  const explicit = lookupCuratedVenue(first.pub_name, first.address ?? "");
  const wikipediaRow = prices.find((row) =>
    String(row.source_datasets ?? "").includes("wikipedia_london_list"),
  );
  const wikipediaUrl =
    wikipediaRow?.comment?.match(/https:\/\/en\.wikipedia\.org\/wiki\/\S+/)?.[0] ??
    wikipediaRow?.comment?.replace(/^Wikipedia:\s*/i, "").trim();
  const haystack = [
    first.pub_name,
    first.address,
    first.description,
    ...prices.map((price) => price.comment),
  ]
    .join(" ")
    .toLowerCase();

  const nearWater =
    explicit.nearWater ?? waterTerms.some((term) => haystack.includes(term));

  // Hand-curated entries are checked editorial → sourced. Keyword matches are a
  // weak hint that still needs a human or a visitor Pint Drop → anecdote, never sourced.
  const hasExplicitHeritage =
    typeof explicit.heritageEra === "string" || typeof explicit.heritageNote === "string";
  const hasWikipediaList = Boolean(wikipediaRow && wikipediaUrl);
  const inferredHeritage =
    !hasExplicitHeritage &&
    !hasWikipediaList &&
    heritageTerms.some((term) => haystack.includes(term));

  const provenance: Provenance | undefined =
    explicit.writerPick || hasExplicitHeritage || explicit.sourceUrl || hasWikipediaList
      ? "sourced"
      : inferredHeritage
        ? "anecdote"
        : undefined;

  return {
    ...explicit,
    nearWater,
    provenance,
    heritageEra:
      explicit.heritageEra ??
      (hasWikipediaList ? "Wikipedia" : inferredHeritage ? "Historic (unverified)" : undefined),
    heritageNote:
      explicit.heritageNote ??
      (hasWikipediaList
        ? wikipediaRow?.description || "Listed on Wikipedia's List of pubs in London."
        : inferredHeritage
          ? "The venue's own description hints at period features. We haven't checked it. A sourced note or a visitor Pint Drop can settle it."
          : undefined),
    sourceLabel: explicit.sourceLabel ?? (hasWikipediaList ? "Wikipedia" : undefined),
    sourceUrl: explicit.sourceUrl ?? (hasWikipediaList ? wikipediaUrl : undefined),
  };
}

// Build the distinct, provenance-stamped claim list for a venue. Nothing here
// collapses: an editorial Sourced heritage claim and a note-only Anecdote drop
// BOTH appear as separate entries. A heritage note without a source ref is
// downgraded to "needs-source" so it is never mistaken for verified editorial.
export function buildVenueClaims(curation: VenueCuration, drops: ClaimDrop[] = []): VenueClaim[] {
  const claims: VenueClaim[] = [];

  if (curation.heritageNote) {
    const hasSource = Boolean(curation.sourceUrl) || curation.writerPick;
    claims.push({
      kind: hasSource ? "sourced" : "needs-source",
      label: hasSource ? curation.sourceLabel ?? "Editorial" : "Needs source",
      content: curation.heritageNote,
      sourceRef: curation.sourceUrl,
      era: curation.heritageEra,
    });
  }

  for (const drop of drops) {
    const priced = typeof drop.priceGbp === "number";
    const content =
      drop.passedDownNote ||
      (priced ? `Logged ${drop.drink || "a pint"} at £${drop.priceGbp!.toFixed(2)}.` : "");
    if (!content) continue;
    claims.push({
      // A seeded demo drop is a "baseline" claim — never Contributor/Anecdote,
      // so seeded liveliness stays visibly distinct from organic drops.
      kind: drop.provenance === "demo" ? "baseline" : priced ? "contributor" : "anecdote",
      label: drop.handle || (priced ? "Contributor" : "Anecdote"),
      content,
      era: drop.era || undefined,
    });
  }

  return claims;
}
