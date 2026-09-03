# ADR 0010: Community price trust model

## Status

Accepted

## Context

Signed-in users submit community prices for drinks at pubs. The map uses these
prices to colour pins, rank list rows, and fill cheapest-price buckets. A
submission needs a trust policy before it can move the map.

Two risks drive this policy. First, one bad actor could submit false prices
and repaint pubs across the whole map. Second, a price can go stale. A pub
changes its prices over time, so an old report is no longer evidence about
tonight.

The policy must also protect a separate promise: a submission always appears
on the pub's own price sheet, dated, from the moment a user submits it. The
sheet is not gated. Only the MAP is gated.

## Decision

**Corroboration threshold.** A community price needs two independent
submitters before it can drive the map. The constant
`COMMUNITY_PRICE_CORROBORATION_THRESHOLD` (`lib/communityPrice.ts`) sets this
value to 2. `isCorroborated` reads a price's stored `corroborations` count
against this threshold. The count is derived at read time. The store never
stores it and never accepts it from a client.

**Max-age window.** A community price loses its hold on the map after 30
days. The constant `COMMUNITY_PRICE_MAX_AGE_MS`
(`lib/communityPrice.ts`, set to `30 * DAY_MS`) defines this window.
`isWithinMaxAge` checks a price's `submittedAt` timestamp against this
window. Past the window, the map falls back to the scraped baseline or a
Pint Drop. The price sheet keeps the row. The observation was true. It is
no longer evidence about tonight.

**The `drivesMap` gate.** One function decides whether a price may move the
map: `drivesMap` (`lib/communityPrice.ts`). It returns true only when a
price is both corroborated and inside the max-age window. Every map
surface that reads community prices calls this one gate. The price sheet
does not call it, because the sheet's promise is different: it shows every
submission, dated, and explains its standing next to it.

**Visibility versus authority.** These are two separate questions, and the
policy answers them apart.

- VISIBILITY: the pub's own price sheet shows a submission immediately.
  This is ungated. A first in-window pint report also marks its pin with a
  provisional badge. `provisionalCommunityPriceVenueIds`
  (`components/map/communityPriceSignals.ts`) computes this badge set. It
  is ungated too: a set of venue IDs, never a `VenueSignal`.
- AUTHORITY: pin colour, list rows, and cheapest-price buckets require the
  `drivesMap` gate to pass. `mergeCommunityPriceSignals`
  (`components/map/communityPriceSignals.ts`) is the one function that
  merges a corroborated, in-window price into the map's `VenueSignal` data.
  It calls `drivesMap` before it merges anything.

A UK base-layer pin (an unpriced pub) can earn the same provisional mark
through its own read path, but that mark is the only thing a base pin can
ever earn. It never gets a price band, a cheapest price, a pin label, or a
place in the Pint Index, no matter how many corroborations arrive.

The type `CommunityPriceMapReach` (`lib/communityPrice.ts`) names a
surface's exact promise about a price: `"paint"`, `"mark"`, or `"page"`. No
surface may describe its promise as a plain boolean.

**Hide, never delete.** A reader flags a wrong price with
`POST /api/price-submit { action: "report" }`. Reporting never auto-hides a
row. Only a moderator can hide a row, through
`app/api/admin/community-prices` (`GET` lists rows for review; `POST` takes
action `"hide"` or `"restore"`). Hiding never deletes the underlying row.

One filter enforces this everywhere: `freshestPerCategory`
(`lib/communityPriceStore.ts`). When a row is hidden, this filter drops it
from the price sheet, the corroboration count, and the map candidate pool,
all at once. Restoring a row reverses all three together.

**No-alcohol prices.** `lib/drinks.ts` owns the closed drink taxonomy. Every
new category needs a matching database migration, because the taxonomy is
mirrored by database CHECK constraints. Soft-drink and alcohol-free reports
pass through the same corroboration and age gates as beer. They never gain
pint authority. `lib/mapExperienceLens.ts` keeps every non-pint category's
`MapLensPrice` out of `VenueSignal`, out of cheapest-pint buckets, and out
of the Pint Index.

An explicit selected-drink lens may still use a trusted, corroborated
category price to colour and label a pin, and to build a cheapest-drink
view for that category. A missing category price stays unknown. It never
defaults to a pint figure.

`SUBMITTABLE_DRINK_CATEGORIES` (`lib/communityPrice.ts`) lists every
category a user may log, including `other`. `MAP_LENS_DRINK_CATEGORIES`
(`lib/drinks.ts`) is the narrower list a user may set as a map lens. It
drops `other`, because a pin cannot label a price "£6 Other".

## Consequences

- One compromised or careless account cannot repaint the map alone. Every
  map-facing price needs a second, independent submitter.
- A price cannot hold the map forever. After 30 days, the map returns to
  its non-community baseline until a fresh submission earns the map again.
- The pub's own price sheet stays complete and honest. It shows every
  submission, corroborated or not, current or aged out.
- A first-time contributor still sees their pin change (the provisional
  mark), even before a second submitter agrees. This keeps the
  contribution loop alive without granting the first report map authority.
- A lone, uncorroborated report never colours a pin, ranks a list row, or
  enters a cheapest-price bucket. A user comparing prices sees only
  trusted figures.
- A wrongly hidden row needs a moderator to restore it. Hiding is not
  self-service and is not reversible by the reporter.
- No-alcohol and soft-drink prices never leak into pint-priced surfaces,
  even once fully corroborated. A user reading a pint price on a pin is
  never quietly reading a soft-drink price instead.

## Alternatives Considered

**Auto-trust single reports.** Rejected. A single submission from one
account could set a pub's map price. One bad actor, or one careless
account, could then repaint every pub in London with false figures. This
risk is exactly the F1 finding this policy closes.

**A stricter corroboration threshold (3 or more).** Rejected. A higher
threshold creates a cold-start problem. Few pubs would ever collect enough
independent submitters to reach the bar, so the map would stay empty of
community prices for most pubs, most of the time. Two independent
submitters is the smallest number that is not "one stranger's word", and
it keeps the feature usable from day one.
