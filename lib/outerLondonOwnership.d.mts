export interface OuterLondonCuratedVenue {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface OuterLondonPub {
  name?: unknown;
  address?: unknown;
  lat: number;
  lng: number;
}

export function outerLondonOwnerForPub(
  pub: OuterLondonPub,
  curatedVenues: OuterLondonCuratedVenue[],
): string | null;
