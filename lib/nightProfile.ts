import { DEFAULT_CITY_ID, parseCityId, type CityId } from "@/lib/cities";
import {
  cleanNightContextPatch,
  isNightAreaSlug,
  type NightContext,
} from "@/lib/nightPlanning";
import { cleanText } from "@/lib/textClean";

export const NIGHT_PROFILE_VERSION = 1 as const;
export const NIGHT_PROFILE_VOICE_PREFERENCES = ["off", "tts", "ptt"] as const;
export type NightProfileVoicePreference =
  (typeof NIGHT_PROFILE_VOICE_PREFERENCES)[number];

export type NightBriefingPreferences = {
  muteAll: boolean;
  mutedAreas: NonNullable<NightContext["nightArea"]>[];
  mutedTopics: string[];
};

export type NightProfileInput = {
  version: typeof NIGHT_PROFILE_VERSION;
  cityId: CityId;
  context: NightContext;
  briefingPreferences: NightBriefingPreferences;
  voicePreference: NightProfileVoicePreference;
  /** Existing owned Pub Pal UUID. Pal name/species stay canonical in pub_pals. */
  pubPalId: string | null;
};

export type NightProfile = NightProfileInput & {
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_NIGHT_PROFILE_INPUT: NightProfileInput = {
  version: NIGHT_PROFILE_VERSION,
  cityId: DEFAULT_CITY_ID,
  context: {
    nightArea: null,
    daypart: "evening",
    partyType: "friends",
    groupSize: null,
    budget: "standard",
    budgetLimitPence: null,
    zeroProof: false,
    wetherspoonsPreferred: false,
    atmosphere: [],
    foodNeeds: [],
    accessibility: [],
    transportConstraints: [],
  },
  briefingPreferences: { muteAll: false, mutedAreas: [], mutedTopics: [] },
  voicePreference: "off",
  pubPalId: null,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanContext(value: unknown): NightContext | null {
  if (!isRecord(value)) return null;
  const cleaned = cleanNightContextPatch(value);
  if (!cleaned) return null;
  const required: Array<keyof NightContext> = [
    "nightArea",
    "daypart",
    "partyType",
    "groupSize",
    "budget",
    "budgetLimitPence",
    "zeroProof",
    "wetherspoonsPreferred",
    "atmosphere",
    "foodNeeds",
    "accessibility",
    "transportConstraints",
  ];
  if (required.some((key) => !(key in cleaned))) return null;
  return cleaned as NightContext;
}

function cleanBriefingPreferences(value: unknown): NightBriefingPreferences | null {
  if (!isRecord(value) || typeof value.muteAll !== "boolean") return null;
  // Area validation is deliberately explicit: briefing mutes may contain
  // multiple Night Areas, unlike NightContext's single nightArea.
  if (!Array.isArray(value.mutedAreas) || !Array.isArray(value.mutedTopics)) return null;
  const mutedAreas = value.mutedAreas
    .filter((item): item is string => typeof item === "string")
    .slice(0, 20)
    .filter(isNightAreaSlug);
  if (mutedAreas.length !== Math.min(value.mutedAreas.length, 20)) return null;
  const mutedTopics = value.mutedTopics
    .filter((item): item is string => typeof item === "string")
    .slice(0, 8)
    .map((item) => cleanText(item, 40))
    .filter(Boolean);
  if (mutedTopics.length !== Math.min(value.mutedTopics.length, 8)) return null;
  return { muteAll: value.muteAll, mutedAreas, mutedTopics };
}

export function cleanNightProfileInput(value: unknown): NightProfileInput | null {
  if (!isRecord(value) || value.version !== NIGHT_PROFILE_VERSION) return null;
  const cityId = typeof value.cityId === "string" ? parseCityId(value.cityId) : null;
  const context = cleanContext(value.context);
  const briefingPreferences = cleanBriefingPreferences(value.briefingPreferences);
  const voicePreference = NIGHT_PROFILE_VOICE_PREFERENCES.includes(
    value.voicePreference as NightProfileVoicePreference,
  )
    ? (value.voicePreference as NightProfileVoicePreference)
    : null;
  const pubPalId =
    value.pubPalId === null
      ? null
      : typeof value.pubPalId === "string" && UUID_PATTERN.test(value.pubPalId)
        ? value.pubPalId
        : undefined;
  if (!cityId || !context || !briefingPreferences || !voicePreference || pubPalId === undefined) {
    return null;
  }
  return {
    version: NIGHT_PROFILE_VERSION,
    cityId,
    context,
    briefingPreferences,
    voicePreference,
    pubPalId,
  };
}

export function cleanNightProfile(value: unknown): NightProfile | null {
  if (!isRecord(value)) return null;
  const input = cleanNightProfileInput(value);
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
  if (!input || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    return null;
  }
  return { ...input, createdAt, updatedAt };
}

export function nightProfileInput(profile: NightProfile): NightProfileInput {
  const input = cleanNightProfileInput(profile);
  if (!input) throw new Error("Night Profile is invalid.");
  return input;
}
