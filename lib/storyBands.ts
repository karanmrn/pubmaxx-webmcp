// Story bands — typed heritage corridors that thread the map's landmarks and
// story pubs into six curated walks (river history, Fleet Street writers,
// markets & theatre, royal/civic, Thames-side industrial, coding-pint).
//
// A band is pure data + a pure member-pub matcher. It never fights the price
// colour system: while a band is active the map may *emphasise* its member
// pubs (a halo), but the price fill stays. Every band carries grounded copy
// (2-3 sentences) and at least one source so the field-guide voice holds.
//
// The matcher is deterministic and side-effect free (haversine only), so band
// membership is trivially unit-testable without a map or network — see
// __tests__/storyBands.test.ts.

import { haversineKm } from "@/lib/haversine";
import { landmarks, type Landmark } from "@/lib/landmarks";
import type { Venue } from "@/lib/venues";
import { bandAnchors as resolveBandAnchors } from "@/lib/storyBandGeometry";
import { bandMemberPubs as matchBandMemberPubs } from "@/lib/storyBandVenueProximity";
import type { BandMember as BandMemberResult } from "@/lib/storyBandVenueProximity";

// The kind drives nothing in logic today, but tags each band so a future
// filter (e.g. "only literary walks") or an analytics slice stays cheap.
export type StoryBandKind =
  | "river"
  | "literary"
  | "market"
  | "civic"
  | "industrial"
  | "modern";

export type StoryBandSource = { label: string; url: string };

export type StoryBand = {
  id: string;
  title: string;
  /** 2-3 grounded sentences, field-guide voice, no hype. */
  copy: string;
  kind: StoryBandKind;
  /**
   * Landmark ids (lib/landmarks) that anchor the corridor. The map draws a
   * subtle tinted hull/line through these; the matcher treats them as the
   * proximity spine for member-pub selection.
   */
  anchorLandmarkIds: string[];
  /**
   * Theme token name (without the leading `--`) the map tints the corridor and
   * member halos with. Kept a bare token so colour stays theme-driven via
   * readTokens — never a raw hex here.
   */
  colourToken: string;
  /**
   * A pub is a member when it sits within this straight-line distance (km) of
   * *any* anchor landmark. Tuned per band: tight for a compact market cluster,
   * looser for a strung-out riverside walk.
   */
  radiusKm: number;
  sources: StoryBandSource[];
};

// The six shipped bands. Anchors are real landmark ids (see lib/landmarks);
// radii are hand-tuned so each band claims its own neighbourhood without
// swallowing the whole city. Copy is sourced and grounded.
export const STORY_BANDS: StoryBand[] = [
  {
    id: "river-history",
    title: "River history",
    copy:
      "The Thames was London's first high street, and the oldest riverside pubs still lean over the water where watermen, smugglers and dockhands drank. This band traces the tideway from Westminster past the South Bank to the Pool of London below Tower Bridge.",
    kind: "river",
    anchorLandmarkIds: [
      "london-eye",
      "shakespeares-globe",
      "tate-modern",
      "tower-bridge",
      "hms-belfast",
    ],
    colourToken: "river",
    // Wave F1: slightly wider so more Bankside / South Bank crawl pubs join Lore.
    radiusKm: 0.7,
    sources: [
      {
        label: "Museum of London Docklands",
        url: "https://www.museumoflondon.org.uk/museum-london-docklands",
      },
    ],
  },
  {
    id: "fleet-street-writers",
    title: "Fleet Street writers",
    copy:
      "For three centuries Fleet Street was the home of the British press, and its taverns doubled as newsrooms where reporters filed, drank and argued. Dr Johnson compiled his Dictionary a few yards north, and the alley pubs around St Paul's kept the ink-stained trade watered.",
    kind: "literary",
    anchorLandmarkIds: ["st-pauls", "somerset-house", "covent-garden"],
    colourToken: "brass",
    radiusKm: 0.75,
    sources: [
      {
        label: "British Library: Fleet Street",
        url: "https://www.bl.uk/collection-guides/newspapers",
      },
    ],
  },
  {
    id: "markets-theatre",
    title: "Markets & theatre",
    copy:
      "Borough and Bankside were London's larder and its playground: a food market trading since at least the 13th century, and the Elizabethan playhouses that gave us Shakespeare's Globe. The pubs here fed porters at dawn and playgoers at dusk.",
    kind: "market",
    anchorLandmarkIds: ["borough-market", "shakespeares-globe", "the-shard"],
    colourToken: "amber",
    radiusKm: 0.65,
    sources: [
      {
        label: "Borough Market: Our history",
        url: "https://boroughmarket.org.uk/about-us/history/",
      },
    ],
  },
  {
    id: "royal-civic",
    title: "Royal & civic",
    copy:
      "Westminster has been the seat of English government and monarchy for nearly a thousand years, from the Abbey's coronations to Parliament and the royal parks. The pubs tucked behind Whitehall have long poured for civil servants, MPs and the crowds around Trafalgar Square.",
    kind: "civic",
    anchorLandmarkIds: [
      "big-ben",
      "westminster-abbey",
      "trafalgar-square",
      "nelsons-column",
      "buckingham-palace",
    ],
    colourToken: "brick",
    radiusKm: 0.75,
    sources: [
      {
        label: "UK Parliament: Living Heritage",
        url: "https://www.parliament.uk/about/living-heritage/",
      },
    ],
  },
  {
    id: "thames-industrial",
    title: "Thames-side industrial",
    copy:
      "East of the Tower the river turned to trade: warehouses, wharves and the tide-washed stairs of Wapping and the Pool of London. The surviving dockside inns once served watermen and sailors, and a few still stand on the very steps where cargo came ashore.",
    kind: "industrial",
    anchorLandmarkIds: ["tower-of-london", "tower-bridge", "hms-belfast"],
    colourToken: "muted",
    radiusKm: 0.85,
    sources: [
      {
        label: "Museum of London Docklands",
        url: "https://www.museumoflondon.org.uk/museum-london-docklands",
      },
    ],
  },
  {
    id: "coding-pint",
    title: "Coding pint",
    copy:
      "The City fringe around Shoreditch and the Barbican became London's tech quarter, where startups spilled out of warehouses and the after-work pint turned into a standup. These pubs sit between the old money of the Square Mile and the studios of the East End.",
    kind: "modern",
    anchorLandmarkIds: ["barbican", "gherkin", "leadenhall-market"],
    colourToken: "riverBright",
    radiusKm: 0.7,
    sources: [
      {
        label: "Tech City / Silicon Roundabout: Wikipedia",
        url: "https://en.wikipedia.org/wiki/Silicon_Roundabout",
      },
    ],
  },
];

// Resolve a band's anchor ids to landmark coordinates, dropping any id that
// doesn't match a real landmark (keeps the map from drawing to a ghost point).
// Pass `catalog` for non-London cities (Manchester anchors live in a separate
// landmark list); defaults to London's curated set for back-compat.
export function bandAnchors(
  band: StoryBand,
  catalog: readonly Landmark[] = landmarks,
): Landmark[] {
  return resolveBandAnchors(band, catalog);
}

// --- DTO validation (unit-tested) ------------------------------------------
//
// A band is *valid* when every field the map and copy contract depend on is
// present and coherent: real anchors, a positive radius, grounded copy, at
// least one source, and a non-empty colour token. Returns the list of problems
// (empty = valid) so the build-time check can report exactly what's wrong.
export function validateStoryBand(
  band: StoryBand,
  catalog: readonly Landmark[] = landmarks,
): string[] {
  const problems: string[] = [];
  if (!band.id.trim()) problems.push("missing id");
  if (!band.title.trim()) problems.push("missing title");

  const words = band.copy.trim().split(/\s+/).filter(Boolean).length;
  if (words < 12) problems.push(`copy too thin (${words} words)`);
  const sentences = band.copy
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
  if (sentences < 2) problems.push(`copy needs 2-3 sentences (found ${sentences})`);

  if (band.anchorLandmarkIds.length < 2) problems.push("needs >= 2 anchors");
  const resolved = bandAnchors(band, catalog);
  if (resolved.length !== band.anchorLandmarkIds.length) {
    const missing = band.anchorLandmarkIds.filter(
      (id) => !catalog.some((lm) => lm.id === id),
    );
    problems.push(`unknown anchor landmark id(s): ${missing.join(", ")}`);
  }

  if (!(band.radiusKm > 0) || band.radiusKm > 3) {
    problems.push(`radiusKm out of range (${band.radiusKm})`);
  }
  if (!band.colourToken.trim()) problems.push("missing colourToken");
  if (band.colourToken.startsWith("--") || band.colourToken.startsWith("#")) {
    problems.push("colourToken must be a bare token name (no -- or #)");
  }
  if (band.sources.length === 0) problems.push("needs >= 1 source");
  for (const source of band.sources) {
    if (!source.label.trim() || !/^https?:\/\//.test(source.url)) {
      problems.push(`invalid source: ${source.label || "(no label)"}`);
    }
  }
  return problems;
}

// Validate every shipped band at once — used by the build-time data check and
// the unit test. Returns a map of bandId -> problems for any invalid band.
export function validateAllStoryBands(
  bands: StoryBand[] = STORY_BANDS,
  catalog: readonly Landmark[] = landmarks,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const band of bands) {
    const problems = validateStoryBand(band, catalog);
    if (seen.has(band.id)) problems.push("duplicate band id");
    seen.add(band.id);
    if (problems.length) out[band.id] = problems;
  }
  return out;
}

// --- Member-pub matching (unit-tested) -------------------------------------

export type { BandMember } from "@/lib/storyBandVenueProximity";

// The member pubs of a band under the current venue set: every venue within
// `radiusKm` (straight-line) of ANY anchor landmark, tagged with its distance
// to the nearest anchor and sorted nearest-first. Only story pubs are eligible
// so a band highlights heritage, not every boozer on the block. Pure — pass the
// already-filtered venue list and the result reflects the live map filters.
export function bandMemberPubs(
  band: StoryBand,
  venues: Venue[],
  catalog: readonly Landmark[] = landmarks,
): BandMemberResult[] {
  return matchBandMemberPubs(band, venues, catalog);
}

// Just the member ids — the map's halo filter wants a plain id list, and the
// URL/fallback logic wants a fast "is there anything to show" count.
export function bandMemberIds(
  band: StoryBand,
  venues: Venue[],
  catalog: readonly Landmark[] = landmarks,
): string[] {
  return bandMemberPubs(band, venues, catalog).map((m) => m.venue.id);
}

// Look up a band by id (URL state → band). Undefined for an unknown id so the
// caller falls back to "no band active" rather than throwing.
export function bandById(id: string | null | undefined): StoryBand | undefined {
  if (!id) return undefined;
  return STORY_BANDS.find((band) => band.id === id);
}

// --- Place-story membership (Wave D) ---------------------------------------
//
// "Does this venue sit on a place-story corridor?" — proximity to any band
// anchor within that band's radiusKm. Unlike bandMemberPubs (which only
// highlights *story* pubs for the map halo), this answers the Lore-tab
// question for any open venue: which Place stories pass through here.
// Pure + deterministic; unit-tested in __tests__/storyBands.test.ts.

export type VenueBandPoint = {
  id: string;
  latitude: number;
  longitude: number;
};

/** Straight-line distance (km) from a venue to the nearest anchor of a band. */
export function venueDistanceToBand(
  band: StoryBand,
  venue: VenueBandPoint,
  catalog: readonly Landmark[] = landmarks,
): number | null {
  const anchors = bandAnchors(band, catalog);
  if (anchors.length === 0) return null;
  const point: [number, number] = [venue.longitude, venue.latitude];
  let nearest = Infinity;
  for (const anchor of anchors) {
    const km = haversineKm(anchor.coordinates, point);
    if (km < nearest) nearest = km;
  }
  return Number.isFinite(nearest) ? nearest : null;
}

/** True when the venue sits within the band's radius of any anchor. */
export function venueInBand(
  band: StoryBand,
  venue: VenueBandPoint,
  catalog: readonly Landmark[] = landmarks,
): boolean {
  const km = venueDistanceToBand(band, venue, catalog);
  return km !== null && km <= band.radiusKm;
}

/**
 * Place stories (bands) this venue belongs to, nearest-first.
 * Accepts a venue id + coordinates (or a full Venue). The id is unused for
 * matching today — membership is geographic — but kept so callers can pass
 * `bandsForVenue(venue)` / `bandsForVenue({ id, latitude, longitude })`.
 */
export function bandsForVenue(
  venue: VenueBandPoint,
  bands: StoryBand[] = STORY_BANDS,
  catalog: readonly Landmark[] = landmarks,
): StoryBand[] {
  return bands
    .map((band) => {
      const km = venueDistanceToBand(band, venue, catalog);
      return km === null ? null : { band, km };
    })
    .filter((row): row is { band: StoryBand; km: number } => row !== null && row.km <= row.band.radiusKm)
    .sort((a, b) => a.km - b.km)
    .map((row) => row.band);
}
