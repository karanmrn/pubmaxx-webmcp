# PRD — Cycle "Trust & Tonight" (design + UI + security)

Owner-grilled and locked 2026-07-12. Supersedes [PRD_UI_NEXT.md](PRD_UI_NEXT.md)
and [PRD_WHATS_ON.md](PRD_WHATS_ON.md); this is the fleet's single routing
source for the cycle. PR-only to main; bots + architect review; difficulty→model
routing per house convention.

## Context

Since 2026-07-11 the fleet shipped all of Wave A (A1–A6), the B1 What's-On spine,
B2 sport data (37 attribute rows, 0 timed — FANZO robots-gated), B3 quiz data
(83 timed rows), C-1 booking links, the IA unification, and the U2–U6 polish
batch. **Status update 2026-07-22 (live audit):** migrations **0024_plans** and
**0025_price_confirms** remain **applied** on prod (`iankajxliutqogqkmvdg`) with
RPCs `create_plan_atomic` / `join_plan_atomic` present. E2 Night Mode, W4 music
data, W5 concierge what's-on intents, lane_to_plan analytics, and map
decomposition waves (F1/F2/M*) have landed on main. **W1 map Tonight lane + pin
badges consuming `/api/whats-on` is shipped** (`TonightLane`,
`useWhatsOnTonight`, pin badge join, analytics, e2e). Remaining W1 polish is
card enrichment (walk minutes + garden cue) and Discover `TonightNearbyLane`
absorption — not rebuilding the surface.

## Owner decisions (binding, from the 2026-07-12 grill)

1. **Flagship = Tonight surface (B6+E1 fused)**; cycle opens with a parallel trust wave.
2. **Prod migrations 0024/0025 — APPLIED** (2026-07-12). Plans/price-confirms durable path is live; keep store fail-soft + CI env isolation for unit tests.
3. **Security scope**: rate-limit batch + CSP nonce + T1 riders (HSTS preload, migration-ledger notes). Image-proxy DNS-rebinding formally accepted (see docs/SECURITY_POSTURE.md).
4. **Tonight launch story**: quiz = timed hero; sport = untimed "Screens live sport" attribute badge; parallel data PR attempts fixture×screening cross-reference (`confidence: derived`).
5. **All four verticals ship this cycle** — B4 deals and B5 music both in (B5 last, honest thin-coverage labels).
6. **B7 concierge what's-on intents in**, last in the What's-On lane.
7. **Wave E**: E4 in; E3 at tightened scope (one shared proxied image component + photo header + thumbnails; lore deferred); E2 Night Mode shipped (no longer migration-gated).
8. **Desktop**: land PR #186 (N4); N1 + N3 mid-cycle; N2 stretch-only behind F1.
9. **Full refactor lane F1→F2→F3→F4 this cycle**; N3 lands after F2 splits VenueInspector.
10. **Design verification**: harness upgrade + Gate-0 baseline + per-PR before/after shots + end-of-cycle graded re-review.
11. **C2 (#163) owner-lock LIFTED** — agents own wording. U1 (#156) closes on tap-path evidence.
12. **Owner fixes Actions billing (#41)**; Vercel-as-gate is the documented fallback meanwhile.
13. **Vercel Analytics + ~10 named custom events**, wired per-PR as part of DoD.
14. **Docs**: all three PRDs committed; this document is the routing source.

## Waves

### Wave 0 — Rig
| ID | Item | Status |
| --- | --- | --- |
| R1 | Harness: 1440×900 pass, tour seed, `npm run shots` | PR #188 |
| R2 | Gate-0 baseline sweep (both viewports/themes) → docs/screenshots/ | after R1 |
| R3 | `@vercel/analytics` + typed event rail: `badge_tap`, `lane_card_tap`, `lane_to_plan`, `cmdk_open`, `night_mode_active`, `drop_logged`, `booking_click`, `whats_on_filter`, `tour_complete`, `plan_created` | in flight |
| R4 | This docs PR | this PR |

### Wave T — Trust (parallel small PRs)
| ID | Item | Status / tier |
| --- | --- | --- |
| D1 | Borough ledger dedupe | PR #189 |
| D2 | Pin-soup clustering (light) + gate pin paint on tile paint | in flight, T3 |
| D3 | Tab bar clips content | PR #189 |
| D4 | "Sort it" CTA accent fill | PR #189 |
| D5 | Search placeholder truncation | T1 |
| D6 | Discover drink rail desktop-light | PR #187 |
| D7 | Desktop map control collisions | T2 |
| D8 | Truncation polish (partial in #189; feed ticker + venue tab remain) | T1 |
| U1 | (#156) Feed+Crawls tap-path at 390px — close on evidence | T1–T2 |
| C2 | (#163) copy rewrites — agent wording | T2 |

### Wave S — Security
| ID | Item | Status / tier |
| --- | --- | --- |
| S1 | `plan-card` rate limit (match card siblings) | in flight, T1 |
| S2 | Per-IP limits on CityMCP proxy surface + `/api/whats-on` | in flight, T2 |
| S3 | Limits on `GET /api/rounds/[code]` + `admin/import-notes` | in flight, T1 |
| S4 | CSP nonce middleware — drop `script-src 'unsafe-inline'` | in flight, T3 |
| S5 | HSTS preload + SECURITY_POSTURE.md + migration ledger notes | in flight, T1 |

### Wave W — What's-On flagship
| ID | Item | Tier → model |
| --- | --- | --- |
| W1 (=B6+E1) | **Tonight surface**: map pin badges + Tonight lane + `/api/whats-on` consumer; Discover points at the map lane (CityMCP `TonightNearbyLane` absorbed). | **SHIPPED** |
| W2 | Sport fixtures data: fixture calendar × screening pubs → `derived` rows; UI contract unchanged | **SHIPPED** (#203) |
| W3 (=B4) | Deals vertical: chain deal days + own pint prices ("cheap round") | **SHIPPED** (`DealsTonightLane`) |
| W4 (=B5) | Music vertical, last: CityMCP events + chain what's-on, thin-coverage labels | **SHIPPED** (`MusicTonightLane`) |
| W5 (=B7) | Concierge intents: parser gains sport/quiz/deal/music moods + tonight-row rank boost; LLM schema extends mood enum only | **SHIPPED** (`lib/concierge/whatsOn.ts`) |

### Wave F — Refactor lane (hard canvas freeze during F1)
F1 (#165) decompose PubMapCanvas/PubMap → F2 (#166) split VenueInspector /
PintDropComposer / RoutePanel → {F3 (#167) concierge-as-map-home, F4 (#168)
store-factory dedupe}. F1 starts the moment D2+D7 merge; only map-canvas work in
flight while it runs.

### Wave E — Mobile companion (after W1)
E4 crawl cards (PR #190) · E3′ one shared proxied venue-image component
(replaces the VenueInspector/PubsGallery/FeedCard/hover-card 3-way split) +
photo header + provenance-labelled thumbnails · E2 Night Mode bottom card —
**shipped** (migrations 0024/0025 applied on prod).

### Wave N — Desktop (parallel)
N4 feed desktop (PR #186) · N1 ⌘K palette (PR #191) · N3 venue inspector
desktop treatment (after F2) · N2 two-pane shell (stretch, behind F1).

### Gate Z — end of cycle
Graded screenshot re-review, same rubric/viewports as PRD_UI_NEXT's grades;
every Wave D defect must be invisible in the shots; grade movement recorded here.

## Sequencing

1. Wave 0 + T + S fan out in parallel (only D2/D7 touch map files).
2. D2+D7 merge → F1 starts (canvas freeze). W1 badge work fully before F1 or fully after — never during.
3. W1 → W2/W3 parallel → W4 → W5. N4/N1 merge on green; N3 after F2.
4. F1 → F2 → {F3, F4}. E4/E3′ after W1; E2 **shipped** (migrations applied; no longer gated).
5. Every UI PR: before/after shots at 390×844 + 1440×900, both themes; bots + architect review; local-ci green; Vercel preview green.

## Guardrails (unchanged, binding)

Provenance `{source, observedAt}` + visible "checked <date>" on every scraped
row; unknown ≠ invented; weekly refresh PR-gated; no third-party DB wholesale
scraping; store seam memory+Supabase with 503 on failed durable writes;
signal-only realtime; frozen map canvas until F1; coverage ratchet only rises;
Apple-design bar (springs, 1:1 tracking, interruptible animation, translucent
chrome hierarchy, reduced-motion cross-fades, one primary action per screen).

## Metrics (measurable once R3 lands)

North star: weekly active crews. Cycle: `badge_tap` % of map sessions;
`lane_to_plan` conversions (post-migration); `cmdk_open` usage;
`night_mode_active` sessions; pin-soup zero-incidence (Gate Z); quiz/sport/deal
row coverage by borough; median `observedAt` freshness.

## Owner actions

1. ~~**Supabase MCP re-auth** → apply 0024/0025~~ **DONE 2026-07-12** on prod.
2. **GitHub Actions billing (#41)** → revives the bot rail.
3. Firecrawl key re-auth (W2/W3 scrape quality); CAMRA/Collins/OpenTable applications (C-2 rails epic, next cycle).
4. Owner wording review on C2 copy PR (#204) before merge.
