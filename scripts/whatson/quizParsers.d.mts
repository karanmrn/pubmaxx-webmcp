// Hand-maintained declarations for quizParsers.mjs so the vitest suite
// (__tests__/whatsOnQuiz.test.ts) type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

export declare const DAY_NAMES: string[];
export declare const LONDON_AREA_NAMES: Set<string>;

export type QuizCard = {
  url: string;
  title: string;
  day: string | null;
  time: string | null;
};

export type QuizVenueDetail = {
  day: string | null;
  time: string | null;
  feeGbp: number | null;
  feeRaw: string | null;
  address: string | null;
  postcode: string | null;
};

export type WhatsOnQuizRow = {
  id: string;
  venueId: string | null;
  placeName: string;
  kind: "quiz";
  startsAt: string;
  title: string;
  detail: string;
  priceGbp?: number;
  source: { label: string; url: string };
  observedAt: string;
  confidence: "listed";
};

export type QuizDropCounts = {
  nonWeekly: number;
  notLondon: number;
  noSlot: number;
};

export type SpeedQuizzingEvent = {
  eventId: string;
  date: string;
  day: string;
  lat: number;
  lng: number;
};

export declare function extractPostcode(text: unknown): string | null;
export declare function isGreaterLondonPostcode(postcode: unknown): boolean;
export declare function isKnownLondonAreaName(placeName: unknown): boolean;
export declare function nextWeeklyOccurrence(
  dayName: string,
  hhmm: string,
  observedAtIso: string,
): string | null;
export declare function decodeEntities(text: unknown): string;
export declare function parseQuestionOneVenuesPage(html: unknown): QuizCard[];
export declare function parseQuestionOneNextPage(html: unknown): string | null;
export declare function parseQuestionOneVenueDetail(html: unknown): QuizVenueDetail;
export declare function isWeeklyCadence(title: unknown): boolean;
export declare function placeNameFromQuestionOneTitle(title: unknown): string;
export declare function buildQuestionOneRows(input: {
  cards: QuizCard[];
  detailsByUrl?: Map<string, QuizVenueDetail>;
  observedAt: string;
  venueIndex?: import("./resolveVenueId.d.mts").VenueResolverIndex | null;
}): { rows: WhatsOnQuizRow[]; dropped: QuizDropCounts };
export declare function parseSpeedQuizzingFindEvents(html: unknown): SpeedQuizzingEvent[];
export declare function isGreaterLondonLatLng(lat: number, lng: number): boolean;
