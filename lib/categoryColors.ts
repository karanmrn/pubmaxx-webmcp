// Category colour system (Epic E5 — "colourful, textured, drink imagery").
// ---------------------------------------------------------------------------
// CANONICAL palette: one accent per drink category, layered ADDITIVELY on top
// of the brass base (brass stays the single brand accent — see
// docs/DESIGN_SYSTEM.md). A category colour identifies a drink family (wine,
// whisky…) the way `--pint`/`--amber`/`--brick`/`--river` are semantic hues,
// not a general-purpose "add colour here" swatch.
//
// This EXPANDS the minimal map E1 seeded (CATEGORY_ACCENT / categoryAccent are
// kept below, unchanged in shape, so the E1 menu keeps importing them) into the
// full light/dark/legacy system with theme-aware CSS-var helpers.
//
// Each category has explicit LIGHT + DARK values, hand-tuned to pass WCAG
// contrast as text/icon on the recessed panel background it sits on:
//   light panel  --panel  #fbf8f0
//   dark panel   --panel  #171712
// Contrast ratios are documented in the token table below and mirrored to CSS
// custom properties (`--cat-wine`, `--cat-whisky`, …) in the appended section
// of app/globals.css. Keep the two in sync: THIS file is the source of truth
// for TS consumers, the CSS block for stylesheet-only consumers.
//
// beer → brass, deliberately: beer maps to the base brass accent so the map's
// cheapest-pint colouring and the beer category read as one identity.

import type { DrinkCategory } from "@/lib/drinks";

export interface CategoryColor {
  /** Light-theme value — passes contrast on the light panel (#fbf8f0). */
  light: string;
  /** Dark-theme value — passes contrast on the dark panel (#171712). */
  dark: string;
  /** Human-facing label. */
  label: string;
}

// The canonical token table. Light/dark values + measured WCAG contrast ratio
// against the panel background each is designed to sit on:
//
//  category   light      ratio  dark       ratio
//  beer       #9a6a24    4.44   #d3a44a    7.86   (== --brass; AA-large / icon)
//  wine       #8a2846    8.00   #e07a97    6.34   burgundy
//  whisky     #985a12    5.20   #e0a34e    8.15   amber
//  gin        #0f7a72    4.89   #4fc9bd    8.92   botanical teal
//  vodka      #2f6f8f    5.22   #7ec4e0    9.30   ice-blue
//  rum        #8a4a24    6.41   #cd8a5a    6.32   mahogany
//  cocktail   #b5493a    4.97   #ef8a6a    7.29   sunset
//  shot       #6a3fb0    6.71   #b28ae8    6.59   electric
//  alcohol-free #176b72  5.47   #67cbd0    9.30   clear teal
//  soft-drink #7a4f00    7.20   #f0b65a    9.37   citrus
//  coffee     #6b3d16    7.80   #d4a06a    7.55   roasted brown
//  other      #5c5347    7.11   #a89e8c    6.79   neutral bark
//
// All light values clear 4.5:1 (WCAG AA normal text) except beer, which is
// pinned to the brass accent (4.44) and used as a large glyph/accent — AA for
// large text (3:1). Legacy Mode swaps in the darkened high-contrast set below.
export const CATEGORY_COLORS: Record<DrinkCategory, CategoryColor> = {
  // beer → brass, on purpose — one identity with the map's cheapest-pint hue.
  beer: { light: "#9a6a24", dark: "#d3a44a", label: "Beer" },
  wine: { light: "#8a2846", dark: "#e07a97", label: "Wine" },
  whisky: { light: "#985a12", dark: "#e0a34e", label: "Whisky" },
  gin: { light: "#0f7a72", dark: "#4fc9bd", label: "Gin" },
  vodka: { light: "#2f6f8f", dark: "#7ec4e0", label: "Vodka" },
  rum: { light: "#8a4a24", dark: "#cd8a5a", label: "Rum" },
  cocktail: { light: "#b5493a", dark: "#ef8a6a", label: "Cocktail" },
  shot: { light: "#6a3fb0", dark: "#b28ae8", label: "Shot" },
  "alcohol-free": { light: "#176b72", dark: "#67cbd0", label: "Alcohol-free" },
  "soft-drink": { light: "#7a4f00", dark: "#f0b65a", label: "Soft drink" },
  coffee: { light: "#6b3d16", dark: "#d4a06a", label: "Coffee" },
  other: { light: "#5c5347", dark: "#a89e8c", label: "Other" },
};

// Legacy Mode / high-contrast overrides live only in the
// `html[data-legacy="1"]` block of app/globals.css — no TS consumer reads
// them, so they are not duplicated here.

// ── Legacy minimal map (E1 compatibility) ────────────────────────────────────
// CATEGORY_ACCENT / categoryAccent are the shape E1's menu already imports.
// Reconciled to the canonical LIGHT values so there is a single source of hue.
// New work should prefer `categoryColor(cat)` (theme-aware CSS var) instead —
// CATEGORY_ACCENT is a flat light-only hex kept for the existing call-sites.
export const CATEGORY_ACCENT: Record<DrinkCategory, string> = Object.fromEntries(
  (Object.keys(CATEGORY_COLORS) as DrinkCategory[]).map((c) => [
    c,
    CATEGORY_COLORS[c].light,
  ]),
) as Record<DrinkCategory, string>;

export function categoryAccent(category: DrinkCategory): string {
  return CATEGORY_ACCENT[category];
}

// ── Theme-aware helpers (preferred for new surfaces) ─────────────────────────
/** The CSS custom-property name for a category (matches the globals.css block). */
export function categoryVar(category: DrinkCategory): string {
  return `--cat-${category}`;
}

/**
 * Theme-aware token reference for inline styles / styled surfaces. Returns
 * `var(--cat-wine)` etc. — resolves to the right light/dark/legacy value
 * automatically via the cascade, so prefer this over a literal hex.
 */
export function categoryColor(category: DrinkCategory): string {
  return `var(${categoryVar(category)})`;
}

export type { DrinkCategory };
