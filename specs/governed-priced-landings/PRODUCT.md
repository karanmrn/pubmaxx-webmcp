# Governed priced landings

Two crawlable page families answer one question from PUBMAXX Pint Price
evidence: what a named beer costs, and what it costs in one part of London.

- `/drink/{brand}` - cheapest listed pints of one brand across London.
- `/area/{area}/drink/{brand}` - the same question inside one Night Area.

## Held: `/area/{area}`

The area landing page itself is NOT published. Captain decision, 2026-08-15: it
duplicates `/borough/{slug}`, which is already linked from the borough index,
the Pint Index league table and the site footer, and two crawlable
"cheapest pints in X" families would compete for one canonical. The path
segment exists only as the parent of the brand-by-area page, so `/area/clapham`
answers 404 and nothing links to it, advertises it or breadcrumbs to it. The
brand-by-area page's parent crumb is the brand's own London page.

## What a page may claim

- Every figure comes from the exact price row that owns it.
- The publisher label and link come from that same row through
  `namedLegacyPintPriceSource`. A row with no publisher reads
  `Publisher not recorded` and carries no link.
- `PINT_DATASET_OBSERVED_AT` prints once as shared collection context. It is
  never described as live, current, updated, or a per-row observation.
- The count says how many pubs cleared the floor, and discloses the cap
  ("Showing 20 of 347 pubs") whenever the page prints fewer than it counted.
- Nothing here is a community submission, and nothing here reaches map
  authority. Community prices still travel through identity, corroboration,
  freshness and moderation.

## Which pages exist

- Brands come from `DRINK_BRANDS.beer`. Areas come from `NIGHT_AREAS`.
- A brand page needs 20 pubs with a valid matching row. A brand-by-area page
  needs 10.
- One pub counts once, at its own cheapest matching row.
- Only pub venue kinds, only finite positive prices.
- Ranked cheapest first, then pub name, then pub id. At most 20 rows printed.
- Anything unpublished is a 404 with `noindex, nofollow` metadata, absent from
  static params and absent from the sitemap.

## Where the page sends a reader

- `/drink/{brand}` primary: `/map?brand={brand}`. `decodeDrinkLens` already
  fills the category from the brand, and `PubMap` excludes beer from the
  selected lens, so `?drink=beer` would not select a lens.
- `/drink/{brand}` secondary: `/map?sel={venueId}&brand={brand}&log=1`, because
  `log=1` arms the composer for a RESOLVED venue and has nothing to open without
  one.
- `/area/{area}/drink/{brand}` primary: `/map?sel={cheapest venueId}&brand={brand}`.
  Never `?q={area name}`: `q` is a free-text venue filter, so an area name
  narrows the map to whatever pubs happen to carry those words, and
  "Piccadilly & Soho" matches none.
- A `sel` names only a pub the MAP can open. The slim index is sharded and the
  map loads the eager core shard first, so the London brand page's log arrival
  takes the cheapest row inside that shard, which is not always rank 1, and the
  brand-by-area page's arrivals keep their own row or drop `sel`. With no such
  pub, and with an eligibility read that could not answer, the link carries the
  brand alone rather than naming a pub the map would discard. The ranked list
  itself never moves for a link.
- The WORDS follow that same decision. The brand-by-area arrival says "Open the
  cheapest {area} pint on the map" only while it names a pub, and says "Find
  {brand} on the map" when it does not, because a brand-only href is London, not
  the area. One decision answers both (`pricedLandingAreaMapCta`), so the two
  cannot drift.
- Each row: its own `/ledger/{venueId}`, and on the brand-by-area page its own
  log arrival (`pricedLandingLogCta`). "Log this price" only while the href
  names that pub; otherwise "Log a {brand} pint price".
- `/drink/{brand}` lists the published `/area/{slug}/drink/{brand}` siblings
  for that brand, so the pair family is not sitemap-only.

## Surface

- One H1, one immediate `From {price}` answer, the publisher status, the count
  and the collection date, all above the fold at 320, 390 and 430 CSS pixels.
- One cheapest-first list. The rank is presentational: the ordered list already
  carries position, and a name on a bare span is dropped by assistive tech.
- A row prints its own drink tag, title-cased when the dataset shouted it. The
  known all-caps beer tokens (IPA, NEIPA and the rest) keep their capitals.
- Every action is at least 44 by 44 CSS pixels and shows visible focus.
- No horizontal page scroll. Light and dark use existing tokens.
- Bottom padding carries `env(safe-area-inset-bottom)`, so phone navigation
  cannot cover the last row.

## Rejected

- A page for every borough: borough membership is broader than night-out
  intent and would multiply weak pages.
- Publishing thin combinations to grow URL count.
- Any figure derived rather than read from a row.
