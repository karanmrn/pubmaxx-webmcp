# PUBMAXXING — Canonical PRD (historical engineering baseline)

> **SUPERSEDED (2026-07-16)** by [`MASTER_PRD.md`](./MASTER_PRD.md). This file is
> retained as implementation history; it is no longer the roadmap authority.

**Historical scope:** On 2026-07-06 this document consolidated the then-current
engineering plan. Its roadmap authority ended when `MASTER_PRD.md` was adopted.

## One line
A price-aware, story-led London pub-crawl **map** where every pint has a story — *Letterboxd +
Instagram for pints* — built to make people come, drink, walk, and fall in love with London.

## Product loop
Open the map → tap a pub / landmark / transport symbol / crawl → grounded visual story →
start or join a nearby crawl (walk it) → **Last Pint** check before the next round → log a
Pint Drop → share → passport + friends → return.

Copy stays grounded: *"Every pint has a story. Bring back cheap pints, chaotic nights, and the
pub stories worth remembering. Last Pint: know when to order one more, and when to settle up."*

## Current state — BUILT & LIVE (do NOT rebuild)
- **Map:** premium keyless OpenFreeMap base (liberty/dark) + 3-D buildings; **46 landmarks** as
  recognizable pictograms with **verified Wikimedia photos** + sourced history; **296 POIs**
  across tube/rail/bus/river/park/garden/market/historic/viewpoint/sight with per-category
  toggles + zoom-depth; the **real coloured TfL rail network** (579 segments, official Colour
  Standard hexes) + line labels; price-coloured clustered pub pins; favourite-pint filter;
  **non-alcoholic filter + "0.0" badge**; beer-garden/outdoor filter; curated crawls; borough pages.
- **Last Pint:** real TfL `/api/last-train` (nearest station + last trains tonight, Night-Tube
  aware, graceful degradation) wired into the venue **Getting home** tab.
- **Mobile:** tabbed venue panel (Overview · Pints · Story · Ask · Getting home) as a bottom
  sheet; bottom tab bar; shared `SiteNav`.
- **Social spine (dual-backend memory+Supabase, RLS, moderation, rate-limited):** multi-lane
  feed; profiles + computed badges/stats; follow graph; 5 reactions; comments; Pint Drops
  (photo + price + story + vibe tags); presence; durable crawl stories + OG cards; saved pubs;
  leaderboards; **PUBMAXXER** grounded heritage Q&A.
- **Ops:** 462 unit + Playwright E2E, CI gate (lint/type/test/build), Vercel deploy, security
  headers + `/data` caching, actor/IP hashing, leak-proof public DTOs, provenance labelling.

## Audit findings (3 parallel audits, 2026-07-06) — the work list
**The code is genuinely robust.** Gaps, prioritised, with file anchors:
- **Scale [HIGH]:** the **6 MB `pint_prices_app_dataset.json` is re-fetched + parsed client-side
  every visit** (no timeout/error-UI/slim index) — `components/PubMap.tsx:141`. **OpenFreeMap
  tiles have no fallback** if the community service is down — `components/PubMapCanvas.tsx`.
- **Reliability [HIGH, guarded]:** in-memory stores reset on serverless cold-start / aren't shared
  across instances (`lib/*Store.ts`) — already 503-guarded in prod; add a fail-fast startup check.
- **Security [HIGH]:** no **CSP** yet (`next.config.mjs`). [MED] reports not per-actor-unique
  (report-spam) `app/api/pint-drops/route.ts`; OpenRouter key could surface in error logs
  `lib/heritage.ts`; **no build-time validation** of bundled JSON (`lib/venueIndex.ts`, `lib/pois.ts`).
- **Quality:** no coverage/complexity **score** gate in CI (the "grep loop score").
- **Social [P0]:** identity is self-asserted — anyone can edit any handle; no notifications /
  activity feed; Pint Passport stats computed but no UI; crawl stories anonymous; hidden comments
  not reviewable in `/admin`.

## Epics (execute in order; subagents per workstream; ship + checkpoint each)

### A · Repo & doc hygiene — ✅ DONE this session
Deleted stale `ci-vercel-gate`; gitignored local tooling; advanced branch to `main` (ended the
cherry-pick divergence); consolidated 16 PRDs into THIS doc (rest archived). Going forward:
**trunk-style** (commit → fast-forward push to `main`), cherry-pick only while codex has live WIP.

### B · Hardening (security · scale · reliability · quality gate)
- **Slim the dataset (biggest win):** `scripts/build_slim_index.mjs` → `public/data/venues_slim.json`
  (id, name, lat/lng, price bucket, borough ~300 KB); map/list load slim, detail lazy-loads via a
  cached `/api/venue/[id]`. Add AbortController + timeout + error/retry UI + IndexedDB cache to
  `PubMap.tsx`.
- **Map tile fallback:** wrap the OpenFreeMap style load → fall back to a second keyless style, then
  the existing WebGL notice.
- **CSP:** add a tested Content-Security-Policy (hash the inline theme script; `worker-src blob:`;
  `connect-src` Supabase + TfL + tiles + Wikimedia; `frame-ancestors 'none'`).
- **Governance:** `npm run validate-data` (validate every bundled JSON with the app's own guards,
  fail build) wired into CI; per-actor-unique reports migration + key; scrub API keys from logs;
  prod startup fail-fast if Supabase unconfigured.
- **Quality-score CI gate:** vitest `--coverage` threshold (start ~70%, ratchet) + ESLint complexity
  rule; surface a one-line score; block merge below.

### C · Real-time pint prices
- **Live layer (exists):** community Pint Drops are tonight's real prices — surface a per-venue
  "last updated" stamp and let contributor prices override the baseline on the map.
- **Scheduled price-refresh agent** (Vercel Cron / GitHub Action) that gathers current prices for a
  rotating set of London pubs from **permissible sources only** (first-party pub/brewery sites, open
  data, listings via search) using web-research tooling, validates + stamps `{source, observedAt}`,
  and writes a versioned `public/data/prices_YYYYMMDD.json` merged at build. ⚠️ **Governance:** respect
  ToS — do not scrape competitor price sites; attribute every price; never show a stale price as live.

### D · Auth ownership (unblocks the social product — needs the user to enable Google in Supabase)
Link `auth.uid()` → `profiles.user_id`; gate profile/crawl-story edits + drop deletes on ownership
(RLS `auth.uid()` policies); keep anonymous read + demo contribute; create only an absent handle
as account-owned. Existing unowned handle data is never re-attributed on sign-in.

### E · Social depth (all four north-stars)
- **Pint Passport (Letterboxd):** render the computed `profileStats`/`computeBadges` (pubs, boroughs,
  beers, crawls, badges) as a collectible card + **custom user lists** (beyond the 7 hardcoded).
- **Social gravity:** `notifications` table + bell + **activity feed** (followed/reacted/commented);
  optional email opt-in.
- **Instagram polish:** richer photo cards; per-account (not per-device) reactions post-auth; surface
  hidden comments in `/admin` (the `status` column exists).
- **Crawl-story authorship:** add `author_id`; edit/delete + attribute crawls to the profile.

### F · Explore London (fall-in-love-with-London)
Turn crawls into **routes**: walking/running distance + time between stops (reuse `lib/haversine`); a
"walk this crawl" mode threading pubs past the new gardens/markets/historic/viewpoint POIs; themed
"a pint, a park, a view" routes; shareable route cards — closing the map → crawl → story → share loop.

### G · Map storytelling + finish in-flight features (from codex's latest PRD, deduped)
- **Landmark story cards → journeys:** each landmark card gets nearby pubs (by distance + story),
  a **"Start crawl here"** action, and an **"Ask PUBMAXXER"** action seeded from the landmark.
- **Story bands** as typed map overlays (river history · writers/Fleet Street · markets/theatre ·
  royal/civic · Thames-side industrial · coding pint) with anchors + URL state + fallbacks.
- **Last Pint upgrade:** extend the card to next-departures at any time of day + the 3 nearest pubs to
  the station + a pub-native decision (`order_one_more | half_pint_only | settle_up_now | train_risk |
  live_data_unavailable`); session-only destination (never infer home).
- **Parallel coloured tube lines** (offset shared corridors) + **mobile drag bottom-sheet** + the 390px
  "Continue with Google" overflow fix.

## Execution model
One subagent workstream per epic/sub-item, **strict file-ownership** (no two agents touch one file),
each self-verifies; I integrate + run the full gate. Ship + checkpoint after each: `npm run ci`
(now incl. `validate-data` + coverage/complexity) + `npm run test:e2e` green → explicit-path commit →
fast-forward `main` → verify Vercel live. Coordinate around codex (same tree): own only new/disjoint
files, never `git add -A`.

## Verification
- **Unit/integration:** new pure logic (slim-index, price-merge + provenance, notification model,
  passport render, route distance, Last-Pint decision, story-band DTO) unit-tested.
- **CI gate:** lint + typecheck + tests + `validate-data` + **coverage ≥ threshold + complexity** + build.
- **E2E (assert the user contract, not MapLibre internals):** CSP doesn't break map/auth/last-train;
  POI + NA filters; landmark story card (image/credit/source/nearby/route); venue tabs switch; Last
  Pint decision states + TfL-outage fallback; `/u/you` first-run passport; owner-only profile edit;
  slim-index map load. Playwright mobile screenshots as the design/mobile QA gate.
- **Security re-check:** `mcp__supabase__get_advisors` after migrations; `curl -I` confirms CSP+headers.
- **Live:** after each ship, curl changed route/data + confirm the Vercel deploy.

## Out of scope (for now)
Native apps · payments / pub-owner dashboards · taxi booking · DMs/real-time chat · storing home
addresses by default · replacing MapLibre/OpenFreeMap · multi-city before the London loop is excellent.

## Appendix — archived source PRDs (folded into this doc)
`docs/archive/`: OPUS_REVIEW_PRD, PRD_ADDENDUM_BUILD_REVIEW, PRD_FABLE_FINAL_REVIEW_AND_LAUNCH,
PRD_FINAL_FOR_FABLE, PRD_MAP_FIRST_REDESIGN, PRD_OPUS_AFTER_MAP_UPGRADE_2026_07_06,
PRD_OPUS_FINAL_POLISH_2026_07_05, PRD_OPUS_NEXT_IMPROVEMENTS_2026_07_06, PRD_PINT_DROPS,
PRD_PRODUCTION_READINESS_FOR_OPUS, PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER, PRODUCT_PLAN, ACTIVE_PLAN,
cc_plan, cc_plan2, codex_plan. Kept live: `teach.md` (repo tour), `docs/DEPLOYMENT.md` (runbook),
`docs/DEMO_DECK.md`, `docs/adr/`, `README.md`, `CONTEXT.md`.
