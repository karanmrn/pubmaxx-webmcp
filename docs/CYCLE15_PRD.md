# CYCLE 15 PRD: The Living London Layer (2026-07-18)

Owner directive: make PUBMAXX the one-stop app for planning any night out with friends in London, launch website end of month (no forced login), apps ready the moment developer accounts exist, and kill every trace of AI slop. Ground truth from four last-30-days research sweeps (Exa + press, ~150 sourced facts, all boroughs including Penge, Purley, Catford, Tottenham, Romford, Barking). Briefs: session scratchpad research/sweep-{central-west,east,south,north}.md, being committed under docs/research/.

## What the research proved

1. THE PRICE GAP IS THE MOAT (confirmed three times now): deliberate last-30-days digging finds almost no per-pub pint prices anywhere in press. Region anchors exist (UK avg 5.34, London top end past 10 quid, Wetherspoon floor 2.99) but per-pub truth does not. Crowdsourced drops are not a feature, they are the product's defensible core. Every surface should funnel toward a drop.
2. LONDON PUB NEWS IS RICH AND NOBODY AGGREGATES IT: ~60 dated, sourced openings/closures/refurbs/awards across the city in 30 days. The George Fitzrovia is Best Pub in London 2026. CAMRA design awards went to Leyton. Heritage pubs reopening (1720s Black Horse Barnet, rescued by its regulars). Threat stories (The Mitre Penge demolished, Crown and Sceptre Streatham at risk). This is exactly the non-slop content the owner wants, with provenance built in.
3. THEMES USERS CAN RIDE: Guinness mania centrally (Devonshire effect, Guinness Saloon Covent Garden, a pub pointedly NOT serving Guinness as its identity), match-day economics (20 quid door charge in Highbury for a World Cup semi shown free elsewhere), beer-garden weather swings.

## Lanes (execution: Opus 4.8 high per owner; Fable reviews and merges on green)

### Lane A: Fresh-facts layer (NOW)
The initial data/area_news.json snapshot came from the four sweep briefs. The current reviewed artifact also accepts rows from the repeatable Keenable refresh; every entry is {area, kind: opening|closure|refurb|award|threat|buzz, title, detail, sourceUrl, sourceName, observedAt, venueMatch?}. Conservative venue matching to existing pins (heritage-lane idiom). Surfaces:
- Area pages + map area context: "New round here" block, max 3 items, dated, source-linked.
- Venue sheet: award badge when a venue matches an award fact (The George: "Best Pub in London 2026, National Pub and Bar Awards").
- Freshness registry entry; refresh workflow = `npm run refresh:area-news` (manual because the deployed server cannot publish committed files). Readers show only facts from the last 21 days and sort newest first.
Anti-slop rule: only sourced, dated facts render; a successful empty read shows
an honest empty state, while an unavailable read says that area updates are
unavailable.

### Lane B: Tonight Conditions (NOW)
The owner's "date + weather + what to drink" surface. Uses the existing cached weather. A rules table (lib/drinkWeather.ts, pure, tested): temp/rain/season to drink suggestion + venue lens (18C+ sun: beer garden lens + lager/cider; cold rain: fireplace lens + stout/ale; crisp autumn: amber ale). One calm strip on map/Tonight: "Saturday 19 Jul, 22C sun. Beer garden weather. 4 gardens near you under 6 quid." Taps existing amenity data (beer garden, fireplace) and price data. Honest: no data, no claim.

### Lane C: The Social Loop v1 (NOW, flagship)
X/Instagram-feel feed without forced login. V1 scope:
- Feed merges: friends' moments/nights, area news (Lane A), drops nearby, buzz signals. Tabs: "Your lot" (friends) and "London"; "Nearby" appears only when a real locality or applied area filter can scope it.
- Friends v1: mutual follow via handle share or QR at the table (progressive identity already exists; no email/password). Follow, unfollow, private by default posture per existing privacy choke points.
- Post types v1: moment (exists), drop (exists), "we're out" check-in (new, lightweight, area-level location only).
Explicitly NOT v1: DMs, comments, algorithmic ranking (chronological within tabs), public profiles beyond handle+avatar.
### Lane D: Native readiness (RUNNING) - Android platform, icons from The Crossing, store pack. Owner does accounts.
### Lane E: Anti-slop enforcement (RUNNING) - slop filter at Story seam + voice spec application.
### Lane F: Mobile UI polish (NEXT WAVE) - spring-physics sheet engine (#345 D1+D8), desktop feed layout, light-basemap custom style JSON.

## Candidates deliberately queued (not this cycle)
Match-day layer (fixture-aware pub finder: showing the game, door charge y/n, crowd level) - strong signal, needs fixture data source decision. Guinness index (price + availability lens) - fun, defer until drops volume supports it. Planning Datahub "local at risk" alerts. Isochrone walking rings.

## Owner decisions pending
1. Feed default visibility: friends-only vs area-public for "we're out" check-ins (recommendation: friends-only, area-public opt-in).
2. Homepage lead on launch day: map-first (current) vs Tonight-conditions-first (recommendation: map-first, conditions strip above fold).
3. TICKETMASTER_API_KEY still the only path to real event listings.

## Launch sequence to month end
Week 1 (now): Lanes A/B/C/D/E land. Week 2: UI polish wave + eval pass on all new surfaces + owner flow review. Week 3: demo-content off, Search Console, soft launch to first users, iterate on their behaviour. Apps submit whenever accounts exist (all engineering pre-done by Lane D).
