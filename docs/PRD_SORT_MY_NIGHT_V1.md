# PRD — "Sort My Night" (PUBMAXXING v1 flagship)

> Status: draft v1 · 2026-07-11 · Author: Fable (product), grilled with the owner
> Distinct from `VERSION_ONE.md` (the consolidated feature inventory) and the code-remediation
> and side-agent wave PRDs. This is the **product-thesis PRD**: the wedge, the core loop, the
> mobile + desktop experience, the new feature spine, and the model/agent routing to build it.

---

## 0. One line

**"We're going out — sort it."** The fastest, best-looking way for a small crew of professionals
to turn *"shall we get a drink?"* into a plan everyone's in on — in one tap.

---

## 1. The thesis (what the grilling settled)

PUBMAXXING today is a beautiful **discovery atlas** — a map of real pint prices, drinks, stories,
9 UK cities. But the job the owner keeps naming — *plan a night out, a crawl, with friends* — is a
**coordination** job, and it barely exists (`/crawls` is exploration, not logistics: no friends,
no time, no "who's in," no itinerary you send). v1 closes that gap without throwing away the atlas.

The synthesis that reconciles every decision below: the product is **same-evening, small-group,
low-drama coordination** — *"the four of us are leaving the office in 20 minutes; where do we go,
in what order, and get everyone on the same page without a 40-message WhatsApp thread."* The map
becomes a **shareable plan** in one tap. The concierge picks the pubs. Your crew persists between
nights. The real competitor is not Google Maps — it is **someone dropping three Google pins into a
WhatsApp group.** We must beat that by 10×.

## 2. The decisions (owner-confirmed, from the grill)

| Axis | Decision | Consequence for the build |
|---|---|---|
| **Wedge (win first)** | After-work professionals, 25–40, London | Fast, reliable "where now", low-drama; mobile-on-the-street primary |
| **Core job** | Plan + coordinate a crawl with friends (same-evening, small group) | Coordination > content; the Plan Card is the centrepiece |
| **Centre of gravity** | Map that becomes a shareable plan in one tap | Map stays, but the *plan* is the product surface |
| **Join mechanic** | Frictionless: link opens instantly, tap "I'm in" with a name; account offered **after** value | Protects the viral coefficient; no account wall |
| **Concierge** | Chat + tap + voice → one ranking engine ("tell it the mood, it decides") | The PUBMAXXER AI becomes the *front door*, not a garnish |
| **Getting in** | Real-time "busy/quiet" + book-a-table links are core | Data + partnership dependency; also the honest revenue path |
| **Frequency** | Both — weekday habit + weekend occasion, one app two rhythms | Two modes, two design souls (see §8) |
| **Growth engine** | Owner's bet: **both** the plan-invite loop AND the public feed (informed choice; splits focus) | We *sequence* them: invite-loop is the weekday engine, feed is the weekend engine |
| **Aesthetic** | **Light = Airbnb/Partiful** (warm, editorial, the invite as an object) · **Dark = Arc/Linear** (sharp, high-craft, on-the-street) | Two souls mapped onto the two existing themes and two moments of the night |
| **Geography** | UK-wide land-grab, keep the 9 cities warm; London perfect first | Coverage as a moat; London depth is the wedge |
| **Ambition** | Beautiful now, business later | Build a clean revenue *surface*, don't jam ads in |
| **Revenue rail** | Promoted pubs — **quarantined** from honest discovery lists (labelled "Featured", never in cheapest or other trust-ranked lists, never touches the concierge) | Sell attention *next to* trust, never sell the ranking |
| **North-star metric** | **Weekly active crews** — groups that plan a night together each week | Everything optimises toward this |
| **What we cut** | Owner: cut nothing. Resolution: nothing is deleted; the wedge gets the **default** — the pro's home is "sort my night", clout/heritage/solo-browse are one tap away, not front-and-centre |

## 3. Where we build FROM (do not rebuild)

Reference `VERSION_ONE.md` for the full inventory. Load-bearing assets this PRD reuses:
- The **map** (3-D vector, slim-load, price pins, drink glyphs, bands, landmarks, tube overlays).
- **The Spill composer** (camera/price/visibility/drafts) — becomes "we ended up here" capture.
- **PUBMAXXER** grounded LLM (`/api/heritage`) — becomes the concierge brain.
- **Rounds** (`/rounds/[code]`, join-by-code, presence) — the seed of crews + the Plan.
- **Last Pint** transport (fix C1/C2 midnight bugs first — see §12).
- Dual-backend store seam, realtime signal-only pattern, OG card pipeline, ratings, offline SW,
  the two-theme token system + category colours, 9-city rails.

## 4. The core loop — "sort my night" (the flow)

1. **Open → the concierge is the front door.** "Quiet-ish near Bank, 4 of us, not pricey" (type,
   tap chips, or say it). It returns 2–3 ranked pubs + an optional narrated crawl.
2. **One tap → a Plan.** The chosen pubs become an ordered Plan with a start time. The map draws it.
3. **Share → the Plan Card.** A gorgeous link (OG pipeline). Mates open it with **no wall**, see
   the pubs/order/time/who's in, tap **"I'm in"** with a name.
4. **Live coordination.** Who's in / on the way / here; "running late / start without me"; in-plan
   reactions so the decision never leaves for WhatsApp; whose-round tracker.
5. **Getting in.** Busy/quiet signal + "can 6 of us get in" + book-a-table.
6. **Last Pint.** When to leave to get home, per line.
7. **After.** "We ended up here" one-tap price/photo drop (feeds the honest data) → **Night recap
   card** (shareable) → the crew persists → one-tap re-invite next week.

That loop is the north-star engine: every shared Plan exposes 2–5 new people to the app at the
exact moment they're deciding to go out.

## 5. Mobile experience (the primary surface — spec)

- **Home = "Sort my night."** Default screen is the concierge input + a live map behind it. Bottom
  `MobileTabBar`: Sort · Map · Crew · You (+ the Drop primary action). Everything else (feed,
  discover, ledger, passport) reachable but not front-and-centre for the wedge default.
- **Concierge sheet:** grows from the input; chip row (vibe / group size / area / budget), a mic
  button (existing Web Speech), and a text field — all feed one ranking call. Results as swipeable
  cards; "Make it a Plan" CTA.
- **Plan sheet:** the existing drag-to-snap venue sheet generalises — peek shows the Plan summary
  (stops, time, who's in), half shows the route + busy/get-in, full shows per-stop detail. Primary
  action (Share / I'm in / Log) always clears the tab bar (safe-area).
- **Live crew strip:** persistent, thumb-reachable "who's on the way" + "we're at pub 2" one-taps.
- **On-the-street mode = dark "Night Out":** sharp, high-contrast, big targets (fix the 38–40px
  tab-bar targets to 44px), minimal chrome, fast. Planning-at-work = light "Candle Coral": warm,
  editorial, the Plan Card looks like something you *want* to send.
- Offline-resilient (pubs have bad signal); reduced-motion + Legacy Mode honoured throughout.

## 6. Desktop experience (spec)

- **Not a stretched phone.** Desktop is where planning-ahead happens (at your desk, 6pm Thursday).
- **Two-pane:** left = concierge + the Plan being assembled (list, times, crew, share); right = the
  map with the Plan drawn live. Editing the Plan updates the map; clicking the map adds a stop.
- **The Plan Card preview** renders full-size — desktop is the best place to *craft* the invite.
- Keyboard-first: arrow/enter to accept concierge picks, ⌘K command bar for "add pub / set time /
  invite". Constrain prose to a `--measure` token (no full-bleed text lines).
- `SiteNav` moves into a shared layout segment (today it's hand-mounted on 10+ pages — any new page
  ships nav-less; see the code-remediation plan).

## 7. Feature spine (by phase of the night)

Priority: **P0** = the core loop must-haves · **P1** = makes it 10× vs WhatsApp+pins · **P2** =
depth/retention · **P3** = growth/monetization surface.

**Deciding (the concierge):**
- P0 · One ranking engine behind chat/tap/voice; returns ranked pubs + optional narrated crawl.
- P0 · Context-aware defaults (weather, time, day → cosy/garden/riverside).
- P1 · **Match-the-group:** each mate's 3-tap preference → the concierge finds the overlap.
- P2 · "Surprise us" — one-tap narrated 3-stop crawl.

**Coordinating (the Plan + the crew):**
- P0 · **The Plan** object (ordered stops + start time) + the map drawing it.
- P0 · **The Plan Card** shareable link; frictionless join (tap "I'm in" + name, account after value).
- P0 · Live presence on the Plan (in / on the way / here); "running late / start without me".
- P1 · **Persistent crews** ("the Thursday lot") + one-tap re-invite — the retention engine.
- P1 · In-plan reactions/short chat (keep the decision in-app).
- P2 · Whose-round tracker + optional low-drama split.
- P2 · Calendar drop (`.ics` exists) + "leave in 20 to make your table" reminder.

**Getting in (the pro's anxiety):**
- P0 · Busy/quiet estimate (opening hours + typical patterns) + community "rammed/quiet" reports.
- P1 · "Can N of us get in" filter; **book-a-table** links (revenue path).
- P0 · **Last Pint** — fix C1/C2 first; per-line "leave by".

**During & after (memory + weekend rhythm):**
- P1 · Live **"tonight" map** — crews out now (opt-in) — the weekend/feed engine.
- P1 · "We ended up here" one-tap Spill (feeds honest data).
- P2 · **Night recap card** — auto "where we went / route / the damage", shareable.
- P2 · Ratings that drive next time ("you loved X → try Y").

**Discovery & UK land-grab:**
- P1 · **Occasion templates** — "leaving do", "birthday for 10", "watch the match", "client dinner",
  "first date" — pre-shaped Plans (big for pros *and* for Featured-pub revenue).
- P2 · City "best-for-X" editorial guides (SEO land-grab across the 9 cities + tourist catch).
- P2 · "Near the office / near a station" quick-lists.
- P3 · **Featured tonight** promoted slot — quarantined from honest ranking, clearly labelled.

## 8. Design — the two souls

One token system, two moods tied to two moments:
- **Light "Candle Coral" = planning** → Airbnb/Partiful: warm paper, coral CTA, generous editorial
  type (Space Grotesk display), the Plan Card as a beautiful object, soft depth + texture.
- **Dark "Night Out" = executing** → Arc/Linear: deep ink, amber/neon accents, sharp high-craft,
  big targets, minimal chrome, fast. This is the on-the-street surface.
- Category colour language (`--cat-*`) threads drink identity through both. Motion stays restrained
  (reveal, plan-draw, pin pulse), reduced-motion + Legacy Mode always honoured. AA on every pairing.

## 9. Roadmap

- **P0 — The loop (make it exist):** concierge ranking engine · the Plan object + map draw · the
  Plan Card + frictionless join · live presence · busy/quiet estimate · Last Pint bug-fix.
- **P1 — 10× vs WhatsApp:** match-the-group · persistent crews + re-invite · in-plan chat ·
  book-a-table + "can N get in" · live tonight map · occasion templates.
- **P2 — Depth/retention:** whose-round/split · calendar + leave-by · night recap card · ratings
  nudges · city guides · quick-lists.
- **P3 — Growth/revenue:** Featured-pub slot (quarantined) · work/team accounts · partner booking
  network · deeper multi-city.
- **Prereq (from the code-remediation plan):** decompose `PubMapCanvas`/`PubMap` before heavy new
  map work; reconcile the duplicate-numbered migrations; z-index token scale; 44px tap targets.

## 10. Model & agent routing by difficulty (Anthropic + OpenAI)

Route each workstream to the cheapest model that clears its difficulty; escalate only where the
task genuinely demands it. "1M ctx" = use the long-context variant when the change spans many files.

| Tier | What it looks like | Anthropic | OpenAI | Example workstreams |
|---|---|---|---|---|
| **T4 — Hardest** | Novel architecture, LLM ranking, realtime + auth + state sync, security-critical, giant-file surgery | **Opus 4.8 (1M ctx)** | **GPT-5.6** | Concierge ranking engine; the Plan/crew realtime coordination backend + state sync; auth-hardening + frictionless-join identity model; **map-file decomposition** (prereq) |
| **T3 — Hard** | Multi-file features, external integrations, data pipelines, migrations | **Opus 4.8** or **Sonnet 5 (1M ctx)** | **GPT-5.6** or **GPT-5.5** | Book-a-table + busyness integrations; occasion-template engine; migrations 0021+/dedupe; night-recap generation |
| **T2 — Medium** | Scoped features, UI-with-logic, component splits, tests | **Sonnet 5** | **GPT-5.5** / **Codex** | Plan Card UI + share; crew management UI; match-the-group; live tonight map; component splits (VenueInspector etc.); city guides |
| **T1 — Low** | Mechanical, content, CSS, cleanup, copy | **Sonnet 5** / **Haiku 4.5** | **Codex** / **GPT-5.5-mini** | Token/z-index cleanup; empty-state migration; dead-code removal; quick-lists; copy; dedup helpers |
| **Design** | Visual craft, the two-souls system, polish | **Sonnet 5 + design-taste agent** | **GPT-5.5 + design pass** | The Airbnb-light / Arc-dark treatment; Plan Card aesthetic; mobile polish |

Orchestration rule (proven this project): one agent owns a disjoint file set per wave; strict
ownership; integrate + gate centrally (`npm run ci` + `npm run test:e2e` + the map console-probe);
scoped commits, never `git add -A` (side agents co-develop live); stash-push-pop around their WIP.
The **map decomposition wave pauses side agents** on `components/PubMap*.tsx` + `components/map/**`.

## 11. Success metrics

- **North star: Weekly Active Crews** (a group that shared/joined a Plan this week).
- Plan **share → "I'm in" conversion** (the viral coefficient; the join-wall decision protects this).
- **Weekday retention** (the after-work habit forming) vs weekend occasion spikes.
- Concierge → Plan conversion (does the front door actually produce plans).
- Get-in success (book-a-table clicks / "we got in" confirms) — the revenue leading indicator.
- City coverage depth (real prices/venues live) as the land-grab scoreboard.

## 12. Guardrails & non-negotiables

- **Trust is the asset.** Promoted pubs never enter the honest ranking or the concierge; provenance
  never flattens; "real prices, no fake catalogues" holds.
- **No account wall on join.** Frictionless first, relationship captured after demonstrated value.
- **Low-drama.** No gamification pressure in the wedge's default surface; Chaos Score/passport are
  opt-in, one tap away — never in the 34-year-old's face.
- **Fix correctness before flash:** Last Pint C1/C2 midnight bugs, the duplicate migrations.
- AA contrast, reduced-motion, Legacy Mode, offline — all held. Coverage ratchet only rises.
- Duty of care: celebrate breadth/discovery, never consumption frequency/speed.

## 13. Open questions / dependencies

- **Busyness data:** no free real-time API — v1 = estimate + community reports; partners (Popular
  Times-style / foot-traffic) later. Confirm which booking partner to integrate first
  (OpenTable / DesignMyNight / SevenRooms) — drives the "can N get in" fidelity.
- **Auth:** [`DEPLOYMENT.md`](./DEPLOYMENT.md#3-browser-sign-in-email-magic-link--google--apple)
  owns current sign-in capability and provider activation state.
- **Realtime scale:** the signal-only Supabase pattern holds for crews; validate at party-size fan-out.
- **Both-growth-engines bet:** owner chose to run plan-invite AND public feed as core; revisit at
  the first metrics read — if weekly-active-crews is driven ~entirely by invites, demote the feed.
