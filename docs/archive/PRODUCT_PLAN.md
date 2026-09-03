# PubMaxing Product Plan

> **Superseded** — see docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md and cc_plan.md

PubMaxing is a London pub discovery and crawl-design app. It helps people understand what London has to offer by combining pint prices, venue character, map exploration, travel constraints, and user visit reports.

## Product Wedge

Every map can show where pubs are. PubMaxing should show which pub night is worth having.

The first product wedge is a map-led crawl planner:

- Show London pubs on a beautiful interactive map.
- Let users filter by price, venue type, amenities, and area.
- Generate a crawl route from 4-7 crawl stops.
- Score routes by price, walkability or tube access, venue heritage, amenities, and user preference.
- Let users report pint prices, beer quality, amenities, and visit notes after going.

## Claude PRD Assessment

Claude's PRD is strong for a one-day demo, especially the emphasis on a visual map, live price logging, and one memorable setting filter such as "by the water".

The main change for this repo is sequencing. We already have an app-ready venue dataset with pint prices and coordinates, so the first build should start from that dataset. Overpass, water proximity, park proximity, hygiene ratings, and Supabase should become enrichment layers after the first map and crawl experience works.

## MVP Slice 1

Build a local, dataset-backed web app:

1. App-ready JSON exported from `data/pint_prices_app_dataset.csv`.
2. Full-screen London map with venue price markers.
3. Search and filters:
   - area or venue search
   - maximum pint price
   - crawl style
   - amenities such as beer garden, live sports, food, cocktails
4. Venue detail popup with price, address, borough, amenities, and source quality notes.
5. Crawl suggestion panel with 4-7 stops selected from filtered venues.

## MVP Slice 2

Add route intelligence:

- Walking-distance scoring using straight-line distance as a first approximation.
- Tube-distance mode as a later enrichment once station data is added.
- Route Window controls for 15, 20, and 30 minutes.
- Route scoring based on cheapness, venue variety, amenities, and distance.

## MVP Slice 3

Add community loop:

- Visit Report form.
- Pint Price update form.
- Beer Quality score.
- Amenity confirmation.
- "Visited Venue" user state.

## Data Approach

Use `data/pint_prices_app_dataset.csv` as the app seed dataset. It already dedupes source rows into one app-friendly table while preserving source flags and data quality notes.

Use these fields first:

- `pub_name`
- `pint_name`
- `price_gbp`
- `address`
- `latitude`
- `longitude`
- `primary_borough`
- `boroughs_visible`
- `food`
- `cocktails`
- `beer_garden`
- `live_sports`
- `live_music`
- `pub_quiz`
- `darts`
- `pool`
- `website`
- `image_url`
- `description`
- `data_quality_notes`

## Near-Term Non-Goals

- User accounts.
- Friend graph.
- Production moderation.
- Real tube routing.
- Full London "places of interest" beyond venues.
- Live price freshness guarantees.

## Key Product Decision

PubMaxing should not compete with Google Maps as a generic directory. It should compete as a curated pub-night planner: price-aware, map-led, and emotionally tuned to the kind of night the user wants.
