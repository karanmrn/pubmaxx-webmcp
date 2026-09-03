# PRD: UK map coverage, Wikipedia POIs, and intentful search

> Status: DRAFT execution + direction (2026-08-08).
> Sibling: `SOCIAL_NIGHT_OS_VISION_PRD.md`, Social Launch PRD.
> Laws: root `CLAUDE.md` (two pub layers; never merge UK base into
> `venues_slim*`), `docs/VOICE.md`, ODbL attribution on the map.

## Why we build

Drinkers already pan a UK map with ~38k OpenStreetMap pubs, but search only
matches curated London rows plus **resident** base shards. Typing "Philharmonic
Dining Rooms" from Brighton while looking at London currently fails. Boroughs
like Hackney are under-represented in the priced curated index relative to OSM
presence. Famous places deserve Wikipedia-grounded history on the sheet, and
the basemap should keep reading like a real city (pitched 3D buildings from the
vector style), not a flat sticker map.

This wave makes search country-wide and intent-aware, seeds Wikipedia/Wikidata
enrichment for notable pubs and POIs, and sets the honest path for denser
London bar coverage - without scraping Reddit or inventing prices.

## What already ships (do not rebuild)

| Asset | Count / behaviour |
| --- | --- |
| UK base OSM pubs (`amenity=pub`) | ~38,215 streamed shards |
| UK place gazetteer (`places.json`) | Town/city/suburb fly targets |
| Curated London slim index | ~1,997 priced/product venues |
| Heritage cache + Landlord | Wikipedia/Wikidata/seed facts per pub name |
| Map search suggest | Areas, boroughs, curated pubs, UK places, resident base pubs |

Gaps this PRD closes first: **national pub name search**, **query intent**,
**durable search telemetry**, **notable Wikidata/Wikipedia seed**, roadmap for
**amenity=bar densification** and a **POI overlay**.

## Anti-goals (law)

1. Do not scrape Instagram, Reddit, TripAdvisor, or logged-in third-party sites.
2. Do not merge UK base pubs into `venues_slim*` or invent `cheapestPrice`.
3. Do not treat Wikipedia prose as a price or access fact.
4. Do not ship a 2 MB national index to every phone; national pub search is
   server-side.
5. Do not claim Google-Maps building footprints as our dataset; pitched MapLibre
   buildings come from the basemap style we already pitch.

## Honest data path

| Need | Source | Licence |
| --- | --- | --- |
| Every UK pub pin | OSM Overpass → UK base shards | ODbL (map attribution) |
| Famous / listed pubs | Wikidata (CC0) + enwiki sitelink | CC0 facts; Wikipedia text CC BY-SA |
| Sheet history blurb | Wikipedia REST `page/summary` via heritage | CC BY-SA credit |
| Monuments / POIs | Wikidata `P625` + heritage designation | Same split as pubs |
| London bars densify | OSM `amenity=bar` (future fetch) | ODbL |

Fame proxy: Wikidata pub with English Wikipedia article and coordinates - not
a popularity scrape.

## Work packages

### WP1 - Search intent classifier (S) - this PR

`lib/mapSearchIntent.ts` labels a query as one or more of:
`borough` | `city` | `area` | `uk_place` | `venue` | `unknown`, with ranked
candidates. Pure, tested. Feeds the API and the suggest panel group order.

### WP2 - National UK pub search API (L) - this PR

- Builder: `scripts/build_uk_pub_search_index.mjs` from `data/osm/uk/uk_osm_pubs.json`
  → `data/generated/uk_pub_search.json` (server-only compact tuples).
- Reader: `lib/ukNationalPubSearch.server.ts` (in-memory, fail-soft).
- Route: `GET /api/map-search?q=` returns intent + national base pub hits.
- Tracing: declare pack in `lib/venueIndexTracing.mjs`.
- Client: MapSearchSuggest fetches when the deferred query is long enough;
  selection flies + opens the unverified sheet (same as resident base).
- Hook into `npm run build:uk-base`.

### WP3 - Supabase search events (S) - this PR

Migration for `map_search_events` (intent primary, result counts, hashed IP
optional via existing patterns, no free-text query stored - store normalised
length + intent only, or a short hash). Analytics event
`map_search_ran` with low-cardinality props. Privacy notice only if practice
changes beyond hashed/ephemeral; prefer PostHog consent-gated event first and
durable rows only when Supabase is configured.

### WP4 - Wikidata notable pubs seed (M) - this PR

`scripts/fetch_wikidata_notable_pubs.mjs` pulls UK pubs with enwiki + coords
into `public/data/wikidata_notable_pubs.json` (CC0 ids + labels + coords +
wiki title); the artifact is generated on demand and is not shipped in the repo.
Heritage / future POI layer can join on name or QID. ODbL map
layer stays OSM; the artifact does not become priced pins.

### WP5 - London amenity=bar densification (L) - follow-up

Extend UK/London OSM fetch taxonomy to `amenity=bar` (and optionally
`biergarten`) for Greater London first, rebuild shards, keep unpriced base
semantics. Outer London seed already has ~145 bars for curation matching only.

### WP6 - Wikipedia POI overlay (L) - follow-up

Separate map source for monuments / listed buildings / famous restaurants with
Wikidata QIDs - marks and sheet blurbs only, never pint authority. Join to OSM
via `wikidata=*` where present.

### WP7 - Curated borough fill (ongoing)

Promote high-signal base pubs in under-filled boroughs (Hackney, Tower Hamlets
/ Poplar, Lambeth / Clapham) into the slim index only when a real price or
editorial row exists - promotion needs stable `venue-uk-*` aliasing
(`public/data/uk_base/README.md`).

## Performance bar

- Map search keystrokes stay on `useDeferredValue`; national fetch aborts on
  newer queries; CDN-cacheable GET with short `s-maxage` for identical `q`.
- National index loads once per lambda instance.
- No full 38k pack in the browser.

## Demo gates

1. From a cold London view, type a Manchester / Liverpool notable pub name →
   national hit → fly → unverified sheet.
2. Type `Hackney` → intent `borough` (or area) ahead of random pub substrings.
3. Type `Sheffield` → UK place / city path still works.
4. Keyless: API answers from the generated index without Supabase.

## Captain questions

1. Store durable `map_search_events` in Supabase in v1, or PostHog-only until
   volume justifies the table?
2. Include `amenity=bar` in the next full UK Overpass pull, or London-only first?
3. POI overlay on by default at high zoom, or opt-in Layers control?
