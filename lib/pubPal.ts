import { clamp as clampRange } from "@/lib/mathClamp";
import { PAL_MASCOT_SLUGS, type PalMascotSlug } from "@/lib/palMascotAssets.mjs";
import { cleanText } from "@/lib/textClean";

/**
 * Eight original Pub Pal forms. The breadth mirrors the useful part of the
 * Codex pet picker (a small, memorable cast) without copying its artwork.
 */
export const PAL_ONBOARDING_SPECIES = [
  "robin",
  "greyhound",
  "cat",
  "fox",
  "pigeon",
  "badger",
  "corgi",
] as const;
export const PAL_LEGACY_SPECIES = [
  "hound",
  "raven",
  "rabbit",
  "turtle",
  "squirrel",
  "bot",
] as const;
export const PAL_SPECIES = [...PAL_ONBOARDING_SPECIES, ...PAL_LEGACY_SPECIES] as const;
export const SIGNAL_FAMILIES = ["beer", "gin", "rum", "whisky", "brandy", "vodka"] as const;
export const PAL_VOICES = ["ember", "velvet", "signal"] as const;
export type PubPalSpecies = (typeof PAL_SPECIES)[number];
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number];
export type PubPalVoiceId = (typeof PAL_VOICES)[number];

export const PAL_ANIMATION_STATES = [
  "idle",
  "noticing",
  "listening",
  "thinking",
  "speaking",
  "celebrating",
  "sleeping",
  "error",
] as const;
export type PalAnimationState = (typeof PAL_ANIMATION_STATES)[number];

export type PalVisualManifest = {
  species: PubPalSpecies;
  /**
   * A rendered species names its own asset slug, which is the SAME string
   * lib/palMascotAssets.mjs holds for it; `layered-svg` means no master exists
   * and every surface falls back to that species' rig.
   */
  format: "layered-svg" | PalMascotSlug;
  silhouette: string;
  face: string;
  signatureProp: string;
  material: string;
  idlePose: string;
  supportedStates: readonly PalAnimationState[];
};

export const PAL_VISUAL_MANIFEST: Record<(typeof PAL_ONBOARDING_SPECIES)[number], PalVisualManifest> = {
  robin: { species: "robin", format: PAL_MASCOT_SLUGS.robin, silhouette: "circuit robin with a warm amber signal chest", face: "bright eyes and a grounded companion gaze", signatureProp: "signal seam", material: "smoked chrome with an amber signal seam", idlePose: "upright and ready beside the route", supportedStates: PAL_ANIMATION_STATES },
  greyhound: { species: "greyhound", format: PAL_MASCOT_SLUGS.greyhound, silhouette: "long-nosed, swept-ear greyhound", face: "loyal bright eyes and a narrow muzzle", signatureProp: "signal collar", material: "smoked chrome with an amber signal seam", idlePose: "upright and gently leaning into the route", supportedStates: PAL_ANIMATION_STATES },
  cat: { species: "cat", format: PAL_MASCOT_SLUGS.cat, silhouette: "compact black cat with a hooked signal tail", face: "half-lidded luminous eyes and a dry smile", signatureProp: "brass bell", material: "black glass with a soft edge glow", idlePose: "seated with one paw lifted", supportedStates: PAL_ANIMATION_STATES },
  fox: { species: "fox", format: "layered-svg", silhouette: "sharp-eared quick fox", face: "curious eyes and an alert tapered muzzle", signatureProp: "route compass", material: "copper hologram with glass highlights", idlePose: "forward on its toes with its tail curled", supportedStates: PAL_ANIMATION_STATES },
  pigeon: { species: "pigeon", format: "layered-svg", silhouette: "round city pigeon with a proud chest", face: "side-eye with a tiny knowing brow", signatureProp: "transit tag", material: "oil-slick chrome with teal and violet signal bands", idlePose: "one foot forward, head tilted toward the street", supportedStates: PAL_ANIMATION_STATES },
  badger: { species: "badger", format: "layered-svg", silhouette: "low, broad badger with strong mask stripes", face: "steady eyes and a reassuring blunt muzzle", signatureProp: "night-key lantern", material: "brushed graphite and frosted signal glass", idlePose: "planted firmly with the lantern held close", supportedStates: PAL_ANIMATION_STATES },
  corgi: { species: "corgi", format: "layered-svg", silhouette: "short, bright corgi with oversized ears", face: "open grin and eager round eyes", signatureProp: "crew band", material: "warm chrome with cream glass panels", idlePose: "front paws wide and ready to celebrate", supportedStates: PAL_ANIMATION_STATES },
};

export const PAL_SPECIES_COMPATIBILITY = {
  hound: "greyhound",
  raven: "raven",
  rabbit: "rabbit",
  turtle: "turtle",
  squirrel: "squirrel",
  bot: "bot",
  "black-cat": "cat",
  black_cat: "cat",
  night_bot: "bot",
  "night-bot": "bot",
} as const satisfies Record<string, PubPalSpecies>;

export function compatiblePalSpecies(value: unknown): PubPalSpecies | null {
  if (typeof value !== "string") return null;
  if (PAL_SPECIES.includes(value as PubPalSpecies)) return value as PubPalSpecies;
  return PAL_SPECIES_COMPATIBILITY[value as keyof typeof PAL_SPECIES_COMPATIBILITY] ?? null;
}

export type PubPalPersonality = {
  playfulness: number;
  energy: number;
  storytelling: number;
  relationship: "guide" | "sidekick" | "confidant";
};

export type PubPalAppearance = {
  species: PubPalSpecies;
  signalAffinity: SignalFamily;
  material: "hologram" | "chrome" | "glass";
  accessory: "none" | "collar" | "monocle" | "signal-ring";
};

export type PubPalVoice = {
  id: PubPalVoiceId;
  pace: number;
  warmth: number;
  energy: number;
};

export type PalProposalPreferences = {
  memories: boolean;
  routes: boolean;
};

export type PubPal = {
  id: string;
  ownerId: string;
  name: string;
  adultAttestedAt: string;
  appearance: PubPalAppearance;
  personality: PubPalPersonality;
  voice: PubPalVoice;
  muted: boolean;
  hidden: boolean;
  proposalPreferences: PalProposalPreferences;
  masteryPoints: number;
  createdAt: string;
  updatedAt: string;
};

export type PubPalMemoryKind =
  | "venue_preference"
  | "atmosphere_preference"
  | "accessibility_preference"
  | "transport_preference"
  | "drink_preference"
  | "night_outcome"
  | "correction";

export type PubPalMemory = {
  id: string;
  palId: string;
  kind: PubPalMemoryKind;
  value: string;
  provenance: "user_confirmed" | "completed_plan" | "user_correction";
  createdAt: string;
  updatedAt: string;
};

export type MasteryEventKind =
  | "plan_completed"
  | "venue_discovered"
  | "pint_drop_verified"
  | "heritage_read"
  | "crew_coordinated"
  | "night_captured";

export type MasteryEvent = {
  id: string;
  palId: string;
  kind: MasteryEventKind;
  sourceId: string;
  points: number;
  createdAt: string;
};

export type PalUnlock = {
  id: string;
  pointsRequired: number;
  category: "material" | "accessory" | "animation" | "home_object" | "lore";
  label: string;
};

export type PubPalDraft = {
  adultConfirmed: boolean;
  name: string;
  appearance: PubPalAppearance;
  personality: PubPalPersonality;
  voice: PubPalVoice;
};

export type PalOnboardingPrivacy = {
  proposeMemories: boolean;
  visible: boolean;
  muted: boolean;
};

export type PalOnboardingDraftV1 = {
  version: 1;
  savedAt: string;
  step: 0 | 1 | 2 | 3 | 4;
  draft: PubPalDraft;
  privacy: PalOnboardingPrivacy;
};

export const PAL_ONBOARDING_DRAFT_KEY = "pubmaxx.pub-pal-onboarding.v1";
export const PAL_ROUTE_ACTIVATION_KEY = "pubmaxx.pub-pal-route-activation.v1";
const PAL_ANONYMOUS_OWNER_KEY = "pubmaxx.pub-pal-onboarding-owner.v1";
let fallbackAnonymousOwner = "";

export function palOnboardingDraftKey(ownerId: string): string {
  return `${PAL_ONBOARDING_DRAFT_KEY}:${encodeURIComponent(ownerId)}`;
}

export function anonymousPalDraftOwner(): string {
  if (typeof window === "undefined") return "anonymous-server";
  try {
    const existing = window.sessionStorage.getItem(PAL_ANONYMOUS_OWNER_KEY);
    if (existing) return existing;
    const token = `anonymous-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(PAL_ANONYMOUS_OWNER_KEY, token);
    return token;
  } catch {
    fallbackAnonymousOwner ||= `anonymous-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return fallbackAnonymousOwner;
  }
}

export function markPalRouteActivation(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAL_ROUTE_ACTIVATION_KEY, JSON.stringify({ version: 1, activatedAt: new Date().toISOString() }));
    window.dispatchEvent(new Event("pubmaxx:pal-route-activation"));
  } catch {
    // Planning remains usable when storage is unavailable.
  }
}

export function hasPalRouteActivation(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PAL_ROUTE_ACTIVATION_KEY) ?? "null") as { version?: unknown; activatedAt?: unknown } | null;
    return raw?.version === 1 && typeof raw.activatedAt === "string" && Number.isFinite(Date.parse(raw.activatedAt));
  } catch {
    return false;
  }
}

export const DEFAULT_PAL_DRAFT: PubPalDraft = {
  adultConfirmed: false,
  name: "",
  appearance: { species: "robin", signalAffinity: "beer", material: "hologram", accessory: "none" },
  personality: { playfulness: 62, energy: 54, storytelling: 58, relationship: "sidekick" },
  voice: { id: "ember", pace: 50, warmth: 64, energy: 52 },
};

function parsePalOnboardingDraft(serialized: string | null): PalOnboardingDraftV1 | null {
  try {
    const raw = JSON.parse(serialized ?? "null") as Partial<PalOnboardingDraftV1> | null;
    if (!raw || raw.version !== 1 || !raw.draft || !raw.privacy) return null;
    const draft = raw.draft as PubPalDraft;
    if (
      typeof draft.adultConfirmed !== "boolean" ||
      typeof draft.name !== "string" || draft.name.length > 32 ||
      !compatiblePalSpecies(draft.appearance?.species) ||
      !SIGNAL_FAMILIES.includes(draft.appearance?.signalAffinity) ||
      !["hologram", "chrome", "glass"].includes(draft.appearance?.material) ||
      !["none", "collar", "monocle", "signal-ring"].includes(draft.appearance?.accessory) ||
      !PAL_VOICES.includes(draft.voice?.id) ||
      !["guide", "sidekick", "confidant"].includes(draft.personality?.relationship)
    ) return null;
    const step = Number.isInteger(raw.step) && Number(raw.step) >= 0 && Number(raw.step) <= 4
      ? raw.step as PalOnboardingDraftV1["step"]
      : 0;
    const species = compatiblePalSpecies(draft.appearance.species);
    if (!species) return null;
    return {
      version: 1,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date(0).toISOString(),
      step,
      draft: { ...draft, appearance: { ...draft.appearance, species } },
      privacy: {
        proposeMemories: raw.privacy.proposeMemories === true,
        visible: raw.privacy.visible !== false,
        muted: raw.privacy.muted === true,
      },
    };
  } catch {
    return null;
  }
}

export function readPalOnboardingDraft(ownerId: string): PalOnboardingDraftV1 | null {
  if (typeof window === "undefined") return null;
  try { return parsePalOnboardingDraft(window.localStorage.getItem(palOnboardingDraftKey(ownerId))); }
  catch { return null; }
}

export function subscribePalOnboardingDraft(ownerId: string, listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const key = palOnboardingDraftKey(ownerId);
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === key) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function migrateLegacyPalOnboardingDraft(ownerId: string): PalOnboardingDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const legacy = parsePalOnboardingDraft(window.localStorage.getItem(PAL_ONBOARDING_DRAFT_KEY));
    if (!legacy) return null;
    // The old key was shared by every browser user. Preserve creative choices,
    // but force a fresh adult attestation before the migrated draft can finish.
    const migrated: PalOnboardingDraftV1 = {
      ...legacy,
      savedAt: new Date().toISOString(),
      step: 0,
      draft: { ...legacy.draft, adultConfirmed: false },
      privacy: { proposeMemories: false, visible: true, muted: false },
    };
    writePalOnboardingDraft(ownerId, { step: migrated.step, draft: migrated.draft, privacy: migrated.privacy });
    window.localStorage.removeItem(PAL_ONBOARDING_DRAFT_KEY);
    return migrated;
  } catch {
    return null;
  }
}

export function writePalOnboardingDraft(ownerId: string, value: Omit<PalOnboardingDraftV1, "version" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const key = palOnboardingDraftKey(ownerId);
    const existing = parsePalOnboardingDraft(window.localStorage.getItem(key));
    if (existing
      && existing.step === value.step
      && JSON.stringify(existing.draft) === JSON.stringify(value.draft)
      && JSON.stringify(existing.privacy) === JSON.stringify(value.privacy)) return;
    window.localStorage.setItem(key, JSON.stringify({
      ...value,
      version: 1,
      savedAt: new Date().toISOString(),
    } satisfies PalOnboardingDraftV1));
  } catch {
    // Best-effort recovery in private/quota-constrained browsers.
  }
}

export function clearPalOnboardingDraft(ownerId: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(palOnboardingDraftKey(ownerId)); } catch { /* best effort */ }
}

export function cleanPalDraft(value: unknown): PubPalDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const appearance = raw.appearance as Record<string, unknown> | undefined;
  const personality = raw.personality as Record<string, unknown> | undefined;
  const voice = raw.voice as Record<string, unknown> | undefined;
  const name = cleanText(raw.name, 32);
  if (!name || raw.adultConfirmed !== true || !appearance || !personality || !voice) return null;
  const species = compatiblePalSpecies(appearance.species);
  if (!species) return null;
  if (!SIGNAL_FAMILIES.includes(appearance.signalAffinity as SignalFamily)) return null;
  if (!PAL_VOICES.includes(voice.id as PubPalVoiceId)) return null;
  const clamp = (input: unknown) => clampRange(Number(input) || 0, 0, 100);
  const relationship = ["guide", "sidekick", "confidant"].includes(String(personality.relationship))
    ? personality.relationship as PubPalPersonality["relationship"] : "sidekick";
  return {
    adultConfirmed: true,
    name,
    appearance: {
      species,
      signalAffinity: appearance.signalAffinity as SignalFamily,
      material: ["hologram", "chrome", "glass"].includes(String(appearance.material)) ? appearance.material as PubPalAppearance["material"] : "hologram",
      accessory: ["none", "collar", "monocle", "signal-ring"].includes(String(appearance.accessory)) ? appearance.accessory as PubPalAppearance["accessory"] : "none",
    },
    personality: { playfulness: clamp(personality.playfulness), energy: clamp(personality.energy), storytelling: clamp(personality.storytelling), relationship },
    voice: { id: voice.id as PubPalVoiceId, pace: clamp(voice.pace), warmth: clamp(voice.warmth), energy: clamp(voice.energy) },
  };
}

export const PAL_UNLOCKS: PalUnlock[] = [
  { id: "signal-ring", pointsRequired: 40, category: "accessory", label: "Signal ring" },
  { id: "gin-glass", pointsRequired: 90, category: "material", label: "Gin crystal" },
  { id: "victorian-lore", pointsRequired: 140, category: "lore", label: "Victorian London chapter" },
];

export type PalMasteryProgress = {
  /** The next item this Pal earns, or null once it has them all. */
  next: PalUnlock | null;
  pointsToNext: number;
  /** 0 to 1 across the gap between the last item earned and the next. */
  fraction: number;
  line: string;
};

/**
 * Where this Pal stands on its mastery track.
 *
 * The track buys COSMETICS and nothing else (ADR 0006): no unlock here changes
 * a recommendation, and none of them is earned by drinking more. The progress
 * is measured from the LAST item earned rather than from zero, so a Pal near
 * the top of the track does not read as almost finished for three levels.
 */
export function palMasteryProgress(masteryPoints: number): PalMasteryProgress {
  const points = Number.isFinite(masteryPoints) ? Math.max(0, masteryPoints) : 0;
  const ordered = [...PAL_UNLOCKS].sort((a, b) => a.pointsRequired - b.pointsRequired);
  const next = ordered.find((unlock) => points < unlock.pointsRequired) ?? null;
  if (!next) {
    return {
      next: null,
      pointsToNext: 0,
      fraction: 1,
      line: "Every mastery item earned.",
    };
  }
  const earnedFloor = ordered
    .filter((unlock) => points >= unlock.pointsRequired)
    .reduce((highest, unlock) => Math.max(highest, unlock.pointsRequired), 0);
  const span = next.pointsRequired - earnedFloor;
  const fraction = span > 0 ? Math.min(1, (points - earnedFloor) / span) : 0;
  const pointsToNext = next.pointsRequired - points;
  return {
    next,
    pointsToNext,
    fraction,
    line: `${pointsToNext} ${pointsToNext === 1 ? "point" : "points"} to the ${next.label}.`,
  };
}
