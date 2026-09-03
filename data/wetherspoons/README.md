# J D Wetherspoon pub directory (first-party)

Scraped via **Firecrawl** from the official WP REST API:

`https://www.jdwetherspoon.com/wp-json/wp/v2/pubs`

## What we have

| File | Purpose |
|------|---------|
| `pubs.geojson` | Same pins as a FeatureCollection for map overlays |
| `facilities.json` / `region.json` / `pub_status.json` | Taxonomy lookups |

`pubs.json` (normalised directory, 824 pubs: name, address, lat/lng, phone,
hours, facilities, booking/hotel links) has a single committed home:
`public/data/wetherspoons/pubs.json` — that's the path the app fetches at
runtime, so there is no duplicate copy here. `pubs.geojson` is still published
to both locations for the map overlay.

## Provenance (non-negotiable)

This is **scraped/observed** first-party directory data — it is **never**
presented as community-contributed data. Mirroring the app-wide
`{source, observedAt}` invariant, every pub in `pubs.json` carries:

- `source`: `{ label, url, licence }` (the WP page it was read from), and
- `observedAt`: ISO-8601 timestamp of the scrape.

The GeoJSON features carry `source` + `observedAt` in their properties, and
both files carry a top-level `provenance` block (`kind: "scraped-directory"`).

## Data integrity

- **824 pubs**; all coordinates are finite and in `[lng, lat]` order.
- Coverage: UK (England/Scotland/Wales/NI/Isle of Man) + Republic of Ireland,
  plus **2 legitimate Spanish airport bars** (Alicante, Barcelona-El Prat).
- **1 corrected coordinate**: *The William Chambers* (Edinburgh, `EH1 1HU`)
  had a sign-flipped longitude (`+3.19099`, landing in the North Sea). Its
  latitude and postcode unambiguously confirm Edinburgh, so the sign was
  corrected to `-3.19099`. The correction is recorded in `pubs.json` `notes`.
- No malformed / dropped rows.

## What we do **not** have (honest)

Per-pub **food/drink item prices are not published on the website**.

- `/pub-menus/{slug}/` pages link to a **chain-wide** table-menu PDF (no extractable per-pub prices).
- `pub-menus` WP REST `acf` is empty.
- Live prices sit in the Order & Pay mobile app backend — out of scope (we do not reverse private APIs).

`menuPricesAvailableOnWeb` is always `false` on each pub until a first-party priced feed appears.

## Refresh

Requires `FIRECRAWL_API_KEY` in `.env` (gitignored). Direct curl to the WP API is Cloudflare-cached; Firecrawl scrapes bypass that.

```bash
set -a; source .env; set +a
node scripts/fetch_wetherspoons_pubs.mjs
```
