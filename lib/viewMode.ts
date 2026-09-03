// View Mode (Lock-In / Ledger) — the "dual modes" surface from the For-You map
// PRD (priority 5). This is a pure VIEW LAYER over one data stream: no schema,
// no API, no new data. It composes primitives that already exist:
//
//   • Lock-In — the default for new/young users. Chaos visible, standard type
//     scale, and the feed opens on the complete chronological lane.
//   • Ledger  — the Heritage view for older/low-vision users and anyone who
//     wants the calm read. It turns Legacy Mode ON (reusing the EXACT same
//     html[data-legacy] mechanism + "pubmax-legacy" storage key — we never
//     fork a second accessibility flag), steers venue links toward the Ledger
//     logbook (/ledger/[id]) where that surface is a peer of the map link, and
//     opens the feed on a calmer lane.
//
// The mode is persisted under its OWN key ("pubmax-mode") and applied as
// html[data-mode]. It is deliberately *coupled* to data-legacy: choosing a mode
// also writes the legacy flag, so the whole visual shift comes for free by
// composing the existing token-override layer rather than restyling anything.
// The pre-hydration application of both attributes lives in public/theme-init.js
// (mirroring how data-theme / data-legacy are applied there, no-flash-safe).

export type ViewMode = "lock-in" | "ledger";

/** localStorage key for the persisted view mode. Mirrors "pubmax-legacy". */
export const MODE_STORAGE_KEY = "pubmax-mode";

/** localStorage key Legacy Mode persists under — the flag Ledger composes. */
export const LEGACY_STORAGE_KEY = "pubmax-legacy";

/** The default when nothing is stored: Lock-In (energetic, chaos-forward). */
export const DEFAULT_MODE: ViewMode = "lock-in";

/** The feed lane each mode opens on. Both start with the complete chronological
 *  read so a signed-out first visit cannot land in a misleading personalised
 *  or empty lane. These are existing FeedFilter ids - no new lane is added. */
export const MODE_DEFAULT_LANE: Record<ViewMode, "for-you" | "latest"> = {
  "lock-in": "latest",
  ledger: "latest",
};

/** Narrow an arbitrary value to a ViewMode, or null if it isn't one. */
export function parseMode(value: unknown): ViewMode | null {
  return value === "lock-in" || value === "ledger" ? value : null;
}

/**
 * Resolve the effective mode from stored values. The mode key is authoritative;
 * if it's unset we fall back to the legacy flag (a user who turned Legacy Mode
 * on directly is, in spirit, in Ledger), else the default. Pure — takes the raw
 * stored strings so it's trivially testable without a DOM.
 */
export function resolveMode(
  storedMode: string | null,
  storedLegacy: string | null,
): ViewMode {
  const explicit = parseMode(storedMode);
  if (explicit) return explicit;
  if (storedLegacy === "1") return "ledger";
  return DEFAULT_MODE;
}

/** Does this mode turn Legacy Mode (html[data-legacy="1"]) on? Ledger does. */
export function modeEnablesLegacy(mode: ViewMode): boolean {
  return mode === "ledger";
}

/**
 * Apply a mode to the document: set html[data-mode] and drive the SAME
 * html[data-legacy] attribute LegacyToggle owns (so every existing legacy CSS
 * override composes for free), then persist both under their keys. Defensive:
 * no-ops off the DOM (SSR). This is the single writer used by the nav switch;
 * it mirrors LegacyToggle.toggle()'s DOM+storage shape exactly.
 */
export function applyMode(mode: ViewMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.mode = mode;

  if (modeEnablesLegacy(mode)) {
    root.dataset.legacy = "1";
  } else {
    delete root.dataset.legacy;
  }

  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    localStorage.setItem(LEGACY_STORAGE_KEY, modeEnablesLegacy(mode) ? "1" : "0");
  } catch {
    // Storage denied — the DOM attributes already applied for this session.
  }
}

/** Read the currently-applied mode from the DOM (attribute the no-flash script
 *  or applyMode set), falling back to storage then the default. Used by the
 *  switch to render its current state without a hydration flash. */
export function currentMode(): ViewMode {
  if (typeof document !== "undefined") {
    const attr = parseMode(document.documentElement.dataset.mode);
    if (attr) return attr;
  }
  if (typeof localStorage !== "undefined") {
    return resolveMode(
      localStorage.getItem(MODE_STORAGE_KEY),
      localStorage.getItem(LEGACY_STORAGE_KEY),
    );
  }
  return DEFAULT_MODE;
}

/**
 * Steer a venue link by mode. Ledger prefers the venue's logbook surface
 * (/ledger/[id]) where that's a peer of the map deep-link; Lock-In keeps the
 * map link. A callsite that has both link targets passes them; this just picks.
 * Pure, so a component can use it without any DOM/storage read of its own.
 */
export function venueHrefForMode(
  mode: ViewMode,
  links: { map: string; ledger?: string },
): string {
  if (mode === "ledger" && links.ledger) return links.ledger;
  return links.map;
}
