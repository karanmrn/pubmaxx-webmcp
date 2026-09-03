import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/curatedCrawls";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { haversineKm } from "@/lib/haversine";
import { WALK_KMH } from "@/lib/routeLegs";
import {
  MAP_EXPERIENCE_LENS_URL_PARAM,
} from "@/lib/mapExperienceLens";
import evidenceSnapshot from "@/public/data/late_food_evidence.json";

// Food endings are deliberately separate from the Venue Dataset: their hours,
// locations and provenance must pass their own evidence gate and never become
// pint-price or crawl-stop facts.
export const LATE_FOOD_AREAS = NIGHT_AREA_SLUGS;
export type LateFoodArea = NightAreaSlug;

export const LATE_FOOD_AREA_ALIASES = {
  soho: "piccadilly-soho",
  piccadilly: "piccadilly-soho",
} as const satisfies Record<string, LateFoodArea>;

export const LATE_FOOD_CATEGORIES = [
  "kebab",
  "pizza",
  "cafe",
  "restaurant",
] as const;
export type LateFoodCategory = (typeof LATE_FOOD_CATEGORIES)[number];
export type LateFoodDietary = "vegan" | "vegetarian" | "gluten-free";
export type LateFoodConfidence = "high" | "medium" | "low";
export const MAX_LATE_FOOD_HANDOFFS = 3;

/** Honest link label for an operator-published menu URL on a food ending surface. */
export const LATE_FOOD_OPERATOR_MENU_LINK_LABEL = "Opens operator menu";

/** Map deep link: food view around the route's last stop (not a delivery handoff). */
export function lateFoodNearMapUrl(
  lastStopVenueId: string,
  cityId?: CityId | string | null,
): string {
  const params = new URLSearchParams();
  params.set("sel", lastStopVenueId);
  params.set(MAP_EXPERIENCE_LENS_URL_PARAM, "food");
  const resolvedCity =
    cityId ?? cityIdFromVenueId(lastStopVenueId) ?? DEFAULT_CITY_ID;
  return cityAwareMapPath(resolvedCity, params);
}

export function lateFoodHoursConfidenceLabel(
  confidence: LateFoodConfidence,
): string {
  if (confidence === "high") return "Hours confidence: high";
  if (confidence === "medium") return "Hours confidence: medium";
  return "Hours confidence: low";
}

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
type Weekday = (typeof WEEKDAYS)[number];

export type LateFoodServiceWindow = {
  open: string;
  close: string;
  closesNextDay: boolean;
};
export type LateFoodHours = {
  service: string;
  verifyOnNight: true;
  weekly: Record<Weekday, LateFoodServiceWindow[]>;
};

export type LateFoodProvenance = {
  kind: "official_operator";
  source: string;
  sourceUrl: string;
  observedAt: string;
  reviewedAt: string;
  expiresAt: string;
};

export type LateFoodAnchor = {
  label: string;
  price: number;
  sourceUrl: string;
  observedAt: string;
};

export type LateFoodWalkingDetour = {
  minutes: number | null;
  distanceKm: number | null;
  basis: "straight-line-from-final-stop" | "unavailable";
  note: string;
};

export type LateFoodTerminal = {
  id: string;
  name: string;
  area: LateFoodArea;
  category: LateFoodCategory;
  /** Empty means no dietary claim is evidenced, not that no options exist. */
  dietary: LateFoodDietary[];
  address: string;
  coordinates: { lat: number; lng: number };
  hours: LateFoodHours;
  walkingDetour: LateFoodWalkingDetour;
  provenance: LateFoodProvenance;
  anchor: LateFoodAnchor;
  confidence: LateFoodConfidence;
  openAtRequestedTime: boolean | null;
};

export type LateFoodApiSuccessResponse = {
  area: LateFoodArea;
  requestedAt: string | null;
  terminals: LateFoodTerminal[];
  rankingSignals: string[];
  missingEvidence: string[];
};

export type LateFoodApiErrorResponse = {
  error: string;
  code: string;
  retryable: false;
  terminals: [];
  details: { terminals: [] };
};

export type LateFoodApiResponse =
  LateFoodApiSuccessResponse | LateFoodApiErrorResponse;

type RawOption = {
  id: string;
  name: string;
  area: LateFoodArea;
  category: LateFoodCategory;
  address: string;
  coordinates: { lat: number; lng: number };
  serviceHoursText: string;
  weeklyHours: Record<Weekday, LateFoodServiceWindow[]>;
  verifyOnNight: true;
  confidence: LateFoodConfidence;
  source: {
    kind: "official_operator";
    publisher: string;
    sourceUrl: string;
    observedAt: string;
    reviewedAt: string;
    expiresAt: string;
  };
  anchor: LateFoodAnchor;
};

type RankingOptions = {
  at?: string | Date | null;
  from?: { lat: number; lng: number } | null;
  now?: number;
};

function rawOptions(): RawOption[] {
  const areas = evidenceSnapshot.areas as Record<
    LateFoodArea,
    { options: RawOption[] }
  >;
  return NIGHT_AREA_SLUGS.flatMap((area) => areas[area]?.options ?? []);
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function londonClock(
  value: Date,
): { weekday: Weekday; minutes: number } | null {
  if (!Number.isFinite(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const weekday = parts
    .find((part) => part.type === "weekday")
    ?.value.toLocaleLowerCase("en-GB") as Weekday | undefined;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return weekday &&
    WEEKDAYS.includes(weekday) &&
    Number.isFinite(hour) &&
    Number.isFinite(minute)
    ? { weekday, minutes: hour * 60 + minute }
    : null;
}

export function isLateFoodOpenAt(
  hours: LateFoodHours,
  value: string | Date,
): boolean | null {
  const instant = value instanceof Date ? value : new Date(value);
  const local = londonClock(instant);
  if (!local) return null;
  const dayIndex = WEEKDAYS.indexOf(local.weekday);
  const today = hours.weekly[local.weekday] ?? [];
  if (
    today.some((window) => {
      const open = clockMinutes(window.open);
      const close = clockMinutes(window.close);
      return (
        local.minutes >= open && (window.closesNextDay || local.minutes < close)
      );
    })
  )
    return true;
  const previousDay =
    WEEKDAYS[(dayIndex + WEEKDAYS.length - 1) % WEEKDAYS.length];
  return (hours.weekly[previousDay] ?? []).some(
    (window) =>
      window.closesNextDay && local.minutes < clockMinutes(window.close),
  );
}

function terminalFromRaw(
  raw: RawOption,
  options: RankingOptions,
): LateFoodTerminal | null {
  const now = options.now ?? Date.now();
  const at = options.at
    ? options.at instanceof Date
      ? options.at
      : new Date(options.at)
    : null;
  if (
    Date.parse(raw.source.observedAt) > now ||
    Date.parse(raw.source.reviewedAt) > now ||
    Date.parse(raw.source.expiresAt) <= now
  )
    return null;
  if (
    at &&
    (!Number.isFinite(at.getTime()) ||
      at.getTime() >= Date.parse(raw.source.expiresAt))
  )
    return null;
  const directKm = options.from
    ? haversineKm(
        [options.from.lng, options.from.lat],
        [raw.coordinates.lng, raw.coordinates.lat],
      )
    : null;
  const openAtRequestedTime = at
    ? isLateFoodOpenAt(
        {
          service: raw.serviceHoursText,
          verifyOnNight: true,
          weekly: raw.weeklyHours,
        },
        at,
      )
    : null;
  return {
    id: raw.id,
    name: raw.name,
    area: raw.area,
    category: raw.category,
    dietary: [],
    address: raw.address,
    coordinates: raw.coordinates,
    hours: {
      service: raw.serviceHoursText,
      verifyOnNight: true,
      weekly: raw.weeklyHours,
    },
    walkingDetour:
      directKm === null
        ? {
            minutes: null,
            distanceKm: null,
            basis: "unavailable",
            note: "Choose a final route stop to calculate distance.",
          }
        : {
            minutes: Math.ceil((directKm / WALK_KMH) * 60),
            distanceKm: Number(directKm.toFixed(2)),
            basis: "straight-line-from-final-stop",
            note: "Direct-distance estimate from the route's actual final stop; confirm the walking route before leaving.",
          },
    provenance: {
      kind: "official_operator",
      source: raw.source.publisher,
      sourceUrl: raw.source.sourceUrl,
      observedAt: raw.source.observedAt,
      reviewedAt: raw.source.reviewedAt,
      expiresAt: raw.source.expiresAt,
    },
    anchor: raw.anchor,
    confidence: raw.confidence,
    openAtRequestedTime,
  };
}

export const LATE_FOOD_TERMINALS: readonly LateFoodTerminal[] = rawOptions()
  .map((raw) =>
    terminalFromRaw(raw, { now: Date.parse(evidenceSnapshot.generatedAt) }),
  )
  .filter((terminal): terminal is LateFoodTerminal => terminal !== null);

export function isLateFoodArea(value: string): value is LateFoodArea {
  return (NIGHT_AREA_SLUGS as readonly string[]).includes(value);
}

export function normalizeLateFoodArea(
  value: string | null | undefined,
): LateFoodArea | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return null;
  if (Object.hasOwn(LATE_FOOD_AREA_ALIASES, candidate)) {
    return LATE_FOOD_AREA_ALIASES[
      candidate as keyof typeof LATE_FOOD_AREA_ALIASES
    ];
  }
  return isLateFoodArea(candidate) ? candidate : null;
}

export function rankFoodHandoff<
  T extends { walkingDetour: { minutes: number | null } },
>(candidates: readonly T[]): T[] {
  return [...candidates].sort(
    (left, right) =>
      (left.walkingDetour.minutes ?? Number.POSITIVE_INFINITY) -
      (right.walkingDetour.minutes ?? Number.POSITIVE_INFINITY),
  );
}

export function shortlistFoodHandoffs<T>(
  candidates: readonly T[],
  limit = MAX_LATE_FOOD_HANDOFFS,
): T[] {
  return candidates.slice(
    0,
    Math.min(Math.max(0, Math.floor(limit)), MAX_LATE_FOOD_HANDOFFS),
  );
}

export function getLateFoodForArea(
  area: LateFoodArea,
  tags: readonly string[] = [],
  options: RankingOptions = {},
): LateFoodTerminal[] {
  // Generic "food" / "meal" / "eat" only mean food was requested. They are not
  // cuisine filters: matching them against name would silently empty the
  // shortlist for a "food then a soft drink" outing.
  const normalizedTags = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0 && !["food", "meal", "eat"].includes(tag));
  const requestedAt = options.at
    ? options.at instanceof Date
      ? options.at
      : new Date(options.at)
    : null;
  const candidates = rawOptions()
    .filter((raw) => raw.area === area)
    .map((raw) => terminalFromRaw(raw, options))
    .filter((terminal): terminal is LateFoodTerminal => terminal !== null)
    .filter((terminal) => !requestedAt || terminal.openAtRequestedTime === true)
    .filter(
      (terminal) =>
        normalizedTags.length === 0 ||
        normalizedTags.some(
          (tag) =>
            terminal.category === tag ||
            terminal.dietary.includes(tag as LateFoodDietary) ||
            terminal.name.toLowerCase().includes(tag),
        ),
    );
  return rankFoodHandoff(candidates);
}
