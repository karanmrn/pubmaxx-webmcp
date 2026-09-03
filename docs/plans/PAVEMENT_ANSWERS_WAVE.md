# Pavement Answers Wave — quench the thirst

> Status: **SHIPPING** (2026-08-07). Research-led product wave on `main`.
> Distinct from utility mounts (#861–#869), night-OS (#829/#832), UK national map (#840), and taste CSS.

---

## What people are dying for (research digest)

Not another review site. The recurring thirst is **pavement answers under price pressure**:

| Signal | Source | Thirst |
|---|---|---|
| Viral Guinndex / Times coverage of Guinness prices across Britain | The Times / Guinndex.co.uk | “How much is a pint *here*, and am I being taken for a ride?” |
| Competitor apps (PintPal live price map, CreamFinder pour quality, Pubs Near Me favourites) | App Store listings 2025–26 | Live prices, shortlists, crawl planning — not star ratings |
| Gen Z daytime / third-space shift | Morning Advertiser, Lumina, CNN 2025–26 | Coffee, earlier dayparts, clear pricing, less “just get smashed” |
| Cost-of-living pint anxiety | BBPA / CAMRA / trade press | Average pint past £5; London outliers hide next to honest locals |

PubMaxxing already owns the honesty monopoly (corroborated prices on a map → shareable plan). This wave ships the **missing pavement verbs** people still leave the app for.

## North star for this wave

> Standing on the map at 5:40pm (or 11am with a laptop): show me what is open, what is cheap in this view, whether this pub’s price is out of line for its patch, and how to get back to my locals or tonight’s deals — without inventing hours or prices.

## Ranked jobs

### P1 — Open now map filter
**Branch:** `cursor/open-now-map-filter-dd0b`  
**Job:** Filters toggle using hours we already trust (Spoons directory match first). Known-open stay, known-closed drop, **unknown stay** with an honest caption. No CityMCP fan-out.  
**Done when:** unit tests for open/closed/unknown; ControlRail + mobile filters.

### P2 — Sheet area price compare (“mug check”)
**Branch:** `cursor/sheet-area-price-compare-dd0b`  
**Job:** On Overview, when we have a pub price and a borough/zone median from Pint Index / zone helpers, print one VOICE-clean compare line. Silence when not enough data. Never invent.  
**Done when:** helper + Overview tests; voice fence.

### P3 — Viewport cheapest list sort
**Branch:** `cursor/viewport-cheapest-sort-dd0b`  
**Job:** Map list view gains a “Cheapest” sort for priced pubs in the current view; unpriced last/labelled; default stays nearest.  
**Done when:** `mapVenueList` tests + list UI chip.

### P4 — Saved pubs on phone filters
**Branch:** `cursor/saved-pubs-pavement-dd0b`  
**Job:** Mobile Filters get the same “Saved only” toggle desktop ControlRail already has; empty copy points at Save on a pub.  
**Done when:** mobile filter test / chrome contract if needed.

### P5 — Tonight / What’s On cold-start
**Branch:** `cursor/tonight-map-coldstart-dd0b`  
**Job:** Cold map reaches Tonight lane / What’s On in ≤2 taps (not buried only under More → Events). Respect chrome budgets. Distinct from quiet-pint-on-`/tonight` page.  
**Done when:** chrome tier / shell tests.

### P6 — Share logged price polish (stretch)
**Branch:** `cursor/share-logged-price-dd0b`  
**Job:** Venue share text prefers corroborated community price + day when present, not only curated `cheapestPrice`.  
**Done when:** share helper tests.

## Opened PRs

| Item | PR |
|---|---|
| Plan | [#872](https://github.com/Singularityszn/pubmax/pull/872) |
| P1 Open now filter | [#874](https://github.com/Singularityszn/pubmax/pull/874) |
| P2 Sheet mug-check | [#876](https://github.com/Singularityszn/pubmax/pull/876) |
| P3 Viewport cheapest sort | [#873](https://github.com/Singularityszn/pubmax/pull/873) |
| P4 Saved pubs on phone | [#878](https://github.com/Singularityszn/pubmax/pull/878) |
| P5 Tonight cold-start | [#875](https://github.com/Singularityszn/pubmax/pull/875) |
| P6 Share logged price | [#877](https://github.com/Singularityszn/pubmax/pull/877) |

## Anti-goals

- No Guinness pour-quality ratings (CreamFinder’s lane; we do not invent ritual scores)
- No CityMCP bulk “open now” scraping
- No Social launch-state change or lot densification in this wave
- No seeded coffee prices

## Execution rules

1. One concern per PR; base `main`.
2. VOICE.md; British; no em dashes; no `!`; jokes off figures.
3. Commit + push + draft PR before claiming done.
4. Prefer mounting existing hours/price helpers over new data pipelines.
