# ADR 0013: UK national base map (the third map)

## Status

Accepted

## Context

PubMaxxing already has two product layers:

1. **Curated city packs** (`venues_slim*`) — priced pins, search, filters, crawls
2. **MapLibre / OpenFreeMap basemap** — country-wide roads and terrain

A third layer already ships as data: **UK base pubs** (~38k OSM `amenity=pub`
shards under `public/data/uk_base/`), streamed past zoom 12. What was missing
was treating that layer as a first-class national map experience (search,
locate, pan continuity, honest chrome) rather than a silent backdrop behind
London.

“Like Google Maps” is the wrong bar. Google is neutral full-stack cartography.
We win as a **UK pub night OS**: continuous pan across the country, places you
can type, pubs you can open, prices only when corroborated — never by stuffing
38k unpriced rows into the curated index.

## Decision

**The third map is the UK base pub layer + place index + national browse
intent**, always on the same MapLibre canvas as curated packs.

| Do | Do not |
|---|---|
| Stream base pubs by viewport (`useUkBaseStreaming`) | Merge base rows into `venues_slim*` |
| Search places via `places.json` on map and chooser | Invent geocoder coverage we do not have |
| Search only **resident** streamed base pubs by name | Download all 38k names into search |
| Open uncovered towns via `/map?place=&lat=&lng=` | Market “every UK city priced” |
| Keep z≥12 gate and payload budgets | Colour base pins from uncorroborated prices |
| Suspend base under drink/food lenses | Build a second map engine |

National overview honesty: below zoom 12 the basemap is national but pubs are
intentionally absent (payload contract). UI must say pubs appear when you zoom
in, never that the country is empty of pubs.

## Consequences

- Agents extend streaming, place search, locate, and base-led chrome
- City packs remain the priced product; base remains the canvas
- Attribution stays on the map (`OSM_ATTRIBUTION`)
- Soft-launch London density still comes first for trust; national browse does
  not replace Horizon 0 cohort work
