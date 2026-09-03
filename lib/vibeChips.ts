// Vibe chips — the mood layer from docs/VIBE_LAYER_SPEC_2026-07-19.md.
//
// Doctrine (spec, binding): a chip is the USER'S voice declaring their night,
// never the brand speaking. Slang lives ONLY in these labels and preset asks;
// every chip maps onto an existing deterministic seam (concierge mood ranking
// or the grounded What's-On lookup) so each press returns receipts or an
// honest empty line — never invented venues.
//
// Every `ask` string below is PARSER-TUNED and pinned by hermetic tests:
// - Chips whose `moods` are non-empty must deterministically parse to those
//   moods via parseConciergeIntent (no model), so the venue ranking hears the
//   register the label promises.
// - Chips backed by a What's-On kind must trigger detectWhatsOnIntent with
//   exactly that kind; the bender ask must NOT (it is a venue-ranking crawl
//   request, and a stray kind term would steal it into the lookup path).
// - "near me" style phrases are banned in asks: the area detectors capture the
//   junk token and silently filter every venue out.
// Reword an ask only with the tests open.

import type { WhatsOnKind } from "@/lib/whatsOn";
import type { ConciergeMood } from "@/lib/concierge/rank";

export type VibeChipId =
  | "bender"
  | "lit"
  | "quiet"
  | "cheeky"
  | "match"
  | "quiz"
  | "date";

// What a press does on the Tonight page: kind-backed chips compose the existing
// kind filter (a night with zero rows of that kind shows the page's own honest
// empty line); rank-backed chips have no What's-On kind, so they hand the ask
// to the Pub Pal, where the concierge mood ranking can answer with receipts.
export type VibeTonightAction =
  | { type: "filter"; kind: WhatsOnKind }
  | { type: "ask" };

export type VibeChip = {
  id: VibeChipId;
  /** User-voice label. Register lives here and in `ask` only. */
  label: string;
  /** Preset question fired through the existing deterministic ask path. */
  ask: string;
  tonight: VibeTonightAction;
  /**
   * Moods the ask must deterministically parse to ([] = the ask rides the
   * What's-On lookup instead of mood ranking). Pinned by tests.
   */
  moods: readonly ConciergeMood[];
};

export const VIBE_CHIPS: readonly VibeChip[] = [
  {
    id: "bender",
    label: "Big one tonight",
    ask: "Plan a big night for four of us, with cheap pints and a lively route",
    tonight: { type: "filter", kind: "deal" },
    moods: ["lively"],
  },
  {
    id: "lit",
    label: "Live and loud",
    ask: "Live music tonight, somewhere buzzing",
    tonight: { type: "filter", kind: "music" },
    moods: [],
  },
  {
    id: "quiet",
    label: "Quiet pint",
    ask: "Somewhere calm for a quiet pint and a chat",
    tonight: { type: "ask" },
    moods: ["quiet"],
  },
  {
    id: "cheeky",
    label: "Cheeky one after work",
    ask: "Cheapest decent pint for a quick one after work",
    tonight: { type: "ask" },
    moods: [],
  },
  {
    id: "match",
    label: "Match on",
    ask: "Who is showing the match tonight, and what is a pint there",
    tonight: { type: "filter", kind: "sport" },
    moods: [],
  },
  {
    id: "quiz",
    label: "Big brain energy",
    ask: "Find us a pub quiz tonight worth losing",
    tonight: { type: "filter", kind: "quiz" },
    moods: [],
  },
  {
    id: "date",
    label: "Date night",
    ask: "A date-night pub with some history, calm not loud",
    tonight: { type: "ask" },
    moods: ["date", "heritage", "quiet"],
  },
] as const;

/** Killed register (spec kill-list). Pinned absent from every chip surface. */
export const VIBE_KILLED_TERMS = [
  "turnt",
  "no cap",
  "bussin",
  "real ones",
] as const;

/** The seven owner-locked chip ids — the ONLY valid vibe votes (spec, binding). */
export const VIBE_CHIP_IDS: readonly VibeChipId[] = VIBE_CHIPS.map((chip) => chip.id);

/**
 * Keep Tonight's filter chips honest: a kind-backed chip is useful only when
 * its kind exists in the current What's-On inventory. Ask-backed chips remain
 * available because their destination can answer independently.
 */
export function visibleTonightVibeChips(
  availableKinds: readonly WhatsOnKind[],
): VibeChip[] {
  const available = new Set(availableKinds);
  return VIBE_CHIPS.filter(
    (chip) => chip.tonight.type === "ask" || available.has(chip.tonight.kind),
  );
}

/** Runtime guard: is `value` one of the seven owner-locked chip ids. */
export function isVibeChipId(value: unknown): value is VibeChipId {
  return typeof value === "string" && (VIBE_CHIP_IDS as readonly string[]).includes(value);
}

export function vibeChipById(id: string): VibeChip | undefined {
  return VIBE_CHIPS.find((chip) => chip.id === id);
}

/** Deep link that opens the Pub Pal with this chip's ask pre-fired. */
export function palChatHref(chip: VibeChip): string {
  return `/pal/chat?ask=${encodeURIComponent(chip.ask)}`;
}

/**
 * The seven locked public share slugs — the ONLY values `?vibe=` accepts on
 * share links and the plan-card OG route. These slugs are a public contract:
 * they already live in group chats, so they never change even if a chip label
 * is reworded (e.g. the pre-approved "Big one tonight" store fallback). The
 * plan-card route keeps its own VIBE_STAMPS literal for satori; a sync test
 * (__tests__/vibeSlugs.test.ts) pins that literal to this canonical map.
 */
export const VIBE_SLUGS: Record<VibeChipId, string> = {
  bender: "on-a-bender",
  lit: "get-lit",
  quiet: "quiet-pint",
  cheeky: "cheeky-one-after-work",
  match: "match-on",
  quiz: "big-brain-energy",
  date: "date-night",
};

/** Runtime guard: is `value` one of the seven locked share slugs. */
export function isVibeSlug(value: unknown): value is string {
  return typeof value === "string" && Object.values(VIBE_SLUGS).includes(value);
}

/**
 * The `?vibe=` slug a plan share or OG URL should carry: an explicitly
 * requested valid slug wins (a stamped link already in the wild keeps its
 * stamp), else the crew's single top vibe, else none. Anything unrecognised
 * is dropped, never echoed — user-controlled OG text is an abuse surface.
 */
export function shareVibeSlug(requested: unknown, top: VibeChipId | null): string | null {
  if (isVibeSlug(requested)) return requested;
  return top ? VIBE_SLUGS[top] : null;
}
