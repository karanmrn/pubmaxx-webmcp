import type { OsmPub } from "./lib/osmPubNormalizer.mjs";

export interface CityDef {
  id: string;
  displayName: string;
  shortPrefix: string;
  bbox: [number, number, number, number];
  enabled: boolean;
}

export const CITIES: Record<string, CityDef>;
export const LONDON_TARGET_BOROUGHS: string[];

export interface CityOsmPack {
  city: string;
  source: string;
  license: string;
  attribution: string;
  fetchedAt: string;
  bbox: [number, number, number, number];
  count: number;
  pubs: OsmPub[];
}

export function normalizeOverpass(
  raw: { elements?: unknown[] },
  city: CityDef,
): CityOsmPack;
