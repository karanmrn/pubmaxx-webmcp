# Map chrome tiers — target architecture + adoption notes

From the #352 systemic review: at full merge the 390px map was headed for seven
peer chips — instrument-panel, not answer. This branch implements the
three-tier hierarchy on main. `lib/mapChromeTiers.ts` is the single source of
truth; the shell renders its descriptors.

| Tier | Surface | Treatment |
|---|---|---|
| 1 | **Near me** | The only primary-weight chip (`.mobileMapChipPrimary`, filled accent); on phone a round map-edge FAB |
| 2 | **Filters** | Quiet icon-button in the one top bar. Absorbs drinks + price + zone + venue-type toggles; refinement count is the badge |
| 3 | **TfL** | Compact 44px icon-button in `.mobileMapUtilityCorner` (fixed, right edge, badge-capable). **List view** lives in the Layers sheet shortcut grid. |

**Tonight cold-start (P5):** when `whatsOnTonight.rows.length > 0`, a measured
`.mobileMapTonightChip` docks under the bar (not a sixth bar slot) and opens
`overlay: "tonight"` in one tap. `buildTonightChip` in `lib/mapChromeTiers.ts`
owns the model. More → Events, Layers → On tonight, and the tab bar remain
homes. Quiet nights omit the chip. The plan pill and tab bar stay outside this
hierarchy. Mobile map action geometry belongs to
`components/mobile/mobileMapShell.css`.

## Narrow desktop state

Tablet and narrow-desktop widths use a contained toolbar rather than squeezing
the complete desktop accessory row. City, search, and Plan remain available;
conditions, zone, and the other desktop extras stand down so the toolbar stays
inside the viewport and clear of the Tonight Arc. The media queries in
`components/map/mapToolbar.css` and `components/map/citySwitcher.css` own the
exact boundary and layout.

## Adoption notes for in-flight branches (mechanical rebases)

- **#309 near-me sheet** (`feat/instant-answer`): its Near-me chip behavior
  replaces `onNearMe`'s recenter-only success with the answer sheet — keep the
  Tier-1 chip mount exactly as here (`.mobileMapChipPrimary`), wire its sheet
  open into the existing `onNearMe` callback. No new chip.
- **#329 zone lens** (`feat/zone-price-lens`): do NOT mount the Zone chip on
  mobile. The zone picker already renders inside the mobile filters sheet on
  that branch — that becomes its only mobile home. Add `zoneActive` as a third
  refinement input to `buildFiltersChip` (one-line: extend the input type and
  the count/aria parts). Desktop toolbar chip unchanged.
- **#346 list view** (`fix/a11y-findings`): mount the List toggle inside the
  Layers sheet's `.mobileLayerShortcuts`, reusing its existing handler; drop its
  standalone placement and keep `.mobileMapUtilityCorner` reserved for TfL.

## Props change (shell)

`MobileMapShell` now takes `drinkFiltersActive` + `priceCapActive` instead of
the combined `filtersActive`; `priceLabel` stays (feeds the Filters aria label
and the sheet). `PubMap.tsx:1611` splits its existing boolean — no logic change.
