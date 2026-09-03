import { haversineKm } from "@/lib/haversine";
import { NIGHT_AREAS, type NightAreaSlug } from "@/lib/nightAreas";
import {
  DEFAULT_NIGHT_PROFILE_INPUT,
  cleanNightProfileInput,
  type NightBriefingPreferences,
  type NightProfileInput,
} from "@/lib/nightProfile";
import { resolveNightPatch, type NightPatchId } from "@/lib/nightPatches";
import {
  cleanNightContextPatch,
  type NightContext,
} from "@/lib/nightPlanning";
import {
  planIntakeNightContextPatch,
  type PlanIntakeDraft,
} from "@/lib/planIntake";
import {
  orderPicksNear,
  type TonightPickDto,
  type WeatherBrief,
} from "@/lib/todayBrief";

/** Highest-priority source wins independently for every field. */
export const TODAY_PERSONALIZATION_SOURCES = [
  "explicit-current-intent",
  "progressive-intake",
  "account",
  "reviewed-device",
  "defaults",
] as const;

export type TodayPersonalizationSource =
  (typeof TODAY_PERSONALIZATION_SOURCES)[number];

export type ResolvedTodayField<T> = {
  value: T;
  source: TodayPersonalizationSource;
};

export type TodayIntentLayer = {
  context?: Partial<NightContext> | null;
  /** A patch may be more precise than the modelled Night Area in context. */
  preferredPatch?: NightPatchId | null;
  hardExclusions?: Partial<{
    areas: NightAreaSlug[];
    topics: string[];
    muteAll: boolean;
  }>;
};

export type ReviewedTodayDevice = {
  /** Device state is ignored unless the caller explicitly attests this flag. */
  reviewed: boolean;
  profile: NightProfileInput;
};

export type TodayPersonalizationInput = {
  explicitCurrentIntent?: TodayIntentLayer | null;
  progressiveIntake?: PlanIntakeDraft | null;
  account?: NightProfileInput | null;
  reviewedDevice?: ReviewedTodayDevice | null;
  defaults?: TodayIntentLayer | null;
  /** One-resolution suppression only. Callers must not persist this value. */
  ignoreToday?: boolean;
};

export type ResolvedTodayPersonalization = {
  ignored: boolean;
  personalized: boolean;
  context: NightContext;
  provenance: Record<keyof NightContext, TodayPersonalizationSource>;
  preferredPatch: ResolvedTodayField<NightPatchId | null>;
  weatherArea: ResolvedTodayField<NightAreaSlug>;
  hardExclusions: {
    muteAll: ResolvedTodayField<boolean>;
    areas: ResolvedTodayField<readonly NightAreaSlug[]>;
    topics: ResolvedTodayField<readonly string[]>;
  };
};

type NormalizedLayer = {
  source: TodayPersonalizationSource;
  context: Partial<NightContext>;
  preferredPatch?: NightPatchId | null;
  briefing?: Partial<NightBriefingPreferences>;
};

const CONTEXT_FIELDS = [
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
] as const satisfies readonly (keyof NightContext)[];

const CONTEXT_LIST_FIELDS = [
  "atmosphere",
  "foodNeeds",
  "accessibility",
  "transportConstraints",
] as const satisfies readonly (keyof NightContext)[];

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function omitWhollyCorruptContextLists(
  raw: unknown,
  cleaned: Partial<NightContext>,
): Partial<NightContext> {
  const result = { ...cleaned };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const source = raw as Record<string, unknown>;
  for (const field of CONTEXT_LIST_FIELDS) {
    const rawList = source[field];
    const cleanedList = result[field];
    if (
      Array.isArray(rawList)
      && rawList.length > 0
      && Array.isArray(cleanedList)
      && cleanedList.length === 0
    ) {
      delete result[field];
    }
  }
  return result;
}

function cleanTopics(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLocaleLowerCase("en-GB"))
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 8);
  return value.length > 0 && cleaned.length === 0 ? undefined : cleaned;
}

function cleanAreas(value: unknown): NightAreaSlug[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<NightAreaSlug>(NIGHT_AREAS.map((area) => area.slug));
  const cleaned = value
    .filter((item): item is NightAreaSlug => typeof item === "string" && allowed.has(item as NightAreaSlug))
    .filter((item, index, all) => all.indexOf(item) === index);
  return value.length > 0 && cleaned.length === 0 ? undefined : cleaned;
}

function normalizeIntent(
  source: TodayPersonalizationSource,
  layer: TodayIntentLayer | null | undefined,
): NormalizedLayer | null {
  if (!layer) return null;
  const context = omitWhollyCorruptContextLists(
    layer.context,
    cleanNightContextPatch(layer.context) ?? {},
  );
  const hardExclusions = layer.hardExclusions;
  const patch = hasOwn(layer, "preferredPatch")
    ? layer.preferredPatch === null || resolveNightPatch(layer.preferredPatch)
      ? layer.preferredPatch
      : undefined
    : undefined;
  const areas = cleanAreas(hardExclusions?.areas);
  const topics = cleanTopics(hardExclusions?.topics);
  const hasBriefing = Boolean(
    areas
    || topics
    || typeof hardExclusions?.muteAll === "boolean",
  );
  const hasPatch = hasOwn(layer, "preferredPatch") && patch !== undefined;
  if (Object.keys(context).length === 0 && !hasPatch && !hasBriefing) return null;
  return {
    source,
    context,
    ...(hasPatch
      ? { preferredPatch: patch }
      : {}),
    ...(hasBriefing
      ? {
          briefing: {
            ...(areas ? { mutedAreas: areas } : {}),
            ...(topics ? { mutedTopics: topics } : {}),
            ...(typeof hardExclusions?.muteAll === "boolean"
              ? { muteAll: hardExclusions.muteAll }
              : {}),
          },
        }
      : {}),
  };
}

function normalizeProfile(
  source: "account" | "reviewed-device",
  profile: NightProfileInput | null | undefined,
): NormalizedLayer | null {
  const clean = cleanNightProfileInput(profile);
  return clean
    ? {
        source,
        context: omitWhollyCorruptContextLists(profile?.context, clean.context),
        briefing: {
          muteAll: clean.briefingPreferences.muteAll,
          mutedAreas: cleanAreas(clean.briefingPreferences.mutedAreas) ?? [],
          mutedTopics: cleanTopics(clean.briefingPreferences.mutedTopics) ?? [],
        },
      }
    : null;
}

function normalizeIntake(draft: PlanIntakeDraft | null | undefined): NormalizedLayer | null {
  if (!draft) return null;
  const context = planIntakeNightContextPatch(draft);
  if (Object.keys(context).length === 0 && !draft.answers.area) return null;
  return {
    source: "progressive-intake",
    context,
    ...(draft.answers.area ? { preferredPatch: draft.answers.area } : {}),
  };
}

function firstContextField<K extends keyof NightContext>(
  layers: readonly NormalizedLayer[],
  key: K,
): ResolvedTodayField<NightContext[K]> {
  for (const layer of layers) {
    if (hasOwn(layer.context, key)) {
      return { value: layer.context[key] as NightContext[K], source: layer.source };
    }
  }
  return {
    value: DEFAULT_NIGHT_PROFILE_INPUT.context[key],
    source: "defaults",
  };
}

function firstBriefingField<K extends keyof NightBriefingPreferences>(
  layers: readonly NormalizedLayer[],
  key: K,
): ResolvedTodayField<NightBriefingPreferences[K]> {
  for (const layer of layers) {
    if (layer.briefing && hasOwn(layer.briefing, key)) {
      return {
        value: layer.briefing[key] as NightBriefingPreferences[K],
        source: layer.source,
      };
    }
  }
  return {
    value: DEFAULT_NIGHT_PROFILE_INPUT.briefingPreferences[key],
    source: "defaults",
  };
}

function nearestWeatherArea(patchId: NightPatchId): NightAreaSlug {
  const patch = resolveNightPatch(patchId);
  if (!patch) return "piccadilly-soho";
  return NIGHT_AREAS
    .map((area) => ({
      slug: area.slug,
      km: haversineKm([patch.lng, patch.lat], [area.centre.lng, area.centre.lat]),
    }))
    .sort((left, right) => left.km - right.km)[0]?.slug ?? "piccadilly-soho";
}

function locationPreferenceFromLayers(layers: readonly NormalizedLayer[]): {
  preferredPatch: ResolvedTodayField<NightPatchId | null>;
  weatherArea: ResolvedTodayField<NightAreaSlug>;
} {
  for (const layer of layers) {
    if (hasOwn(layer, "preferredPatch")) {
      const preferredPatch = layer.preferredPatch ?? null;
      const sameLayerArea = hasOwn(layer.context, "nightArea")
        ? layer.context.nightArea
        : null;
      return {
        preferredPatch: { value: preferredPatch, source: layer.source },
        weatherArea: {
          value: preferredPatch
            ? nearestWeatherArea(preferredPatch)
            : sameLayerArea ?? "piccadilly-soho",
          source: layer.source,
        },
      };
    }
    if (hasOwn(layer.context, "nightArea")) {
      const area = layer.context.nightArea;
      // A full stored profile contains the schema default `nightArea: null`.
      // That is absence, not an instruction to erase a lower remembered patch.
      if (!area && (layer.source === "account" || layer.source === "reviewed-device")) continue;
      return {
        preferredPatch: {
          value: null,
          source: layer.source,
        },
        weatherArea: {
          value: area ?? "piccadilly-soho",
          source: layer.source,
        },
      };
    }
  }
  return {
    preferredPatch: { value: null, source: "defaults" },
    weatherArea: { value: "piccadilly-soho", source: "defaults" },
  };
}

/**
 * Resolve the Today read model without reading storage, auth, the clock, or the
 * network. A device profile participates only when the caller explicitly marks
 * that snapshot reviewed. Empty arrays, false, and null are real field values,
 * so a higher-priority source can deliberately clear a lower preference.
 */
export function resolveTodayPersonalization(
  input: TodayPersonalizationInput = {},
): ResolvedTodayPersonalization {
  const reviewedDevice = input.reviewedDevice?.reviewed === true
    ? normalizeProfile("reviewed-device", input.reviewedDevice.profile)
    : null;
  const layers = [
    normalizeIntent("explicit-current-intent", input.explicitCurrentIntent),
    normalizeIntake(input.progressiveIntake),
    normalizeProfile("account", input.account),
    reviewedDevice,
    normalizeIntent("defaults", input.defaults),
  ].filter((layer): layer is NormalizedLayer => layer !== null);

  const resolvedEntries = CONTEXT_FIELDS.map((field) => [field, firstContextField(layers, field)] as const);
  const context = Object.fromEntries(
    resolvedEntries.map(([field, resolved]) => [field, resolved.value]),
  ) as NightContext;
  const provenance = Object.fromEntries(
    resolvedEntries.map(([field, resolved]) => [field, resolved.source]),
  ) as Record<keyof NightContext, TodayPersonalizationSource>;
  const muteAll = firstBriefingField(layers, "muteAll");
  const ignored = input.ignoreToday === true || muteAll.value;
  const location = locationPreferenceFromLayers(layers);

  return {
    ignored,
    personalized: !ignored && layers.some((layer) => layer.source !== "defaults"),
    context,
    provenance,
    preferredPatch: location.preferredPatch,
    weatherArea: location.weatherArea,
    hardExclusions: {
      muteAll,
      areas: firstBriefingField(layers, "mutedAreas"),
      topics: firstBriefingField(layers, "mutedTopics"),
    },
  };
}

export type TodayBriefReadModel = {
  weather: WeatherBrief | null;
  picks: TonightPickDto[];
  filteredPickCount?: number;
};

export type PersonalizedTodayBriefReadModel = TodayBriefReadModel & {
  filteredPickCount: number;
};

const TODAY_PICK_LIMIT = 3;

function normalizedTopicMatch(pick: TonightPickDto, topics: readonly string[]): boolean {
  const normalized = `${pick.kind} ${pick.kindLabel} ${pick.title}`
    .normalize("NFKC")
    .toLocaleLowerCase("en-GB")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const haystack = ` ${normalized} `;
  return topics.some((topic) => {
    const phrase = topic
      .normalize("NFKC")
      .toLocaleLowerCase("en-GB")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    return phrase.length > 0 && haystack.includes(` ${phrase} `);
  });
}

function pickNightArea(pick: TonightPickDto): NightAreaSlug | null {
  if (pick.lat === null || pick.lng === null) return null;
  let nearest: { slug: NightAreaSlug; km: number } | null = null;
  for (const area of NIGHT_AREAS) {
    const km = haversineKm([pick.lng, pick.lat], [area.centre.lng, area.centre.lat]);
    if (km <= area.radiusKm && (!nearest || km < nearest.km)) nearest = { slug: area.slug, km };
  }
  return nearest?.slug ?? null;
}

function sourceDiverseOrder(picks: readonly TonightPickDto[]): TonightPickDto[] {
  const primary: TonightPickDto[] = [];
  const overflow: TonightPickDto[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    const source = pick.sourceLabel.normalize("NFKC").trim().toLocaleLowerCase("en-GB");
    if (seen.has(source)) overflow.push(pick);
    else {
      seen.add(source);
      primary.push(pick);
    }
  }
  return [...primary, ...overflow];
}

/** Apply only claims the Today DTO can prove: patch order, weather area, and mutes. */
export function applyTodayPersonalization(
  base: TodayBriefReadModel,
  weatherByArea: Readonly<Partial<Record<NightAreaSlug, WeatherBrief | null>>>,
  resolved: ResolvedTodayPersonalization,
): PersonalizedTodayBriefReadModel {
  if (resolved.ignored) {
    return {
      ...base,
      picks: base.picks.slice(0, TODAY_PICK_LIMIT),
      filteredPickCount: base.filteredPickCount ?? 0,
    };
  }

  const mutedAreas = new Set(resolved.hardExclusions.areas.value);
  const mutedTopics = resolved.hardExclusions.topics.value;
  const filtered = base.picks.filter((pick) => {
    if (normalizedTopicMatch(pick, mutedTopics)) return false;
    const area = pickNightArea(pick);
    return !area || !mutedAreas.has(area);
  });
  const patch = resolved.preferredPatch.source !== "defaults"
    ? resolveNightPatch(resolved.preferredPatch.value)
    : null;
  const area = resolved.weatherArea.source !== "defaults"
    ? NIGHT_AREAS.find((candidate) => candidate.slug === resolved.weatherArea.value)
    : null;
  const near = patch
    ? { lat: patch.lat, lng: patch.lng }
    : area
      ? { lat: area.centre.lat, lng: area.centre.lng }
      : null;
  const picks = sourceDiverseOrder(orderPicksNear(filtered, near)).slice(0, TODAY_PICK_LIMIT);
  const personalizedWeather = resolved.weatherArea.source !== "defaults" || resolved.preferredPatch.value
    ? weatherByArea[resolved.weatherArea.value]
    : undefined;

  return {
    weather: personalizedWeather ?? base.weather,
    picks,
    filteredPickCount: base.picks.length - filtered.length,
  };
}
