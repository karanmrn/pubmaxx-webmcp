export type CityVenuePack = {
  readonly slimVenuesPath: string;
  readonly enabled: boolean;
};

export const CITY_VENUE_PACKS: Record<string, CityVenuePack>;

export const LAST_RIDE_CITY_IDS: readonly string[];

export function enabledVenuePackIncludes(): string[];

export function venuePackIncludesFor(cityIds: readonly string[]): string[];
