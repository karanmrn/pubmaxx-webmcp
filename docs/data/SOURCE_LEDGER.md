# Source ledger

Operating ledger for every densification ingest path. Wave S3 of
[`docs/plans/FIRST_PRINCIPLES_OUTINGS.md`](../plans/FIRST_PRINCIPLES_OUTINGS.md).

A source may only write what this table allows. Social listening is research only:
it may never write into `community_prices`. Private app reverse-engineering is
refused. Open Pubs may be evaluated against identity; it does not auto-merge into
`venues_slim`.

## Hard refusals (all sources)

| Temptation | Why refused |
|---|---|
| Scrape X / Instagram / TikTok for prices | ToS, brittle, unverifiable; not a price authority |
| Reverse Wetherspoons Order & Pay (or any private chain app) | Private backend; first-party web fence only (`lib/wetherspoons.ts`) |
| Dump WhatPub / Untappd / Tripadvisor catalogues | Proprietary volunteer/commercial IP; not open data |
| Social vibes into pin colour or cheapest buckets | Breaks provenance monopoly |
| Invent prices to fill empty coffee / food / AF views | Empty stays explicit |

## Priority table

| Priority | Source | Licence posture | Repo status | May write | Explicit refusals |
|---|---|---|---|---|---|
| P0 | Community submit + corroboration | Drinker-attributed; signed-in handle + stable actor | Shipped (`lib/communityPrice.ts`, `/api/price-submit`) | `community_prices` (and venue-signal rows on the same table) after rate limits; map paint only when corroborated | Anonymous threshold auto-hide; social-scraped figures; client-supplied corroboration counts |
| P0 | Curated London slim index | Hand-curated product index; OSM-derived rows carry ODbL via map attribution | Shipped (`venues_slim*.json`, `scripts/build_slim_index.mjs`) | Product pins, search, filters, crawl routing | Merging UK base or Open Pubs in automatically; treating demo seed as a labelled claim on the pin figure |
| P0 | OSM UK base shards | © OpenStreetMap contributors, ODbL 1.0 | Shipped (`public/data/uk_base/`, `scripts/build_uk_base_shards.mjs`) | Unpriced base pins + provisional community marks only | Prices, bands, pin labels, Pint Index, merge into curated slim |
| P0 | OSM UK venue packs + London venue shards | © OpenStreetMap contributors, ODbL 1.0 | Shipped (`data/osm/uk/uk_osm_venues_*.json`, `public/data/london_venues/`, `scripts/fetch_uk_osm_venues.mjs`); taxonomy in [`VENUES.md`](../../data/osm/uk/VENUES.md) | Kind-tagged presence rows (name, address, position, kind) on the shards; `/near?mode=desk` also reads `public/data/london_desks/desks.json` wifi / laptop / hours | Prices, bands, pin labels, cheapest buckets, Pint Index; occupancy / seat counts; merging into `venues_slim` or `uk_base`; inferring a kind from a name, a chain or a postcode |
| P1 | FSA hygiene open data | FSA open API / FHRS terms; keyless `x-api-version: 2` | Shipped (`lib/foodHygiene.ts`, `/api/hygiene`) | Hygiene badge context on the venue sheet (matched by postcode + fuzzy name) | Invented ratings; using hygiene as price or vibe authority |
| P1 | Open Pubs (FSA-derived CSV) | Open data derived from FSA FHRS + ONS Postcode Directory (OGL for ONS; FSA terms for ratings source). See [getthedata.com/open-pubs](https://www.getthedata.com/open-pubs) | Evaluation scaffold only (`scripts/lib/openPubs.mjs`, `scripts/evaluate_open_pubs.mjs`). Docs: [`OPEN_PUBS.md`](./OPEN_PUBS.md) | Dry-run match reports against curated / OSM identity. No production merge by default | Auto-merge into `venues_slim`; inventing prices; treating club/bar rows as priced pubs |
| P1 | Tavily official-site enrichment | Robots-aware; each priced row carries named publisher URL + licence tag | Shipped scripts (`scripts/enrich_city_pubs_tavily.mjs`) | Official-site menu / price candidates when extractable and attributed | Ignoring robots; writing unattributed prices; competitor scrape disguised as enrichment |
| P1 | Chain first-party pages (Greene King, Nicholson’s, MBPLC, Wetherspoons web, …) | First-party site terms + robots; Firecrawl harvest lanes where approved | Partial (`scripts/firecrawl_*`, `lib/wetherspoons.ts`, drink-price refresh) | Priced rows only when the page really yields them; identity / menu links when not | Reverse Order & Pay or any private app API; faking Wetherspoons per-pub web prices |
| P2 | Ticketmaster / Skiddle | Official APIs; Ticketmaster Discovery free tier; Skiddle needs commercial OK for commercial use, and its credit needs name + logo + event link | Shipped (`scripts/whatson/eventsRefresh.mjs`, `lib/events/liveProvider.ts`, `GET /api/out`, `/out`). Skiddle stays fenced off until the approval and the logo both land | Tonight / what’s-on `event` rows with deep links and a source credit; a ticket price only on the /out card, worded “Tickets from £X” | Using events as prices anywhere else; permanent TM cache; Skiddle commercial use without written approval or without its logo on screen |
| P2 | Context.dev registered venue-events pages | First party only: allowed `venue-events` rows in `lib/harvest/sourcePolicy.ts` (`contextDevEventSources()`), each with its own robots decision and the day it was checked. An extract call hands a whole page to a model, so a `nonFirstPartyException` source is refused outright | Shipped (`lib/contextDev.ts`, `lib/events/contextDevProvider.ts`, `scripts/whatson/eventsRefresh.mjs`); keyless it is `not-configured`. Lane and budget: [`LONDON_HARVEST.md`](../LONDON_HARVEST.md) | What's-On `event` rows with a source credit and a link out; a date-only listing carries `startsDate` and no clock time | Any URL not in the source table; a price claim of any kind; inventing a start time the page does not state |
| P2 | Common (`common-social.com`) | Not first party. Read as a named exception in `lib/harvest/sourcePolicy.ts` (`common-social-posts`): robots allows the sitemap, and no commercial-use bar is stated. Captain 2026-08-16 | Shipped (`scripts/whatson/commonRefresh.mjs`); 1 request per second, a UA naming PUBMAXX and the public contact, and a per-run fetch cap | Facts only plus a link out: the `og:title`, and place + date from the `og:description` prefix. A post publishes no clock time, so the row states a date and says so | Storing or rendering the description text or the names inside it; reading any page the sitemap does not list; any price claim |
| P2 | Historic England / Wikipedia citations | NHLE open data; Wikipedia CC BY-SA + citation | Shipped (heritage listings, Wikipedia integrate dry-run paths) | Heritage facts / listed-building badges when match is conservative | False-positive listing badges; scraping WhatPub “heritage” as if open |
| P3 | Licensed social firehoses / brand APIs | Only with an explicit licence / API agreement | Not started (research only) | Curation queue leads (“go check this pub”) for humans | **Not a write path to `community_prices`**; no pin paint; no automatic price rows |
| P3 | Pub-landlord partnerships | Contracted official menu feeds | BizDev, not scrape | Official attributed menu / price feeds once contracted | Scraping a partner’s back office; silent re-licence of their feed |

## Operating model

1. **Identity first.** Match every candidate to a curated id or `venue-uk-*`. No orphan price rows.
2. **Official before social.** First-party and open registers before any listening channel.
3. **People close the loop.** Corroboration remains the paint gate for community authority.
4. **Publish what failed.** If a web surface has no price (Wetherspoons today), say so; do not fake rows.

## Related docs

- Open Pubs dry-run: [`OPEN_PUBS.md`](./OPEN_PUBS.md)
- UK base delivery: [`public/data/uk_base/README.md`](../../public/data/uk_base/README.md)
- Event API research: [`docs/EVENT_SOURCES_RESEARCH_2026-07-18.md`](../EVENT_SOURCES_RESEARCH_2026-07-18.md)
- Voice / disclosure: [`docs/VOICE.md`](../VOICE.md)
