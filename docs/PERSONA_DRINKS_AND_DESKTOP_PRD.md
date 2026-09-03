# PRD: Desktop Parity + Persona Drinks (2026-07-18)

Owner directive: (1) two Fable agents bring every mobile-first feature to a first-class desktop experience with weather always present; (2) a persona-drinks layer: famous people's and fictional characters' favourite drinks, sourced, with ingredients, as a discovery lens. Owner asked Fable to add features on top. Skeptic pass and endorsement guardrails included.

## Part 1: Desktop parity (two Fable lanes)

Mobile-first was correct; desktop is now the laggard (audit finding: feed wastes half a 1440px screen). Two lanes:

LANE D1, desktop shell: persistent right rail on wide viewports carrying (top to bottom) the Conditions strip (date, temperature, rain chance, drink verdict — ALWAYS visible, owner requirement), area news "New round here" for the map viewport area, and the night arc / get-home strip when active. Feed becomes two-column on wide. Map keeps full-bleed with the drawer; rail collapses cleanly at the breakpoint (lib/breakpoints.ts constant, no new magic numbers).

LANE D2, desktop feature integration: audit every mobile-first feature for desktop reachability and polish: social tabs + check-in composer, /add/handle confirm sheet, hygiene/heritage/award plaques in the desktop drawer, search fly-to, conditions, planner. Fix what is unreachable or ugly at 1440x900. Keyboard affordances where cheap (Escape closes drawer, / focuses search). Hover states per emil-design-eng bar (150-250ms ease-out, no ease-in).

## Part 2: Persona drinks ("Drink like...")

### The skeptic pass (Fable, before building)
A celebrity-drinks trivia page is exactly the AI-slop gimmick this product has been killing. The PUBMAXX-native version ties every persona to REAL pubs and REAL prices: "Bond drinks a dry martini. Four pubs near you make a proper one." Discovery lens over our data, not a trivia encyclopedia. Recommendation: build the pub-tied lens, skip a standalone encyclopedia page. OWNER DECISION PENDING (question asked).

### Data layer (research crawl first, product second)
data/persona_drinks.json: {id, name, kind: "person"|"fictional", knownFor, drink, drinkCategory (maps to our existing drink categories), why (one sourced sentence), sourceUrl, sourceName, observedAt, ingredients: [...], howToOrder (one line), confidence}. Real people: only PUBLICLY REPORTED preferences from interviews/articles, each with a source URL; no invented preferences; UK + US figures. Fictional: canon citations (film/book/scene); e.g. Bond, vesper martini, "shaken not stirred" (Casino Royale). Target 80-150 entries across musicians, actors, CEOs, athletes, internet personalities, fictional characters.

### Endorsement + legal guardrails (non-negotiable)
Copy always "reported favourite" or "as ordered in [film]"; never implies endorsement of PUBMAXX or any pub. No photos or likenesses of real people; text + our own iconography only. A one-line disclaimer on the surface. Fictional characters referenced factually by name only, no franchise imagery. Any entry whose source dies gets dropped, not paraphrased from memory.

### Product surfaces (pending owner decision on shape)
1. Persona lens on the map/drinks layer: pick a persona (searchable list), map highlights pubs serving that drink category; drink card shows ingredients + how to order + the sourced why.
2. Conditions cross-link: personas whose drink fits tonight's weather verdict surface first.
3. Fun seam on venue sheet: when a pub's menu matches an iconic drink, a quiet line ("Does a proper dry martini. Bond's order.").

### Fable's additions on top (owner invited)
- "Your round, their order": in a plan/crawl, each friend can adopt a persona for the night; the round card shows each order with its how-to-order line. Social, screenshottable, drives the crawl loop.
- Ingredients cards double as a "what am I actually drinking" education layer, tied to our drink categories rather than generic cocktail-DB content.
- Seasonal rotation: personas resurface by weather fit (stout people in the rain, spritz people in the sun) — reuses lib/drinkWeather verdicts.

## Sequencing
Now: research crawl (Exa + Firecrawl REST), desktop lanes D1/D2. After owner shape decision + crawl QA: dataset PR, then surfaces. Persona surfaces are NOT launch-blocking for month-end; desktop parity IS.
