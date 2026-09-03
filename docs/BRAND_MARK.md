# PUBMAXX brand mark

The master mark is **the double-struck X** ("The Crossing X"), owner-approved on
2026-07-22 and stamped across the web and native surfaces plus the dynamic OG
share cards from a single geometry source. It supersedes the earlier "Clink"
(tapered-pint) exploration on those surfaces.

## The story

A confident, clean X built on the X Corp / blackboard-bold (double-struck)
construction: one **thick solid descending stroke** (`\`, top-left to
bottom-right) crossed by an **ascending stroke** (`/`, bottom-left to top-right)
that is **split into two thin parallel strokes** passing either side of the thick
one, leaving a clear channel where they cross. Flat sharp terminals, zero
ornament. Distinctiveness is ours: coral `#ff5a5f` on ink `#060607`, our own
proportions and terminal angles — a similar construction to X Corp's, never a
trace of their asset.

The brand reality the mark answers to:

- **Name**: `PUBMA××ING`. The doubled `××` is the hero of the wordmark
  (`components/brand/PubmaxxWordmark.tsx`; both glyphs now use the master mark
  construction, the second tinted `--brass`).
- **Product**: London pubs, honest prices, night navigation.
- **Tone**: dry London. No kitsch, no foam, no froth.
- **Tokens**: coral `--brass #ff5a5f` + `--brass-bright #ff7a55` (the ember),
  `--ink-deep #060607`, `--paper #fffdf9`.

## Geometry

Drawn on a 64x64 grid, the single source of truth is **`lib/brandMark.mjs`**.
Every stroke is a filled polygon (not a stroked path) so the flat-cut terminals
stay crisp at every raster tier.

Four consumers read those numbers and none of them owns a copy: the in-app
component (`MARK_GEOMETRY` in `components/brand/PubmaxxMark.tsx`), the satori
share cards (`MARK_POLYGONS` in `lib/ogBrand.tsx`), and the two asset
generators. Each used to write the coordinates down itself, which is how the
shipped home-screen icon could drift off the brand with no test failing.
`__tests__/brandIconAssets.test.ts` holds all of them together and fails on a
generator that restates a polygon.

```svg
<!-- bare X (transparent): favicon / PWA "any" icons. No ember on the icon. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <polygon points="42,10 47,10 13,54 8,54" fill="#ff5a5f"/>   <!-- thin / A -->
  <polygon points="51,10 56,10 22,54 17,54" fill="#ff5a5f"/>  <!-- thin / B -->
  <polygon points="9,10 21,10 55,54 43,54" fill="#ff5a5f"/>   <!-- thick \ (on top) -->
</svg>
<!-- tile (app icon / maskable / apple-touch): coral X on the light field.
     The mark is inset to 62% of the tile width; see "Static assets". -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#ffffff"/>
  <g transform="translate(32 32) scale(0.8267) translate(-32 -32)">
    <polygon points="42,10 47,10 13,54 8,54" fill="#ff5a5f"/>
    <polygon points="51,10 56,10 22,54 17,54" fill="#ff5a5f"/>
    <polygon points="9,10 21,10 55,54 43,54" fill="#ff5a5f"/>
  </g>
</svg>
```

- **Thick stroke** (`\`, descending, ~12u wide, drawn on top): `9,10 21,10 55,54 43,54`
- **Thin stroke A** (`/`, upper-left, ~5u): `42,10 47,10 13,54 8,54`
- **Thin stroke B** (`/`, lower-right, ~5u): `51,10 56,10 22,54 17,54`
- **Channel** between the two thin strokes ≈ 4u (where the thick stroke crosses).
- **Simplified slash** (16px raster fallback, replaces the two thins): `45,10 53,10 19,54 11,54`
- **Ember node** (in-app surfaces only, not the icon): circle cx 32, cy 32, r 3.2, fill `#ff7a55`.

## Small-optics rule (16px acceptance bar)

The double-struck read holds down to ~24-32px; below that the ~4u channel between
the two thin strokes closes up. So the **16px member of `favicon.ico` uses the
simplified single ascending slash** (`slashSimple`) plus the thick stroke — a
crisp, unmistakable X at 16px (verified by rendering). `favicon.svg` ("any" size)
keeps the full double-struck construction: on retina tabs it renders at ~32px+
and resolves cleanly; the low-DPI 16px fallback is the `.ico` simplified entry.

## Ember decision

The ember is **not part of the icon silhouette**. On the double-struck crossing
the interlock is already the visual event, and a dot at centre muddies the
channel (verified by rendering). So every static icon export — `favicon.svg`,
`favicon.ico`, `icon-192/512`, maskable, apple-touch — and the native icon/splash
sources drop it. It is kept only on the **lit in-app brand surfaces** as a
personality spark: the `duo`/`plaque` component variants, the Strike pop, the
night seal, the loading ember, and the OG share cards (rendered ≥46px).

## Component

Implemented in `components/brand/PubmaxxMark.tsx`. Three variants, one API:

| variant  | fill                                             | use                                   |
| -------- | ------------------------------------------------ | ------------------------------------- |
| `mono`   | `currentColor` strokes, no ember, transparent    | inline in text, single-colour, stamps |
| `duo`    | coral strokes + coral-bright ember, transparent  | wordmark lockup, on-surface badge     |
| `plaque` | ink-deep tile, coral strokes, coral-bright ember | app icon, avatar, standalone tile     |

```tsx
import PubmaxxMark from "@/components/brand/PubmaxxMark";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

<PubmaxxMark variant="plaque" size={40} title="PUBMAXX" />
<PubmaxxWordmark withMark markVariant="duo" markSize={22} />  // full lockup
<PubmaxxWordmark />                                            // text-only (unchanged)
```

Colours resolve from live theme tokens (`var(--brass ...)`) with literal
fallbacks, so the mark is correct in both light and dark and also renders outside
the app's CSS. `mono` inherits theme ink via `currentColor`.

### Lockup and spacing rules

- **Clear space** between mark and wordmark is `0.42em` of the wordmark size
  (`.pubmaxxLockup` gap). Around the whole lockup, keep clear space of at least
  half the mark height.
- **Minimum sizes**: mark 16px (favicon). Lockup: wordmark at least 14px so the
  `××` glyphs stay legible; below that, use the mark alone.
- Mark and wordmark scale as **one unit**. Never resize one independently.

### Don'ts

- Don't merge the two thin ascending strokes or close their channel (except the
  sanctioned 16px `slashSimple` fallback).
- Don't recolour the strokes outside the token palette (coral / ink / currentColor).
- Don't add the ember to an icon export or small tier.
- Don't rotate, skew, outline-stroke, or drop-shadow the mark.
- Don't stretch. Width and height stay equal.
- Don't place the `duo` or `mono` mark on a low-contrast surface; use `plaque`.
- Don't reintroduce the retired "Clink" tapered-pint arms.

## Static assets

Run `npm run gen:brand-assets` (`node scripts/gen-brand-assets.mjs`); it needs
`sharp` (already a dependency). The script is only the WRITER: what each file is
lives in `lib/brandIconAssets.mjs` as a table of tiers, and
`__tests__/brandIconAssets.test.ts` regenerates that same table in memory and
fails when a committed file no longer matches. Never hand-edit an icon.

**Two fields, one mark.** The LIGHT tile is a white field with the coral mark
and is what every linked icon ships as. The DARK tile is the same mark on
`--ink-deep`. The mark takes **62% of the tile width** on the home-screen and
browser-tab tier, and **54%** on the maskable and monochrome tier, because what
a circular Android mask crops against is the mark's corner distance from centre
rather than its width.

Live under `public/`:

| file | field | tier |
| --- | --- | --- |
| `favicon.svg`, `favicon-x.svg` | light | rounded plaque |
| `favicon-dark.svg` | dark | rounded plaque |
| `favicon.ico` | light | 16 / 32 / 48 members; the 16 takes the simplified single-slash cut |
| `icon-192.svg` / `.png`, `icon-512.svg` / `.png` (+ `icon-x-*`) | light | rounded plaque |
| `icon-dark-192.png`, `icon-dark-512.png` | dark | rounded plaque |
| `icon-maskable.svg`, `icon-maskable-512.png` | light | full bleed, safe zone, opaque |
| `icon-maskable-dark-512.png` | dark | full bleed, safe zone, opaque |
| `icon-monochrome.svg`, `icon-monochrome-512.png` | none | mark on transparency, `purpose: "monochrome"` |
| `apple-touch-icon.png`, `apple-touch-icon-x.png` | light | 180px, full bleed, opaque |
| `apple-touch-icon-dark.png` | dark | 180px, full bleed, opaque |
| `pal/circuit-robin-{32,64,128,512}.{webp,png}` | circuit robin | square mascot renditions |
| `pal/circuit-robin-avatar-{32,64,128,512}.{webp,png}` | circuit robin | circular-avatar-safe mascot renditions |
| `pal/circuit-greyhound-{32,64,128,512}.{webp,png}` | circuit greyhound | square mascot renditions |
| `pal/circuit-greyhound-avatar-{32,64,128,512}.{webp,png}` | circuit greyhound | circular-avatar-safe mascot renditions |
| `pal/circuit-cat-{32,64,128,512}.{webp,png}` | circuit cat | square mascot renditions |
| `pal/circuit-cat-avatar-{32,64,128,512}.{webp,png}` | circuit cat | circular-avatar-safe mascot renditions |

The Pub Pal renditions are the one set here that is not cut from the mark. Each
species that ships a master owns one row in `lib/palMascotAssets.mjs`, and that
row names the same slug as the species' `format` in `lib/pubPal.ts`; a species
absent from the table has no master and every surface draws its layered-SVG rig
instead. Write a set with `node scripts/gen-pubpal-mascot.mjs <species>
<master.png>`, which centre-square crops the master once and writes the four
squares and four circular avatars in webp and png. Masters stay outside the repo.

The `-x` files are byte-identical mirrors, not separate designs. `app/layout.tsx`
links the suffixed paths because a new PATH is the only reliable way to move a
returning browser off a cached retired mark (browsers ignore a `?v=` bust on an
icon). They are generated here, so a linked icon can no longer lag the file it
mirrors. A `public/brand/` reference mirror (plus `mark-mono.svg`) is refreshed
by the same run.

## What iOS honours

Checked 2026-08-10. State it this way and no stronger.

- **The Home Screen icon is `apple-touch-icon`, and it takes no `media`.**
  Whatever that one URL holds is the icon in every appearance. We point it at
  the LIGHT tile. iOS bakes the icon when the web app is added, so an icon
  change reaches an already-installed home screen only when it is re-added.
- **The web app manifest has no dark-icon field.** An `icons` member is
  `src` / `sizes` / `type` / `purpose` and nothing else, so a dark PNG listed
  beside the light one at the same size is not a dark variant, it is a coin toss
  the UA makes in a light context. Our dark tiles stay OUT of the manifest.
- **`purpose: "monochrome"` is the only variant selector the manifest has.**
  Android composites its own field and tint behind it. That is that platform's
  answer to a tinted Home Screen, and we ship it.
- **A `media="(prefers-color-scheme: dark)"` favicon link works** in Chrome and
  Firefox for the browser tab. That is where `favicon-dark.svg` is wired, and it
  is the only place a dark icon of ours is selected.
- **iOS Dark and Tinted Home Screen appearances are applied to a web clip
  without asking us.** There is no web equivalent of a native app's `dark` and
  `tinted` icon slots. Tinted maps the artwork to luminance and paints the
  user's tint over it, so a WHITE-field icon flattens towards a near-uniform
  slab while an INK-field icon keeps a clear mark. The light tile is the
  captain's ruling; flipping the Home Screen to the dark tile is a one-line
  change of the `bleed("light")` apple-touch entry in `lib/brandIconAssets.mjs`.

## Native app icons and splash

`scripts/gen-native-app-icons.mjs` writes the `@capacitor/assets` source images
into `assets/` (coral icon field with the ink X; a light coral splash and a dark
ink splash, mark centred, no ember). The Android adaptive foreground is stamped
at scale 0.8 so the wider X stays inside the 66/108 safe zone. The canonical
stamp step is `npx @capacitor/assets@3 generate`, which fans them into `ios/` and
`android/`.

## OG cards

`lib/ogBrand.tsx` `CrossingMark` draws the double-struck X polygons + the ember
(export name/API unchanged so its ~17 `next/og` consumers — `opengraph-image.tsx`
/ `*-card` routes plus the `app/og.png` route — stay untouched). satori renders
the `<polygon>` subset natively.

## Pending: store-listing masters

The store-listing masters under `public/store-assets/` (rendered by
`scripts/gen-store-assets.mjs`, pinned by `__tests__/storeAssets.test.ts`, issue
#440) still carry the retired Clink polygons and are **out of scope for this
lane**. They need a follow-up pass to the double-struck construction so the App
Store / Play icons match; until then the store icons will lag the web/native/OG
surfaces.
