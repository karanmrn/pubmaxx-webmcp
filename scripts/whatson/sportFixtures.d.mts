// Hand-maintained declarations for sportFixtures.mjs so the vitest suite
// (__tests__/whatsOnSportFixtures.test.ts) type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

export type SportFixture = {
  id: string;
  title: string;
  competition: string;
  venue: string;
  kickoffLondonDate: string;
  kickoffLondonTime: string;
  source: { label: string; url: string };
};

export declare const SPORT_FIXTURES: SportFixture[];

export type SportAttributeRow = {
  id?: string;
  venueId?: string;
  placeName?: string;
  address?: string;
  lat?: number;
  lng?: number;
  kind?: string;
  title?: string;
  detail?: string;
  source?: { label?: string; url?: string };
  observedAt?: string;
  confidence?: string;
};

export type WhatsOnDerivedSportRow = {
  id: string;
  venueId?: string;
  placeName: string;
  lat?: number;
  lng?: number;
  kind: "sport";
  startsAt: string;
  title: string;
  detail: string;
  source: { label: string; url: string };
  observedAt: string;
  confidence: "derived";
};

export declare function londonWallClockToIso(dateStr: unknown, timeStr: unknown): string | null;

export type SportFixtureDropReason = string;

export type SportFixtureDiagnostics = {
  droppedFixtures: Array<{ id: string; reason: SportFixtureDropReason }>;
  droppedAttributeRows: Array<{ fixtureId: string; attrRowId: string; reason: SportFixtureDropReason }>;
};

export declare function buildSportFixtureRows(input: {
  attributeRows: SportAttributeRow[];
  fixtures: SportFixture[];
  observedAt: string;
  venueIndex?: import("./resolveVenueId.d.mts").VenueResolverIndex | null;
}): WhatsOnDerivedSportRow[];

export declare function buildSportFixtureRowsWithDiagnostics(input: {
  attributeRows: SportAttributeRow[];
  fixtures: SportFixture[];
  observedAt: string;
  venueIndex?: import("./resolveVenueId.d.mts").VenueResolverIndex | null;
}): { rows: WhatsOnDerivedSportRow[]; diagnostics: SportFixtureDiagnostics };
