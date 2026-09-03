# PubMaxing — Final PRD for Fable

> **Superseded** — see docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md and cc_plan.md. Historical context; current state also lives in teach.md.

> A price-aware, story-led London pub-crawl planner. This is the build-and-design handoff for Fable: what exists (verified, running), what to make beautiful, and the exact order to do it in. Vocabulary follows `CONTEXT.md`; supersedes nothing but consolidates `OPUS_REVIEW_PRD.md`, `PRD_PINT_DROPS.md`, `PRD_PRODUCTION_READINESS_FOR_OPUS.md`, and `codex_plan.md` into one Fable-facing brief.

## One line

Every real pint price in London, on a living map — and the story of every pub worth the walk. It brings 18-year-olds, Gen Z and Gen X back to the same tables.

## Problem

London pub discovery is split across price lists, generic map directories, and personal memory. You can find a cheap pint, or a nearby pub, or a famous old boozer — never all three, and never the human knowledge that makes a pub matter. Meanwhile the pubs are closing. There is no single place that makes the tradeoff visible — a cheaper pint, a better room, a riverside setting, a stronger story — and lets one generation hand its pub knowledge to the next.

## Solution

Three layers on one map:
- **Price** — observed pint prices per venue (cheap → mid → expensive), colour-coded.
- **Setting** — by the water, gardens, the right room, walkable route shape.
- **Story** — heritage (era, listed status, who drank here), sourced editorial picks, and **Pint Drops**: community photos + the price you paid + a Passed-Down Note, each carrying visible **provenance** (Sourced / Contributor / Anecdote) so history and legend never blur.

The product is a **planner**: pick a Crawl Preference, filter, accept a Suggested Crawl or build your own by tapping pubs, and inspect any venue's price, story, photos, and **The Landlord** — a retrieval-grounded AI that tells a pub's real history and honestly says when it doesn't know.

---

## Current state — what is BUILT and VERIFIED (not aspirational)

Running on `main`, verified end-to-end against a live Supabase project this session:

- **Landing page** (`/`, product-led) → **planner** (`/map`). Light + dark theme with a no-flash toggle, persisted.
- **Map** — MapLibre + CARTO dark basemap, ~1,037 venues from a 3,097-row price dataset, price-coloured pins, crawl-route line, filters, Suggested Crawl + Build-Your-Own.
- **Community Pint Drops** — single write-path `POST /api/pint-drops`: text + price + **pint photo + venue photo** (multipart), server-side validation, deterministic Storage keys with **orphan cleanup**, public-read photo URLs, in-memory fallback, production-503 without Supabase. **Confirmed persisting to live Supabase** (real row written + read back; not in-memory).
- **Moderation** — report → hide → `/admin` review console (token-gated) → restore / keep-hidden, with report metadata and a moderator-only DTO (reviewers see hidden photos; the public never does).
- **The Landlord** (`/api/heritage`) — grounded on a heritage cache + curation, unified on `venue_key`, client context labelled `contributor` (never Sourced), honest "I won't make one up" fallback. **OpenRouter key is live**, so it narrates.
- **Provenance claim-list** — Sourced / Needs-Source / Contributor / Anecdote render as distinct claims; map signals derived without flattening.
- **Quality** — 91 vitest tests + Playwright E2E smoke, CI (Node 22: lint · typecheck · test · build). tsc + lint + build green.

**Backend is live**: Supabase tables (`visit_reports`, `pub_heritage`), `pint-drops` public bucket, service-role writes, RLS public-read — all verified working.

---

## THE MAP — the centrepiece Fable should make unforgettable

Today's map is a competent flat 2-D dark web map. The reference we want to match is the **londonszn** rent map we built together (in `.context/londonszn/`): a **pitched, rotating, 3-D London** that feels alive. The map is the product's soul; a design studio's demo lives or dies on it.

**Target experience (reference: londonszn, `bengaluru.rent`, `london.jamespotter.dev`, `londonstartupmap.com`):**

1. **3-D pitched perspective on load** — `pitch: ~45, bearing: ~-15, zoom ~10.5` (londonszn uses `pitch: 42, bearing: -12`). London is a place, not a chart.
2. **Slow idle orbit** — a gentle auto-rotate (bearing drift) when the user is idle, exactly like the londonszn `viewCommand: { type: 'orbit' }`. Pauses on interaction, resumes after a few seconds still. This is the "wow."
3. **3-D buildings** — MapLibre `fill-extrusion` on the basemap's building layer, height-driven, subtle in dark, so the City and Canary Wharf read as skyline.
4. **Sky + fog** — MapLibre `sky` layer + atmospheric fog for depth at the horizon.
5. **Cinematic fly-to** — selecting a venue or a crawl stop `easeTo`s to it with pitch/zoom, brass ring on the pin; the route draws as an animated **brass polyline** between stops.
6. **Landmarks + history layer** — Big Ben, Tower Bridge, St Paul's, the Tower, Greenwich, etc. as tasteful glyphs; tap → a short sourced history card (ties directly into The Landlord + `pub_heritage`). This is the "landmarks, history and all the beautiful things related to the London map" the brief asks for.
7. **Custom pin craft** — replace default circles with designed markers: price stamp fill, a brass stroke for story pubs, a photo-thumb halo when a pub has Pint Drops. Clustering at low zoom (MapLibre `cluster: true`), pins at high zoom — never 1,000 React markers (perf rule from londonszn).
8. **Legible in both themes** — dark = candle-lit night city; light = the CARTO positron "day guidebook." Every map colour is a token so it flips cleanly.

**Why it matters:** a judge who clicks "Open the map" must feel craft in the first second. The illustrated Thames hero on the landing is currently more beautiful than the real map — that inversion is the single biggest design gap to close.

---

## What to add / improve — prioritised for the Fable demo

### P0 — Demo-blockers (the app currently embarrasses itself here)
1. **Seed 8–12 real-feeling Pint Drops** on the curated heritage pubs (Prospect of Whitby, The Grapes, The Dove, The Lamb…), each with a **Demo/Seed** provenance badge. The community layer — the whole differentiator — is empty on load and reads as vaporware. *(This also makes the declared-but-unused `Baseline`/`Demo` badges real.)*
2. **Fix `hasStory` overfire** — a price-only drop currently flips a venue to a "story pub" and boosts heritage scoring. A bare price is not a story. Gate the story signal on a note/heritage claim. *(Do this before seeding or the seeds render wrong.)*
3. **Landing honesty** — "from £3.80" is wrong (real floor £1.99 canonical); "3,000+ prices **logged**" implies community logs that don't exist yet (rewrite to "**mapped**"); label the sample drop cards + Landlord chat mock as **Example**.

### P1 — The beautiful map (the centrepiece above)
4. Rebuild `PubMapCanvas` toward the target experience: 3-D pitch, idle orbit, 3-D buildings, sky/fog, fly-to, brass route polyline, custom pins + clustering, landmarks/history layer. Keep it token-themed for light/dark.
5. **Surface the story on the map, not just the landing** — one hero heritage venue / Landlord teaser on map load so the soul survives the click-through.

### P2 — Structural polish (so it reads "designed", from the thermo-nuclear audit)
6. **Decompose `PubMap.tsx` (1,079 lines)** → `ControlRail`, `RoutePanel`, `VenueInspector`, `PintDropComposer` + a `usePintDrops` hook (~150-line orchestrator).
7. **Unify the two Pint Drop backends** behind one store interface (deletes ~40% of `route.ts`; tests pin the contract).
8. **Collapse the triplicated DTO** to one type-only import; delete dead code (`priceColor`, `averagePrice`, `writerTrail`, `setDropStatusRemote`, phantom `venueId` param); gitignore `.context/`.

### P3 — Launch-readiness (not demo-blocking, real before public UGC)
9. **Durable rate limiting** (Supabase table/RPC, keyed on handle + hashed IP) — today it's in-memory, per-process.
10. **The Landlord LLM bounds** — `temperature: 0`, max-token cap, timeout/abort + safe fallback; reject model output citing missing fact ids.
11. **Browser/E2E tests** (Playwright: `/`, `/map`, map select, build-your-own, composer, photo failure, report, theme) + **fresh desktop/tablet screenshots** (today only mobile exist).
12. **Stable venue-id alias table** before the first real dataset re-import (ids survive reordering, not re-geocoding).

### P4 — Future features (the "bring London back" vision, post-Fable)
- **Rich landmark/history overlay** from open data: OSM `historic=*`, Wikidata (`P571` inception, `P1435` listing), Historic England listed buildings — enriching `pub_heritage` and the map's landmark layer.
- **Route save + share** (shareable URL state, like londonszn's bbox-in-URL discipline).
- **Live "what's on tonight"** ambient layer (events near a crawl) — echoing the londonszn city-feed dots, without scope-creeping into rentals.
- **Generational crawls** — curated named routes ("Victorian Soho", "Hilton's riverside") that make the cross-generation story explicit.

---

## Design direction

- **Two moods, one system.** Dark = a candle-lit night city (current default). Light = a printed day guidebook. Both driven by the same tokens (`--ink`, `--paper`, `--brass`, `--river`, `--pint`…) so the whole app + map flip cleanly.
- **One accent: brass.** No second accent, no gradient-as-decoration, no glassmorphism, no emoji, no hype copy. Serif (EB-Garamond-feel via the system `--serif`) for brand + headlines; Inter for chrome; tabular figures for prices. (lavish-design discipline, applied to PubMaxing's own guidebook brand.)
- **The "pub guidebook margin" motif** — side panels as annotated margins: price stamps, route numbers, sourced notes, provenance chips beside a living map.
- **Motion with restraint** — the idle orbit, cinematic fly-to, and reveal-on-scroll; all behind `prefers-reduced-motion`.

## User stories (delta beyond what's built)

1. As a first-time visitor, I open the map and it's *alive* — a rotating 3-D London with real pubs and a few glowing story pins — so I get it in 5 seconds.
2. As a planner, tapping a landmark tells me its history (sourced), so the map teaches me London, not just prices.
3. As a contributor, my pint photo + Passed-Down Note appears on a pub that already has a few drops, so I'm joining a living thing, not seeding an empty one.
4. As a mobile user, selecting a pub raises an immediate bottom-sheet with price, story, photos, and add-to-crawl — no long scroll.
5. As a judge/demo viewer, the map "wows" and the cross-generation story is legible without reading a word of copy.

## Implementation decisions (carry forward)

- Keep the **single write-path seam** (`POST /api/pint-drops`) and the **read-merge into one Venue model**. Never a second Pint-Drop render path.
- **Provenance never flattens.** Summary signals are *derived* from the distinct claim list.
- **The Landlord answers only from server-retrieved facts.** Client context is `contributor`, never Sourced.
- **Map performance rules** (from londonszn): GeoJSON sources + layers, cluster < zoom 13, debounce bbox work, cap rendered pins — never per-listing React markers at scale.
- **Stable venue ids** stay content-hashed (not array index).
- **Seed content is provenance-tagged** so day-one liveliness never masquerades as organic.

## Testing / QA

- Unit (done): grouping, filtering, scoring, curation/provenance, Pint Drop handler, store DTO, heritage grounding — 63 tests.
- **Add**: Playwright E2E across the flows above; a live-Supabase smoke (create → read → photo → report → hide → restore); map-render nonblank + orbit + fly-to smoke.
- **Screenshots**: regenerate desktop / tablet / mobile, both themes, for review parity.
- CI gate on every PR (blocked today only by a GitHub Actions **billing lock** on the account — not a code issue).

## Out of scope (hold the line)

Full accounts / social graph / feed · paid venue dashboards · automated AI moderation · real walking directions (label distance "straight-line" until built) · tube routing · importing londonszn's rental/neighbourhood features · expanding *The Greatest Pubs* contents without rights · replacing Supabase.

## What we need from Karan / to ship

- **Provided ✓**: live Supabase project (tables, bucket, service-role key), OpenRouter key — all verified working.
- **Still needed**: clear the **GitHub Actions billing lock** (turns CI green); a **deploy target** (Vercel) + production secrets; the **moderation owner** + public-photo/takedown copy; content-rights confirmation for writer/book/heritage claims.

## The pitch line

> "Every price is real — and so is every story. Open the map: London turns under you, the old riverside pubs glow, and tapping one tells you why it's still standing. Truth in the price, truth in the past — and a reason for every generation to come back to the pub."
