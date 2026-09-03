// Hand-maintained declarations for eventNormalise.mjs so the app and the vitest
// suite type-check under the repo's allowJs:false tsconfig. Keep in sync with
// the runtime module.

import type { VenueResolverIndex } from "../../scripts/whatson/resolveVenueId.d.mts";

export type EventSource = { label: string; url: string };

export declare const EVENT_REFRESH_CITIES: readonly string[];

export declare const TICKETMASTER_SOURCE: EventSource;
export declare const SKIDDLE_SOURCE: EventSource;

export declare const TICKETMASTER_SEGMENT_KIND: Record<string, "music" | "sport" | "event">;
export declare const SKIDDLE_EVENTCODE_KIND: Record<string, "music" | "sport" | "event">;

export type WhatsOnEventKind = "music" | "sport" | "event";

export type WhatsOnEventRow = {
  id: string;
  venueId?: string;
  placeName: string;
  lat?: number;
  lng?: number;
  kind: WhatsOnEventKind;
  /** Absent when the listing states a day and no clock time. */
  startsAt?: string;
  /** London calendar date a date-only listing states. Never invented. */
  startsDate?: string;
  timeEvidence?: string;
  endsAt?: string;
  title: string;
  detail?: string;
  priceGbp?: number;
  imageUrl?: string;
  sourceId?: string;
  area?: string;
  source: EventSource;
  observedAt: string;
  confidence: "listed";
};

export type MapEventOpts = {
  observedAt: string;
  venueIndex?: VenueResolverIndex | null;
  /** Injected by the CLI. Absent means no venue matching happens at all. */
  resolveVenue?:
    | ((
        match: {
          name: string;
          address?: string;
          postcode?: string;
          lat?: number | null;
          lng?: number | null;
        },
        index: VenueResolverIndex,
      ) => string | null)
    | null;
};

export type EventDropReason = "noKind" | "noPlace" | "noStart" | "noUrl" | "noTitle";

export type EventDropCounts = Record<EventDropReason, number> & { total: number };

export declare const EVENT_DROP_REASONS: readonly EventDropReason[];

export type NormalisedEvents = {
  rows: WhatsOnEventRow[];
  dropped: EventDropCounts;
};

export declare const EMPTY_EVENT_DROPS: Readonly<EventDropCounts>;

export declare function emptyEventDrops(): EventDropCounts;
export declare function mergeEventDrops(into: EventDropCounts, from: EventDropCounts | null | undefined): EventDropCounts;
export declare function summariseEventDrops(dropped: EventDropCounts): string;
export declare function dedupeEventRowsBySourceId(rows: WhatsOnEventRow[]): WhatsOnEventRow[];
export declare function cityGeo(city?: string): {
  lat: number;
  lng: number;
  radiusMiles: number;
};

export declare const DATE_ONLY_TIME_EVIDENCE: string;

/** False while Skiddle's official logo asset is absent. */
export declare const SKIDDLE_BRAND_ASSET_PRESENT: boolean;
/** True while a Skiddle row may not be fetched, written or served at all. */
export declare function skiddleLaneFenced(): boolean;

export declare function toIsoInstant(value: unknown): string | null;
export declare function statedCalendarDate(value: unknown): string | null;

export declare function mapTicketmasterEvent(
  event: unknown,
  opts?: MapEventOpts,
): WhatsOnEventRow | null;

export declare function normaliseTicketmasterEvents(
  payload: unknown,
  opts?: MapEventOpts,
): NormalisedEvents;

export declare function mapSkiddleEvent(
  event: unknown,
  opts?: MapEventOpts,
): WhatsOnEventRow | null;

export declare function normaliseSkiddleEvents(
  payload: unknown,
  opts?: MapEventOpts,
): NormalisedEvents;
