// Hand-maintained declarations for greeneKingSportParser.mjs so the vitest suite
// (__tests__/whatsOnSportParser.test.ts) type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

export declare const SPORT_ATTRIBUTE_TITLE: string;
export declare const SPORT_ATTRIBUTE_DETAIL: string;

export type GreeneKingMenuRecord = {
  name?: string;
  menuUrl?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
};

export type WhatsOnSportRow = {
  id: string;
  venueId?: string;
  placeName: string;
  lat?: number;
  lng?: number;
  kind: "sport";
  title: string;
  detail: string;
  source: { label: string; url: string };
  observedAt: string;
  confidence: "listed";
};

export type SportCoverageCounts = {
  pubsChecked: number;
  showsLiveSport: number;
  noLiveSport: number;
  undetermined: number;
};

export declare function parseGreeneKingSportsFlag(html: unknown): boolean | null;
export declare function pubPageUrlFromMenuUrl(menuUrl: unknown): string;
export declare function gkVenueIdFromRecord(record: GreeneKingMenuRecord): string | null;
export declare function sportAttributeRow(
  record: GreeneKingMenuRecord,
  observedAt: string,
): WhatsOnSportRow;
export declare function buildSportAttributeRows(input: {
  venues: Array<{ record: GreeneKingMenuRecord; showsSport: boolean | null }>;
  observedAt: string;
}): { rows: WhatsOnSportRow[]; counts: SportCoverageCounts };
