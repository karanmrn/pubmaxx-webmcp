# teach.md — Understanding PubMaxing

> A guided tour of this repository for a developer joining the project. Read the "big picture" first, then dive into whichever subsystem you're touching. Every section is written to be read in a few minutes and cites real `file:line` anchors so you can jump straight to the code.

---

## What it is (the 60-second version)

**PubMaxing** is a price-aware, story-led **London pub-crawl planner**. Three layers on one living map:

- **Price** — every real observed pint price in London, colour-coded (cheap → mid → expensive).
- **Setting** — by the water, gardens, the right room, a walkable route shape.
- **Story** — pub heritage (era, listed status, who drank here), sourced editorial picks, and **Pint Drops** (community photos + the price you paid + a "passed-down note"), each carrying visible **provenance** so history and legend never blur.

You pick a crawl style, filter, and either accept a **Suggested Crawl** or **Build your own** by tapping pubs — or load a curated **Featured route** ("Victorian Soho"), or **Pubs near me**. Any crawl is captured in the URL and shareable. Tapping a pub opens **The Landlord** — a retrieval-grounded AI that tells the pub's real history and honestly says when it doesn't know.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · MapLibre GL +
OpenFreeMap basemaps (CARTO fallback) · Supabase (Postgres + Storage + RLS) ·
OpenRouter (Claude) for The Landlord · Vitest + Playwright · deployed on
Vercel.

---

## Quick start (run it in 2 minutes)

```sh
npm install
npm run dev            # http://localhost:3000 — works with NO secrets
```

The app runs **keyless** for local dev: Pint Drops use an in-memory store, and The Landlord answers in "structured/grounded" mode (reads the facts on record; no narration). To light up the durable seams, copy `.env.example` → `.env.local` and add Supabase + `OPENROUTER_API_KEY`.

Useful scripts (`package.json`):

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run verify` | **lint · typecheck · test** — the fast local gate |
| `npm run ci` | `verify` **+ build** — the full gate (what Vercel runs) |
| `npm test` | Vitest unit suite (~100+ cases) |
| `npm run test:e2e` | Playwright smoke (builds + starts, drives Chromium) |
| `npm run setup` | Enables the pre-push git hook (`core.hooksPath=.githooks`) — run once |

Run `npm run setup` after cloning so a broken push is caught locally before it leaves your machine (see [CI without GitHub Actions](#continuous-integration-without-github-actions)).

---

## The big picture (architecture)

PubMaxing is a **thin, deterministic pipeline** with a small server seam. The data layer is pure and framework-free; the UI is a thin consumer; the backend is one write path and one Q&A path.

```
                       public/data/pint_prices_app_dataset.json   (product price rows)
                                        │  (fetched client-side, once)
                                        ▼
   ┌─────────────────────  DATA & DOMAIN (lib/, pure) ──────────────────────┐
   │  groupVenuePrices → Venues (content-hashed stable ids)                 │
   │  getVenueCuration → provenance-stamped claims (never flattened)        │
   │  filterVenues → scoreVenue → buildCrawlRoute (greedy walk)             │
   │  mergeVenueDrops ← community Pint Drops (demo seeds filtered out)      │
   └────────────────────────────────┬──────────────────────────────────────┘
                                     │ props
                                     ▼
   ┌──────────────────  FRONTEND (app/, components/) ──────────────────────┐
   │  PubMap.tsx (state hub) → ControlRail · RoutePanel · VenueInspector    │
   │                         → PubMapCanvas.tsx (MapLibre, GeoJSON layers)  │
   │  Theme (no-flash script + useSyncExternalStore) · shareable URL sync   │
   └───────────────┬───────────────────────────────────┬───────────────────┘
                   │ POST /api/pint-drops              │ POST /api/heritage
                   ▼                                    ▼
   ┌──────────────────────────  BACKEND (server-only) ─────────────────────┐
   │  validate → rate-limit → persist + photo (Supabase, service-role)     │
   │  moderation: report → hide@threshold → /admin review                  │
   │  The Landlord: retrieve facts (venue_key) → grounded answer OR         │
   │                honest "I won't make one up" fallback (LLM bounds)      │
   └───────────────────────────────────────────────────────────────────────┘
```

**Four ideas run through everything:**

1. **Provenance never flattens.** Sourced editorial, community contributions, anecdotes, and demo seeds stay visibly distinct — the badge *is* the product's trust signal.
2. **Seams light up with keys, honest fallbacks without.** No Supabase → in-memory + production-503; no OpenRouter → The Landlord reads facts back instead of narrating; the app never *pretends* to have data or durability it doesn't.
3. **Content-hashed stable ids.** A venue's id is an FNV hash of its name+address+coords, not an array index — so seeds and curated crawls survive dataset reordering.
4. **One write path, one URL write path, one map lifecycle.** Single seams keep the invariants enforceable.

---

## Repo map

| Path | What lives there |
|---|---|
| `lib/` | The pure domain: venues, curation/provenance, pint-drops, seeds, curated crawls, nearby, crawl-url, landmarks, heritage, supabase, pintDropsStore |
| `app/` | Routes: `/` (landing), `/map` (planner), `/admin` (moderation), `/api/*`, `/og.png` (edge OG image), `layout.tsx` (shell + no-flash script) |
| `components/` | `PubMap.tsx` (state hub), `PubMapCanvas.tsx` (map), `map/*` (ControlRail/RoutePanel/VenueInspector/PintDropComposer/hooks), `landing/*`, `ThemeToggle.tsx` |
| `app/globals.css` · `app/theme.css` · `components/landing/landing.css` | The design system: tokens, light/dark, responsive, motion |
| `supabase/migrations/*.sql` | Schema + RLS: `visit_reports`, `pub_heritage`, `pint-drops` bucket, `rate_limits`, RPCs |
| `__tests__/*` · `e2e/*` · `playwright.config.ts` | Vitest unit suite + Playwright smoke |
| `public/data/` | The price dataset + heritage cache |
| `vercel.json` · `.githooks/` | CI-without-GitHub-Actions (see below) |
| `docs/` | PRD, build-review addendum, demo deck |

---

## Data & Domain Model

### Overview

This is the pure, framework-free core of PubMaxing: it turns the flat price dataset into story-bearing `Venue` objects, and owns every rule about **money and provenance**. It groups price rows into venues, filters and scores them for a given crawl style, greedily builds a walkable route, and layers a moderated community "Pint Drop" system on top — all while keeping editorial facts, contributor evidence, and demo seeds *visibly distinct and never blended*. Everything here is deterministic and side-effect-free except the in-memory Pint Drop store, which is deliberately swappable. The UI (`components/PubMap.tsx`) is a thin consumer of these functions.

### Key types & files

| File | What it holds |
|------|---------------|
| `lib/venues.ts` | The `Venue` / `VenuePrice` / `Filters` types and the whole pipeline: `venueGroupingKey` + `stableVenueIdFromKey` (ids), `groupVenuePrices`, `filterVenues`, `scoreVenue`, `buildCrawlRoute`, `crawlSummary`, `mergeVenueDrops`, plus `hasStory`/`distanceKm`/`formatPrice` helpers. |
| `lib/curation.ts` | The provenance model: `Provenance`, `ClaimKind`, `VenueClaim`, `VenueCuration`; the hand-curated `curatedVenues` map + water/heritage keyword lists; `getVenueCuration` (heritage inference) and `buildVenueClaims` (the never-flatten claim list). Also the writer identity/sources. |
| `lib/pintDrops.ts` | The community layer: `PintDropInput`/`PintDrop` types, `validatePintDrop` (the trust boundary), the in-memory store, rate limiting (`isRateLimited`/`isLimited`), and moderation (`reportPintDrop`, `restore`/`keepHidden`, `REPORT_HIDE_THRESHOLD`). |
| `lib/pintDropSeeds.ts` | Nine hand-written `"demo"`-tagged Pint Drops pinned to specific heritage venues so the community layer looks alive on day one. |
| `lib/curatedCrawls.ts` | Four named "generational" routes as ordered lists of venue ids. |
| `lib/nearby.ts` | `nearestVenueIds` — haversine "pubs near me" from a lat/lng. |
| `lib/crawlUrl.ts` | `encodeCrawl` / `decodeCrawl` / `seedCrawlState` — shareable-URL round-trip for the whole crawl state. |
| `public/data/pint_prices_app_dataset.json` | Product price rows fetched client-side and fed into `groupVenuePrices`. |

### How it works

**The pipeline (venues.ts).** One venue is *many* price rows (one row ≈ one drink at one pub). `groupVenuePrices` (`venues.ts:145`) buckets rows by `venueGroupingKey` — `pub_name | address | lat(5dp) | lng(5dp)`, each part normalised. For each bucket it sorts prices ascending, derives `cheapestPrice`/`averagePrice`, OR-folds the amenity flags, unions sources, and attaches curation. `filterVenues` (`venues.ts:251`) applies query/price/amenity/curation predicates (a `null` price passes the price filter — unknown ≠ expensive). `scoreVenue` (`venues.ts:301`) is a per-style weighted sum (cheapness, amenities, heritage, `nearWater`, `writerPick`, source-trust). `buildCrawlRoute` (`venues.ts:338`) is a **greedy nearest-good-neighbour walk**: take the top ~60 seeds, grow each route by picking the highest `score − 2.4·distance` neighbour within a per-`routeWindow` leg cap, then pick the best whole route. A heuristic, not an optimiser — intentionally simple.

**The provenance model (curation.ts).** Two enums are the heart of the design:

- `Provenance` = `sourced | contributor | anecdote | demo` — the *origin*. `demo` marks seeded example content that must never masquerade as organic.
- `ClaimKind` = `baseline | sourced | contributor | anecdote | needs-source` — the *badge* the UI renders per claim.

`getVenueCuration` (`curation.ts:195`) resolves heritage two ways: an **explicit** hand-curated entry (→ `sourced`), or a **keyword** match against a strict period list (`victorian`, `grade ii listed`, `dating back`…) → only `anecdote` with `heritageEra: "Historic (unverified)"`. Weak generic words like `historic`/`traditional` were removed because they flooded the map with fake badges. `buildVenueClaims` (`curation.ts:241`) **never collapses claims**: a sourced editorial note and a note-only Pint Drop are separate entries; a heritage note lacking a source is downgraded to `needs-source`; a `demo` drop always becomes a `baseline` claim, never `contributor`/`anecdote`.

**Content-hashed stable ids.** `stableVenueIdFromKey` (`venues.ts:136`) is a 32-bit **FNV-1a hash** of the grouping key, base-36, prefixed `venue-`. It's a *content hash, not an array index*, so it survives dataset reordering. That's what lets `curatedCrawls.ts`/`pintDropSeeds.ts` hard-code ids like `venue-16pnwmm` (Prospect of Whitby).

**The Pint Drop trust boundary.** `validatePintDrop` (`pintDrops.ts:69`) treats the client as untrusted. `clean()` strips `<`/`>` and control chars, collapses whitespace, and caps field lengths; price must be finite and within `£0–£20`; a drop must carry a price OR a note. Provenance follows evidence: priced ⇒ `contributor`, note-only ⇒ `anecdote`.

### Data flow

**Raw row → Venue with claims:** `PubMap.tsx` fetches the JSON → `groupVenuePrices` groups + hashes the id → `getVenueCuration` attaches provenance-stamped curation → `mergeVenueDrops` folds community drops into *derived signals only* → `VenueInspector` calls `buildVenueClaims` to render the non-collapsing claim list.

**Resolving a crawl to venue ids:** shared URL → `seedCrawlState(location.search)` → `decodeCrawl` (clamps numbers, drops unknowns); curated crawl → `curatedCrawls[i].venueIds`; near-me → `nearestVenueIds(lat, lng, venues, n)`. All three produce **stable ids** resolved against the `venueById` map.

### Gotchas & invariants

- **Ids are content hashes, not positions.** Change what goes into `venueGroupingKey` and **every id changes** — seed/curated ids silently break. Tests recompute ids from the dataset to catch this.
- **Provenance never flattens.** Don't merge a sourced note and an anecdote into one string.
- **Demo drops are display-only.** `mergeVenueDrops` (`venues.ts:223`) filters `provenance === "demo"` *out* before touching prices or `hasStory`. A **bare price drop is not a story** — `hasStory` only lights from a drop with a non-empty note.
- **Keyword heritage ≠ sourced.** A keyword match yields `anecdote`/`needs-source`, never `sourced`.
- **A `null` price means "unknown," not free.**
- **Validation strips HTML at the boundary** — but don't make that your only XSS defence.

### Robustness notes

**Strengths.** The read pipeline is pure/deterministic → cheaply and heavily tested (dedicated suites for venues, curation, claims, curated crawls, seeds, nearby, crawl-url, rate-limit, pint-drops). Seed/curated ids are **pinned to the dataset by tests that recompute the FNV hash**, so a moved venue fails CI instead of 404-ing. `decodeCrawl` **never throws on bad input**. The Pint Drop trust boundary is thorough.

**Risks / ceilings (flagged by in-code risk comments).** The Pint Drop store and per-handle rate limiter are **in-memory** (reset on restart, don't span instances) — the upgrade is the Supabase adapter + durable counters. `buildCrawlRoute` is a greedy heuristic, not shortest-path. Grouping trusts lat/lng to 5dp; two distinct pubs sharing name+address+rounded-coords would merge (not observed in current data).

---

## The Map (MapLibre)

### Overview

The map is PubMaxing's centerpiece: a pitched, reader-controlled 3-D view of
London and supported UK cities. Curated venues use price-aware markers, while
UK-wide OpenStreetMap pubs form a quieter unverified layer with no price fields.
The crawl route is drawn with animated brass "marching ants." Rendering uses
**MapLibre GL** with keyless **OpenFreeMap** vector basemaps and a CARTO
fallback. Three deliberate choices run through `components/PubMapCanvas.tsx`:

1. **Client-only.** `"use client"`; everything happens inside one mount effect (`:271`). WebGL has no server story.
2. **Token-driven.** `readTokens()` (`:79`) reads the app's CSS custom properties; scene assembly derives semantic scene marks and label ink from them, so one theme toggle repaints UI and map in lockstep.
3. **Perf via GeoJSON layers, not React markers.** Every pub/cluster/route/landmark is a GeoJSON source + data-driven style layer. Updating = `source.setData(...)`, rendered on the GPU; route and entrance animation runs without React churn.

### Key pieces

| Layer / concept | Purpose |
|---|---|
| `MAP_STYLES` / `FALLBACK_STYLES` | OpenFreeMap primary styles and CARTO fallbacks; `components/map/canvas/tokens.ts` owns the URLs. |
| `LONDON_VIEW` | Opening London camera; `components/map/canvas/tokens.ts` owns its exact values. |
| `readTokens()` (`:79`) | CSS vars → a `Tokens` object for semantic scene marks and label ink; `lib/mapBasemapTaste.ts` owns basemap palette details. |
| `assembleSceneCritical()` / `assembleSceneDeferred()` | Build the first-paint pub layers, then the visual-polish and transit layers; the wrapper runs on `style.load`. |
| `addLayerOnce()` (`:319`) | Guarded `addLayer` — skips if the layer exists, so a duplicate pass can't throw. |
| `buildings-3d` (`:345`) | `fill-extrusion` off the basemap's `building` layer. |
| `pubs-point` (`:459`) | Price-stamp dots: fill by price bucket, brass stroke + larger radius for story pubs. |
| `uk-base-point` | Unclustered, unpriced OSM pubs for the current viewport, rendered below every curated pub layer. |
| `pubs-selected-glow`+`pubs-selected` (`:503`,`:517`) | Double brass ring lifting the chosen pub. |
| `pubs-drops-halo` (`:445`) | River-toned ring around pubs with Pint Drops. |
| `clusters`+`cluster-count` (`:530`,`:553`) | Brass-tinted wells that deepen with count. |
| `route-line`+`route-line-dash` (`:409`,`:420`) | Solid brass underlay + the animated "marching ants." |
| Shared animation RAF | One `requestAnimationFrame` loop advances route dashes, pin entrances, and active pulses without moving the camera. |

### How it works

**Mount → critical scene → deferred scene.** The mount effect reads the theme,
wires reduced-motion, constructs the `Map` with the matching vector style and
UK pack bounds, and wires click/cursor handlers **by layer id** (bound to the
`Map`, so they survive style swaps). On `style.load`, the handler yields to a
render opportunity, then builds pub, route, and pin layers without holding the
basemap behind the full scene assembly. It schedules buildings, visual taste,
transit, and Tonight overlays for idle time or the next frame. `setMapReady(true)`
still follows scene construction; the parent loading chrome waits for the
tile-paint gate.

**Cold `/map` warm path.** `app/map/page.tsx` loads
`public/map-first-paint-init.js` before the client shell. On ordinary network
profiles it starts the manifest and core shard requests, and
`lib/mapEarlyWarm.ts` lets the venue loaders reuse those promises. The London
shell also warms the MapLibre chunk before its effect mounts.

**Two pub sources, two contracts.** The curated `pubs` source owns clustering,
prices, search, filters, and crawl routing. `lib/ukBasePubs.ts` loads the
separate `uk-base` source only after the street-level zoom gate, then fetches
only cells overlapping the padded viewport. Base pins remain unclustered and
lose symbol collisions to curated pins. Tapping one opens an unverified sheet
that accepts a community price without adding the pub to the curated index.
`public/data/uk_base/README.md` owns the shard and identity contract.

**Why `addLayerOnce` guards exist.** Scene assembly runs on *every*
`style.load` - first paint and after every theme flip. A bare `map.addLayer` on
a live style throws `"Layer with id X already exists"` inside MapLibre's event
dispatch, aborting the scene and half-building the map. `addLayerOnce` checks
`getLayer` first; sources get `if (!map.getSource(...))` guards.

**Why animation checks `isStyleLoaded()`.** During a theme `setStyle({diff:false})` the style is *transiently null*, and calling `getLayer` on a null style throws (the classic "#418 / getLayer-on-null"). The loop checks `!map.isStyleLoaded()` first because it is null-safe and returns `false` mid-swap. It also skips work under `prefers-reduced-motion` and when `document.hidden`.

**Theme flip.** A `MutationObserver` on `html[data-theme]` (`:696`) calls `setStyle(MAP_STYLES[next], { diff: false })`. `diff: false` is deliberate: it forces a full swap so `style.load` re-fires and scene assembly re-reads the (already-flipped) tokens. A diff'd swap would keep stale-themed layers.

**Teardown** (`:711`) cancels the RAF, disconnects the observer, removes listeners, calls `map.remove()`, and nulls the ref — no leaked loop or handler.

**Landmarks → story pubs.** `lib/landmarks.ts` is a curated, sourced list of 16 landmarks. Tapping one flies the camera in and, via `nearestStoryPubs` (haversine, `hasStory` venues), surfaces the closest 3 pubs — so a landmark tap leads back into the pub data instead of dead-ending on a Wikipedia link.

### Gotchas & invariants

- **Never touch the mount lifecycle carelessly.** The map is constructed once, with stable `useCallback` deps. Add an unstable dep and the whole map tears down every render. Data changes go through `setData`/`setFilter`, never a remount.
- **The guards must stay** (`addLayerOnce`, `getSource` checks, the RAF `isStyleLoaded()`). Remove one and the next theme toggle crashes.
- **Keep palette ownership clear.** Scene marks and label ink stay token-driven; `lib/mapBasemapTaste.ts` owns the basemap's neon-noir dark palette, warm-paper light palette, and pub-first label hierarchy. Keep those style-layer values there.
- **`setStyle` must be `{ diff: false }`.**
- **No per-listing React markers.**
- **The WebGL fallback is load-bearing** — the `try/catch` (`:285`) catches a no-WebGL constructor throw and renders a notice while the planner keeps working.

### Robustness notes

**Strengths:** synchronous WebGL fallback; idempotent scene assembly + crash-proof
RAF via style-state guards; clean teardown; refs decouple data from lifecycle;
reduced-motion + `document.hidden` respected. **Residual risks:** dependence on
the basemap's OpenMapTiles-style building layer for 3-D buildings (a renamed
source layer silently flattens them); both primary and fallback styles are
remote; landmark distances are straight-line by design (labelled as such).

---

## Backend, The Landlord & Robustness

### Overview

The backend is deliberately small and seam-first: **one write path** for Pint Drops and **one Q&A path** for The Landlord, each a single Next.js route handler. The guiding ADR: **no client-side database access** — the browser never talks to Supabase directly; every write is validated, provenance-tagged, and rate-limited *before* it reaches storage, via a service-role admin client that only exists on the server (`lib/supabase.ts:7`). Two providers, both optional: **Supabase** (Postgres + Storage + RLS) and **OpenRouter** (the LLM). The single backend-selection point is `store()` (`app/api/pint-drops/route.ts:24`) — every handler talks only to the `PintDropStore` interface.

### Key pieces

| File / endpoint | Responsibility |
|---|---|
| `app/api/pint-drops/route.ts` | The **single** Pint Drop write/read/moderation path: multipart+JSON, validation, rate-limit gate, moderator auth, production-503 gate |
| `lib/pintDrops.ts` | Storage-agnostic core: `validatePintDrop`, `isLimited`, `REPORT_HIDE_THRESHOLD`, the process-memory store |
| `lib/pintDropsStore.ts` | The `PintDropStore` interface + two implementations; photo upload, DTOs, deterministic keys + orphan cleanup, the atomic `report_pint_drop` RPC |
| `lib/supabase.ts` | `getSupabaseAdmin` (service-role, server-only), config checks, `hashIp` (salted), `checkRateLimitDurable` (fail-open) |
| `lib/heritage.ts` / `app/api/heritage/route.ts` | The Landlord: fact retrieval, provenance labelling, honest fallback, LLM bounds + phantom-fact rejection |
| `supabase/migrations/0001–0004` | Schema + RLS (deny-all writes, public-read), `check_rate_limit` + `report_pint_drop` RPCs |
| `app/admin/page.tsx` | The moderation console |

### How it works

**Pint Drop write flow.** `parseBody` handles multipart or JSON. `validatePintDrop` (`pintDrops.ts:69`) is the **trust boundary** — re-checks/coerces every field server-side and derives `provenance` (client never sets it). Then `isLimited` keyed on `handle + hashed-IP`, then `store().create`. In Supabase, **photos upload before the insert** to deterministic keys; if the insert fails, `deletePhotos` removes exactly those keys — no orphans.

**Moderation.** Reports are unauthenticated. One report **never hides content** — a drop leaves public reads only at `REPORT_HIDE_THRESHOLD = 2`, and the increment-stamp-hide happens in **one atomic RPC** (`report_pint_drop`, 0004) so concurrent reports can't lose a count. Hidden drops surface in `/admin` for restore / keep-hidden.

**The Landlord.** Retrieves facts **only from server-side stores** keyed by `venue_key` (= `normaliseVenueName`): `heritage_cache.json` + the `pub_heritage` table. With an OpenRouter key, the LLM answers grounded strictly in those numbered facts; otherwise (or on any failure) it reads the facts back verbatim or emits the honest line *"…I won't make one up."* (`NO_STORY_LINE`).

### Security posture

- **Service-role key is server-only**; no anon client, no client insert path.
- **RLS deny-all for writes, public-read for reads.** `visit_reports` has RLS on with no write policy; public SELECT is scoped to `status = 'visible'`. `rate_limits` has RLS on with *no* policies — server-private.
- **Server-side validation trust boundary** (text + photo type/size), backed by DB `CHECK` constraints.
- **Constant-time moderator gate** — `safeTokenEqual` sha256's both sides then `timingSafeEqual`; the token is never echoed.
- **Rate limiting is durable + IP-hashed** — `check_rate_limit` (atomic RPC); the IP is a *secondary* signal, always `sha256(salt:ip)` before it touches the table or a log.
- **The Landlord's honest-refusal integrity** — `sanitiseModelAnswer` **rejects the whole answer** (falls back to structured) if it cites a fact id outside the retrieved set. A phantom citation = fabrication.
- **Provenance never laundered** — client `context` is labelled `contributor` and excluded from the `SOURCED` set; a visitor cannot forge pub history.

### Robustness notes & known gaps

**Strengths:** the production-503 gate refuses to acknowledge writes in prod if Supabase isn't configured (the store never lies about durability); two atomic RPCs close race windows; orphan-free photo cleanup; the LLM call is bounded on every axis (`temperature: 0`, `max_tokens: 400`, 10s `AbortController`) with every failure collapsing to the honest fallback; neither AI route can 500 the demo.

**Honest residual risks a newcomer should watch:**
- **Two backends, not unified** (in-memory vs Supabase, chosen per request) — a behavioural fix must be made in *both*.
- **The rate limiter fails OPEN by design** — a limiter outage falls back to in-memory (logged loudly, never silent), but on Vercel each cold-start gets a fresh budget, so a Supabase outage weakens rate limiting exactly when you'd want it.
- **`x-forwarded-for` is client-suppliable** — safe only because Vercel's edge normalises it; a self-host needs a trusted proxy. (Blast radius is contained — IP is a secondary key.)
- **In-memory report path is non-atomic** (dev only).
- **`ADMIN_TOKEN` unset opens moderation off-production** (`NODE_ENV` dev/test) — always set it anywhere reachable, incl. previews.
- **Public bucket serves hidden objects** — `toDTO` withholds URLs for hidden rows, but kept URLs still resolve (UUID-pathed, unguessable). A real takedown needs a private bucket + signed URLs.
- **`RATE_LIMIT_SALT` defaults in dev** — set it in production.

---

## Frontend, Features & Delivery

### Overview

Next.js 16 **App Router** (React 19, TS, no CSS framework — hand-written CSS with tokens). The shell (`app/layout.tsx`) renders `<html>`/`<body>` + an inline no-flash theme script; every route composes the same tokens from `globals.css` + `theme.css`. Four routes: **`/`** landing, **`/map`** planner, **`/admin`** moderation, **`/og.png`** edge OG image. Product flow is **landing → map** (the landing links to `/map?style=heritage`, which the planner reads on mount). "Two moods, one system": light = day-lit guidebook, dark = candle-lit pub.

### Key pieces

| File / dir | Responsibility |
|---|---|
| `app/layout.tsx` | Shell: metadata, OG/Twitter, the inline **no-flash theme script** (`:50`) |
| `app/{page,map/page,admin/page}.tsx` | Route entry points |
| `app/og.png/route.tsx` | Edge-rendered 1200×630 social image via `next/og` |
| `components/PubMap.tsx` | **The ~171-line orchestrator** — all planner state, data fetch, wires the panels |
| `components/PubMapCanvas.tsx` | The MapLibre map |
| `components/map/ControlRail.tsx` | Mode toggle, filters, Featured routes, "Pubs near me", stats |
| `components/map/RoutePanel.tsx` | Route summary + stops, "Copy link", add-stops picker |
| `components/map/VenueInspector.tsx` | Selected venue: amenities, provenance claims, prices, Pint Drops, The Landlord |
| `components/map/PintDropComposer.tsx` | The contribution form |
| `components/map/{usePintDrops,useCrawlUrl}.ts` | `/api/pint-drops` traffic; shareable-URL seed/sync |
| `components/ThemeToggle.tsx` | Theme button — `useSyncExternalStore`, hydration-safe, reload-persistent |

### How it works

**The planner state model (`PubMap.tsx`).** All state is plain `useState` in one component — no store, no context. A chain of `useMemo` derivations:

```
rows (fetched JSON)
  → groupVenuePrices → baseVenues
  → mergeVenueDrops → venues        (folds community drops into signals)
  → filterVenues → filteredVenues
  → buildCrawlRoute / builtIds.map → route        (mode = "suggest" | "build")
  → venueById.get(selectedVenueId) → selectedVenue
```

Five state atoms: `mode`, `filters`, `builtIds`, `selectedVenueId`, `rows`. A separate `loaded` flag is flipped in the fetch's `.finally()` so the UI distinguishes "still loading" (skeleton) from "zero matches" (empty state with a Clear-filters CTA).

**URL sync (single write path).** `seedCrawlState(window.location.search)` runs *once* in a `useMemo` lazy initializer to seed all five atoms. `useCrawlUrlSync` is the **only** thing that touches the URL — `history.replaceState`, debounced ~300ms, on every state change. `lib/crawlUrl.ts` clamps numbers, drops unknowns, and **never throws**.

**The theme system (no-flash + `useSyncExternalStore`).** Two cooperating pieces avoid the classic hydration mismatch: (1) the **no-flash script** runs synchronously in `<head>`, reading `localStorage["pubmax-theme"]`/`prefers-color-scheme` and setting `html[data-theme]` before paint; (2) `ThemeToggle` reads via `useSyncExternalStore` with a **deterministic `"light"` server snapshot**, so server HTML === first client render (no #418). After hydration it re-reads the real attribute; a `MutationObserver` keeps the icon synced; a mount `useEffect` re-asserts `data-theme` from `localStorage` (a DOM write, not setState).

**Features hang off the state:** Featured routes (`loadCuratedCrawl` → build mode + `builtIds`, instantly shareable); Pubs near me (`startNearbyCrawl`, an event handler, feature-detects geolocation, degrades gracefully); Pint Drops (`usePintDrops` owns all API traffic + client photo validation); The Landlord (`LandlordPanel`).

**Responsive.** Desktop is a 3-column grid (`356px | 1fr | 372px`). At ≤1050px → single column, map hoisted to top; at ≤768px the map becomes a sticky `60svh` hero and the rails read as scrollable bottom sheets — **pure CSS, no JS**.

### Design system

Tokens in `globals.css` (`:root`, light) overridden in `theme.css` (dark): `--ink`/`--paper`/`--panel` families, semantic accents `--pint`/`--amber`/`--brick`/`--river`, and **one brass accent** `--brass` (tuned to WCAG AA on paper). Serif for headlines, Inter for UI. **Provenance chips** (`Sourced`/`Contributor`/`Anecdote`/`Demo`/`Baseline`/`Needs Source`) are the visual half of the honesty contract. `prefers-reduced-motion` respected app-wide; the landing's reveal only hides content behind `(prefers-reduced-motion: no-preference) and (scripting: enabled)` — so reduced-motion *and* no-JS visitors get static, fully-visible content.

### Testing & delivery

- **Unit** — Vitest, ~100+ cases across 12 files pinning the load-bearing pure logic and the honesty invariants (demo seeds don't move prices, claims carry provenance, URL decode never throws).
- **E2E** — Playwright `e2e/smoke.spec.ts`: one Chromium project, a real production build on port 3100, three non-flaky checks (landing + honesty labels + CTA; `/map` mounts; theme flips/persists/survives reload). **WebGL-agnostic** — asserts canvas *or* fallback, since headless CI has no GPU.
- **Gate** — `npm run ci` = `verify (lint·typecheck·test) + build`.
- **Deploy** — Vercel; the OG route uses the Edge runtime.
- **Env** — `.env.example`: local dev runs *without* secrets (in-memory + structured fallback); production needs Supabase, `ADMIN_TOKEN`, `RATE_LIMIT_SALT`, optionally `OPENROUTER_API_KEY`.

### Gotchas

- **`react-hooks/set-state-in-effect` is an ERROR here.** Keep it green: `setState` only in event/fetch handlers; lazy `useState`/`useMemo` initializers for URL/localStorage seeding; effects that only do DOM writes or subscriptions.
- **No-flash + hydration** — don't naively read theme in render; the deterministic `"light"` server snapshot is load-bearing, and `<html suppressHydrationWarning>` exists because the script mutates `<html>` pre-hydration.
- **Keep the single URL write path** — `useCrawlUrlSync` is the only code that touches the URL; new shareable state means extending `lib/crawlUrl.ts` (keep its clamps in sync with the sliders).
- **E2E is WebGL-agnostic** — the map test passes on canvas *or* fallback, with no `pageerror` assertion on `/map` (MapLibre emits async teardown errors under headless timing that aren't app bugs). Don't tighten it to require the canvas.

---

## Continuous integration without GitHub Actions

GitHub Actions is currently **billing-locked** on this account, so the `.github/workflows/ci.yml` job shows red — that's an account/billing issue, not a code problem. The tree stays green through three free layers instead, in order of what actually protects production:

### 1. Vercel build = the deploy gate (primary, free, already in your pipeline)

`vercel.json` sets the build command to the full check:

```json
{ "buildCommand": "npm run ci" }   // lint && typecheck && test && build
```

Every Vercel deploy now runs lint · typecheck · **the Vitest suite** · then the Next build. **If any step fails, the deploy fails and production is never updated.** This is the single most important gate — it uses build minutes you're already paying for and needs no extra service. (It adds ~10–15s per deploy; trim to `typecheck && build` if that ever matters.)

### 2. Local pre-push git hook (free, catches it before it leaves your machine)

`.githooks/pre-push` runs `npm run verify` (lint · typecheck · test — build is skipped as it's slow and Vercel covers it). Enable once per clone:

```sh
npm run setup     # git config core.hooksPath .githooks
```

A red push is stopped locally, so broken code never even reaches GitHub.

### 3. External free CI (optional — if you want GitHub *status checks* on PRs)

If you want a green/red check *on the PR itself* (what Actions gave you), these run free and integrate with GitHub without Actions:

| Service | Free tier | How |
|---|---|---|
| **Cirrus CI** | Free for public repos | Install the GitHub App, add a `.cirrus.yml` running `npm ci && npm run ci` |
| **CircleCI** | ~6,000 build-min/mo free | GitHub App + `.circleci/config.yml` |
| **GitLab CI** | Free CI minutes | Mirror the repo to GitLab, add `.gitlab-ci.yml` |
| **Woodpecker CI** | Open-source, self-host | Point it at the repo |

**Recommendation:** the Vercel build gate + the pre-push hook already give you a real, free CI loop that protects production and your local pushes. Add **Cirrus CI** (free for public repos) only if you specifically want the PR status-check UX back. If the GitHub Actions billing lock is cleared, `ci.yml` starts passing again and simply becomes a fourth, redundant layer.

---

## Robustness at a glance (consolidated)

| Area | Strength | Watch out for |
|---|---|---|
| **Data** | Pure/deterministic, heavily tested; ids pinned to dataset by tests; `decodeCrawl` never throws | Grouping merges pubs sharing name+address+rounded coords (not seen in data) |
| **Map** | WebGL fallback; idempotent scene assembly; crash-proof RAF; clean teardown | Depends on remote OpenMapTiles-compatible style shapes for 3-D buildings |
| **Writes** | Single path; server validation + DB CHECKs; orphan-free photos; production-503 (never lies about durability) | Two backends not unified — fix behaviour in both |
| **Abuse** | Durable atomic rate-limit RPC; salted-hashed IP; constant-time admin gate | Fails **open** on a Supabase outage; `x-forwarded-for` trust relies on Vercel edge |
| **The Landlord** | Grounded-only; rejects phantom citations; temp 0 + timeout; honest refusal | — |
| **Moderation** | Report ≠ hide (threshold 2); atomic increment; token-gated `/admin` | Public bucket serves hidden objects to kept URLs (needs private bucket for real takedowns) |
| **Frontend** | Hydration-safe theme; single URL write path; reduced-motion + no-JS safe | `set-state-in-effect` is an ERROR — follow the established patterns |
| **CI/CD** | Vercel build gate + pre-push hook (both free) | GitHub Actions billing-locked (not a code issue) |

**Before opening to real public UGC**, the honest to-do list (from `docs/PRD_ADDENDUM_BUILD_REVIEW.md`): unify the two Pint-Drop backends, make the rate limiter's outage behaviour observable/decided, confirm the `x-forwarded-for` trust boundary for the deploy target, move to a private photo bucket + signed URLs if real takedowns are needed, and set `ADMIN_TOKEN` + `RATE_LIMIT_SALT` on every reachable environment.

---

## Where to look next

- **Product vision & roadmap:** `docs/PRD_FINAL_FOR_FABLE.md`
- **Verified build state + defect triage:** `docs/PRD_ADDENDUM_BUILD_REVIEW.md`
- **Demo script:** `docs/DEMO_DECK.md`
- **The honesty contract in code:** `lib/curation.ts` (`buildVenueClaims`) and `lib/heritage.ts` (`sanitiseModelAnswer`, `NO_STORY_LINE`)
- **The one write path:** `app/api/pint-drops/route.ts`
- **The map lifecycle:** `components/PubMapCanvas.tsx` (read the guards before you touch it)
