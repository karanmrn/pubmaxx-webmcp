# Map Markers Plan — Drink Icons Dominate

**Branch:** `cursor/nights-out-ui-fdb7`  
**Skills:** use product register under `skills/` (Impeccable / Layers); do not invent a London MCP.

---

## 1. Problem diagnosis

Map density constants are owned by [`components/map/canvas/buildScene.ts`](../components/map/canvas/buildScene.ts). See the density-contract entry in [`AGENTS.md`](../AGENTS.md) before changing them.

On Discover, ranked lists (city rivalry, tonight) use bold red/brass rank circles (`.leaderboardRankNum`, `.tonightRank`) that compete with content.

Champagne maps to the **wine** drink-pin kind (no separate champagne glyph).

---

## 2. Visual changes

| Surface | Change |
|--------|--------|
| **Clusters** | Keep radius and text compact so density stays visible without oversized discs. Fill meaning belongs to the live Map key and `clusterCircleColorExpr`; density must not change that colour meaning. |
| **Unclustered pubs** | Keep drink silhouettes as the primary marker language; ensure icon scale stays readable without oversized pads. |
| **Discover ranks** | Shrink rank circles (~18–20px), soften fill; number secondary to pub/city name. |

Touch points: [`components/map/canvas/buildScene.ts`](../components/map/canvas/buildScene.ts) (cluster paint + source options), `lib/mapBasemapTaste.ts` (`clusterCircleColorExpr` if needed), `app/discover/discover.css`.

---

## 3. Flow fixes

1. **City rivalry → preferred city + fit bounds**  
   Rivalry row links (`CityRivalryTable` → `cityMapShareUrl`) should also persist preferred city (`lib/cityPreference`) and land the map with bounds fit for that city — not a London-centric default when the user picked Glasgow/Manchester/etc.

2. **Drink chips → matching shapes**  
   Discover category cards deep-link via `exploreHref` (`?drink=`), and chip landing must leave the drink lens active rather than a sea of mixed clusters. What `drink=` and `brand=` actually do to the map has since moved on from this plan: the live contract is `parseDrinkCategoryParam` / `MAP_LENS_DRINK_CATEGORIES` ([`lib/drinkBrands.ts`](../lib/drinkBrands.ts), [`lib/drinks.ts`](../lib/drinks.ts)), summarised in the URL-param table of [`docs/MOBILE_FLOW_SPEC.md`](./MOBILE_FLOW_SPEC.md) §3 and pinned by [`__tests__/categoryShowcaseLens.test.ts`](../__tests__/categoryShowcaseLens.test.ts). Read those, not this line.

---

## 4. London / TfL note

**No London MCP** in the cloud agent catalog — do not invent or wait on one.

Reuse existing integration only:

- `/api/last-train` for last-train guidance  
- `tfl_lines.json` + TfL icons already registered in `lib/mapIcons.ts` (`ns: "tfl"`) and drawn in `PubMapCanvas`

Transport layers stay wayfinding chrome; they must not outshine drink pins.

**Pint-drops / Supabase:** `/api/pint-drops` returning 503 in local or prod when Supabase is required is separate infra — do not fake drops or invent a London MCP substitute for community prices.

---

## 5. QA flows (browser)

1. Open `/map` at the default city zoom - clusters are compact and their price meaning is available in the Map key; zoom in until drink silhouettes dominate.
2. Apply beer / wine / cocktail / spirits filter — pins match silhouettes; champagne venues show wine.  
3. Discover → city rivalry row (non-London) → map opens that city, preferred city set, camera fits bounds.  
4. Discover → drink chip → map with drink filter on and matching shapes visible.  
5. Discover rankings — rank numerals small, names primary.  
6. Spot-check TfL / last-train still works; no London MCP dependency.

---

## 6. Success criteria

- At city overview zoom, price-coded clusters stay compact while radius and the centre count carry density.
- Drink silhouettes are the memorable map language once zoomed or filtered.  
- Discover ranks are quiet ordinals, not big red badges.  
- Rivalry and drink chips land on the right city + filter with shapes that match intent.  
- London transit continues via existing TfL paths only.
