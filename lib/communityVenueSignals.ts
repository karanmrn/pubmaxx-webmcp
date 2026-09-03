import {
  COMMUNITY_PRICE_CORROBORATION_THRESHOLD,
  isWithinMaxAge,
} from "@/lib/communityPrice";

export type CommunityVenueSignalKey =
  | "character"
  | "step-free-venue"
  | "step-free-toilets"
  | "door-policy"
  | "people-eating"
  | "na-friendly";

export type CommunityVenueSignalValue =
  | "rough"
  | "posh"
  | "step-free"
  | "steps"
  | "no-issue"
  | "trainers"
  | "groups"
  | "late"
  | "eating"
  | "drinks-only"
  | "good-na-options"
  | "limited-na";

export type CommunityVenueSignalCandidate = {
  signalValue: CommunityVenueSignalValue;
  submittedAt: number;
  corroborations: number;
};

export type CommunityVenueSignal = {
  /** Observation handle, so a wrong report can be flagged and moderated. */
  id?: string;
  venueId: string;
  signalKey: CommunityVenueSignalKey;
  signalValue: CommunityVenueSignalValue;
  submittedAt: number;
  source: "community";
  corroborations?: number;
  establishedCandidate?: CommunityVenueSignalCandidate;
};

export type CommunityVenueSignalInput = {
  venueId: string;
  signalKey: CommunityVenueSignalKey;
  signalValue: CommunityVenueSignalValue;
};

export type CommunityVenueSignalValidation =
  | { ok: true; value: CommunityVenueSignalInput }
  | { ok: false; error: string };

export type CommunityVenueSignalOption = {
  value: CommunityVenueSignalValue;
  label: string;
};

export const COMMUNITY_VENUE_SIGNAL_OPTIONS = {
  character: [
    { value: "rough", label: "Rough" },
    { value: "posh", label: "Posh" },
  ],
  "step-free-venue": [
    { value: "step-free", label: "Step-free" },
    { value: "steps", label: "Has steps" },
  ],
  "step-free-toilets": [
    { value: "step-free", label: "Step-free" },
    { value: "steps", label: "Has steps" },
  ],
  "door-policy": [
    { value: "no-issue", label: "No issue seen" },
    { value: "trainers", label: "Trainers refused" },
    { value: "groups", label: "Big groups refused" },
    { value: "late", label: "Late entry restricted" },
  ],
  "people-eating": [
    { value: "eating", label: "People eating" },
    { value: "drinks-only", label: "Drinks only" },
  ],
  "na-friendly": [
    { value: "good-na-options", label: "Good alcohol-free options" },
    { value: "limited-na", label: "Limited alcohol-free options" },
  ],
} as const satisfies Record<
  CommunityVenueSignalKey,
  readonly CommunityVenueSignalOption[]
>;

export const COMMUNITY_VENUE_SIGNAL_LABELS: Record<
  CommunityVenueSignalKey,
  string
> = {
  character: "Character",
  "step-free-venue": "Entrance",
  "step-free-toilets": "Toilets",
  "door-policy": "Door",
  "people-eating": "Eating",
  "na-friendly": "Alcohol-free",
};

const SIGNAL_KEYS = new Set<CommunityVenueSignalKey>(
  Object.keys(COMMUNITY_VENUE_SIGNAL_OPTIONS) as CommunityVenueSignalKey[],
);

const MAX_VENUE_ID = 64;

function cleanVenueId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, MAX_VENUE_ID);
}

export function isCommunityVenueSignalKey(
  value: unknown,
): value is CommunityVenueSignalKey {
  return typeof value === "string" && SIGNAL_KEYS.has(value as CommunityVenueSignalKey);
}

export function isCommunityVenueSignalValueFor(
  signalKey: CommunityVenueSignalKey,
  value: unknown,
): value is CommunityVenueSignalValue {
  return (
    typeof value === "string" &&
    COMMUNITY_VENUE_SIGNAL_OPTIONS[signalKey].some(
      (option) => option.value === value,
    )
  );
}

export function validateCommunityVenueSignal(
  input: unknown,
): CommunityVenueSignalValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Missing submission body." };
  }
  const raw = input as Record<string, unknown>;
  const venueId = cleanVenueId(raw.venueId);
  if (!venueId) return { ok: false, error: "Choose a venue." };
  if (!isCommunityVenueSignalKey(raw.signalKey)) {
    return { ok: false, error: "Pick what you noticed." };
  }
  if (!isCommunityVenueSignalValueFor(raw.signalKey, raw.signalValue)) {
    return { ok: false, error: "Pick what you noticed." };
  }
  return {
    ok: true,
    value: {
      venueId,
      signalKey: raw.signalKey,
      signalValue: raw.signalValue,
    },
  };
}

/**
 * How much the community actually backs one question's answer. The ONE thing a
 * reading surface may branch on: a summary that inspected the copy instead read
 * a stronger claim out of weaker evidence the moment a sentence changed.
 *
 * `unknown` covers "nobody has said" AND "one person has said", because a lone
 * report is not an answer to an access question at any age.
 */
export type CommunityVenueSignalTrust = "unknown" | "reported" | "established";

export type CommunityVenueSignalText = {
  primary: string;
  detail?: string;
  trust: CommunityVenueSignalTrust;
};

const ACCESS_KEYS = new Set<CommunityVenueSignalKey>([
  "step-free-venue",
  "step-free-toilets",
]);

/**
 * Access questions answer whether someone can get in and use the toilets, so
 * they carry the stricter rule: only corroboration leaves `unknown`, and being
 * unable to check never reads as "no".
 */
export function isAccessSignalKey(
  signalKey: CommunityVenueSignalKey,
): boolean {
  return ACCESS_KEYS.has(signalKey);
}

function establishedSignal(
  signal: CommunityVenueSignal,
  now: number,
): CommunityVenueSignalCandidate | null {
  const candidate =
    signal.establishedCandidate ??
    ({
      signalValue: signal.signalValue,
      submittedAt: signal.submittedAt,
      corroborations: signal.corroborations ?? 1,
    } satisfies CommunityVenueSignalCandidate);
  return candidate.corroborations >= COMMUNITY_PRICE_CORROBORATION_THRESHOLD &&
    isWithinMaxAge(candidate, now)
    ? candidate
    : null;
}

function onePersonText(
  signalKey: CommunityVenueSignalKey,
  value: CommunityVenueSignalValue,
): string {
  switch (signalKey) {
    case "character":
      return `One drinker called it ${value}.`;
    case "step-free-venue":
      return value === "step-free"
        ? "One drinker reported a step-free entrance."
        : "One drinker reported steps at the entrance.";
    case "step-free-toilets":
      return value === "step-free"
        ? "One drinker reported step-free toilets."
        : "One drinker reported steps to the toilets.";
    case "door-policy":
      if (value === "no-issue") return "One drinker saw no door issue.";
      if (value === "trainers") return "One drinker reported trainers can be refused.";
      if (value === "groups") return "One drinker reported big groups can be refused.";
      return "One drinker reported late entry restrictions.";
    case "people-eating":
      return value === "eating"
        ? "One drinker saw people eating."
        : "One drinker saw a drinks-only room.";
    case "na-friendly":
      return value === "good-na-options"
        ? "One drinker called the alcohol-free options good."
        : "One drinker called the alcohol-free options limited.";
  }
}

function establishedText(
  signalKey: CommunityVenueSignalKey,
  value: CommunityVenueSignalValue,
): string {
  switch (signalKey) {
    case "character":
      return `Drinkers called it ${value}.`;
    case "step-free-venue":
    case "step-free-toilets":
      return value === "step-free" ? "Step-free" : "Steps reported";
    case "door-policy":
      if (value === "no-issue") return "Drinkers reported no door issue.";
      if (value === "trainers") return "Drinkers reported trainers can be refused.";
      if (value === "groups") return "Drinkers reported big groups can be refused.";
      return "Drinkers reported late entry restrictions.";
    case "people-eating":
      return value === "eating"
        ? "Drinkers saw people eating."
        : "Drinkers saw a drinks-only room.";
    case "na-friendly":
      return value === "good-na-options"
        ? "Drinkers called the alcohol-free options good."
        : "Drinkers called the alcohol-free options limited.";
  }
}

function olderText(
  signalKey: CommunityVenueSignalKey,
  value: CommunityVenueSignalValue,
): string {
  switch (signalKey) {
    case "character":
      return `Older drinker reports called it ${value}.`;
    case "step-free-venue":
      return value === "step-free"
        ? "Older drinker reports said the entrance was step-free."
        : "Older drinker reports said the entrance had steps.";
    case "step-free-toilets":
      return value === "step-free"
        ? "Older drinker reports said the toilets were step-free."
        : "Older drinker reports said the toilets had steps.";
    case "door-policy":
      if (value === "no-issue") return "Older drinker reports said there was no door issue.";
      if (value === "trainers") return "Older drinker reports said trainers can be refused.";
      if (value === "groups") return "Older drinker reports said big groups can be refused.";
      return "Older drinker reports said late entry was restricted.";
    case "people-eating":
      return value === "eating"
        ? "Older drinker reports saw people eating."
        : "Older drinker reports saw a drinks-only room.";
    case "na-friendly":
      return value === "good-na-options"
        ? "Older drinker reports called the alcohol-free options good."
        : "Older drinker reports called the alcohol-free options limited.";
  }
}

export function communityVenueSignalText(
  signalKey: CommunityVenueSignalKey,
  signal: CommunityVenueSignal | undefined,
  now: number = Date.now(),
): CommunityVenueSignalText {
  if (!signal) {
    if (signalKey === "step-free-venue") {
      return {
        primary: "Unknown",
        detail: "Nobody has confirmed step-free entrance access.",
        trust: "unknown",
      };
    }
    if (signalKey === "step-free-toilets") {
      return {
        primary: "Unknown",
        detail: "Nobody has confirmed step-free toilet access.",
        trust: "unknown",
      };
    }
    return { primary: "Not reported yet.", trust: "unknown" };
  }

  const established = establishedSignal(signal, now);
  if (established) {
    const disagrees =
      established.signalValue !== signal.signalValue &&
      signal.submittedAt > established.submittedAt;
    const agreement =
      signalKey === "character"
        ? `${established.corroborations} people agreed.`
        : `Confirmed by ${established.corroborations} drinkers.`;
    return {
      primary: establishedText(signalKey, established.signalValue),
      detail: disagrees
        ? `${agreement} One newer report disagrees.`
        : agreement,
      trust: "established",
    };
  }

  const stale = !isWithinMaxAge(signal, now);

  // An uncorroborated access report keeps the primary line at Unknown whatever
  // its age. Ageing is a reason to trust a report LESS, so it may only ever
  // move to the supporting line: the older wording used to be a promotion, and
  // one expired report read as a step-free entrance nobody had confirmed.
  if (isAccessSignalKey(signalKey)) {
    return {
      primary: "Unknown",
      detail: stale
        ? `${olderText(signalKey, signal.signalValue)} Needs a fresh check.`
        : onePersonText(signalKey, signal.signalValue),
      trust: "unknown",
    };
  }

  if (stale) {
    return {
      primary: olderText(signalKey, signal.signalValue),
      detail: "Needs a fresh check.",
      trust: "reported",
    };
  }

  return {
    primary: onePersonText(signalKey, signal.signalValue),
    trust: "reported",
  };
}
