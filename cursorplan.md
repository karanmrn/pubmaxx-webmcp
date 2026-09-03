# PUBMAXX next-features implementation plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Sequence the next product work after the 19-20 Aug Grok-list ships, so the live site, the identity wave, and the remaining H0/H1 roadmap can move without inventing a new stack.

**Architecture:** GitHub `main` is truth. Production still sits on the 18 Aug 2026 deploy. Workers use an isolated copy of `origin/main`, never the dirty local fleet clone. One execution lane on this 8 GB Mac. Do not reopen closed Grok-list items. Do not add database tables unless a later explicit captain word names that table. Captain-held calls stay held.

**Tech Stack:** Next.js App Router, MapLibre, Supabase, Capacitor iOS/Android shells, Vitest, Playwright (one worker), existing DESIGN.md / VOICE.md / AGENTS.md laws.

**Repo:** `https://github.com/Singularityszn/pubmax`  
**Plan SHA at write:** `d0d0d3fd` (cheap-pint `selectPayload` type, #1118)  
**Live site:** `pubmaxxing.com` on `chengdu-1fnmz3gqd` / `3d36237d` (18 Aug 21:55). Everything after that SHA is on GitHub and not on Vercel.

---

## How to use this plan

1. Read this file before any new ship.
2. Do Wave 0 first. It is operations, not a feature.
3. Then pick the first undone task in Wave 1. Finish it. Merge. Then the next.
4. Do not start Wave 2 until Wave 1 leftover bugs that users will hit on the undeployed set are green, or the captain names a different first feature.
5. Wave 2 unblocks Wave 3 identity surfaces. Do not build the Instagram-shaped profile on a public-always follow graph.
6. One worker at a time. `NODE_OPTIONS=--max-old-space-size=2048`. One Playwright worker.
7. GitHub Actions stay off. Local `npm run verify` (or the named targeted suite) is the green bar. Do not wait on the 168h CI monitor.
8. Deploy only when the captain names deploying or Vercel. One deploy per day.
9. Verify at 390x844 and desktop before calling a visual task done.
10. Load `apple-design` and `emil-design-eng` on every visual ship. State in the PR body which skill changed a decision.

### Worker rules (copy into every brief)

- Isolated worktree. Stop if launched in the primary checkout.
- Keep the diff to this task. No drive-by dependency or audit fixes.
- Commit after each coherent slice so a crash costs minutes.
- Start the no-mistakes run yourself after the implementation commit (Composer does this; Grok-in-Cursor often stops and waits).
- Rebase on fresh `origin/main` immediately before opening the PR.
- `git checkout -- next-env.d.ts tsconfig.json` before any wt3 screenshot checkout if those files dirty.
- Use `chrome-devtools-axi` for required device emulation and screenshots. Use Playwright for scripted end-to-end checks.
- Capture screenshots under `/tmp`, then move them. Verify the file exists.
- Do not treat a red GitHub check as a merge blocker. Local verify is the gate.
- Fable / first mate reviews the PR before merge.

### Commands that prove green

```bash
# Targeted (preferred while one lane is live)
npx vitest run __tests__/<named>.test.ts

# Full local bar (only when the machine has headroom; never two at once)
NODE_OPTIONS=--max-old-space-size=2048 npm run verify
```

Expected: named suite PASS, or verify completes with lint + typecheck + coverage + resilient-audit green.

---

## Current context

### What already shipped on GitHub (not live)

| Slice | PR | Note |
|---|---|---|
| Map first-paint / arrival + choose-area | #1094, #1097 | Captain direction: honest arrival + find-my-location + other areas |
| Social photo fixes | #1089 | Follow avatars, DM attach, cover Remove |
| Chrome / forms | #1095 | Consent, login button, vibe chips, Out hierarchy |
| Polish / perf | #1096 | |
| Map reliability | #1107 | Grok list v0 item 5 |
| One-tap Pint Drop | #1108 | v0 item 1 |
| Today Top picks | #1109 | v0 item 2 |
| Pal Plan send | #1110 | item 3 |
| Weekday 17:00 cheap-pint ping | #1111 | item 4. Needs migration 0111 |
| Home + Pal five-tab chrome | #1112 | item 6 |
| Consent pill foot clearance | #1113 | item 7 |
| Desktop `/out` grouping | #1114 | item 8 |
| Crawl stops | #1115 | Closed empty. Already on main via #1087 |
| Price freshness honesty | #1116 | item 10. Empty baseline 3 July 2026, episodic |
| Bristol enrich bound | #1117 | item 11. Cap 8 queries, 45s wall |
| Cheap-pint `selectPayload` type | #1118 | Follow-up to #1111 |

Do not reopen these. If live proof after deploy finds a regression, file a follow-up. Do not rebuild the slice.

### What must not be treated as main

The local fleet clone can sit behind `origin/main` with uncommitted skill-delete noise. Ignore it. Workers start from `origin/main`.

Two leftover copies still hold local-only history. Do not discard them without an explicit captain word:

- `projects/pubmax-gnhf-worktrees/objective-build-two-8b6a75` on `feat/og-cards-generative` (1 local commit)
- `~/.codex/worktrees/pubmax-product-loop` (many local commits; most features already landed under other SHAs)

### Product law that every later wave must keep

From `data/vision.md` (first mate home) and `AGENTS.md` in this repo:

- The personal record is the public record. Logging a night makes the map more true.
- Uncorroborated community reports do not paint authority. Pint Drop corroboration vs map paint is a captain hold. Do not silently pick.
- Honest empty beats a dressed empty. Dated source or it does not ship.
- Coral doubled-stroke X is frozen. Do not restyle the mark.
- Five tabs: Now / Map / Out / Social / You. Moment is the floating +. Pal and Home light a tab after #1112.
- Social is live by default; `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` is the emergency rollback.
- Photo safety scan is advisory. A missing scanner must not refuse an upload.
- 18+ is a one-tap self-assertion, not a DOB gate.
- Website stays the product until 100 accounts. Apps are built for hype and readiness, not a second public front door.

---

## Wave 0. Operations before any new feature

This wave is captain + first mate. A coding worker does not start Wave 1 until 0.1 and 0.2 are complete and verified.

### Task 0.1: Named production deploy of the undeployed GitHub set

**Objective:** Put the reviewed GitHub set from `#1097` through `#1118`, pinned at `d0d0d3fd`, on `pubmaxxing.com` in one end-of-day deploy.

**Files:** none in git. Deploy from the GitHub SHA, not a dirty local tree.

**Step 1:** Captain says the concrete deploy word (deploying or Vercel).

**Step 2:** Build and promote exact commit `d0d0d3fd` with the existing Vercel project `chengdu`. Then `vercel promote`. Do not widen the deploy to later merges.

**Step 3:** Smoke the live routes: `/`, `/map`, `/near`, `/near?mode=desk`, `/out`, `/tonight`, `/today`, `/pal`, `/privacy`, `/add/karan`, `/drink/guinness`, `/admin` (expect 401 anon), `/api/out`.

**Step 4:** Phone 390 + desktop screenshots of Map arrival, Today Top picks, one-tap Pint Drop, five-tab chrome, desktop `/out` grouping, consent pill above the tab bar.

**Done when:** deployment metadata names `d0d0d3fd`, live HTML shows the five tabs and "What's on tonight" / arrival card copy from that commit, and `/admin` stays 401 for anon.

### Task 0.2: Apply Supabase migration 0111

**Objective:** Persist cheap-pint ping prefs. Without this, #1111 cannot remember the weekday 17:00 choice.

**Files:**
- `supabase/migrations/20260819200000_0111_cheap_pint_ping_prefs.sql`

**Step 1:** Captain applies the SQL in the Supabase SQL editor, or re-auths the connector and asks first mate to apply it.

**Step 2:** Confirm the prefs table/columns exist. Cheap-pint prompt write then read-back on a real account.

**Done when:** a signed-in save of the ping preference survives reload.

### Task 0.3: Do not "fix" the dirty local clone

**Objective:** Leave the fleet clone alone. It is not the source of truth.

**Done when:** workers spawn from `origin/main` into an isolated copy.

---

## Wave 1. Leftover bugs users will hit on the undeployed set

Ship these before new surfaces. Each is already queued. Order is the order a phone user hits them.

### Task 1.1: Desktop voids

**Backlog:** `fix-desktop-voids`  
**Objective:** We-are-out two-column, `/near` content-first, `/login` rhythm. Kill the empty slabs on a wide screen.

**Files:**
- Modify: `app/near/page.tsx`
- Modify: `app/login/page.tsx`
- Modify: `components/discovery/*` (Tonight / We-are-out desktop wrappers)
- Modify: `components/nav/SiteNav.tsx`
- Test: `__tests__/navigationModel.test.ts` plus a new `__tests__/desktopVoids.test.ts` if layout helpers move

**Step 1:** Write a failing test that the desktop `/near` and `/login` shells expose a content-first landmark, not a hero-height void.

**Step 2:** Run `npx vitest run __tests__/desktopVoids.test.ts -v`  
Expected: FAIL until the landmark exists.

**Step 3:** Tighten the desktop CSS/layout. Do not invent a new page.

**Step 4:** Re-run the test. PASS. Screenshot 1280 and 390.

**Step 5:** Commit. `git commit -m "fix: fill desktop voids on near, login, and we-are-out"`

### Task 1.2: Session and password prompt

**Backlog:** `fix-session-password-prompt`  
**Objective:** A saved password means the setup/change stack is hidden. 30-day session survives a real phone relaunch.

**Files:**
- Modify: `app/login/page.tsx`
- Modify: identity / onboarding surfaces under `app/onboarding/` and `lib/` auth helpers
- Test: existing login / session tests under `__tests__/`

**Step 1:** Reproduce on a signed-in account: after the browser has a saved password, the change-password stack must not be the default view.

**Step 2:** Write or extend a test for "saved credential => no default password-setup stack".

**Step 3:** Minimal UI hide. Do not delete the ability to change a password from settings.

**Step 4:** Hard relaunch test on a real iPhone after Wave 0 deploy. Cookie session first. Native token flow only if that drop is observed.

### Task 1.3: JS budgets on Today, Tonight, Out

**Backlog:** `issues-l1-js-budget`, `out-bundle-over-budget`  
**Objective:** `/today` and `/tonight` under 1300/1280 KB. `/out` back under 1300 KB decoded.

**Files:**
- Modify: `app/today/page.tsx`, `app/tonight/page.tsx`, `app/out/page.tsx` and their client islands
- Modify: `components/discovery/*`, `components/nav/*`
- Test: existing bundle budget tests (search `__tests__` for `1300` / `js budget`)

**Step 1:** Measure current decoded JS with the repo's budget helper. Record the number in the PR.

**Step 2:** Split or defer client islands. Do not remove features to fake the budget.

**Step 3:** Re-measure. PASS the existing budget test.

### Task 1.4: Out follow-ups

**Backlog:** `out-l2-followups`, `out-api-lanes-param`  
**Objective:** Per-provider rows age out when Ticketmaster/Skiddle say they are stale. `/api/out?lanes=events` skips the open-plans RPC that `/tonight` discards.

**Files:**
- Modify: `app/api/out/route.ts`
- Modify: Out provider adapters under `lib/` (search `ticketmaster`, `skiddle`, `contextDev`)
- Test: existing Out API tests; add `__tests__/outLanesParam.test.ts`

**Step 1:** Failing test: `GET /api/out?lanes=events` does not call the open-plans path.

**Step 2:** Implement the lanes query. Default stays today's behaviour.

**Step 3:** Age stale provider rows. Honest empty if the only rows are past their provider expiry.

### Task 1.5: Planner release follow-ups

**Backlog:** `planner-release-followups`  
**Objective:** Intake-conflict copy never claims a lock the planner does not hold. Remaining #1070 leftovers.

**Files:**
- Modify: planner intake / lock copy under `app/plan/` and `lib/` planner helpers
- Test: existing planner tests from #1070

### Task 1.6: Pal place-word second matcher

**Backlog:** `pal-place-word-second-matcher`  
**Objective:** The second matcher in `lib/ask/tools.ts` must not land `Angel` / `Clapton` as a false place.

**Files:**
- Modify: `lib/ask/tools.ts`
- Test: existing Ask/Pal tool tests; add cases for Angel and Clapton as people/place ambiguous tokens

**Step 1:** Failing test with those two tokens.

**Step 2:** Tighten the second matcher. First matcher stays.

### Task 1.7: Occupancy GET venue-id canonicalise

**Backlog:** `occupancy-get-canonicalise`  
**Objective:** `GET /api/venues/[id]/occupancy` lists against the canonical venue id.

**Files:**
- Modify: `app/api/venues/[id]/occupancy/route.ts`
- Modify: `lib/` occupancy store
- Test: `__tests__/occupancyRoute.test.ts`, `__tests__/occupancyStore.test.ts`

### Task 1.8: Trust-credit hide-then-restore

**Backlog:** `trust-credit-edge-cases`  
**Objective:** A moderator hide then restore must not permanently kill the pair.

**Files:**
- Modify: trust credit store / events under `lib/`
- Test: existing slice-3 tests; add hide-then-restore case

### Task 1.9: Image-absent gate test

**Backlog:** `fix-image-absent-gate-test`  
**Objective:** `__tests__/profileImageServeJourney.test.ts` is green after #1056.

**Files:**
- Test: `__tests__/profileImageServeJourney.test.ts`

Do not change serve policy to make the test pass. Fix the test to the accepted #1056 law, or fix a real regression if the serve path drifted.

### Task 1.10: Map basemap cold-start

**Backlog:** `ux-map-basemap-init`  
**Objective:** Basemap style/tile/glyph init is not 4.3-12.8s on a cold phone.

**Files:**
- Modify: `components/` map shell (PubMap / MapLibre init)
- Modify: style / glyph / sprite URLs
- Test: existing ` __tests__/pubMap.test.ts` plus a timing fixture if one exists

Do not trade honesty of first paint (#1094/#1097) for a spinner lie.

### Task 1.11: Flaky validate test and menu-harvest bound

**Backlog:** `fix-flaky-validate-test`, `menu-harvest-pilot`  
**Objective:** Stabilise the known flake. Keep menu-harvest a bounded permitted-chain pilot, not a UK scrape.

---

## Wave 2. Account privacy (unblocks identity)

Captain decision 2026-08-10: Instagram-shaped account. One toggle. Public or private. Private = follow requests with owner approval. Public card (handle / name / avatar / counts) always visible. Open feed lives inside the follow graph.

**Backlog:** `feature-account-privacy` (ready).  
Blocked on this: `feature-profile-ig-layout`, `feature-settings-simplify`, `feature-activity-history`.

Today `lib/followStore.ts` writes a follow edge immediately. `app/api/profiles/[handle]/follow/route.ts` is an immediate follow/unfollow. There is no visibility column on the public card.

Do not add a table if the existing `follows` row can carry a `pending` state and `profiles` can carry a `visibility` column via a new migration. If a migration is required, stop and ask the captain to apply it. Do not invent a second graph.

### Task 2.1: Visibility field on the profile record

**Objective:** A profile is `public` or `private`. Default `public` so existing accounts do not flip dark.

**Files:**
- Modify: `lib/profileStore.ts` (`ProfileRecord`, `publicProfileFromRecord`, `publicCardForProfile`)
- Modify: `app/api/profiles/[handle]/route.ts`
- Test: `__tests__/profilesRoutePrivacy.test.ts`, `__tests__/profileStore.test.ts`, `__tests__/profileCardFields.test.ts`

**Step 1:** Failing test: public payload includes `visibility: "public" | "private"` and never includes email/DOB.

**Step 2:** Add the field to memory store first so tests pass without Supabase.

**Step 3:** Migration SQL (next number after 0111) only if production must persist it. Captain applies.

**Step 4:** Commit. `git commit -m "feat: persist public-or-private account visibility"`

### Task 2.2: Follow request instead of instant follow when the target is private

**Objective:** `follow()` on a private target creates a request. Owner approve writes the edge. Owner deny drops it.

**Files:**
- Modify: `lib/followStore.ts`
- Modify: `lib/followWrite.server.ts`
- Modify: `app/api/profiles/[handle]/follow/route.ts`
- Create: `app/api/profiles/[handle]/follow-requests/route.ts` (owner list / approve / deny)
- Test: new `__tests__/followRequests.test.ts`

**Step 1:** Failing tests:
- public target: POST follow still creates an edge
- private target: POST follow creates a pending request, `isFollowing` is false, counts do not rise
- owner approve: edge exists, request gone, counts rise
- owner deny: no edge, request gone

**Step 2:** Minimal store methods. Keep `listMutuals` as intersection of accepted edges only.

**Step 3:** Commit. `git commit -m "feat: private accounts require a follow request"`

### Task 2.3: Read-path enforcement

**Objective:** Nights, moments, pub photos, and the open feed are visible to: the owner, accepted followers of a private account, and everyone when the account is public. The public card stays visible in all cases.

**Files:**
- Modify: `app/api/profiles/[handle]/route.ts` (full vs card)
- Modify: `app/u/[handle]/` page (or current profile page)
- Modify: feed assembly under `lib/feed.ts`
- Test: `__tests__/profilesRoutePrivacy.test.ts`, `__tests__/profilePublicCards.test.ts`

**Step 1:** Failing test: anonymous GET of a private handle returns card + `visibility: "private"` and no night grid.

**Step 2:** Owner GET returns the full payload.

**Step 3:** Accepted-follower GET returns the full payload.

### Task 2.4: `/add/<handle>?auto=1` respects privacy

**Backlog (held):** `predeploy-review-0816-decision-add-link-auto-follow-gesture`, `add-link-auto-follow-call`  
**Objective:** Do not expand auto-follow. If the target is private, auto=1 creates a request, never a silent edge. The captain still owns whether auto=1 may write a follow for public accounts without a gesture.

**Files:**
- Modify: `app/add/[handle]/page.tsx`
- Modify: `lib/arrivalWelcome.ts` if that is the marker seam
- Test: existing add-link tests from #1059

Until the captain answers the auto=1 gesture call, implement only the private-target request path. Leave public auto=1 as specified in #1059.

### Task 2.5: Owner toggle on You

**Objective:** Signed-in You can flip public/private. Copy is Instagram-plain. No settings maze.

**Files:**
- Modify: You / profile editor surfaces (`app/u/`, profile options)
- Test: `__tests__/profileOptions.test.ts`, `__tests__/profileEditMode.test.ts`

**Step 1:** Failing test: owner PATCH visibility to `private` then public card shows private and follow becomes request.

**Step 2:** One toggle. Confirm copy: "When private, people ask to follow. Your public card stays visible."

---

## Wave 3. Identity surfaces (blocked on Wave 2)

### Task 3.1: Instagram-shaped profile

**Backlog:** `feature-profile-ig-layout`  
**Objective:** Counts row (followers / following / pints). Grid of nights, moments, pub photos. Profile is an identity card, not a settings page.

**Files:**
- Modify: profile shell (`__tests__/profileShellLayout.test.ts` names the contract)
- Modify: `components/` profile grid
- Test: `__tests__/profileShellLayout.test.ts`, `__tests__/profileRichRender.test.ts`, `__tests__/nightProfile.test.ts`

Preserve the coral X. Do not add a third avatar system.

### Task 3.2: Settings simplify

**Backlog:** `feature-settings-simplify`  
**Objective:** Fold private details into a lean one-time setup. Visibility toggle is the standing control. DOB stays optional.

**Files:**
- Modify: `app/onboarding/` and settings / You editor
- Test: onboarding + `__tests__/profilesRoutePrivacy.test.ts`

### Task 3.3: Activity history

**Backlog:** `feature-activity-history`  
**Objective:** Durable ledger of mate adds, follows, joins. Public accounts' follow activity can notify people in the graph (Instagram-shaped). Private accounts' activity stays private.

**Files:**
- Modify: `app/activity/page.tsx`
- Create or modify an activity store under `lib/` using an existing table if one exists. If none exists, stop and ask. Do not add a table in silence.
- Test: new `__tests__/activityHistory.test.ts`

Revise `/add` copy that says "No follower counts, no public list" when this ships. That copy becomes a lie the moment counts exist.

### Task 3.4: Social launch state

**Status:** Superseded by the live-by-default Social launch. Use
`docs/SOFT_LAUNCH_RUNBOOK.md` for the current rollback procedure.

---

## Wave 4. Map integrity

The map is the product. These are correctness laws, not decoration.

### Task 4.1: Map key same-revision guarantee

**Backlog:** `map-key-same-revision-guarantee`  
**Objective:** No alcohol key can describe buckets the map is not painting. Four earlier attempts failed. Treat this as a lock-step revision: key labels and paint function share one exported revision constant.

**Files:**
- Modify: map key component + paint/bucket helpers beside `PubMap`
- Test: `__tests__/pubMap.test.ts` plus a new same-revision test that imports both sides from one module

**Step 1:** Failing test: if the paint enum changes and the key enum does not, the test fails at import time.

**Step 2:** One module exports both. Delete duplicate enums.

### Task 4.2: PubMap decomposition

**Backlog:** `pubmap-decomposition`  
**Objective:** Decompose `PubMap` around what it does today (camera, pins, sheets, arrival, key). No behaviour change.

**Files:**
- Modify: the current `PubMap` module (search `components/**/PubMap*.tsx`)
- Test: `__tests__/pubMap.test.ts` must stay green with the same assertions

Do not use this task to sneak features.

### Task 4.3: Venues waves 2-5 (London-first)

**Backlog:** `venues-waves-2-5`  
**Objective:** Curated famous venues, not bulk import. London first. Depth compounds.

**Files:**
- Modify: venue data packs / curated overlays under `public/data/` and `lib/venues.ts`
- Test: venue merge / kind tests

Honor AGENTS.md corroboration. A single uncorroborated Pint Drop still must not paint authority unless the captain answers that hold.

---

## Wave 5. Get people together (the mission)

Every feature in this wave must answer: does this get real people into a real place?

### Task 5.1: Deal Radar

**Backlog:** `feature-deal-radar`  
**Objective:** Happy hours + meal deals near you now. Honest sourcing. Money-saved only when the figure is dated and sourced.

**Files:**
- Modify: `components/discovery/DealsTonightLane.tsx`
- Modify: `lib/dealsHonesty.ts`, `lib/dealsDigest.ts`, `lib/harvest/chainDeals.ts`
- Modify: `public/data/whats_on/deals_london.json`
- Test: `__tests__/dealsHonesty.test.ts`, `__tests__/dealsTonightCaption.test.ts`, `__tests__/whatsOnDeals.test.ts`

Do not invent a UK-wide harvest. Permitted chains only.

### Task 5.2: Culture crawls

**Backlog:** `feature-culture-crawls`  
**Objective:** Gallery / market / music + pint combo. Free-thing-first. Uses the existing planner (5-6 stops already in scope from 11 Aug).

**Files:**
- Modify: `app/plan/page.tsx`, `app/crawls/`, planner stop model
- Test: planner tests from #1070 / #1077

### Task 5.3: Night streaks + money-saved ledger

**Backlog:** `feature-night-streaks`  
**Objective:** Retention loop from nights already logged. Money-saved only from corroborated priced nights. This-month-with-your-lot is mutuals only.

**Files:**
- Modify: You / night profile (`lib/` night profile, `__tests__/nightProfile*.test.ts`)
- Test: new `__tests__/nightStreaks.test.ts`

If this needs a new table, stop and ask.

### Task 5.4: Step Out nudge

**Backlog:** `feature-step-out-nudge`  
**Objective:** One honest weekly push. Quiet pint tonight, X min away, at Y price, only when those three facts exist.

**Files:**
- Reuse cheap-pint ping seams from #1111 (`__tests__/cheapPintPing*.test.ts`) rather than a second notifier
- Test: extend cheap-pint tests; do not duplicate the dispatch type bug #1118 already fixed

### Task 5.5: The Regular Table (scout first)

**Backlog:** `regular-table-scout`  
**Objective:** Knowledge only. Weekly matched table of 4-6 at a corroborated-cheap pub. Do not build until the scout report exists and the captain says implement.

**Deliverable:** `data/<id>/report.md` in the first mate home, not a PR.

### Task 5.6: Out / events honesty leftovers

Skiddle logo + API key remain a captain hold (`skiddle-logo-asset`). Ticketmaster key is already in Vercel. Common posts stay facts-only cards.

---

## Wave 6. Remaining H0 master-plan rows

From `data/pubmaxx-v1-master-plan/roadmap.md`. Skip rows already shipped (R-001 DeepSec, R-002 product-loop, R-003 missions, R-004 kinds, R-007 desk mode, R-011 occupancy L1, R-017 UK OSM).

### Task 6.1: Work-spot amenity vocabulary (R-005)

**Backlog:** `mp-r-005` if present, else file against the roadmap row.  
**Objective:** wifi, sockets, laptop policy, noise, seating, quiet hours as community signals with provenance.

**Files:** community venue signals under `lib/` + existing occupancy / amenity readers  
**Test:** new amenity tests; occupancy tests stay green

Migration SQL if a column is missing. Captain applies.

### Task 6.2: Founders Discord + first IRL crawl (R-009)

**Objective:** Product eats its own cooking. RSVPs via `/invite/[token]`.

Captain still owns Discord invite rotation (`review-spec-decision-discord-invite-rotation`, `v01-research-decision-discord-invite-revoke`). Do not mint or commit a new live invite.

### Task 6.3: Weekly PostHog operating dashboard (R-010)

**Objective:** One page the captain reads on Monday: answers, invites, prices, missions, Pint vs Desk.

**Files:** existing PostHog helpers; do not add a new analytics vendor.

### Task 6.4: Occupancy layer 2 (R-012)

**Backlog:** after 1.7  
**Objective:** Quiet-hours forecast from own report history + hours, with sample size. Never dressed as "now".

### Task 6.5: User-added venues (R-013)

Cafe / lounge / desk. Dedupe against OSM and curated. `reported` until corroborated.

### Task 6.6: CDN + public JSON cache (R-041, R-042)

Crawler volume must not be a function invocation each. One `s-maxage` + SWR policy with a test.

### Task 6.7: Privacy notice with each new data practice (R-044)

Same commit as the practice. `__tests__/legalPages.test.ts` stays green.

---

## Wave 7. Apps (held on captain enrolment)

**Backlog:** `capacitor-finish-and-sign`, `mp-r-006`, `store-accounts-enroll`, `v01-research-decision-store-accounts-enrol`

**Objective:** Finish the existing Capacitor iOS + Android shells. TestFlight internal + Play internal. Store name `PUBMAXXING`. Bundle id `com.pubmaxx.app`. Website stays the product until 100 accounts.

**Files:**
- `capacitor.config.ts`
- `docs/CAPACITOR_WRAP.md`
- `android/`, `ios/` (if present)
- Skills: `plan-capacitor-hardening`, `enhance-capacitor-ui`

Do not start this wave until the captain has enrolled Apple Developer (individual, 99 USD) and Google Play Console (25 USD). First mate cannot create those accounts.

App sign-in for V0.1: handle + password only. Sign in with Apple + Google is the first post-launch app task.

Maps: web MapLibre in the shell. Native later maybe.

---

## Wave 8. H1 and later (do not pull forward)

Keep these queued. Do not start because they are exciting.

| Id | Title | Gate |
|---|---|---|
| R-014 | Deals lane for cafes + pubs (operator publish + harvest) | after R-021 or Deal Radar honesty holds |
| R-015 | Pub Pal cross-vertical tools | after occupancy L2 |
| R-016 | `/work/<borough>` pages | after amenities + desk mode |
| R-018 | Work-spot enrichment cron, official pages only, budget-capped | after R-017 (already shipped) |
| R-019 | Wanted for cafes and desks | after kinds (shipped) |
| R-020 | Coffee price + Flat White lane + COFFEEMAXX landing | after kinds |
| R-021 | Operator claim + verify | ADR 0011 rail; Stripe freeze still held |
| R-022 | Store screenshots per MODE | after R-006 |
| R-023 | Public store release | 100 accounts |
| R-024+ | Occupancy L3, B2B prices, D2C Plus, daytime crews, Manchester, bookings deep-link, Flat White Index, FTS search, Year in Pints | later horizons |
| `convex-migration-eval` | Convex vs Supabase | scout only. Not a rewrite. |
| `og-cards-generative` | Data-driven OG cards | ties to leftover GNHF worktree. Do not discard that copy. |
| `design-blueprint-texture` | Landing micro-texture | taste, after identity wave |
| `openwiki-pubmax` | Agent docs | blocked on captain API key |
| `tracing-fence-blind-spots` | Tracing fence | after captain unpauses Arize |
| `voice-audit-remaining-surfaces` | Voice pass | anytime as a taste lane |
| `whats-on-ingest-runtime` | whats_on full ingest runtime | pick a runtime; no silent new host |
| `review-pr945-vision` | Mine Cursor vision doc | planning, not a ship |
| `social-743-744-merge` | Old social PRs | only if they still apply on current main |
| `skills-catalog-repair` | First mate home skills, not this repo | do not file a pubmax PR |

Monetization (R-025, R-026, G-007) waits on `monetization-skeptic-decision-adr-stripe-freeze` and `monetization-skeptic-decision-settle-funds-flow`. Do not build Stripe Checkout, Connect, or a paywall.

WORKMAXX / COFFEEMAXX domains (`mp-r-008`) wait on the captain buying them.

---

## Captain holds (do not implement around them)

Answer these in chat. A worker that invents an answer is a defect.

1. **OAuth.** Google and Microsoft buttons are dead in Supabase until the captain supplies credentials.
2. **Clerk.** Adopt in production or cancel. Production auth is Supabase magic links today.
3. **Supabase Pro.** Free-tier pause after 7 days idle vs ~USD 25/mo.
4. **Pint Drop corroboration vs AGENTS.md:20.** One uncorroborated drop currently paints pins in `lib/venues.ts` merge. Law says it must not. Pick: gate the lane, or amend the law to community submissions only.
5. **Stripe ADR 0011/0012 freeze vs Founding Member / Connect sequencing.**
6. **Round-split funds flow.** Peer repay vs merchant Connect. FCA / Tips Act / Challenge 25 if merchant.
7. **Discord invite `r46K8Qv5W`.** Rotate or accept that it is public in the repo.
8. **Store enrolment.** Apple + Play. Blocks Wave 7.
9. **Adult-gate keyless desk/coffee reads under 18.**
10. **Occupancy proxy meaning.** Forecast is not "empty right now". Google scraping is refused.
11. **Brand rename trigger.**
12. **Codex `/area/*` family.** Hold, fold into `/borough`, or ship SEO-only after fixes.
13. **Dormant `/api/email-subscribers`.** Remove (recommended) or restore delivery.
14. **WORKMAXX second store listing timing.** Metric trigger, not day-one.
15. **add-link `auto=1` gesture.** Follow-on-load for any signed-in visitor vs one-shot door marker.
16. **GitHub Actions re-enable.** Standing no. D1 stays held unless the captain changes it.
17. **Pint Drop legacy `report_count`.** Leave (recommended) / zero / migrate. Blocks L4.
18. **Pub Pal mastery ladder.** Wire triggers or drop (recommended drop).
20. **Close stale tracker issues** `#252 #282 #287 #384 #385 #392 #437 #443 #727`.
21. **Skiddle logo + API key.**
22. **Arize tracing.** Paused, decide post-launch.
23. **Conductor delete** after rescue.
24. **Screensaver / Aerial.** Off until the captain says bring it back.
25. **Migration 0111** (Task 0.2).
26. **D2C Plus timing, B2B price levels, App Store target wording.** Already recommended; options stay open in the master-plan report.

---

## Recommended order for the next ten working days

After both Wave 0 tasks are complete and verified:

1. Wave 1.1 desktop voids  
2. Wave 1.2 session / password  
3. Wave 1.3 JS budgets  
4. Wave 1.4 Out lanes + stale rows  
5. Wave 1.6 Pal matcher  
6. Wave 1.7 occupancy canonicalise  
7. Wave 2.1-2.5 account privacy  
8. Wave 3.1 IG profile  
9. Wave 4.1 map-key same revision  
10. Wave 5.1 Deal Radar  

Capacitor stays parked until store enrolment. Convex stays a scout. Monetization stays frozen.

---

## Files most tasks will touch (quick index)

| Area | Paths |
|---|---|
| Tabs | `components/nav/navigationModel.ts`, `components/nav/SiteNav.tsx`, `components/nav/SiteNavMore.tsx`, `__tests__/navigationModel.test.ts` |
| Map | PubMap module, `app/map/page.tsx`, `app/map/arrival/page.tsx`, `__tests__/pubMap.test.ts`, `__tests__/arrivalWelcome.test.ts` |
| Follow graph | `lib/followStore.ts`, `lib/followWrite.server.ts`, `app/api/profiles/[handle]/follow/route.ts` |
| Public card | `lib/profileStore.ts`, `app/api/profiles/[handle]/route.ts`, `__tests__/profilesRoutePrivacy.test.ts` |
| You / nights | night-profile routes and `__tests__/nightProfile*.test.ts` |
| Out / deals | `app/out/page.tsx`, `app/api/out/route.ts`, `components/discovery/DealsTonightLane.tsx`, `lib/dealsHonesty.ts` |
| Pal | `lib/ask/tools.ts`, `app/pal/` |
| Cheap pint | `__tests__/cheapPintPing*.test.ts`, migration 0111 |
| Occupancy | `app/api/venues/[id]/occupancy/route.ts`, `__tests__/occupancy*.test.ts` |
| Apps | `capacitor.config.ts`, `docs/CAPACITOR_WRAP.md` |
| Law | `AGENTS.md`, `CONTEXT.md`, `DESIGN.md`, `VOICE.md` |

---

## Tests / validation

- Default: targeted Vitest for the files in the task.
- Visual ships: 390x844 + desktop screenshots through `chrome-devtools-axi`. Use Playwright in the worktree for scripted end-to-end checks.
- After implementation commit: one no-mistakes run on that worker. No second ACP-only run if Cursor ACP hangs. Recover custody only when status says `recover_custody`.
- First mate reviews with code-review + codebase-design before merge.
- Do not deploy from the merge. Batch to the named daily deploy.

---

## Risks and tradeoffs

- **8 GB Mac.** One lane. A second full suite will swap and can shut the machine down.
- **Dirty local clone.** A worker that starts there will ship skill-delete noise. Isolation is mandatory.
- **Actions off.** A red GitHub check is not information. Local verify is.
- **Privacy vs growth.** Private-by-default would hide the graph on day one. Default stays public.
- **Pint Drop law vs paint.** Building venues waves before that hold is answered risks painting uncorroborated pins again.
- **Stripe freeze.** Any paywall or Connect work before the ADR amendment is a contract break.
- **100-account gate.** A public store push before that number fights the accepted plan.
- **GNHF / product-loop leftover copies.** Features in those copies may already be on main under other SHAs. Inventory before reuse.

---

## Open questions (only these need the captain before Wave 2+)

Wave 1 can start without new answers after both Wave 0 tasks are complete and verified.

Before Wave 2 lands in production, the captain should confirm:

1. Default new accounts stay **public**. Yes or no.
2. Public `auto=1` add-links stay as specified in #1059, and private targets become a request. Yes or no.
3. Wave 0 deploy: name the deploy when ready.

Everything else in the holds list can wait. Do not block leftover bug fixes on those holds.
