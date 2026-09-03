// Hand-maintained declarations for musicRefresh.mjs so the vitest suite
// (__tests__/whatsOnMusic.test.ts) type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

export type MusicSource = { label: string; url: string };

export declare const SKEHANS_SOURCE: MusicSource;
export declare const IVY_HOUSE_SOURCE: MusicSource;
export declare const SPICE_OF_LIFE_SOURCE: MusicSource;
export declare const AINT_NOTHIN_BUT_SOURCE: MusicSource;
export declare const TROUBADOUR_SOURCE: MusicSource;

export type MusicResidencyDef = {
  id: string;
  placeName: string;
  address?: string;
  postcode?: string;
  dayName: string;
  startTime: string;
  title: string;
  detail: string;
  source: MusicSource;
};

export declare const MUSIC_RESIDENCIES: MusicResidencyDef[];

export type WhatsOnMusicRow = {
  id: string;
  venueId?: string;
  placeName: string;
  kind: "music";
  startsAt: string;
  title: string;
  detail: string;
  source: MusicSource;
  observedAt: string;
  confidence: "listed";
};

export declare function buildMusicResidencyRows(input: {
  residencies: MusicResidencyDef[];
  observedAt: string;
  venueIndex?: import("./resolveVenueId.d.mts").VenueResolverIndex | null;
}): WhatsOnMusicRow[];
