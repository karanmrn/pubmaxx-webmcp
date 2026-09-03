# PUBMAXXING design system

**North star: "Nights Out With Friends."** PubMax is a map-first crawl planner
for Saturday with your mates — candle-table planning by day, street-amber
energy by night. Strategic context lives in root `PRODUCT.md`; the visual
spec (Impeccable / Stitch format) lives in root `DESIGN.md`. This document
remains the engineering token guide for `app/globals.css` + `app/theme.css`.

## Locked color decision (Phase 0 → Phase 3)

Explored in [`docs/design-explorations/`](./design-explorations/README.md).
**Ship A for light, B for dark — not a blend.**

| Theme | Direction | Thesis |
|---|---|---|
| **Light (default)** | **A Candle Coral** | Warm peach paper + coral Plan CTA (`--brass` ≈ `#ff5a5f`) |
| **Dark** | **B Night Out** | Deep ink + coral CTA (`--brass`) + amber route (`--night-amber`) + pint neon go - **no purple glow** |

Field Guide jobs retained: `--river` / `--pint` / `--brick` stay semantic for
pins and prices. Coral owns the primary CTA in both themes; amber stays a
transport and price signal.

Pointers: [`PRODUCT.md`](../PRODUCT.md) · [`DESIGN.md`](../DESIGN.md) ·
[`docs/design-explorations/`](./design-explorations/).

This document describes the token scale, type pairing, and pressed-ink
tactility that make that thesis hold. It **extends** the existing system in
`app/globals.css` (tokens, light theme) and `app/theme.css` (dark theme
overrides + shared theme-toggle chrome) — nothing here forks or replaces those
files, and every token that existed before this pass still resolves under the
same **name** (values may retune within the A/B decision).

## Where things live

| File | Owns |
|---|---|
| `PRODUCT.md` | Strategic brief: vocabulary, A/B lock, taste dials, anti-refs |
| `DESIGN.md` | Impeccable visual spec (colors, type, components, do/don't) |
| `app/globals.css` | `:root` token definitions (light/default values), sheet material, resets, shared press feedback, and the pressed-ink utility |
| `app/theme.css` | `html[data-theme="dark"]` token overrides, dark-first sheet material, Plan CTA contrast, theme-toggle |
| `app/layout.tsx` | `next/font` wiring — loads the three type-trio fonts as CSS variables on `<html>` |
| `lib/springMotion.ts` + `lib/useSpringValue.ts` | Interruptible spring integration, reduced-motion jumps, and React animation ownership |
| `components/map/canvas/` + `lib/mapBasemapTaste.ts` | Scene marks and label ink read live tokens; the map-owned basemap palette and label hierarchy stay in `lib/mapBasemapTaste.ts` |

If you're adding a new component: reach for a token below before writing a
literal value. If the token you need does not exist, add it to the theme source
first, then document its non-obvious role here.

The map has a deliberate style-layer contract. Dark mode uses a neon-noir
near-black field with slate water and restrained roads; light mode uses warm
paper land with quieter washes. Pub marks lead the hierarchy: basemap pub POI
labels are prominent, generic venue-label layers receive the same priority,
neighbourhood labels are smaller and quieter, and road labels remain
contextual. This pass changes palette and label paint/layout
only; it does not add `pubs-hero-glow` or `pubs-confidence-ring` layers. The
implementation and absence checks live in `lib/mapBasemapTaste.ts` and
`__tests__/mapSymbolCollision.test.ts`.

## Colour

### Palette roles

DOM token values and the deliberate map/root versus DOM/body split live in
`app/globals.css` and `app/theme.css`. Map style-layer values and derivations
live in `lib/mapBasemapTaste.ts`; the stable token roles are:

| Token family | Role |
|---|---|
| `--ink`, `--ink-soft`, `--muted` | primary, secondary, and tertiary text |
| `--line`, `--line-soft`, `--hairline` | map-aware and DOM structural edges |
| `--paper`, `--panel`, `--panel-raised`, `--panel-overlay` | page-to-overlay elevation ladder |
| `--ink-deep` | inverse and stamp-dark chrome |
| `--brass`, `--brass-bright` | Plan CTA and identity accent |
| `--brass-accessible` | login primary only - deepened coral that carries a white label at AA |
| `--pint`, `--amber`, `--brick` | price and status semantics |
| `--river`, `--river-bright` | heritage and by-water information |

**One accent owns the CTA in both themes.** Coral (`--brass`) carries actions;
amber (`--night-amber`) stays a route and price signal. Every other hue (`pint` / `amber` /
`brick`, `river`) is a semantic status/category colour — don't reach for them
to "add colour" to something that isn't a price band or a heritage/by-water
marker.

### Semantic roles (new — additive aliases)

Raw palette tokens describe *hue*; semantic tokens describe *job*. New work
should prefer the semantic name so a future palette change (e.g. retuning
`--brick`) propagates without hunting down every consumer:

```
--color-accent            → var(--brass)
--color-accent-strong     → var(--brass-bright)
--color-positive          → var(--pint)
--color-caution           → var(--amber)
--color-negative          → var(--brick)
--color-info              → var(--river)
--color-info-strong       → var(--river-bright)
--color-surface           → var(--paper)
--color-surface-panel     → var(--panel)
--color-surface-raised    → var(--panel-raised)
--color-surface-inverse   → var(--ink-deep)
--color-text              → var(--ink)
--color-text-soft         → var(--ink-soft)
--color-text-muted        → var(--muted)
--input-placeholder       → var(--muted)
--color-border            → var(--line)
--color-border-soft       → var(--line-soft)
```

### Text on painted fills

A handful of places set text colour on an **accent fill** (a brass button or
gradient, an ink-deep button, a photo-caption scrim) rather than a page
surface. Use these roles instead of a raw hex. Regular brass brightens in dark
mode, so its text role flips with the theme; inverse, strong-accent, and photo
fills keep fixed text colours. Exact values live in `app/globals.css` and
`app/theme.css`.

```
--color-on-accent          theme-aware text on regular brass
--color-on-inverse         cream text on solid ink-deep
--color-on-accent-strong   dark text on coral or brass-bright
--color-on-photo           white text on a photo-scrim overlay
```

The `/login` primary and the magic-link button are the one coral fill that
carries a **white** label (`--color-on-photo`). They paint `--brass-accessible`,
a deepened coral, because `--brass` under white is below AA. It is not a second
site-wide primary: the landing hero CTA and the map's sanctioned coral marks
stay on `--brass` with dark ink. `app/globals.css` owns the rationale beside the
token, and `__tests__/loginPage.test.ts` holds both states to 4.5:1.

## Type

### The trio

| Role | Typeface | Variable | Why |
|---|---|---|---|
| Display | **Space Grotesk** (variable weight, 300–700) | `--font-display` (aliased by `--serif`) | A modern geometric grotesque with a **very large x-height**, chosen for a Gen-Z-native voice. The big x-height keeps capitals and lowercase close in size, so there is little caps-contrast and headlines read confident and current rather than shouty. Its quirky terminals give it character without tipping into gimmick. This **supersedes the earlier Fraunces "field-guide serif"** thesis — the brand is now a display sans, not hand-set serif. Open-licence, self-hosted via `next/font/google` (no external request, no layout shift). |
| Body | **Inter** | `--font-body` | Already the app's body face — kept deliberately. Inter is neutral and extremely legible at small UI sizes (panel copy, chip labels), which is exactly what a body face should be: carry the display face's personality without competing for it. |
| Data | **JetBrains Mono** | `--font-data` | Prices, stats, route metrics. A monospace gives numerals a "stamped ticket / till receipt" character that Inter's tabular figures don't — it's a deliberate second texture, not just a bolder body font. Paired with `font-variant-numeric: tabular-nums` so columns of numbers align. |

All three are loaded once in `app/layout.tsx` via `next/font/google` and
exposed as CSS variables on `<html>`, so `globals.css`/`theme.css` and any
component reading `var(--serif)`, `var(--font-body)`, or `var(--font-data)`
picks them up automatically — no per-component font imports.

`--serif` is kept as a permanent alias for `--font-display`: every existing
`h1`/`h2`/`h3`/`.eyebrow`/card-title that already reads `var(--serif)` now
renders in Space Grotesk with zero changes to those components. The variable
name is historical (it's a sans now, not a serif) — it's kept only so the swap
touches one place, not ~40 call-sites.

### Caps policy — stamps only

Display type is set in **sentence case**, not all-caps. Eyebrows, section
titles, stat labels, and column headers were previously `text-transform:
uppercase` with wide tracking; that tracking existed to make all-caps legible,
and the caps themselves fought Space Grotesk's low caps-contrast. They are now
sentence case with tight tracking (~`0.01em`), sized up slightly to hold the
hierarchy the tracking used to carry.

**Uppercase is reserved for stamps** — small bordered/filled pill chips and
badges that read as a pressed mark rather than prose. These keep their caps as
a deliberate ink-stamp idiom:

- provenance / era chips (`.provChip`, `.claimEra`, `.ledgerProvenance`)
- honesty + demo badges (`.exampleTag`, `.demoDataNote span`, `.feedFilterDemo`)
- pill kicker/badge chips (`.curatedBadge`, `.goldenKicker`, feed status chips)
- the passport-stamp kicker (`.passportKicker`, set in the mono data face)

If a label is plain text with letter-spacing (an eyebrow, a section title, a
stat `dt`), it is sentence case. If it's a chip with a border/fill that reads
as a stamp, it may keep caps.

### Type scale

```
--text-2xs   0.68rem     eyebrows, micro-labels
--text-xs    0.76rem     chip/tag text
--text-sm    0.85rem     secondary body copy
--text-base  1rem        default body
--text-md    1.16rem     h3 / card titles
--text-lg    1.42rem     h2
--text-xl    1.74rem     h1 / section heroes
--text-2xl   2.13rem     page-level display
--text-3xl   2.6rem      landing hero only
```

```
--leading-tight   1.12   display headlines
--leading-snug    1.35   card copy
--leading-normal  1.5    body paragraphs
--tracking-tight  -0.01em  large display type (Space Grotesk headlines)
--tracking-wide   0.05em   legacy; sentence-case labels now use ~0.01em
--tracking-wider  0.08em   legacy (all-caps titles are retired — see caps policy)
```

Shared type-role utilities live in `app/globals.css`. High-impact surfaces use
those roles or a local responsive clamp where the layout needs one; new type
decisions should extend the same hierarchy rather than add another peer-sized
heading.

### Data/tabular utility

```css
.font-data,
.tabular-data {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}
```

Opt-in class for anything migrating to the full "stamped ticket" numeral
treatment. Existing price displays that only set
`font-variant-numeric: tabular-nums` (without the mono face) are untouched —
adding the class is optional, additive polish.

## Spacing, radius, shadow

```
--space-1 … --space-12   4px base scale (4/8/12/16/20/24/32/40/48)
--radius        8px      default corner (cards, inputs)
--radius-sm     6px      tight corner (chips, small controls)
--radius-lg    18px      sheets / bottom-drawer corners
--radius-pill 999px      pills, avatar-style chips
```

### Shadow: night bloom (dark) vs paper-lift (light)

`--shadow` is the same variable in both themes but tuned to a different
*feeling*, not just a darker version of itself:

- **Light (`app/globals.css`)** — soft warm paper-lift over Candle Coral paper
  (coral-tinted, not cool lavender).
- **Dark (`app/theme.css`)** — deeper drop **plus a faint amber bloom** (Night
  Out street light) — never purple mesh/glow.

`--shadow-sm` follows the same day/night pairing for smaller elements.
`--shadow-inset-press` is the inset "pressed" shadow shared by both themes
for the pressed-ink utility (see below) — it flips its highlight edge (cream
in light, amber in dark) so the letterpress effect reads correctly against
either surface.

### Edges: the de-box rule

**Borders are for inputs. Fills are for selection. Hairlines are for
structure. Nothing else gets an edge.**

A border is a strong signal, so it has one job: it says "type into me" or
"pick from me". Anything that is not an input earns its grouping some other
way, and the choice is made in this order:

1. **A fill.** This is how selection reads. A selected control takes
   `--panel-raised` with `--ink` text; an unselected one takes no fill at all
   and `--muted` text. Never invert that: an unselected control drawn louder
   than the selected one tells the eye the wrong thing.
2. **A hairline.** `--line-soft` divides list rows and separates the segments
   inside one control. A group of segments wears at most ONE edge, around the
   group, never one per segment.
3. **Spacing.** A heading with controls under it is already a section. It does
   not need a card.
4. **Nothing.** Most containers are in this row.

Coral (`--brass`) is not a selection colour. It belongs to the primary CTA,
the selected pin ring, and at most a 2px underline on an active tab. See
DESIGN.md, The One Accent Rule.

Two traps this repo has hit:

- **This app ships no Tailwind preflight.** A `<button>` with no explicit
  `border`/`background` inherits the user agent's `2px outset buttonborder` on
  `buttonface`. Every new button primitive must set `border-0 bg-transparent`
  at its base, or it draws the heaviest chrome in the app for free.
- **The global `:focus-visible` rule sets `border-radius: var(--radius-sm)`.**
  A round control has to restate its own radius on focus, or it squares off the
  moment it is focused. Prefer `outline-offset: -2px` on anything already
  inside a bordered group, so focus marks the control rather than building a
  second shape around it.

`__tests__/deBoxSegmentedControl.test.ts` pins the segmented-control half of
this. Origin: design judgement 2026-08-01, findings 2.4, 2.5, 2.13 and 2.16.

### Sheet material

Sheets and drawers use one translucent neutral material over the map, with
layered micro-shadows and a solid fallback for reduced transparency, increased
contrast, or missing backdrop-filter support. `app/globals.css` and
`app/theme.css` own the material roles; map and mobile sheet styles only consume
them. This is a functional depth cue for movable overlays, not permission to
add decorative glass elsewhere.

## Motion

CSS duration and easing tokens in `app/globals.css` own hover, focus, ambient,
and pointer-down feedback. They do not own sheet travel.

`lib/springMotion.ts` owns bounded spring integration and momentum projection.
`lib/useSpringValue.ts` owns animation frames, interruption, retargeting,
cleanup, and reduced-motion jumps. Phone sheets animate real height to preserve
sticky-footer geometry; tablet drawers use vertical translation; wider desktop
drawers use horizontal translation. Direct drag remains one-to-one and release
velocity carries into the settling spring.

Shared non-map press feedback is a low-specificity base layer. Components with
their own positioning transform keep local ownership and neutralise the shared
scale through the documented custom-property seam in `app/globals.css`.

## Stacking (z-index)

Never write a literal `z-index` in app/component CSS — use the semantic ladder
defined in `:root` in `app/globals.css` (`--z-float` 50 → `--z-overlay-top`
1300, with the map's internal ladder `--z-map-base` 450 … `--z-map-toolbar`
560 in between; see the token block for the full list with per-token comments).
Each token's value equals the literal it replaced, so adopting one is never a
stacking-order change. If two overlays must NOT tie, they get separate tokens
(e.g. `--z-map-route-chip` 540 sits under `--z-map-chip` 541; `--z-map-suggest`
512 under `--z-map-banner` 515). Component-internal stacking (0–20, local
stacking contexts) stays as literals.

**Rule:** CSS animation belongs behind the reduced-motion media contract in
`app/globals.css`; JavaScript animation must read the same preference and jump
to its target. Static price-stamp tilt is a shape, not travel, and remains
visible in reduced motion.

## Pressed-ink / bar-mat tactility

The price stamp, provenance chips, and vibe tags should feel like something
**physically stamped** - pressed ink on a bar mat - not a generic rounded
badge. `app/globals.css` owns the utility and plaque roles.

`components/PriceBadge.tsx` owns the DOM price signature. Feed, borough,
venue, mobile peek, and recap surfaces compose that component instead of
restating its border, surface, type, or tilt. MapLibre cannot render the DOM
component, so `components/map/canvas/tokens.ts` resolves the same plaque roles
and `buildScene.ts` applies them inside the existing collision-indexed symbol
layers.

Word-based provenance and vibe chips may use the flat pressed treatment, but
the tilt remains price-only.

## The signature element

**One thing held with restraint: the brass price stamp.** It's the only
place the press-tilt (`.ink-stamp--tilt`) treatment should appear. The
candle-lit map is the second memory hook (see `components/map/canvas/`), but it is a
*mode*, not a stampable UI element, so it doesn't compete with the price
stamp for the "one signature" slot.

Do not add a second tilted/stamped element elsewhere in the UI. If a new
surface needs emphasis, reach for the brass border/accent colour, not a
second signature gesture.

## Day/night coherence

Both themes flip from the same token names — `app/theme.css` only
overrides values inside `html[data-theme="dark"]`, never introduces new
variable names. The map token reader in `components/map/canvas/tokens.ts`
reads current computed values for semantic scene marks and label ink. The
basemap style-layer palette remains deliberately map-owned in
`lib/mapBasemapTaste.ts`, where the dark and light map contracts stay together.

This pass audited `app/globals.css` and `app/theme.css` for literals that
bypassed this: it found six repeated instances of hardcoded cream/dark text
sitting on solid brass/ink-deep fills (now `--color-on-accent` /
`--color-on-inverse` / `--color-on-accent-strong`), and two card gradients
(`.writerCard`, `.landlordAnswer`) whose end-stop was a fixed light-cream hex
that would have gone bright and jarring against the dark theme's charcoal
surfaces — both now resolve via `--surface-tint-river` /
`--surface-tint-brass`, `color-mix()`-derived from `--panel-raised` so they
stay in the current theme's tonal range automatically.

One legend swatch (`.mapLegend span`) keeps a fixed light-mode ink colour by
design — the legend chip's background is intentionally always a light,
translucent card (readable pinned over the map basemap in both themes), so
its text should not flip dark.

## Do / don't

**Do**

- Reach for a semantic token (`--color-accent`, `--color-positive`, …) before
  a raw palette token, and a raw palette token before a literal hex.
- Use `--font-display`/`--serif` for headlines and brand marks,
  `--font-body` for everything else, `--font-data` for prices/stats.
   the `--ink-stamp-*` tokens for the pressed-ink utility.
- Route new CSS and JavaScript animation through the reduced-motion owners
  described above.
- Add a new token to the theme source before inventing a one-off value.

**Don't**

- Don't introduce a second accent hue. Brass is the accent; `pint`/`amber`/
  `brick`/`river` are semantic, not decorative.
- Don't use gradients as decoration — the two gradients in this codebase
  (`.writerCard`, `.landlordAnswer`) are subtle, single-hue surface tints, not
  a visual flourish; don't add a rainbow/hero gradient elsewhere.
  Authored Pub Pal materials are the narrow exception: a gradient may model
  chrome, glass, or hologram depth inside the character portrait only. It must
  use one Signal affinity plus semantic surface tokens and must never become a
  page, card, button, or navigation background.
- Don't add decorative glassmorphism. Translucency is limited to movable
  sheets/overlays and narrow functional floating chrome.
- Don't add a second tilted/stamped signature element — restraint is the
  point.
- Don't hardcode a hex value in a component that already has a token for that
  role; if no token fits, propose one here first.

## Category colour & drink imagery (Epic E5)

The "site looks plain" fix, held to the same token discipline — **additive
colour, not a repaint**. Brass is still the one brand accent; the category
colours identify a *drink family* the way `--pint`/`--amber`/`--river` are
semantic hues, not a licence to paint any surface. If you're not showing a
drink category, don't reach for a `--cat-*` token.

### Category colour tokens

One accent per drink category, defined as CSS custom properties in the E5
append-only block at the end of `app/globals.css`, mirrored in
`lib/categoryColors.ts` (the source of truth for TS consumers). Each has an
explicit light + dark value, hand-tuned to pass **WCAG contrast as text/icon
on the recessed panel** (`--panel`: `#fbf8f0` light / `#171712` dark):

| Token | Light | ratio | Dark | ratio | Hue |
|---|---|---|---|---|---|
| `--cat-beer` | `#9a6a24` | 4.44\* | `#d3a44a` | 7.86 | brass (== the base accent) |
| `--cat-wine` | `#8a2846` | 8.00 | `#e07a97` | 6.34 | burgundy |
| `--cat-whisky` | `#985a12` | 5.20 | `#e0a34e` | 8.15 | amber |
| `--cat-gin` | `#0f7a72` | 4.89 | `#4fc9bd` | 8.92 | botanical teal |
| `--cat-vodka` | `#2f6f8f` | 5.22 | `#7ec4e0` | 9.30 | ice-blue |
| `--cat-rum` | `#8a4a24` | 6.41 | `#cd8a5a` | 6.32 | mahogany |
| `--cat-cocktail` | `#b5493a` | 4.97 | `#ef8a6a` | 7.29 | sunset |
| `--cat-shot` | `#6a3fb0` | 6.71 | `#b28ae8` | 6.59 | electric violet |
| `--cat-alcohol-free` | `#176b72` | 5.47 | `#67cbd0` | 9.30 | clear teal |
| `--cat-soft-drink` | `#7a4f00` | 7.20 | `#f0b65a` | 9.37 | citrus |
| `--cat-other` | `#5c5347` | 7.11 | `#a89e8c` | 6.79 | neutral bark |

\* beer is pinned to the brass accent (one identity with the map's
cheapest-pint hue), so it's AA-large / icon (3:1) rather than AA-normal. Use it
as a glyph or large accent, not small body text.

**Legacy Mode** gets a darker (light theme) / brighter (dark theme)
high-contrast set via the `html[data-legacy="1"]` overrides in the same block —
the tokens flip automatically, no consumer changes.

### Drink imagery — licence-safe, our IP

Per-category glyphs are **original SVG line-art** authored for this repo
(`components/drinks/icons/*.tsx`): a pint glass, wine glass, whisky tumbler, gin
balloon, rum snifter, vodka shooter, cocktail coupe, shot glass, a zero-sealed
pint for `alcohol-free`, a straw-and-citrus tumbler for `soft-drink`, and a
generic bottle for `other`. They stroke with `currentColor` on a shared 32×32
viewBox, so they stay crisp from 16px to 128px and take the category colour from
whatever sets `color`.

**Licence rule for any future raster imagery:** do NOT scrape or embed
copyrighted photos. Any bitmap must be **CC0 / public-domain**, credited in the
provenance the same way drink prices are (source + licence + observedAt). Until
then, the SVG glyphs are the drink imagery — they're ours, so there's no licence
risk.

### How to opt in (adoption guide)

Other surfaces stay opt-in — this pass ships the *system*, glyphs, and a
showcase; it does not recolour existing feed/map/ledger panels (that's
codex-collision territory).

1. **A single category glyph, correctly themed:**

   ```tsx
   import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
   <DrinkGlyph category="wine" size={40} title="Wine" />   // labelled
   <DrinkGlyph category="gin" />                            // decorative
   ```

   `DrinkGlyph` colours itself from `var(--cat-*)` (light/dark/Legacy all
   handled). Pass `inheritColor` to draw in the parent's `currentColor` instead
   (e.g. inside a mono chip that already sets the colour).

2. **A category accent in CSS** — reference the token, never a literal hex:

   ```css
   .menuSection[data-category="whisky"] .sectionRule { color: var(--cat-whisky); }
   ```

   Or from TS via `categoryColor("whisky")` → `"var(--cat-whisky)"`.

3. **The whole palette at a glance** — drop the showcase on a menu header /
   discover surface:

   ```tsx
   import { CategoryShowcase } from "@/components/drinks/CategoryShowcase";
   <CategoryShowcase title="Every drink, every colour" />
   ```

4. **Paper/linen texture** — add the `.textured-panel` class to a NEW surface
   you own (a card, a header). It lays a ~4% brass-tinted linen weave in a
   `::before` (multiply in light, screen in dark), never intercepts pointer
   events, and self-disables under Legacy Mode / forced-colors. Keep it subtle —
   texture, not noise — and do **not** retrofit it onto existing panels codex may
   be editing.

**Don't:** don't recolour prices, statuses, or heritage markers with a
`--cat-*` token (those own `--amber`/`--pint`/`--river`); don't apply a category
colour to something that isn't a drink category; don't add a second texture
pattern or bump the linen opacity into "pattern" territory.
