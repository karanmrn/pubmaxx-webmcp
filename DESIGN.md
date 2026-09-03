---
name: PUBMAXX
description: Nights-out-with-friends crawl planner — Candle Coral light, Night Out dark
colors:
  ink: "#17171a"
  ink-soft: "#3f3f46"
  muted: "#666670"
  line: "#e2e0e3"
  line-soft: "#ece9eb"
  paper: "#f8f2ec"
  panel: "#eee7df"
  panel-raised: "#fdf9f4"
  ink-deep: "#0b0b0d"
  brass: "#ff5a5f"
  brass-bright: "#ff7a55"
  pint: "#18a76d"
  amber: "#f2a71b"
  brick: "#ff5a5f"
  river: "#2864d8"
  river-bright: "#29b6f6"
  night-paper: "#0a0a0b"
  night-panel: "#141416"
  night-panel-raised: "#202024"
  night-amber: "#f0a01a"
  night-pint: "#5fb389"
typography:
  display:
    fontFamily: "Space Grotesk"
    fontWeight: 700
    lineHeight: 1.12
  body:
    fontFamily: "Inter"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "JetBrains Mono"
    fontWeight: 700
rounded:
  sm: "6px"
  md: "8px"
  lg: "18px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
---

# Design System: PUBMAXX

## 1. Overview

**Creative North Star: "Nights Out With Friends"**

PUBMAXX is a map-first crawl planner that should feel like planning Saturday with your mates - warm candle paper by day, street-amber energy by night. The UI serves the product: Plan, Stop, Venue, Friend, Route. Brand moments (display type, coral CTA) punch through; chrome stays calm enough to navigate under street light or kitchen lamp.

Light theme ships **Direction A Candle Coral** (warm peach paper + coral Plan CTA). Dark theme ships **Direction B Night Out** (deep ink + coral Plan CTA + amber route + pint neon go). Field Guide hues (`river` / `pint` / `brick`) keep semantic jobs for pins and prices - they do not steal the primary CTA.

This system explicitly rejects purple-glow SaaS dark, cream+terracotta DTC defaults, card-dashboard first viewports, and Inter-as-display. Explorations live in `docs/design-explorations/`; strategic context in `PRODUCT.md`; implementation tokens in `app/globals.css` + `app/theme.css`.

**Key Characteristics:**

- One coral accent owns Plan hierarchy in both themes
- Map plane is the hero surface; sheets support the Plan
- Semantic roles over decorative rainbow
- Space Grotesk display + Inter body + JetBrains Mono data
- Taste dials: variance ~5, motion ~4–5, density ~6 (product register)

## 2. Colors

Candle Coral neutrals by day; Night Out ink by night. Coral stays primary in both themes and semantic colours stay named.

### Primary

- **Candle Coral** (`#ff5a5f` / `--brass`): Plan CTA, selection, active accent in both themes. Legacy token name `--brass` - keep the name so `readTokens()` and existing components keep working.
- **Coral Hover** (`#ff7a55` / `--brass-bright`): Louder warm hover / marker lift on Plan actions.
- **Night Amber** (`#f0a01a` / `--night-amber`): Dark-theme route and price energy. Plan actions stay coral.

### Secondary (semantic — not decoration)

- **Pint Go** (`#18a76d` light / `#3dff9a` dark / `--pint`): Cheap pint / positive / neon-go on night.
- **Lager Caution** (`#f2a71b` / `--amber`): Mid price / caution.
- **Brick Dear** (`#ff5a5f` family / `--brick`): Expensive / destructive — same coral family as light CTA, but job is price/danger, not Plan.
- **River Info** (`#2864d8` / `--river`): Heritage / by-water / tube-blue info.

### Neutral

- **Candle Paper** (`#f8f2ec` / `--paper`): Light page base with a candle tint, not flat cream `#F4F1EA`.
- **Candle Panel** (`#eee7df` / `--panel`): Recessed panel.
- **Raised** (`#fdf9f4` / `--panel-raised`): Cards, inputs.
- **Neutral Ink** (`#17171a` / `--ink`): Primary text on paper.
- **Neutral Line** (`#e2e0e3` / DOM `--line`): Quiet structural hairline.
- **Night Ink Paper** (`#0a0a0b` / `--paper` dark): Deep nightlife base.
- **Night Chrome** (`#141416` / `#202024`): Dark panel / raised.

### Named Rules

**The One Accent Rule.** Coral owns primary CTA and Plan selection in both themes. Amber stays a route and price signal; pint, river, and brick never decorate chrome that isn’t a price band, heritage marker, or status.

**The No Purple Glow Rule.** Dark theme uses ink + amber bloom + pint neon only. No purple mesh, violet gradients, or grape bloom behind surfaces.

**The Candle Not Cream Rule.** Light paper stays peach-warm (`#fff1e6` family). Avoid generic warm-cream DTC (`#F4F1EA` + terracotta + serif display).

## 3. Typography

**Display Font:** Space Grotesk (with system sans fallback) — via `--font-display` / legacy alias `--serif`
**Body Font:** Inter (with system sans fallback) — `--font-body`
**Label/Mono Font:** JetBrains Mono — `--font-data`

**Character:** Confident geometric display with a big x-height; neutral body that doesn’t compete; mono stamps for prices and route metrics.

### Hierarchy

- **Display** (700, `--text-xl`–`--text-3xl`, tight leading): Brand mark, page heroes — sentence case.
- **Headline** (700, `--text-lg`–`--text-xl`): Section titles.
- **Title** (600–700, `--text-md`): Card / stop titles.
- **Body** (400–500, `--text-base` / `--text-sm`): Panel copy, stop meta.
- **Label / Stamp** (700 mono or caps chip): Price stamps and provenance chips only — uppercase reserved for stamps.

### Named Rules

**The Inter-Is-Body Rule.** Inter is never the display face. Space Grotesk (or an intentional display substitute documented here) owns headlines.

**The Caps-Are-Stamps Rule.** Sentence case everywhere except bordered/filled stamp chips.

## 4. Elevation

Hybrid: light theme uses soft paper-lift shadows; dark theme uses deeper drop plus a faint warm amber bloom so chrome feels lit, not merely dimmed. Map floating chrome uses solid night panels (no frosted glass wash).

### Shadow Vocabulary

- **Paper lift** (light `--shadow`): Soft warm-tinted lift over candle paper.
- **Night bloom** (dark `--shadow`): Deep black drop + amber glow (`rgba` warm, never purple).
- **Pressed ink** (`--shadow-inset-press`): Letterpress inset for `.ink-stamp`.

### Named Rules

**The Flat-Chrome-On-Map Rule.** Floating map controls are solid `--panel-raised`, not glassmorphism.

**The Sheet-Material Exception.** Movable sheets and drawers may use the shared
neutral translucent material because it communicates depth over the map. They
must use the solid reduced-transparency and increased-contrast fallback.

## 5. Components

Tactile and decisive — Plan actions read louder than chrome.

### Buttons

- **Shape:** Pill (`--radius-pill` / 999px) for Plan; default radius 8px for standard controls.
- **Primary (`.planBtn`):** Coral gradient `var(--brass)` → `var(--brass-bright)` in both themes, with fixed dark label ink for AA contrast.
- **Hover / Focus:** Accent border or glow ring; focus-visible outline 2px accent.
- **Active Plan:** Ink-deep treatment for “planning” state (existing `.planBtn.active`).

### Chips

- **Style:** Hairline border, optional brass/pint/river tint by job.
- **Stamps:** `.ink-stamp` pressed border + inset shadow; tilt is price-only.

### Cards / Containers

- **Corner Style:** 8px default; 18px sheets.
- **Background:** `--panel` / `--panel-raised` — cards only when they contain interaction (stop list, controls). No decorative card grids in the hero.
- **Border:** `--line` hairlines.

### Inputs / Fields

- **Style:** Raised surface, soft line border, 8px radius.
- **Focus:** Coral accent ring (`--brass`).

### Navigation

Quiet accent hover on icons; floating theme toggle as raised pill on map. Mobile tab bar uses solid night panel in dark.

### Map (signature)

Full-bleed map plane with colored pins (pint / amber / brick / river by semantics) and route stroke in theme accent. `readTokens()` in `components/map/canvas/tokens.ts` supplies semantic mark and label colours. `lib/mapBasemapTaste.ts` owns the map style-layer palette and pub-first label hierarchy; do not duplicate those values elsewhere.

## 6. Do's and Don'ts

### Do:

- **Do** use coral `--brass` for Plan CTAs in both themes (`#ff5a5f` family).
- **Do** use Night Out deep ink with amber route energy in dark (`#f0a01a` / `--night-amber`).
- **Do** keep `--pint` / `--river` / `--brick` on pins and price semantics.
- **Do** keep existing token names (`--brass`, `--paper`, …) so map `readTokens()` keeps working.
- **Do** put brand + one Plan CTA + map in the first viewport hierarchy — see explorations README.

### Don't:

- **Don't** ship purple glow / mesh SaaS dark (no violet nebula, no grape bloom stacks).
- **Don't** default to cream DTC (`#F4F1EA` + terracotta + serif display).
- **Don't** build card dashboards or equal feature-card grids in the first viewport.
- **Don't** use Inter (or Roboto / Arial / system) as the display/hero face.
- **Don't** blend A’s coral paper with B’s neon and C’s river accents in one theme.
- **Don't** put floating promo badges or sticker chips on the map hero.
