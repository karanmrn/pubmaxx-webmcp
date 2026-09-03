# Desktop feature parity — gap audit & phased plan

**Status:** **HISTORICAL SNAPSHOT** (gap audit as of 2026-07-23; current behavior lives in source)

**Date:** 2026-07-23  
**Away-mode supervisor:** Local commit on this docs branch only. **Do not push, open PR, or merge** without owner review. **Do not start Waves D1–D6.**  
**Isolation (mandatory):** this plan lives **only** on a dedicated git worktree / branch so it does not pollute `main` or other cmux agent trees.

| Isolation field | Value |
|-----------------|--------|
| Worktree | `/Users/karanmanoharan/Documents/pubmax-desktop-parity-plan` |
| Branch | `docs/desktop-feature-parity-plan` |
| Plan path (this tree only) | `docs/plans/desktop-feature-parity.md` |
| Do **not** edit this plan on | `main`, Fable trees (`pubmax-fable-*`), Sol branches, Opus/Codex wave worktrees under `.codex-worktrees/*` |
| Implement later via | **new** feature branches from fresh `origin/main` **after** gate checks in §5.1 — never stack on concurrent agent branches |

**Restart note:** Prior session died on context overflow (~3.1M-token dump). Rewrite used subagent summaries + targeted greps only.  
**Scope:** Mobile web (≤640px primary product surface) vs desktop web (≥641px, QA matrix **1280×800** and **1440×900**, light + dark)  
**Out of scope:** Capacitor native store polish, persona-drinks content lane, new desktop-only product surfaces as the strategy

---

## 1. Executive summary

PubMax is **mobile-first by design** and that remains correct. The phone shell (bottom tabs + map portal sheets) is the mature interaction model. Desktop already reuses most **panel content** (venue inspector, planner, feed cards) and has meaningful wide layouts on **Map, Tonight, Feed, Plan, Discover, Pal, Pubs**.

What still lags is not “does the page load at 1440px?” — it is:

1. **Shell incompleteness (D1):** owner-required **always-visible Conditions + area news + night arc rail** is only partially shipped (Conditions chip on map toolbar; AreaNews on `/tonight`; no unified map right rail).
2. **Reachability (D2):** secondary journeys (Plan, Near, Historic, Pubs, Pal, Messages, Activity) are first-class enough on mobile (tabs, sheets, tour) but **under-linked on desktop** beyond SiteNav utilities + ⌘K.
3. **Narrow “paper” density:** several high-traffic surfaces stay single 640–720 columns on large monitors (Today, Messages, Activity, We-are-out, many story/detail pages).
4. **Dual-path map tech debt:** phone portal (≤640) vs side drawers (>640) vs **legacy 641–768 bottom-sheet CSS** on drawer DOM — tablet seam is the worst UX band.
5. **Known open ticket:** desktop **area-search / gazetteer parity** is mobile-shell-only by construction (`FABLE_HANDOFF`).

**Prior product authority:** `docs/PERSONA_DRINKS_AND_DESKTOP_PRD.md` (D1/D2) — desktop parity **is** launch-relevant; persona-drinks surfaces are **not**.

**Recommendation (collision-aware):** run **docs + low-contention social/desktop-chrome first**; **hold** Today / Plan / Tonight / persona / security-touching waves until concurrent Sol·Fable·Opus·Codex lanes clear (see §5). Do not run desktop map-shell PRs in the same merge window as Sol map chrome or producthunt tonight.

---

## 2. Product stance (from docs + code)

| Principle | Source |
|-----------|--------|
| Mobile-first is canonical; desktop is denser adaptation of the **same jobs** | `MOBILE_FLOW_SPEC`, `PRD_PUBMAXX_UNIFIED_PRODUCT`, `PERSONA_DRINKS…` |
| Same primary jobs: **Today · Map · Moment · Tonight · Stories · You** (Moment = compose action, not a place) | `navigationModel.ts`, `MobileTabBar`, `SiteNav` |
| Desktop keeps its own nav; mobile owns bottom tabs | `MOBILE_FLOW_SPEC` |
| No new desktop-only product as the main strategy | `PRD_MOBILE_FIRST…` non-goals |
| D1 right rail + D2 feature audit at 1440×900 | `PERSONA_DRINKS_AND_DESKTOP_PRD` |
| Keyboard cheap wins: Esc closes overlays; `/` focuses map search | D2 + `useMapKeyboardShortcuts` |

### Breakpoints & tokens

| Value | Role | SSOT? |
|-------|------|-------|
| **640 / 641px** | Phone vs desktop JS/CSS shell split | **Yes** — `lib/breakpoints.ts` `MOBILE_MAX_WIDTH` / `MOBILE_MEDIA_QUERY` (CSS mirrors by hand) |
| **768px** | Map drawer CSS band (bottom-sheet transform on `.mapDrawer`) | **No** — conflicts with 640 JS path (tablet hybrid) |
| **900 / 1180px** | SiteNav density; ⌘K control hidden ≤900 | SiteNav CSS only |
| **1024px** | Tonight rail, Feed rail+2-up, map docked inspector polish | Feature CSS |
| **`--content-max: 640px`**, **`--content-max-wide: 1240px`** | Reading vs wide shells | `globals.css` — **partially adopted** |
| Playwright | Mobile 390/430; desktop 1280/1440 | `playwright.config.ts` |

---

## 3. Current architecture snapshot

### 3.1 Global chrome

```
app/layout.tsx
  ├─ CommandPaletteProvider (⌘K / Ctrl+K)
  ├─ SiteNav (full links ≥641; compact ≤640)
  ├─ MobileTabBar (non-root routes; CSS display:none ≥641)
  └─ DeferredShellExtras (tour, A2HS, push, night mode…)
```

| Surface | Mobile (≤640) | Desktop (≥641) |
|---------|---------------|----------------|
| Primary IA | Bottom tabs: Today, Map, **Moment FAB**, Tonight, Stories, You | Top SiteNav: Today, Map, Tonight, Stories, You + Moment icon + ⌘K |
| Utilities | Compact top bar (wordmark, bell, messages, theme) | Same utilities + fuller link row |
| Map host | `MobileMapShell` + portal `MobileSharedSheet` | `SiteNav` + `MapToolbar` + left/right `.mapDrawer` |

### 3.2 Desktop-only components today

| Component | Mount | Role |
|-----------|-------|------|
| `ConditionsChip` | `MapToolbar` when `isMobile === false` | Weather / drink verdict on map (owner: always visible) |
| `AreaNewsRail` | `/tonight` rail block | “New round here” dated facts; fail-soft empty |
| `siteNavMoment` | SiteNav actions | Moment compose when tab FAB absent |

There is **no** shared `DesktopRightRail` host used across map + feed + tonight yet — D1 pieces are **embedded per surface**.

### 3.3 Map dual path (highest complexity)

| Band | Interaction model | Notes |
|------|-------------------|--------|
| ≤640 | Portal bottom sheet + height snaps; MobileMapShell chips | Mature; gestures via `useSheetHeightDrag` |
| 641–768 | **JS side-drawer DOM** + **CSS translateY sheet** | Hybrid / awkward; drag often no-ops above 640 |
| ≥769 | Side drawers (`translateX`, ~376px), dual open possible | Planner left + venue right; keyboard `/` + Esc |

**Shared content, different chrome:** `ControlRail` / `RoutePanel` / `VenueInspector` bodies are shared; chrome trees diverge hard.

### 3.4 What already works well on desktop

- **Map:** side drawers, MapToolbar, ConditionsChip, dual drawer capability, keyboard search/Esc, layers/price controls
- **Tonight:** sticky 2-column rail ≥1024 (conditions + AreaNews)
- **Feed:** ≥1024 filter rail + two-up stream (N4 / D1 partial)
- **Plan composer:** multi-column shell (~1160)
- **Discover / Pubs / Pal / Historic index / Bar-tab:** grids or multi-col
- **⌘K command palette** as desktop power entry
- **Hover polish** widespread (`pointer: fine`)

---

## 4. Gap audit

Severity: **P0** blocks “first-class desktop” claim · **P1** core journey quality · **P2** polish / power · **Tech** debt enabling the rest

### 4.1 Information architecture & reachability

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| IA-1 | Secondary destinations (**/plan**, **/near**, **/pubs**, **/historic**, **/pal**, plan list) lack durable primary chrome on desktop beyond ⌘K / in-page links | P0 | SiteNav = primary 5 + utilities; mobile has stronger map-chip / tour density |
| IA-2 | **Stories** bucket absorbs `/feed`, `/discover`, `/crawls` — OK for active state, weak for discovering crawls/historic from top nav | P1 | `navigationModel.ts` match set |
| IA-3 | Vocabulary must stay unified (no desktop “Drinks” vs mobile “Discover” regressions) | P1 | `MOBILE_FLOW_SPEC` open violations historically; current model uses Stories |
| IA-4 | Mid-width **641–900**: full desktop links, no tab bar, **⌘K control hidden** — discoverability valley | P1 | `siteNav.css` |
| IA-5 | First-run tour has no spotlight at all — it is one card, so no surface is pointed at on either size | P2 | `FirstRunTour` (the tab-column spotlight seam was never rendered and is now removed) |

### 4.2 Map & planner chrome

| ID | Gap | Severity | Evidence |
|----|-----|----------|----------|
| MAP-1 | **D1 right rail incomplete on map** — Conditions = toolbar chip only; AreaNews **not** on map; night arc/get-home not persistent rail | P0 | `ConditionsChip` comments; AreaNews only Tonight; PRD D1 |
| MAP-2 | **Desktop area-search / gazetteer parity** open ticket — mobile shell search richer by construction | P0 | `FABLE_HANDOFF` clarified ticket |
| MAP-3 | **`MobilePlanActivation`** (“describe your night” mood/intent generate) **phone-only** | P1 | `components/plan/MobilePlanActivation.tsx` usage |
| MAP-4 | Mobile first-class **Near me / Tonight / TfL / Filters / Layers** chip rail vs desktop scattered toolbar/banners/lanes — feature parity of *content* mostly yes, *discoverability* uneven | P1 | `MobileMapShell` vs desktop chrome tree |
| MAP-5 | Venue **sticky action footer** (Drop/Share/Crawl) polished in portal; desktop sticky bar largely CSS-hidden / tab-hunting | P1 | `VenueStickyBar` comments |
| MAP-6 | Wide canvas **underuses dual-panel** — can open both drawers but not productized as “plan + detail” with map padding | P2 | PubMap mutual exclusion only on mobile |
| MAP-7 | **Tablet 641–768** transform dual-axis tech debt | Tech / P1 UX | globals `.mapDrawer` + `useSheetDrag` gate |
| MAP-8 | Map onboarding overlay desktop-only — intentional but mobile/desktop onboarding stories diverge | P2 | shell audit |
| MAP-9 | Concierge / TonightLane / several chips desktop-map-home only | P2 | intentional rehome on mobile sheets |

### 4.3 Content surfaces

| Route | Desktop status | Gap |
|-------|----------------|-----|
| `/map` | Strong base | MAP-1…7 above |
| `/tonight` | **Good** (≥1024 rail) | Ensure rail content matches D1 completeness (night arc) |
| `/feed` | **Good** (≥1024 rail + 2-up) | Validate at 1440 vs old “wastes half the screen” audit; rail slot may still be thin |
| `/today` | **Partial** | Single `--content-max` stack — highest “home from laptop” underuse |
| `/plan` | **Good** composer | List/history density; entry from SiteNav weak (IA-1) |
| `/plan/[id]`, recap | Partial | Reading-column recap |
| `/discover` | Good | Keep grid; ensure Stories path obvious |
| `/crawls`, story | Partial | Index OK; story 640 reading only |
| `/pubs`, `/historic` | Good / partial | Index grids; detail prose columns fine |
| `/near` | Partial | Geo-first; desktop wants map+list hybrid |
| `/pal` | Good | Multi-col exists |
| `/moment` | **Poor** | Camera-centric; desktop file-pick only; discoverability via quiet nav icon |
| `/messages` | **Poor** | Single ~720 col — no inbox \| thread split |
| `/activity` | **Poor** | Notification list, phone density |
| `/u/[handle]` | Partial | Limited multi-pane (lists / drops / saved) |
| `/we-are-out` | Poor | Mobile social density |
| `/add/[handle]` | Partial | Confirm sheet / form; D2 called out desktop polish |
| Marketing `/`, `/about`, `/pint-index` | Good enough | Not app-shell parity targets |

### 4.4 Social & identity

| ID | Gap | Severity |
|----|-----|----------|
| SOC-1 | Messages not a desktop messaging UX | P1 |
| SOC-2 | We-are-out / check-in / social loop density mobile-native | P1 |
| SOC-3 | Profile lacks multi-pane (bio + lists + drops) | P2 |
| SOC-4 | Moment capture feels second-class on desktop | P2 |
| SOC-5 | `/add/[handle]` confirm flow needs 1440 polish (D2) | P2 |

### 4.5 Power-user & keyboard

| ID | Gap | Severity |
|----|-----|----------|
| KB-1 | Map: `/` + Esc implemented — **good** | — |
| KB-2 | ⌘K exists but **affordance hidden ≤900** and absent on pure mobile | P1 mid-desktop |
| KB-3 | Limited shortcuts for layers / filters / dual drawers | P2 |
| KB-4 | Focus-trap parity for docked venue panel (historical #346) — treat as regression gate | P1 QA |

### 4.6 Layout density & design system

| ID | Gap | Severity |
|----|-----|----------|
| LAY-1 | Competing historical max-widths; tokens exist but not universal | Tech / P1 |
| LAY-2 | `DESIGN_SYSTEM.md` has **no breakpoint table** — 640 vs 768 vs 1024 tribal knowledge | Tech |
| LAY-3 | Feed/Tonight use **1024** for rails while phone split is **640** — document intentional dual thresholds | P2 docs |

### 4.7 What is intentionally *not* a parity gap

- **A2HS / PWA install prompts** — mobile-centric by nature  
- **Bottom tab bar** — desktop uses SiteNav  
- **Sheet drag gestures** — desktop uses drawers  
- **Camera capture** — desktop file picker is acceptable if upload UX is clear  
- **Persona-drinks encyclopedia** — separate lane, not launch-blocking  

---

## 5. Top 12 gaps ranked by user impact

1. **MAP-1** — Finish map D1 conditions + area news (+ night arc) without fighting venue drawer  
2. **MAP-2** — Desktop area-search / gazetteer parity with mobile shell  
3. **IA-1** — Desktop reachability of Plan / Near / Historic / Pubs / Pal / Messages  
4. **Today density** — 2-col brief + rail for “planning from home”  
5. **Messages split-pane**  
6. **MAP-3** — Port plan-intent activation into desktop planner  
7. **MAP-7** — Kill tablet 641–768 hybrid (choose one model)  
8. **MAP-5** — Desktop venue sticky actions / footer  
9. **Activity denser ops surface**  
10. **Profile multi-pane**  
11. **Moment desktop upload polish**  
12. **LAY-1** — Adopt `--content-max` / `--content-max-wide` consistently  

---

## 5.1 Concurrent agents — freeze map (do not coincide)

Snapshot of **live worktrees / branches as of 2026-07-23**. Re-run `git worktree list` before starting any implement PR.

| Agent / lane | Worktree or branch | Hot files / surfaces | Collision rule for desktop parity |
|--------------|--------------------|----------------------|-----------------------------------|
| **Fable — auth** | `pubmax-fable-auth` · `codex/fable-auth-recovery` | auth callback / exchange | **Never** touch `app/auth/**`, auth providers |
| **Fable — data** | `pubmax-fable-data` · `codex/fable-data-hermeticity` | night-out contracts / tests | Avoid data contract tests they own |
| **Fable — plan location** | `pubmax-fable-plan-location` · `codex/fable-plan-location` | `PlanIntake`, `plan.css`, `nightPatches`, e2e plan-intake | **HOLD** all Plan desktop density / plan-intent work until merged or abandoned |
| **Fable — today** | `pubmax-fable-today` · `codex/fable-today-diversity` | `lib/todayBrief.ts` | **HOLD** Today 2-col until Fable + personalization Today settle |
| **Codex — personalized today** | `.codex-worktrees/wave-personalized-today` | `TodayClient`, `todayPersonalization` | Same HOLD as Fable today |
| **Codex — surprise drink / persona** | `.codex-worktrees/wave-surprise-drink` | persona lens / drink selector | **Never** pair with desktop D1 rail on map in same merge train; persona is separate product lane |
| **Codex — personalization integration** | `.codex-worktrees/wave-personalization-integration` | integration docs/gates | Wait for green merge before Today/desktop personalization chrome |
| **Codex — producthunt waves** | `pubmax-codex-producthunt-waves` | **Tonight** decision launcher, `tonight.css`, **Plan** handoff/share, mobile plan | **HOLD** Tonight rail refactor + Plan handoff chrome until PH wave merges or freezes |
| **Codex — security** | `.codex-worktrees/wave-next-security` + security-persistence/rls trees | Next.js dep, security reads | No shared dep bumps; no social-read API thrash |
| **Codex — push / analytics / generation** | `pubmax-codex-wave*` | push identity, VAPID, grounded plan gen | Orthogonal — do not open those PRs from this tree |
| **Sol (historical / branches)** | `sol-s3-walk`, `cursor/sol-wave-*`, map chrome waves | map chrome, walk/routing, mobile-first | **HOLD** MAP-1/2/4/7 and tablet unification while Sol map PRs are open; Sol owns mobile map quality first |
| **Opus (per sol.md)** | map pin dark-mode, mobile visual audit | `PubMap` / basemap / sheet | Same map freeze; Opus map fixes land **before** desktop map shell PRs |
| **Other** | mobile-sheet-scroll-fix, brand/* | mobile sheets, brand icons | Do not edit mobile portal sheet physics from this lane |

### Hard rules

1. **One surface owner at a time.** If Fable/Sol/Opus/Codex has an open worktree on a surface, desktop parity **queues** that surface — does not dual-edit.  
2. **No stacking** desktop PRs on their branches. Always branch from **fresh `origin/main`** in a **new** worktree (`pubmax-desktop-parity-impl-*`), never reuse this docs tree for implementation either if other agents use docs paths.  
3. **Merge windows:** at most **one** desktop-parity implementation PR in flight when a hot surface is also in flight on another agent. Prefer sequential merges.  
4. **This docs branch** only adds/updates `docs/plans/**` (and optional coordination notes). It must **not** modify app/components/lib.  
5. **Before each phase start:** refresh freeze map; if a HOLD cleared, re-base; if a new collision appears, slip that wave.

### Safe vs blocked surfaces (now)

| Surface | Desktop parity action **now** | Why |
|---------|-------------------------------|-----|
| `docs/plans/**` only | **GO** | This tree |
| Messages / Activity / Profile / Moment upload polish | **GO** (low contention) | No active agent worktrees on these |
| SiteNav secondary “More” (link-only, no Plan UX rewrite) | **GO with care** | Avoid restyling while producthunt touches tonight; keep PR tiny |
| Feed rail reuse / gutters only | **GO with care** | Prefer CSS-only; no persona coupling |
| DesktopRail **host abstraction** (new file under `components/desktop/`) | **GO** if unused by Tonight/Today until adapters land | Build host without wiring contested pages |
| Map D1 rail + gazetteer search | **HOLD** | Sol/Opus map + FABLE area-search ticket; producthunt map-adjacent |
| Tonight rail rewrite | **HOLD** | producthunt tonight decision launcher |
| Today 2-col | **HOLD** | fable-today + personalized-today |
| Plan intent / MobilePlanActivation port | **HOLD** | fable-plan-location + producthunt plan handoff |
| Persona / surprise drink chrome | **OUT OF LANE** | Separate PRD lane |
| Auth / push / security | **OUT OF LANE** | Fable/Codex security waves |

---

## 6. Phased plan (waves ordered to avoid agent collisions)

Waves are **serial by default**. Parallelism only where the freeze map shows **GO** on disjoint file sets.

### Wave D0 — Foundations (docs / gates only) · **NOW · this worktree**

**Owner tree:** `pubmax-desktop-parity-plan` · branch `docs/desktop-feature-parity-plan`  
**Touches:** `docs/plans/**` only  
**Collides with:** nothing if no other agent edits this plan path  

| Work | Detail | Done when |
|------|--------|-----------|
| D0.1 This plan + freeze map | Keep §5.1 current | Agents know HOLDs |
| D0.2 Breakpoint contract note | Keep §2 table authoritative until DESIGN_SYSTEM PR | No new magic px in later waves |
| D0.3 Screenshot checklist | List required shots (do not commit large binaries from other trees) | Checklist in plan or sibling doc in this tree |
| D0.4 Preflight script (optional later) | `git worktree list` + fail if hot paths dirty on main | Documented in plan |

**Non-goals:** any app code.

---

### Wave D1 — Uncontested desktop density · **AFTER D0 · new impl worktree**

**Branch naming:** `feat/desktop-parity-d1-social` (example)  
**Touches (allowlist):** `app/messages/**`, `app/activity/**`, `app/u/**`, `components/messages/**`, `components/profile/**`, `app/moment/**`, `components/moment/**`, related CSS only  
**Do not touch:** `app/today/**`, `app/tonight/**`, `app/plan/**`, `components/PubMap.tsx`, `components/mobile/**`, auth, push  

| Work | Detail | Priority |
|------|--------|----------|
| D1.1 Messages split-pane ≥1024 | Inbox \| thread | P1 |
| D1.2 Activity denser layout | Timeline density, filters | P2 |
| D1.3 Profile multi-pane | Lists / drops / saved | P2 |
| D1.4 Moment desktop upload CTA | File/drag-drop language; no camera primacy | P2 |
| D1.5 `/add/[handle]` dialog polish | Keyboard dismiss; 1440 center | P2 |

**Gate:** Playwright desktop project for messages; no overlap with Fable auth.

**Why first:** high user impact, **zero** live agent worktrees on these surfaces.

---

### Wave D2 — Shell chrome without map rewrite · **AFTER D1 merges (or parallel if files disjoint)**

**Branch:** `feat/desktop-parity-d2-shell`  
**Touches (allowlist):** `components/desktop/*` (new DesktopRail host), `components/nav/SiteNav*` (minimal overflow only), `app/feed/feed.css` gutters if needed, `lib/breakpoints` docs comments only  
**HOLD if:** producthunt still editing SiteNav/tonight shared tokens heavily  

| Work | Detail |
|------|--------|
| D2.1 `DesktopRail` host API | Slots: Conditions, AreaNews, NightArc — **no map wiring yet** |
| D2.2 SiteNav “More” overflow | Links only: Plan, Near, Pubs, Historic, Pal — no feature rewrites |
| D2.3 Mid-width ⌘K affordance | Restore discoverability 641–900 without fighting PH |
| D2.4 Feed 1440 gutter audit | CSS-only if N4 already shipped |

**Do not** mount rail on Tonight/Today/Map in this wave.

---

### Wave D3 — Map desktop shell (D1 product rail + search) · **HOLD until map/sol/opus quiet**

**Start only when:** no open Sol map PR; Opus dark-pin/mobile map audit not in flight; mobile-sheet-scroll worktree idle; producthunt not mid-flight on map-adjacent chrome.  
**Branch:** `feat/desktop-parity-d3-map-rail`  
**Touches:** `components/map/MapToolbar.tsx`, map search suggest, `components/desktop/*`, carefully `PubMap` only if unavoidable (prefer extract)  

| Work | Detail |
|------|--------|
| D3.1 Map Conditions always-on policy | Rail or durable chip + padding rules with venue drawer |
| D3.2 Area news on map when area known | Reuse AreaNewsRail |
| D3.3 Desktop gazetteer / area-search parity | Close FABLE open ticket |
| D3.4 Venue sticky actions in desktop drawer footer | MAP-5 |

**Explicit non-overlap:** do not ship in same merge train as Sol S* map chrome or Opus pin fixes.

---

### Wave D4 — Tonight + Today adapters · **HOLD until Fable/Codex Today + producthunt Tonight land**

**Start only when:** `codex/fable-today-diversity`, `wave-personalized-today`, and producthunt tonight decision work are **merged or parked**.  
**Branch:** `feat/desktop-parity-d4-today-tonight`  

| Work | Detail |
|------|--------|
| D4.1 Tonight consumes DesktopRail | Replace one-off grid with shared host; keep PH decision card intact |
| D4.2 Today 2-col + rail | Build **on top of** personalized today — layout only, no ranking logic |
| D4.3 Night arc / get-home strip in rail when active | Coordinate with night-kit already on main |

---

### Wave D5 — Plan desktop intent · **HOLD until plan-location + producthunt plan handoff land**

**Start only when:** `codex/fable-plan-location` and producthunt `MobilePlanHandoff` / plan share surfaces are settled.  
**Branch:** `feat/desktop-parity-d5-plan`  

| Work | Detail |
|------|--------|
| D5.1 Extract shared plan-activation from `MobilePlanActivation` | Phone keeps mobile UX |
| D5.2 Mount on desktop left planner | No second planning system |
| D5.3 Near hybrid list+map (optional) | After map D3 search exists |

---

### Wave D6 — Tablet unification + dual-drawer power · **LAST · after D3**

**Branch:** `feat/desktop-parity-d6-tablet`  
**Depends on:** D3 map shell stable  

| Work | Detail |
|------|--------|
| D6.1 Pick tablet model | Pure side drawers 641+ **or** portal ≤768 — delete the other transform path |
| D6.2 Dual-drawer productization ≥1100 | Map padding when both open |
| D6.3 Keyboard expansion + content-token retrofit | LAY-1 |
| D6.4 Hover / motion bar | emil-design-eng; reduced-motion |

---

### Sequencing diagram (collision-aware)

```text
NOW (docs tree only)
  D0 foundations ─────────────────────────────────────────────┐
                                                              │
CLEAR social surfaces (no agent owners)                       │
  D1 messages / activity / profile / moment  ─────────────────┤
                                                              │
  D2 DesktopRail host + SiteNav More (no map/tonight/today)  ─┤
                                                              │
HOLD ── map free (Sol/Opus/sheet idle) ──► D3 map rail+search ┤
HOLD ── today+tonight agents clear ──────► D4 today/tonight   ┤
HOLD ── plan agents clear ───────────────► D5 plan intent     ┤
D3 done ─────────────────────────────────► D6 tablet/power    ┘

NEVER in this lane: persona surprise-drink, auth, push, security Next bumps
```

Persona-drinks / celebrity lens remains a **parallel non-blocking lane** owned elsewhere — **do not schedule inside desktop parity waves**.

---

## 7. Residual vs already shipped (working truth)

| Claim | Status (code/docs 2026-07-23) |
|-------|-------------------------------|
| `lib/breakpoints.ts` SSOT 640 | **Shipped** |
| Conditions on map desktop | **Partial** — chip in toolbar, not full rail |
| Area news rail | **Partial** — Tonight (and feed slot patterns); not map |
| Feed multi-column ≥1024 | **Shipped** (N4) — re-audit gutters at 1440 |
| Tonight 2-col ≥1024 | **Shipped** |
| Desktop Moment in SiteNav | **Shipped** (#506) |
| Map keyboard `/` + Esc | **Shipped** |
| ⌘K palette | **Shipped** |
| Mobile portal sheet rebuild | **Shipped** (defect D1 register) |
| Desktop area search gazetteer | **Open ticket** |
| Unified DesktopRail component | **Not shipped** as shared host |
| MobilePlanActivation on desktop | **Not shipped** |
| Messages split-pane | **Not shipped** |
| Tablet 640/768 unification | **Not shipped** |

---

## 8. Success criteria

1. **Jobs:** All six primary jobs completable on desktop without a phone.  
2. **Conditions:** Weather / drink verdict visible on map desktop whenever data exists (drawer open or closed).  
3. **Search:** Desktop map search can resolve areas/localities with parity to mobile gazetteer path.  
4. **Density:** Today, Feed, Tonight, Messages, Profile use intentional multi-region layouts ≥1024 (not empty side gutters).  
5. **Reachability:** Plan, Near, Messages, Pal reachable in ≤2 clicks from any app shell page at 1440.  
6. **Keyboard:** Esc dismisses top overlay; `/` focuses map search on map; ⌘K discoverable ≥641 (or documented alternative).  
7. **No feature only in MobileTabBar** without a desktop equivalent (Moment already has SiteNav; keep that contract).  
8. **QA:** Playwright desktop projects green for map venue open, tonight, feed, messages; screenshot matrix updated.  
9. **Tablet:** Single map chrome model for 641–768 (no dual-axis transforms).  

---

## 9. Non-goals

- Redesigning the product as a desktop SaaS dashboard  
- Pixel-matching mobile bottom sheets on large monitors  
- Shipping persona-drinks catalog as part of this track  
- Replacing MapLibre full-bleed map with always-on 3-column grid of the pre–map-first era  
- Making A2HS / native install “work the same” on desktop browsers  

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Fighting venue drawer for right edge | Explicit stacking rules; map padding; chip fallback when drawer open |
| PubMap size / edit-lock history | Prefer extracted shells (MapToolbar, MobileMapShell patterns); thin PubMap forks |
| Hydration flash (SSR `mobileViewport=false`) | Prefer CSS gates for chrome visibility where possible; matchMedia subscribe early |
| Scope creep into social redesign | Phase 3 after Phase 1–2 gates |
| Context overflow in future sessions | Keep writing here; subagents return summaries only |

---

## 11. Suggested PR slices (implementers — each in its **own** worktree)

| PR | Wave | Scope | Depends / freeze |
|----|------|--------|------------------|
| A | D0 | This plan only (`docs/plans/**`) on `docs/desktop-feature-parity-plan` | Isolated docs tree |
| B | D1 | Messages split-pane | No messages owner |
| C | D1 | Activity + profile density | Can follow B |
| D | D1 | Moment + add/handle polish | Can follow B |
| E | D2 | `DesktopRail` host **unwired** + SiteNav More + mid-width ⌘K | After A; not during SiteNav thrash |
| F | D3 | Map rail + conditions policy | **HOLD** until Sol/Opus/map free; after E |
| G | D3 | Desktop gazetteer search | Same HOLD as F; can stack after F or sequential |
| H | D3 | Venue drawer sticky actions | With or after F |
| I | D4 | Tonight rail adapter | **HOLD** until producthunt tonight lands; after E |
| J | D4 | Today 2-col layout only | **HOLD** until Fable/personalized today land |
| K | D5 | Plan activation shared + desktop mount | **HOLD** until plan-location + PH plan handoff |
| L | D6 | Tablet unification + dual-drawer + tokens | After F |

**Implementation worktree convention (do not reuse agent trees):**

```bash
# From main repo — only when starting a GO wave:
git fetch origin
git worktree add -b feat/desktop-parity-d1-messages \
  /Users/karanmanoharan/Documents/pubmax-desktop-parity-d1-messages \
  origin/main
# Work only there. Never commit desktop parity into pubmax-fable-* or .codex-worktrees/wave-*.
```

---

## 12. Open questions for owner

**OWNER ANSWERED 2026-07-23 21:1x (Karan, via supervisor AskUserQuestion):**

1. **Rail scope:** **Map + Tonight + Feed only.** Other pages stay focused.  
2. **Secondary nav:** **SiteNav “More” overflow menu** (Wave D2.2 as planned).  
3. **Tablet:** **STILL PARKED** — small-desktop drawers vs large-phone portal through 768 undecided. D6 stays blocked on this.  
4. **Today role:** **Today is desktop home** when not on map. Justifies D4 Today 2-col investment.  
5. **Launch bar:** **MAP-1 + MAP-2** (map rail + area search) defines the desktop-parity milestone. D1 social density ships after but is not milestone-gating.  

---

## 13. Evidence log

| Date | Source | Note |
|------|--------|------|
| 2026-07-23 | Tree listing | `components/desktop` = ConditionsChip + AreaNewsRail only |
| 2026-07-23 | `lib/breakpoints.ts` | `MOBILE_MAX_WIDTH = 640` |
| 2026-07-23 | Explore subagent: shell/nav | Dual chrome trees; tablet mid-width; dead CSS branches |
| 2026-07-23 | Explore subagent: map/planner | Portal vs drawer; 768 hybrid; D1 incomplete; plan intent mobile-only |
| 2026-07-23 | Explore subagent: routes | Route readiness table; top gaps Messages/Today/Moment/Activity |
| 2026-07-23 | Explore subagent: docs | D1/D2 authority; superseded UI Next still useful as defect catalogue |
| 2026-07-23 | `FABLE_HANDOFF.md` | Desktop area-search ticket; #401 D1 claims |
| 2026-07-23 | Targeted rg | Feed/Tonight `@media (min-width: 1024px)` rails; MapToolbar ConditionsChip |
| 2026-07-23 | Isolation move | Plan removed from `main` working tree; lives only on worktree `pubmax-desktop-parity-plan` / branch `docs/desktop-feature-parity-plan` |
| 2026-07-23 | Worktree census | Fable: auth, data, plan-location, today, integration; Codex: personalized-today, surprise-drink, personalization-integration, security, producthunt (tonight+plan); Sol/Opus map lanes treated as HOLD for D3+ |

---

## 14. References (paths only)

- `docs/PERSONA_DRINKS_AND_DESKTOP_PRD.md` — D1/D2  
- `docs/MOBILE_FLOW_SPEC.md` — mobile IA + vocabulary  
- `docs/MAP_CHROME_TIERS.md` — mobile chip hierarchy  
- `docs/PRD_UI_NEXT.md` — superseded but N1–N4 history  
- `docs/archive/PRD_MAP_FIRST_REDESIGN.md` — full-bleed + drawers  
- `FABLE_HANDOFF.md` — live verification + open tickets  
- `lib/breakpoints.ts`  
- `components/nav/navigationModel.ts`  
- `components/desktop/*`  
- `components/mobile/*`  
- `components/map/MapToolbar.tsx`  
- `components/map/pubmap/useMapKeyboardShortcuts.ts`  

---

*End of plan — FINAL for away-mode. No implementation until owner review. §12 stays parked (no agent-chosen defaults). No push/merge from this branch without review.*
