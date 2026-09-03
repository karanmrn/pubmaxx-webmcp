export interface OsmPub {
  osmId: string;
  name: string;
  amenity: string | null;
  lat: number;
  lng: number;
  address: string | null;
  locality: string | null;
  postcode: string | null;
  website: string | null;
  phone: string | null;
  openingHours: string | null;
  brewery: string | null;
  operator: string | null;
  outdoorSeating: boolean;
  smoking: Record<string, string> | null;
  cuisine: string | null;
  wikidata: string | null;
  wikipedia: string | null;
}

export function normalizeOsmPubElement(
  element: unknown,
  options?: { fallbackCity?: string | null },
): OsmPub | null;

export interface OsmVenue extends OsmPub {
  kind: string;
  taxonomyKey: string;
  shop: string | null;
  tourism: string | null;
  office: string | null;
  internetAccess?: string;
  internetAccessFee?: string;
  internetAccessSsid?: string;
  wheelchair?: string;
  capacity?: string;
  brand?: string;
  laptop?: string;
  laptopFriendly?: string;
  takeaway?: string;
  food?: string;
  alcohol?: string;
}

export function normalizeOsmVenueElement(
  element: unknown,
  options: { kind: string; taxonomyKey: string; fallbackCity?: string | null },
): OsmVenue | null;

export function sortOsmPubs<T extends OsmPub>(pubs: T[]): T[];
