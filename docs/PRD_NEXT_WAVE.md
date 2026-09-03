# PRD — Next Wave (post-Sort-My-Night-P0), 2026-07-11

Routing PRD for the agent fleet. Every task carries a difficulty tier and the
models cleared to execute it. **All work lands as PRs**; bots (CodeRabbit /
Greptile) must pass, then the architect (Fable) reviews before merge. Never
`git add -A` — explicit paths only.

## Difficulty → model routing

| Tier | What qualifies | Anthropic | OpenAI |
| --- | --- | --- | --- |
| T4 | architecture, concurrency, ranking engines, map internals | Opus 4.8 (1M) | GPT-5.6 |
| T3 | multi-file features, store seams, data pipelines | Opus 4.8 / Sonnet 5 (1M) | GPT-5.5 |
| T2 | UI slices, wiring, copy, tests | Sonnet 5 | GPT-5.5 / Codex |
| T1 | mechanical: renames, CSS swaps, docs | Haiku 4.5 | Codex |

## State of the world (verified 2026-07-12)

- Prod (pubmaxxing.com) serves current main; Vercel + local-ci are the interim gates.
- Migrations `0024_plans` / `0025_price_confirms` **APPLIED** on live Supabase
  (`iankajxliutqogqkmvdg`) — plans + price confirms durable. Unit tests must
  clear `SUPABASE_*` env so CI does not hit live tables.
- GitHub Actions still dead at the ACCOUNT level (billing/spending limit — every
  run `startup_failure` pre-allocation). Owner-only fix. Vercel build + local
  gates remain the interim gate; ci.yml stays manual-only until fixed.
- W1–W5 What's-On flagship + E2 Night Mode + lane_to_plan analytics are on main
  (map Tonight lane/pin badges, Deals + Music Discover lanes, concierge intents).
  Residual polish ships via the Trust & Tonight residuals PR (walk/garden cues,
  Discover→map absorb, usual-lot invite).

## House guardrails (bind every task)

1. Frictionless join: opening a shared link never requires an account.
2. Provenance honesty: scraped/estimated data carries `{source, observedAt}` /
   `isEstimate`; never presented as community data; promoted venues never mix
   into honest rankings.
3. Store seam: every store works memory + Supabase, selected by
   `isSupabaseConfigured()`; durable WRITE failures → 503, reads fail soft.
4. Signal-only realtime: payloads never rendered, only trigger refetches.
5. Design tokens only — no literal z-index/hex where a semantic token exists
   (docs/DESIGN_SYSTEM.md); every animation behind reduced-motion gates.
6. Vercel runs vitest under NODE_ENV=production — neutralize prod-only guards
   in tests via the established `vi.mock` pattern.

---

## Wave S — Salvage (parallel lane, owner-approved: revive ALL)

Each item = one PR from the surviving branch, rebased onto main, provenance
labels added, its own bot+architect review.

| ID | Task | Source | Tier → models |
| --- | --- | --- | --- |
| S1 | 6,141-row scraped drink-price payload + Greene King/M&B menu parsers; add `{source, observedAt}` to every row; wire into the weekly PR-gated refresh | branch `cursor/firecrawl-pub-scraping-aec3` (#139) | T3 → GPT-5.6 or Opus 4.8 |
| S2 | Wetherspoons UK directory: 824 pubs + GeoJSON + `lib/wetherspoonsDirectory.ts` | branch `cursor/wetherspoons-directory-scrape-aec3` (#135) | T2 → Sonnet 5 |
| S3 | Greene King food menus + food price map layer (90 files) | branch `cursor/greene-king-menus-aec3` (#138) | T3 → Sonnet 5 (1M) |
| S4 | TfL journey legs in RoutePanel + Tonight overlay chip — the `/api/citymcp/journey` API is live on prod and UNUSED | branch `cursor/london-chain-scrape-e4ef` (#142 UI half) | T3 → Opus 4.8 |
| S5 | Unique small fixes from #133/#143: borough camera fit, 44px map FABs, citySwitcher z-index, "Plan tonight Plan" dual-label bug | branches `cursor/map-declutter-outer-finish-8c7c`, `cursor/ui-mobile-desktop-polish-8c7c` | T1-T2 → Codex / Haiku 4.5 |
| S6 | Bot findings on main: LRU/size-cap the `placeCache`/`thingsToDoCache`/journey caches in `lib/citymcp/client.ts`; `https?:` scheme guard on `menuUrl` in `lib/scrapedPubs.server.ts`; og:image → canonical pubmaxxing.com | main | T1 → Codex / Haiku 4.5 |

## Wave U — Mobile UX majors (from the 390px walkthrough)

| ID | Task | Tier → models |
| --- | --- | --- |
| U1 | Surface Feed + Crawls on mobile (links exist but are desktop-only-visible; nothing at 390px reaches them) — rides the IA change in C1 | T2 → Sonnet 5 |
| U2 | Anonymous "Cheers" fails silently (503, no feedback): optimistic state + toast, or claim-a-handle prompt like Activity | T2 → Sonnet 5 |
| U3 | `/map?sel=` deep link opens the sheet but never moves the camera — flyTo the pin when `sel` resolves | T2 → Sonnet 5 (map chrome only, no PubMap internals) |
| U4 | CSP `img-src` allowlist (next.config.mjs) blocks scraped-pub photos — extend allowlist or proxy images | T2 → Sonnet 5 |
| U5 | Map top-bar collision at 390px: disruption banner vs city chip + "No route" chip | T2 → Codex |
| U6 | Polish batch: /messages Georgia-serif h1 + edge padding; venue-sheet title inset + dead space; story-modal sticky-footer overlap; layers-panel clipping; geolocation-honest "nearby" in Drop composer; labelled OAuth buttons | T1 → Haiku 4.5 / Codex |

## Wave C — Copy + IA unification (owner decisions locked)

| ID | Task | Tier → models |
| --- | --- | --- |
| C1 | **One coordinated IA PR:** unified tab set everywhere — **Map · Pubs · Drop · Pint stories · You**; "London"→"Boroughs"; kill the Drinks/Discover split (one canonical route + redirect); one-noun vocabulary — **"Pint Drop"** in every button/error/composer ("Spill" survives only as a venue-page section name); Feed/Crawls reachable on mobile; e2e nav tests updated | T3 → Opus 4.8 |
| C2 | **Copy PR: the 10 rewrites + developer-speak purge** (owner reviews wording in the diff): landing hero "Know the price before you order…"; primary CTA "Find pubs near me"; map loading "Finding the pubs. Fetching tonight's prices."; leaderboard de-dataset-ing; get-in "Four of you should get in fine — but no promises on a Friday. If it matters, book."; busyness "That's the usual pattern for this hour — we're not watching the door."; feed empty-state reorder; "Lock it in" plan CTA; one-noun error strings; borough coverage line | T2 → Sonnet 5 |
| C3 | **"Plan tonight" CTA pinned on the Map** (primary entry; absorbs Start Round entry). Plan gets a tab later only if usage proves it | T2 → Sonnet 5 |

## Wave F — Flagships (sequenced, not parallel)

| ID | Task | Tier → models | Precondition |
| --- | --- | --- | --- |
| F1 | Map decomposition: `components/PubMapCanvas.tsx` (2.6k lines) + `PubMap.tsx` (complexity 74) split into layered modules | T4 → Opus 4.8 (1M) | ALL other agents paused on `components/PubMap*.tsx` + `components/map/**` |
| F2 | Component splits: VenueInspector, PintDropComposer, RoutePanel | T3 → Sonnet 5 (1M) | codex paused on those files |
| F3 | Sort-My-Night P1: concierge-as-map-home, plan drawn on the map | T4 → Opus 4.8 | F1 merged |
| F4 | Store-factory dedupe: 13 `lib/*Store.ts` files / 5.5k lines of dual-backend boilerplate → one factory | T3 → GPT-5.6 | F2 merged (touches everything) |

## Owner actions (blocking)

1. GitHub Actions billing/spending limit (github.com/settings/billing) → then
   branch protection on main + required checks.
2. ~~Supabase MCP re-auth → apply migrations 0024 + 0025~~ **DONE 2026-07-12**
   (plans + price_confirms live on prod). Keep advisors green after schema PRs.
3. Review the copy wording in the C2 diff before merge.
4. Firecrawl key re-auth when scrape refresh PRs need higher quality.

## Verification bar (every PR)

vitest + tsc + eslint green; coverage ratchet holds (74/77/71 — only rises);
e2e where surfaces changed; bots pass; architect review recorded; live-verify
on prod after merge (the changed surface, in both themes, at 390px first).
