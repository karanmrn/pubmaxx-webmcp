# London POI seed notes — 2026-07-08

Research notes for expanding `public/data/london_pois.json` (Wave E).  
**Not scraped dumps.** URLs and themes only — used to shortlist public, well-known places across Greater London. Reddit / X threads are research pointers, never ingested as content.

## Public / official sources (preferred)

| Source | Theme | URL |
| --- | --- | --- |
| Greater London Authority — Open Data | Parks, green space inventories | https://data.london.gov.uk/ |
| TfL Open Data | Stations, piers, river services | https://tfl.gov.uk/info-for/open-data-users/ |
| Historic England — List Entry | Listed buildings / monuments | https://historicengland.org.uk/listing/the-list/ |
| Royal Parks | Central royal parks & gardens | https://www.royalparks.org.uk/ |
| National Trust / English Heritage | Historic houses & gardens in London | https://www.nationaltrust.org.uk/ / https://www.english-heritage.org.uk/ |
| Visit London / London & Partners | Markets, viewpoints, riverside walks | https://www.visitlondon.com/ |
| Wikimedia Commons / Wikidata | Coordinates + freely licensed names | https://www.wikidata.org/ |
| Borough park pages (e.g. Southwark, Hackney, Richmond) | Local parks & commons | Various council sites |

## Community research pointers (notes only — do not scrape)

Themes spotted in public discussion (titles / URLs as bookmarks, no post bodies copied):

| Theme | Example pointer | What we took from it |
| --- | --- | --- |
| Best London viewpoints / hills | Reddit r/london threads on Primrose Hill, Greenwich Park, Richmond Hill, Parliament Hill | Confirm viewpoint POIs already sparse → add hills & rooftop-adjacent public lookouts |
| Hidden parks & commons | r/london / r/CasualUK “underrated parks” threads | Outer-borough greens (Tooting, Streatham already present; add more SE/SW/N commons) |
| Street markets worth a detour | r/londonfood, Visit London market guides | Expand beyond Camden/Borough cluster — Deptford, Greenwich, Broadway, etc. |
| Riverside walks & piers | Thames Path chatter on X / Visit London | More river piers + embankment sights east & west of the existing nine |
| Historic oddities | Historic England “unusual London” lists | Cemeteries, small museums, city churches already strong; fill outer historic houses |

## Authoring rules applied to this seed pass

1. **Schema identical** to existing rows: `{ id, name, category, coordinates: [lng, lat], rank? }`.
2. **Unique ids** — kebab prefix by category (`park-…`, `viewpoint-…`, …).
3. **Greater London bbox** — lng ∈ [-0.5, 0.3], lat ∈ [51.28, 51.72] (same as `__tests__/pois.test.ts`).
4. **Categories targeted this pass:** park, garden, market, historic, viewpoint, sight, river (transport left alone — another agent owns transit merge).
5. **No Reddit/X text** in the JSON — names and coordinates from public gazetteers only.
6. **Demo honesty** — POIs carry no provenance field; they are ambient orientation dots, not sourced heritage claims (those stay in `lib/landmarks.ts`).

## Coverage gaps this pass aims to close

- Viewpoints were thin (5) → add public hills, bridges, and lookouts.
- Gardens thin (5) → add formal / community gardens.
- Markets clustered central → add outer-borough street markets.
- Parks: fill remaining well-known commons and regional parks.
- Historic / sights: outer museums, docks, and riverside landmarks not already listed.

## Out of scope

- Polling Reddit or X APIs.
- Copying user comments into seed files.
- Inventing amenity or opening-hour claims for pubs from social posts.
