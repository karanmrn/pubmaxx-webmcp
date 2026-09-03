// Culture Crawl — a step-out-of-the-house outing built from data the app
// ALREADY owns. No scraper, no listings feed, no new freshness liability.
//
// The shape is: one free-standing thing to see first (a POI from the ambient
// layer, lib/pois.ts), then the ordinary priced pub route the planner already
// generates. The POI half is a WAYPOINT, never a Stop: it carries no price, no
// opening hours, no era, no admission, and it never enters the grounding proof
// or the three-Stop count. A waypoint prints only what its own record holds:
// its name, its own category, and the straight-line distance to the first pub.
//
// What we do NOT know about a POI is most of it. The layer is orientation dots:
// there is no hours field, no admission field, no exhibition field. So no
// surface may say a gallery is open, free, or showing anything. When a lane has
// nothing near the route, the honest answer is that we found nothing, never a
// nearest-anything substituted for the thing that was asked for.

import { haversineKm } from "@/lib/haversine";
import { POI_CATEGORIES, POI_CATEGORY_META, type Poi, type PoiCategory } from "@/lib/pois";

/** Closed ids for the shipped Culture Crawl chips. */
export const CULTURE_CRAWL_CHIP_IDS = [
  "gallery-pint",
  "market-kebab",
  "river-historic",
  "sights-quiet",
] as const;
export type CultureCrawlChipId = (typeof CULTURE_CRAWL_CHIP_IDS)[number];

/**
 * Closed set of free-thing lanes a describe query may ask for. Declaration
 * order is PRIORITY order: the first lane a query matches owns the waypoint.
 * "historic" sits last on purpose, because "river walk then a historic pub"
 * asks for a riverside waypoint and a historic PUB, and a lane that read the
 * pub adjective as the waypoint would answer a question nobody asked.
 */
export const CULTURE_WAYPOINT_KINDS = [
  "gallery",
  "market",
  "riverside",
  "green",
  "view",
  "sight",
  "historic",
] as const;
export type CultureWaypointKind = (typeof CULTURE_WAYPOINT_KINDS)[number];

type WaypointLane = {
  /** POI categories this lane may draw from. */
  categories: readonly PoiCategory[];
  /**
   * Optional filter on the POI's OWN name. It is a read of the record, never a
   * claim we add: a chip that says "gallery" may only land on a POI whose own
   * name carries the word, so "Gallery then a pint" can never answer with a
   * monument.
   */
  namePattern?: RegExp;
  /** Words in a describe query that ask for this lane. */
  queryPattern: RegExp;
};

const WAYPOINT_LANES: Record<CultureWaypointKind, WaypointLane> = {
  gallery: {
    categories: ["sight", "historic"],
    namePattern: /\b(?:gallery|galleries|museum)\b/i,
    queryPattern: /\b(?:gallery|galleries|museum|museums|exhibition)\b/i,
  },
  market: {
    categories: ["market"],
    queryPattern: /\b(?:market|markets)\b/i,
  },
  riverside: {
    categories: ["river"],
    queryPattern: /\b(?:river|riverside|thames|towpath)\b/i,
  },
  green: {
    categories: ["park", "garden"],
    queryPattern: /\b(?:park|parks|garden|gardens|green space|common)\b/i,
  },
  view: {
    categories: ["viewpoint"],
    queryPattern: /\b(?:view|views|viewpoint|skyline)\b/i,
  },
  sight: {
    categories: ["sight"],
    queryPattern: /\b(?:sight|sights|sightseeing|landmark|landmarks)\b/i,
  },
  historic: {
    categories: ["historic"],
    queryPattern: /\b(?:historic|heritage|monument)\b/i,
  },
};

/** How far from the first pub a waypoint may sit and still be a walk to it. */
export const CULTURE_WAYPOINT_MAX_KM = 1.2;

/**
 * The chips themselves. Each query is pre-approved and has returned a priced
 * three-stop route keyless through the describe-first path before shipping.
 *
 * A query may never carry a transport word ("walk", "tube"): `inferNightContext`
 * turns one into a transportConstraint, and `selectGroundedPlanRoute` refuses
 * outright when any is present, so a chip saying "River walk" in its QUERY 422s
 * while the same outing worded "riverside" builds. The LABEL is free to say
 * walk, because a label is the reader's ask and never reaches the optimizer.
 */
export const CULTURE_CRAWL_CHIPS: ReadonlyArray<{
  id: CultureCrawlChipId;
  label: string;
  query: string;
}> = [
  { id: "gallery-pint", label: "Gallery then a pint", query: "gallery then a pint in Soho for 2" },
  { id: "market-kebab", label: "Market wander + kebab", query: "market wander then a kebab in Camden for 3" },
  {
    id: "river-historic",
    label: "River walk + historic pub",
    query: "riverside then a historic pub in Bermondsey for 2",
  },
  { id: "sights-quiet", label: "Sights then a quiet one", query: "sights then a quiet one in Victoria for 2" },
];

/** Why these chips exist. Shown as the lead above the group. */
export const CULTURE_CRAWL_MISSION = "Out of the house. Something to see first, the pint after.";

/** Said when a lane has nothing near the route. Scarcity, not a dead end. */
export const CULTURE_WAYPOINT_NONE_NOTE =
  "Nothing near this route we can point you to yet. The pubs below still stand.";

/**
 * Said beside every waypoint we DO find. The POI layer holds a name, a category
 * and a point. It holds no hours and no admission, so the copy says so rather
 * than letting a reader assume a door that is open and free.
 *
 * A place with no door gets the shorter line: naming an admission we do not
 * hold for a pier or a park reads as a warning about a charge nobody levies,
 * which is its own small lie. The split is keyed on the POI's own category.
 */
export const CULTURE_WAYPOINT_UNKNOWN_NOTE =
  "Opening times and admission are not recorded. Check before you go.";

export const CULTURE_WAYPOINT_OPEN_AIR_NOTE =
  "Opening times are not recorded. Check before you go.";

const OPEN_AIR_CATEGORIES: readonly PoiCategory[] = ["river", "park", "garden", "viewpoint"];

export function cultureWaypointNote(category: PoiCategory): string {
  return OPEN_AIR_CATEGORIES.includes(category)
    ? CULTURE_WAYPOINT_OPEN_AIR_NOTE
    : CULTURE_WAYPOINT_UNKNOWN_NOTE;
}

export type CultureWaypointDTO = {
  poiId: string;
  name: string;
  category: PoiCategory;
  /** The category's own shipped label. Never a description of the place. */
  categoryLabel: string;
  kind: CultureWaypointKind;
  /** Straight-line kilometres from the first pub Stop. */
  distanceKm: number;
  coordinates: [number, number];
};

export type CultureOpenerDTO = {
  /** Lanes the query asked for, in priority order. */
  requested: CultureWaypointKind[];
  waypoint: CultureWaypointDTO | null;
  note: string;
};

export function isCultureCrawlChipId(value: unknown): value is CultureCrawlChipId {
  return typeof value === "string" && (CULTURE_CRAWL_CHIP_IDS as readonly string[]).includes(value);
}

export function cultureCrawlChipQuery(id: CultureCrawlChipId): string {
  return CULTURE_CRAWL_CHIPS.find((chip) => chip.id === id)!.query;
}

/** Every shipped chip query, for the pre-approved describe allow-list. */
export const CULTURE_CRAWL_CHIP_QUERIES: readonly string[] = CULTURE_CRAWL_CHIPS.map(
  (chip) => chip.query,
);

/**
 * Which free-thing lanes a describe query asks for, in priority order. An empty
 * result means the query is an ordinary pub outing and gains no waypoint, so
 * every existing describe chip keeps its current answer byte for byte.
 */
export function cultureWaypointKindsForQuery(query: unknown): CultureWaypointKind[] {
  if (typeof query !== "string" || !query.trim()) return [];
  return CULTURE_WAYPOINT_KINDS.filter((kind) => WAYPOINT_LANES[kind].queryPattern.test(query));
}

function poiMatchesLane(poi: Poi, lane: WaypointLane): boolean {
  if (!lane.categories.includes(poi.category)) return false;
  return lane.namePattern ? lane.namePattern.test(poi.name) : true;
}

/**
 * Nearest qualifying POI to the first pub, lane by lane in priority order.
 * Pure and deterministic: distance decides, then the POI id breaks ties, so the
 * same route and the same layer always yield the same waypoint.
 */
export function selectCultureWaypoint(
  pois: readonly Poi[],
  kinds: readonly CultureWaypointKind[],
  origin: { lat: number; lng: number },
): CultureWaypointDTO | null {
  for (const kind of kinds) {
    const lane = WAYPOINT_LANES[kind];
    const best = pois
      .filter((poi) => poiMatchesLane(poi, lane))
      .map((poi) => ({ poi, km: haversineKm([origin.lng, origin.lat], poi.coordinates) }))
      .filter(({ km }) => km <= CULTURE_WAYPOINT_MAX_KM)
      .sort((a, b) => a.km - b.km || (a.poi.id < b.poi.id ? -1 : a.poi.id > b.poi.id ? 1 : 0))[0];
    if (!best) continue;
    return {
      poiId: best.poi.id,
      name: best.poi.name,
      category: best.poi.category,
      categoryLabel: POI_CATEGORY_META[best.poi.category].label,
      kind,
      distanceKm: Number(best.km.toFixed(2)),
      coordinates: [best.poi.coordinates[0], best.poi.coordinates[1]],
    };
  }
  return null;
}

function isWaypointKind(value: unknown): value is CultureWaypointKind {
  return typeof value === "string" && (CULTURE_WAYPOINT_KINDS as readonly string[]).includes(value);
}

/**
 * Read an opener back off a generation response. A malformed or half-built
 * waypoint reads as no waypoint, never as a partly rendered place, because a
 * named POI with a missing distance would print a claim with nothing behind it.
 */
export function cleanCultureOpener(value: unknown): CultureOpenerDTO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.note !== "string" || !row.note.trim()) return null;
  const requested = Array.isArray(row.requested) ? row.requested.filter(isWaypointKind) : [];
  if (requested.length === 0) return null;
  const raw = row.waypoint;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { requested, waypoint: null, note: row.note };
  }
  const point = raw as Record<string, unknown>;
  const coordinates = point.coordinates;
  const ok =
    typeof point.poiId === "string" && point.poiId.length > 0
    && typeof point.name === "string" && point.name.length > 0
    && typeof point.categoryLabel === "string" && point.categoryLabel.length > 0
    && isWaypointKind(point.kind)
    && typeof point.distanceKm === "number" && Number.isFinite(point.distanceKm)
    && Array.isArray(coordinates) && coordinates.length === 2
    && coordinates.every((part) => typeof part === "number" && Number.isFinite(part))
    && (POI_CATEGORIES as readonly unknown[]).includes(point.category);
  if (!ok) return { requested, waypoint: null, note: CULTURE_WAYPOINT_NONE_NOTE };
  return {
    requested,
    waypoint: {
      poiId: point.poiId as string,
      name: point.name as string,
      category: point.category as PoiCategory,
      categoryLabel: point.categoryLabel as string,
      kind: point.kind as CultureWaypointKind,
      distanceKm: point.distanceKm as number,
      coordinates: [(coordinates as number[])[0], (coordinates as number[])[1]],
    },
    note: row.note,
  };
}

/**
 * The whole opener for one generated route. Returns null when the query never
 * asked for a free thing, so an ordinary plan response is unchanged.
 */
export function buildCultureOpener(input: {
  query: unknown;
  pois: readonly Poi[];
  origin: { lat: number; lng: number } | null;
}): CultureOpenerDTO | null {
  const requested = cultureWaypointKindsForQuery(input.query);
  if (requested.length === 0) return null;
  const waypoint = input.origin ? selectCultureWaypoint(input.pois, requested, input.origin) : null;
  return {
    requested,
    waypoint,
    note: waypoint ? cultureWaypointNote(waypoint.category) : CULTURE_WAYPOINT_NONE_NOTE,
  };
}
