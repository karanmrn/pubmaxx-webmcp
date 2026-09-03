import { NIGHT_AREAS, NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { cleanText } from "@/lib/textClean";
import { inferPlanStopCount, normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";

export const DAYPARTS = ["daytime", "after_work", "evening", "late_night", "get_home"] as const;
export type Daypart = (typeof DAYPARTS)[number];
export { type NightAreaSlug };
export const PARTY_TYPES = ["solo", "friends", "work"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];
export const BUDGETS = ["value", "standard", "treat"] as const;
export type Budget = (typeof BUDGETS)[number];

export type NightContext = {
  nightArea: NightAreaSlug | null;
  daypart: Daypart;
  partyType: PartyType;
  groupSize: number | null;
  /** Requested pub stops. Missing legacy context means the default three. */
  stopCount?: PlanStopCount;
  budget: Budget;
  /** Explicit per-person budget for the three-stop route. Never inferred from profile history. */
  budgetLimitPence: number | null;
  zeroProof: boolean;
  /**
   * Soft-prefer pubs that join the first-party J D Wetherspoon directory.
   * Never a hard filter: areas with few Spoons must still return three stops.
   */
  wetherspoonsPreferred: boolean;
  atmosphere: string[];
  foodNeeds: string[];
  accessibility: string[];
  transportConstraints: string[];
};

export type ContextReason = { field: keyof NightContext; evidence: string; explanation: string };
export type InferredNightContext = { context: NightContext; confidence: number; reasons: ContextReason[] };

const AREA_LABELS = NIGHT_AREAS
  .flatMap((area) => [area.name, ...area.aliases].map((label) => ({ slug: area.slug, label })))
  .sort((a, b) => b.label.length - a.label.length);

function londonHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
}

function defaultDaypart(now: Date): Daypart {
  const hour = londonHour(now);
  if (hour < 16) return "daytime";
  if (hour < 19) return "after_work";
  if (hour < 23) return "evening";
  return hour < 4 ? "late_night" : "get_home";
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** Names the chain in free text (Wetherspoon / Wetherspoons / Spoons). */
export const WETHERSPOONS_QUERY_PATTERN = /\bwetherspoons?\b|\bspoons\b/i;

export function inferNightContext(rawQuery: unknown, now = new Date()): InferredNightContext {
  const query = cleanText(rawQuery, 500);
  const lower = query.toLocaleLowerCase();
  const reasons: ContextReason[] = [];
  const areaMatch = AREA_LABELS.find(({ label }) => lower.includes(label.toLocaleLowerCase()));
  if (areaMatch) reasons.push({ field: "nightArea", evidence: areaMatch.label, explanation: "Matched the requested area." });

  let daypart = defaultDaypart(now);
  // Explicit clock words win over occasion language. Coffee / catch-up / Spoons
  // are daytime occasions only when no stronger time-of-day word is present.
  const daypartMatchers: Array<[Daypart, RegExp, string]> = [
    ["after_work", /after[ -]?work|leaving do/, "after work"],
    ["get_home", /get home|last train|heading home/, "get home"],
    ["late_night", /late[ -]?night|after midnight/, "late night"],
    ["evening", /evening|tonight/, "evening"],
    ["daytime", /daytime|lunch|afternoon|brunch|\bcoffee\b|catch[ -]?up/, "daytime"],
  ];
  const explicitDaypart = daypartMatchers.find(([, pattern]) => pattern.test(lower));
  if (explicitDaypart) {
    daypart = explicitDaypart[0];
    reasons.push({ field: "daypart", evidence: explicitDaypart[2], explanation: "Matched the requested time of day." });
  }

  const spoonsMentioned = WETHERSPOONS_QUERY_PATTERN.test(lower);
  // Spoons is a value chain with no generate-time hard filter: when the query
  // names it and no clock word won above, stick daytime + value so the chill
  // Spoons occasion still shapes ranking (see chip honesty tests).
  if (!explicitDaypart && spoonsMentioned) {
    daypart = "daytime";
    reasons.push({ field: "daypart", evidence: "Wetherspoons", explanation: "Spoons outing defaults to daytime when no clock word is stated." });
  }

  const numeric =
    lower.match(/\b(\d{1,2})\s*(?:of us|people|mates|friends)\b/) ??
    lower.match(/\b(?:for|party of|group of)\s+(\d{1,2})\b/);
  const word = Object.entries(NUMBER_WORDS).find(([label]) =>
    new RegExp(`\\b(?:${label}\\s+(?:of us|people|mates|friends)|(?:for|party of|group of)\\s+${label})\\b`).test(lower),
  );
  const groupSize = numeric ? Number(numeric[1]) : word?.[1] ?? null;
  if (groupSize) reasons.push({ field: "groupSize", evidence: numeric?.[1] ?? (word?.[0].replace(/^./, (c) => c.toUpperCase()) ?? ""), explanation: "Matched the stated group size." });

  const stopCount = inferPlanStopCount(lower, NUMBER_WORDS);
  if (stopCount !== 3) {
    reasons.push({ field: "stopCount", evidence: `${stopCount} stops`, explanation: "Matched the requested crawl size." });
  }

  const partyType: PartyType = /colleague|team|work social|leaving do/.test(lower) ? "work" : /solo|just me|on my own/.test(lower) ? "solo" : "friends";
  const budget: Budget = /cheap|budget|value|not pricey|wetherspoons?|\bspoons\b/.test(lower)
    ? "value"
    : /special|splash out|treat/.test(lower)
      ? "treat"
      : "standard";
  const budgetLimitMatch = lower.match(/(?:under|up to|max(?:imum)?|budget(?: of)?)\s*£\s*(\d{1,3})(?:[.,](\d{1,2}))?(?:\s*(?:each|per person))?/);
  const budgetLimitPence = budgetLimitMatch
    ? Number(budgetLimitMatch[1]) * 100 + Number((budgetLimitMatch[2] ?? "").padEnd(2, "0") || 0)
    : null;
  if (budgetLimitPence) reasons.push({ field: "budgetLimitPence", evidence: `£${(budgetLimitPence / 100).toFixed(2)}`, explanation: "Matched the explicit per-person route budget." });
  const atmosphere = ["quiet", "lively", "historic", "cosy", "sports", "music", "garden"].filter((value) => lower.includes(value));
  // Chill is the everyday synonym for quiet on describe-first chips; ranking
  // only scores the closed "quiet" token, so map rather than invent a new one.
  if (/\bchill\b/.test(lower) && !atmosphere.includes("quiet")) atmosphere.push("quiet");
  const foodNeeds = ["kebab", "pizza", "chips", "vegan", "vegetarian", "halal"].filter((value) => lower.includes(value));
  // Bare "food" marks the outing as food-aware for ranking and endings. It is
  // not a cuisine filter (lateFood drops this non-specific tag).
  if (/\bfood\b/.test(lower) && !foodNeeds.includes("food")) foodNeeds.push("food");
  const accessibility = /wheelchair|step[- ]free|accessible/.test(lower) ? ["step-free"] : [];
  const transportConstraints = /tube/.test(lower) ? ["tube"] : /walk/.test(lower) ? ["walking"] : [];
  const zeroProof = /zero[ -]?proof|alcohol[ -]?free|soft[ -]?drinks?|not drinking|sober|0\.0/.test(lower);
  const wetherspoonsPreferred = spoonsMentioned;
  if (wetherspoonsPreferred) {
    reasons.push({
      field: "wetherspoonsPreferred",
      evidence: "Wetherspoons",
      explanation: "Soft-prefers pubs matched to the first-party J D Wetherspoon directory.",
    });
  }

  return {
    context: {
      nightArea: areaMatch?.slug ?? null,
      daypart,
      partyType,
      groupSize,
      stopCount,
      budget,
      budgetLimitPence,
      zeroProof,
      wetherspoonsPreferred,
      atmosphere,
      foodNeeds,
      accessibility,
      transportConstraints,
    },
    confidence: areaMatch ? 0.86 : 0.62,
    reasons,
  };
}

export function isNightAreaSlug(value: unknown): value is NightAreaSlug {
  return typeof value === "string" && (NIGHT_AREA_SLUGS as readonly string[]).includes(value);
}

export function isDaypart(value: unknown): value is Daypart {
  return typeof value === "string" && (DAYPARTS as readonly string[]).includes(value);
}

export function isPartyType(value: unknown): value is PartyType {
  return typeof value === "string" && (PARTY_TYPES as readonly string[]).includes(value);
}

export function isBudget(value: unknown): value is Budget {
  return typeof value === "string" && (BUDGETS as readonly string[]).includes(value);
}

function cleanContextList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, 8)
    .map((item) => cleanText(item, 40))
    .filter(Boolean);
}

export function cleanNightContextPatch(value: unknown): Partial<NightContext> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const atmosphere = cleanContextList(row.atmosphere);
  const foodNeeds = cleanContextList(row.foodNeeds);
  const accessibility = cleanContextList(row.accessibility);
  const transportConstraints = cleanContextList(row.transportConstraints);

  return {
    ...(row.nightArea === null || isNightAreaSlug(row.nightArea) ? { nightArea: row.nightArea } : {}),
    ...(isDaypart(row.daypart) ? { daypart: row.daypart } : {}),
    ...(isPartyType(row.partyType) ? { partyType: row.partyType } : {}),
    ...(row.groupSize === null
      ? { groupSize: null }
      : typeof row.groupSize === "number" && row.groupSize >= 1 && row.groupSize <= 30
        ? { groupSize: Math.floor(row.groupSize) }
        : {}),
    ...(row.stopCount === undefined
      ? {}
      : { stopCount: normalizePlanStopCount(row.stopCount) }),
    ...(isBudget(row.budget) ? { budget: row.budget } : {}),
    ...(row.budgetLimitPence === null
      ? { budgetLimitPence: null }
      : typeof row.budgetLimitPence === "number" && Number.isInteger(row.budgetLimitPence) && row.budgetLimitPence >= 500 && row.budgetLimitPence <= 50_000
        ? { budgetLimitPence: row.budgetLimitPence }
        : {}),
    ...(typeof row.zeroProof === "boolean" ? { zeroProof: row.zeroProof } : {}),
    ...(typeof row.wetherspoonsPreferred === "boolean" ? { wetherspoonsPreferred: row.wetherspoonsPreferred } : {}),
    ...(atmosphere ? { atmosphere } : {}),
    ...(foodNeeds ? { foodNeeds } : {}),
    ...(accessibility ? { accessibility } : {}),
    ...(transportConstraints ? { transportConstraints } : {}),
  };
}

export function cleanNightContext(value: unknown): NightContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isNightAreaSlug(row.nightArea) || !isDaypart(row.daypart)) return null;
  if (!isPartyType(row.partyType)) return null;
  if (!isBudget(row.budget)) return null;
  return {
    nightArea: row.nightArea,
    daypart: row.daypart as Daypart,
    partyType: row.partyType as PartyType,
    groupSize: typeof row.groupSize === "number" && row.groupSize >= 1 && row.groupSize <= 30 ? Math.floor(row.groupSize) : null,
    stopCount: normalizePlanStopCount(row.stopCount),
    budget: row.budget as Budget,
    budgetLimitPence: typeof row.budgetLimitPence === "number" && Number.isInteger(row.budgetLimitPence) && row.budgetLimitPence >= 500 && row.budgetLimitPence <= 50_000
      ? row.budgetLimitPence
      : null,
    zeroProof: row.zeroProof === true,
    wetherspoonsPreferred: row.wetherspoonsPreferred === true,
    atmosphere: cleanContextList(row.atmosphere) ?? [],
    foodNeeds: cleanContextList(row.foodNeeds) ?? [],
    accessibility: cleanContextList(row.accessibility) ?? [],
    transportConstraints: cleanContextList(row.transportConstraints) ?? [],
  };
}
