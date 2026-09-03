# Fold-ready harvest stats

Built: 2026-08-28. Passes: pubs search enrich 38215/38484, bars 6892/6892, OSM-website `/contents` 9628.

Captain rules applied: name and town must both match before lore is kept. Website and menu URLs must be https. Social observations are excluded.

Identity is OSM id. Name is not a key.

## Universes

| Set | Count |
|---|---:|
| Pub seed | 38484 |
| Bar seed | 6892 |
| Union of OSM ids | 45376 |

## Pass outcomes (raw observations, before the fold gate)

| Pass | Rows written | Rows with any observation |
|---|---:|---:|
| Pubs search enrich | 38215 | 2443 |
| Bars search enrich | 6892 | 6892 |
| OSM-website `/contents` | 9628 | 8293 |

## Match gate (lore)

Final accepted history rows: 5472.

The fold applies current contiguous venue-name and town matching, then keeps at
most one passing history observation per OSM id. The `Matched lore` count below
is the final overlay row unit used for reconciliation.

## Fold-ready overlay (`overlay.jsonl`)

16416 rows. A row exists only when at least one usable enrich field survives the gates.

| Field | Rows | Share of 38484 pubs |
|---|---:|---:|
| Overlay row (any usable field) | 16416 | 42.7% |
| https website | 15088 | 39.2% |
| https menu URL | 3137 | 8.2% |
| Matched lore | 5472 | 14.2% |
| Social | 0 | 0.0% |

`sources[]` holds the https URLs that back the kept website, menu, and lore fields.
Seven website observations contain comma-separated namesake HTTPS URLs. The
fold keeps those observations for reconciliation, but serving omits them from
CTAs because they are not single valid URLs.
