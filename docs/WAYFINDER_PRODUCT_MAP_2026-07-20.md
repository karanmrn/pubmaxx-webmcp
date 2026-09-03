# WAYFINDER PRODUCT MAP (2026-07-20)

Canonical execution map for the decision-complete product roadmap authored by Sol 5.6, reconciled against shipped code on main. Written by Fable after owner rulings on 2026-07-20. Sol and every lane read this file together with docs/UNIVERSAL_DAY0_PRD.md (STATE OF THE BUILD + TASTE DOCTRINE remain binding). FABLE_HANDOFF.md carries live session state.

Status legend used throughout: EXISTS (shipped on main, wire or extend it, do not rebuild), PARTIAL (seams exist, close the gap), MISSING (genuine new build), OWNER (blocked on an owner-only action). Every EXISTS/PARTIAL claim names real files; read them before writing anything.

## Destination

The complete loop live in London: anonymous grounded Plan, account onboarding, gated collaboration, confirmed completion, private Memory, consented Story, better future discovery. Standing on honest evidence-gated coverage, an instrumented analytics baseline, a Membership rail, and then iOS. Reaching the end = every wave below closed through its gate with evidence.

## Notes

- Execution-carrying map. Tickets are build slices; decisions are locked unless a ticket is explicitly marked "decision".
- Lane discipline unchanged: isolated worktree, own branch, non-draft PR, full local vitest at latest main before opening (semantic-collision guard), merge on full green (Vercel chengdu + pubmax, CodeRabbit, Cursor security), squash merge, delete branch, remove worktree.
- Frontend lanes = Fable forks xhigh; backend lanes = Opus 4.8 xhigh or Sol; mixed scopes split.
- Migrations additive only, owner applies, search_path pinned on functions.
- Verification bar per lane: vitest green local + Vercel, tsc clean, no em dashes in product copy, provenance label on every sourced claim, hermetic tests, write-surface certification bumped in the same commit as any new mutating route (count currently 64), both-theme screenshots for UI lanes.

## Decisions so far (owner, 2026-07-20)

- Six-tab nav + /tonight cold start STAYS (shipped and locked via #414, #422, #445). The five-tab clause in the Sol roadmap is superseded.
- Full map, waved: near waves fully ticketed, far waves coarser slices with entry gates.
- Sequencing deviation from the Sol roadmap: solo anonymous Plan activation plus analytics baseline ships BEFORE the collaborative trial build. Wave 4 entry is gated on Wave 2 acceptance data.
- Convex is contained to the Pub Pal domain: Pal profile, explicitly confirmed Pal memories and preferences, mastery, and unlocks. Plan and collaboration (including completion/PNC), entitlement, social, identity, and core product authority remain on Supabase. Existing Convex `planCompletions` and its migration/DTO surfaces are frozen pre-ruling scaffolding, not an approved cutover path; `plan_completion` stays in `supabase` mode. Any new non-Pal Convex table, capability, or runtime path requires an explicit owner-approved decision recorded in this map and a matching architecture-fence update.
- This map lives at docs/WAYFINDER_PRODUCT_MAP_2026-07-20.md and is the handoff artifact to Sol.

## Corrections to the Sol 5.6 roadmap (update your model before planning against it)

1. **Nav.** Roadmap wants Today/Explore/Plan/Stories/You with Tonight inside Explore. Superseded: six-tab equal-rhythm nav shipped (#414, #422, count-driven CSS model in components/nav/mobileNav.css) and wrapped-app cold start lands /tonight (#445, lib/entryDecision.ts, owner-locked).
2. **CI.** Roadmap claims hosted CI is unavailable and asks for per-handoff verification bundles. Wrong: Vercel runs the full ci script (tests inside builds) and gates every merge; it has been the green gate since #383. Only GitHub Actions crons are dead ($0 billing cap, owner item). The verification-bundle clause is dropped; the existing lane verification bar stands.
3. **Analytics.** Roadmap says "add PostHog through explicit allow-listed events". The rail already EXISTS end to end: lib/analytics.ts (consent-gated, DNT-honouring, pseudonymous beacon), lib/analyticsEvents.ts (closed allow-list registry + sanitizeEvent), lib/analyticsIdentity.ts, lib/posthogServer.ts (server-side forwarder, consent-checked), app/api/events (rate-limited ingest), components/ConsentAwareVercelAnalytics.tsx. Remaining work is event COVERAGE for loop metrics, not integration.
4. **Convex.** Roadmap says evaluate Convex only after measured Supabase pain. Overtaken by reality: the repository already carries a typed Convex foundation for the Pal domain (`convex/schema.ts`: `pubPals`, `palMemories`, `masteryEvents`, `palUnlocks`, plus frozen `planCompletions` and shadow-read migration scaffolding). Wave 0.6 is now ruled: Convex is contained to Pub Pal; Plan, collaboration, entitlement, social, identity, and core authority stay on Supabase. The exact schema allow-list is CI-fenced in `__tests__/convexContainment.test.ts`.
5. **Webpack dev failure.** Roadmap opens with fixing a webpack development failure (area-news browser/server split). No live evidence of this failure in current session state. Wave 0 carries a cheap verification ticket; fix only if reproduced.
6. **Assumed-new is largely built.** Much of roadmap phases 2, 4, and 5 already exists on main: plan generation, invites with hashed tokens, proposals and two vote systems, presence, recap pipeline with a single publish gate, propose-then-confirm Story publication, per-owner consent endpoints, offline read caching, PWA, account-claim seam. The corresponding tickets below are wire/extend, not greenfield. Read the named files first.

## Wave 0: Stabilize + instrument (now)

| # | Ticket | Status | Lane |
|---|--------|--------|------|
| 0.1 | Owner-blocking batch: apply migration 0044 (supabase/migrations/20260719130000_0044_plan_vibe_votes.sql, additive-only; vibe votes 503 durably until applied), GitHub Actions billing cap (revives weather/signals/ingest crons; brief freshness dies without it), TICKETMASTER_API_KEY (#385), store enrollment (#390), VAPID keypair, Exa/Firecrawl credit top-ups | OWNER | owner |
| 0.2 | Webpack dev smoke: `next dev --webpack --port 3210`, then exercise `/api/area-news?area=soho`, `/borough/camden`, and `/map`. On 2026-07-21 all returned 200 and the claimed `node:fs`/`node:path` client-bundle leak did not reproduce after the browser-safe/server-only split. A clean `npm ci` restored the separately missing `@capacitor/app` install and typecheck passed; this was dependency drift, not the area-news boundary | CLOSED WITH EVIDENCE | Sol |
| 0.3 | Lint scope repair: exclude .claude/worktrees and detached worktrees from lint globs so stray worktrees cannot fail main lint | per roadmap | Opus |
| 0.4 | Route smoke coverage: cheap Playwright (or judge-shot harness) smoke over /today, /tonight, Explore/Map, /plan, /moment, Stories, You, public profile; scripts/judge_w2_shots.mjs is the reusable capture base | PARTIAL | Opus |
| 0.5 | Loop-metrics event coverage: extend the closed registry in lib/analyticsEvents.ts with the activation and loop events the metrics section needs (plan_generated, plan_accepted, plan_saved, claim_started, claim_completed, plan_completed, memory_reviewed, story_published, qualifying core actions for Weekly Meaningful Pubmaxxers). Server-enforced consent path unchanged; no new payload PII; no raw coordinates | rail EXISTS | Opus |
| 0.6 | Convex containment ruling: contain Convex to Pub Pal; Plan, collaboration, completion/PNC, entitlement, social, identity, and core authority remain Supabase. Frozen pre-ruling Plan Completion scaffolding is not a cutover path; CI fences schema expansion | DECIDED | Fable + owner |
| 0.7 | Worktree and branch hygiene: classify existing worktrees (patch-equivalent, uniquely salvageable, incomplete, abandoned), prune ~130 stale worktree-agent-* local branches and ~158 remote heads with squash-merge ancestry proof per branch; evaluate salvage of gnhf/objective-make-every-f07487 (possibly unmerged shareSheet + bar-tab OG work) | per handoff | Fable |
| 0.8 | Judge-w2 polish tail (non-blocking, ranked in docs/JUDGE_W2_VERDICT_2026-07-20.md): pal mid-zone ~250px, /near header idiom, landing coach-chip transient overlap, map first-frame attitude (watch only) | backlog | Fable forks |

Exit gate: 0.1 items done by owner, 0.2 settled with evidence, 0.5 events flowing to PostHog from prod.

## Wave 1: Store-ready close-out (in flight; tail of wayfinder #437)

| # | Ticket | Status | Lane |
|---|--------|--------|------|
| 1.1 | #441 first-run onboarding, locked shape: London, companion pick, contextual notification ask AFTER first plan action (never on boot). Build ON lib/entryDecision.ts (deep-link bypass and /tonight invariants are test-pinned) and lib/firstRunTour.ts + prompt budget (lib/promptBudget.ts). The roadmap's "one useful Plan first" principle folds in as the onboarding's landing action, not a new flow | seams EXIST | Fable fork |
| 1.2 | #443 wrapped-build evidence refresh (Gate Z style): Capacitor sync (capacitor.config.ts remote-URL shell, ios/ + android/ EXIST), safe areas, status bar, offline fallback for remote-URL shell, both-theme evidence set on the wrapped build. Owner-approved sequencing exception (2026-07-21): retain the allow-listed native deep-link route seam now as wrapped-shell infrastructure; broader Wave 7 native companion behavior remains gated | config + deep-link seam EXIST | Opus |
| 1.3 | Lane B continuation (Sol): web-push VAPID provider behind the existing lib/pushProvider.ts seam (APNs transport already on main; read lib/pushTokenStore.ts, lib/pushSender.ts, lib/nativePush.ts first, do not rebuild), push event + click-through handler in public/sw.js, manual daily brief sender script (crons dead). No-op loudly without VAPID keys | PARTIAL | Sol |
| 1.4 | Push identity join (new, surfaced by inventory): push tokens currently register pre-auth carrying no user or plan identity, so plan-scoped and person-scoped targeting is impossible. Add an identity join on the token store (claimed account or plan membership) before any targeted push ships. Write-surface certification applies | gap | Sol |
| 1.5 | Lane E continuation (Sol): restaurants + attractions ingest through lib/slopFilter.ts + provenance registry + freshness registry (lib/freshness.ts, data/freshness_registry.json). Per-row source URL + observed-at date or the row does not ship; honest empty states; halt on credit failure and report owner | pipeline EXISTS | Sol |

Exit gate: #437 closes (every ticket + wrapped-build evidence pass), store listing assets final.

## Wave 2: Solo Plan activation (deviation: ships before collaboration)

The activation cornerstone. An anonymous user gets a grounded, adjustable three-stop Crawl in about a minute, with every claim honest and every hard constraint respected. Instrumented so Wave 4 has a baseline to gate on.

| # | Ticket | Status | Lane |
|---|--------|--------|------|
| 2.1 | Progressive intake flow: `components/plan/PlanIntake.tsx` owns the resumable, skippable questions over `lib/planIntake.ts`; `PlanComposer.tsx` reveals route controls only after intake and keeps the final action unavailable until every visible stop and required field is complete | EXISTS | Fable fork |
| 2.2 | Grounded generation: extend app/api/plans/generate + lib/planRoute.ts to consume the intake constraints. Hard constraints (safety, accessibility, exclusions, budget ceiling, transport feasibility) are never silently violated: a stop that fails one is excluded or explicitly flagged, never quietly included. Soft-constraint relaxations disclosed on the result | generate EXISTS | Opus |
| 2.3 | Stop cards with reasons: matching reasons, provenance chips (lib/provenanceLabels.ts), freshness/confidence (lib/priceConfidence.ts state machine, lib/nightSignalClaims.ts verification levels), transport feasibility (lib/tfl.ts), warnings, alternatives with one-tap swap (plan proposals seam) | data layers EXIST | Fable fork |
| 2.4 | Constraint fence tests: vitest suite proving hard-constraint invariants against the generator (accessibility-required never yields an inaccessible stop, budget ceiling never exceeded without a flag, etc.). This is the roadmap's non-negotiable made executable | new | Opus |
| 2.5 | Passwordless email auth uses `signInWithOtp` and is the complete primary path. Google and Apple buttons are gated by live Supabase provider availability; neither social provider is enabled in production. [`DEPLOYMENT.md`](./DEPLOYMENT.md#3-browser-sign-in-email-magic-link--google--apple) owns provider state and setup | EXISTS; social setup OWNER | Sol |
| 2.6 | Apple web sign-in code exists behind provider availability. Production activation needs a paid Apple Developer account; the native Capacitor flow remains separate follow-up. See [`DEPLOYMENT.md`](./DEPLOYMENT.md#apple) | PARTIAL; activation OWNER | Sol |
| 2.7 | Compact account onboarding replaces the old identity-claim route. A verified account claims a public handle and supplies a private date of birth, while full name and sex are optional and private; the first claimant can take an unlinked legacy handle and its history. Contributions are not blocked by age | EXISTS | Opus |
| 2.8 | Activation instrumentation: time-to-accepted-route measurement (target ~1min), accepted/saved events from 0.5 registry, funnel from intake start to acceptance | registry from 0.5 | Opus |

Exit gate (also the Wave 4 entry gate): first reliable London PostHog baseline for solo Plan acceptance. Numeric threshold set from that baseline with the owner, per the roadmap's own rule, and recorded here.

## Wave 3: Trustworthy London coverage

| # | Ticket | Status | Lane |
|---|--------|--------|------|
| 3.1 | Zone-level evidence gating: extend lib/cityCapabilities.ts (CityReleaseTier flagship/core/preview + per-capability availability with dated evidence, EXISTS at city level) down to patch granularity over lib/nightPatches.ts. Supported zones labelled honestly; no uniform-coverage claims | city level EXISTS | Opus |
| 3.2 | Unsupported-zone previews + demand capture: honest factual preview (no fabricated Plans), nearby supported alternatives, and a demand waitlist (MISSING; components/map/CitySuggestBanner.tsx is the adjacent pattern) | MISSING | Opus |
| 3.3 | Per-field conflict resolution: generalize the lib/nightSignalClaims.ts corroboration model (single_source/corroborated/manual_review, confidence, reviewState, corroboratingSources) from night signals to venue fact stores (prices, hours, accessibility, atmosphere). Resolution by authority + freshness + corroboration + confidence; unresolved conflict exposed, not hidden | model EXISTS for signals | Sol |
| 3.4 | Structured Visit Reports: formalize atop Pint Drops (lib/pintDrops.ts, lib/pintDropsStore.ts, contribution gamification in lib/pintContributions.ts) and ratings (lib/ratingsStore.ts, dual backend). Structured fields + optional short note; summaries recency/confidence weighted; NO public star scores. Existing moderation queue (app/admin) covers review | substrate EXISTS | Opus |
| 3.5 | Venue operator rail: verified venue accounts, attributed proposals for corrections/events/offers/responses that route through review rather than overwriting trusted data. Entirely MISSING (nightSignalClaims reviewAuthority is internal-only). Admin console app/admin/page.tsx is the review side to extend | MISSING | Sol |
| 3.6 | Sponsorship and affiliate separation (policy + rendering): disclosed, visually separated, never affects organic ranking, eligibility, warnings, provenance, alternatives, or prices. Content/policy ticket with a render fence test | policy | Fable fork |
| 3.7 | Night-shaping layers only: real events via Ticketmaster (key = owner item 0.1), culture, opening-hour change detection, transport disruption (lib/tfl.ts). Weather EXISTS (lib/drinkWeather.ts, manual refresh until crons revive). Everything through slop filter + provenance + freshness, same as Lane E | partial | Sol |
| 3.8 | Staged London cohorts: recruit and observe Decide, Explore, Contribute mode cohorts against the instrumented funnel; feeds threshold setting | ops | owner + Fable |

Exit gate: evidence-gated zone map live, Visit Reports flowing, conflict model serving on at least prices + hours.

## Wave 4: Collaborative Planned Night trial (ENTRY-GATED on Wave 2 baseline)

Mostly wire/extend. Read the plan sub-domain first: lib/planStore.ts (route_revision optimistic concurrency), lib/planCollaborationStore.ts, lib/planMemberCapability.ts, app/api/plans/[id]/{invites,redeem,proposals,constraints,session,presence,getin,complete,recap}, lib/inviteShare.ts (hashed tokens, PLAN_MEMBER_TOKEN_SALT), two vote systems (proposal votes + vibe votes with migration 0044 RPC pattern).

| # | Ticket | Status | Lane |
|---|--------|--------|------|
| 4.1 | Cohost role: PlanMemberRole is host/guest only today; add cohost with capability table in lib/planMemberCapability.ts. Hosts stay accountable; cohosts get confirm/resolve powers | PARTIAL | Opus |
| 4.2 | Invitation privacy preview: pre-acceptance view exposes ONLY inviter, broad area, time window, vibe, accessibility expectations. Links plan-bound, revocable, abuse-rate-limited, expire at plan end (invites + redeem EXIST; preview, revocation UX, expiry semantics are the gap) | PARTIAL | Fable fork |
| 4.3 | Append-only plan_events journal: formalize the PlanActionDTO action log (arrived/skipped/swapped/ending) + proposals + votes + constraint changes into one append-only journal per plan. Detours: live changes append recorded detour events; the locked route is never overwritten (route_revision snapshots are the substrate) | PARTIAL | Sol |
| 4.4 | Offline write outbox: the one genuine greenfield build. Queue authored actions offline, replay on reconnect using the existing idempotency seams (lib/planMutationKey.ts, planMutationHttp.ts digests); non-conflicts merge automatically; route conflicts retain every event and surface to host/cohost for resolution. No CRDT; journal + revision + human resolution. sw.js and lib/offlineCache.ts cover reads already; writes are the gap | MISSING | Sol |
| 4.5 | Completion rules: completion requires scheduled commencement, meaningful crew-authored activity (journal-derived), and host/cohost confirmation. Passive location, expiry, or cancellation never consumes the trial. app/api/plans/[id]/complete EXISTS as the seam | PARTIAL | Opus |
| 4.6 | Trial entitlement seam: one collaborative Planned Night trial per PUBMAXX User ID, in a processor-independent entitlement ledger (the same ledger Membership uses in Wave 6; define the contract now, no Stripe dependency). Account onboarding required before trial completion or durable preservation (2.7). Trial Plans and Memories permanently readable and exportable after completion | MISSING | Sol |
| 4.7 | Personal (solo) planning stays free and ungated, permanently. Fence test | invariant | Opus |

Exit gate: full trial loop passes end to end in staging cohort: invite, join, propose, vote, offline detour, conflict resolution, confirmed completion, trial consumed exactly once.

## Wave 5: Memory + consented Story completion

Substrate EXISTS: moments (lib/momentDraft.ts, lib/nightMomentMedia.ts, app/moment), recap pipeline (lib/planRecap.ts, lib/recapView.ts, lib/recapCard.ts), single publish gate getPublishedRecapSource (lib/nightMemoryStore.ts, consumed by lib/socialFeed.ts and app/recap/[storyId]), propose-then-confirm publication (app/api/night-stories/[id]/publish-proposals + publish-confirmations), per-owner consents (app/api/night-stories/[id]/consents, hasPublicationConsent in lib/recapView.ts: pending/withdrawn/absent never pass).

| # | Ticket | Status | Lane |
|---|--------|--------|------|
| 5.1 | Draft Memory from journal: generate the private draft from confirmed plan_events + authored contributions (4.3 output). Host review required; a completed Pubmaxxing Loop = completed Plan + at least one preserved authored contribution + host-reviewed private Memory. Publication stays optional | PARTIAL | Opus |
| 5.2 | Audience tiers: NightStoryVisibility is private/unlisted/public today; add followers and crew-only. Widening an audience requires renewed approval from every affected contributor | PARTIAL | Opus |
| 5.3 | Story versioning: published Stories versioned; material edits involving another person trigger reapproval from that person | MISSING | Sol |
| 5.4 | Contributor controls: per-contributor approval of Moments, tags, quotes, media, likeness (consent endpoints EXIST per-owner; extend to per-item), contributor veto on reuse of their contribution, host controls interactions | PARTIAL | Opus |
| 5.5 | Redaction on withdrawal or deletion: departing person's content and identity redacted without destroying everyone else's Story. Design against the publish gate so redaction is one choke point | MISSING | Sol |
| 5.6 | Alt-text authoring: field exists in the media model (lib/nightMomentMedia.ts); build the author-confirmed authoring surface. AI may suggest, author must confirm; unconfirmed alt text blocks publish | PARTIAL | Fable fork |
| 5.7 | Photo-first stands; video stays deferred (roadmap exclusion, restated as a fence) | invariant | - |

Exit gate: loop-depth metric live (completed loops ending in reviewed private Memory), consent-withdrawal test passes end to end.

## Wave 6: Membership + social depth

| # | Ticket | Status | Lane |
|---|--------|--------|------|
| 6.1 | Compliance floor (entry requirement for this wave, per roadmap): full-account data export and erase-everything endpoint (today only Pal-scoped export app/api/pub-pal/memories/export + scattered per-surface DELETEs), audited consent records, app-wide proportionate 18+ assurance (today only Pal adultAttestedAt attestation) | PARTIAL | Sol |
| 6.2 | WTP research with London cohorts, then owner locks ONE transparent annual price before any checkout code | OWNER | owner + Fable |
| 6.3 | Stripe Billing: annual plan, hosted checkout + portal, verified webhooks, entitlement ledger from 4.6 as the single truth (no stripe dependency exists today; greenfield). Cancellation stops renewal, access through paid term; failed renewal = 7 days grace; renewal failure never interrupts a started Planned Night | MISSING | Sol |
| 6.4 | Membership gating: following, reactions, comments, reposts, publishing, messages, continuing Memories, post-trial collaboration behind entitlement, enforced server-side. Public profiles and consented public Stories stay freely readable | gating MISSING, verbs mostly EXIST | Opus |
| 6.5 | Blocking: mutual invisibility + no contact, shared-crew presence/contact isolation with safe exit paths, never revealing who blocked whom. Entirely MISSING; touches feed choke (lib/socialFeed.ts), messages (lib/messageAuth.ts), presence, invites | MISSING | Sol |
| 6.6 | Reposts + quote posts: canonical repost references, MISSING today | MISSING | Opus |
| 6.7 | Account privacy model: Instagram-like public/private defaults, unique pseudonymous handles (EXIST), follower/following list visibility subject to privacy, relationship-plus-local feed ranking (lib/forYou.ts deterministic ranker is the base) | PARTIAL | Opus |
| 6.8 | DM hardening: DMs EXIST (lib/messagesStore.ts, realtime, explicitly courtesy-curtain trust). Bring to encrypted in transit and at rest (not E2EE initially), 15-minute unsend-for-everyone, restricted audited safety-evidence records | PARTIAL | Sol |
| 6.9 | Ops console: extend app/admin (token-gated queues EXIST for pint drops, comments, import notes) to least-privilege roles: moderation, safety escalation, data stewardship, venue operations, billing support, super-admin | PARTIAL | Sol |
| 6.10 | Moderation program: risk-tiered human moderation, confidential reporters, explanatory enforcement notices, appeals, rapid path for severe consent/safety incidents | PARTIAL (report flow exists on pint drops) | Sol + owner |
| 6.11 | Lifetime Membership rubric: published contribution rubric, nomination, review, reasons, appeal, abuse revocation | policy | owner + Fable |

Exit gate: entitlement ledger authoritative across web checkout, trial, and gates; blocking live; compliance floor passed.

## Wave 7: Platform + expansion (coarse slices, sharpen later)

- iOS native night companion: push, deep links, camera/share integration, explicit foreground location, safe areas, resilient Plan access, auth, payment compliance. iOS 15 floor preserved unless a required capability proves incompatible. Enters only after web/PWA proves the full loop (Waves 2-5) with cohort evidence.
- Store purchase rail fallback: web checkout preferred; if store review rejects entitlement-only recognition, add the minimum compliant store purchase rail writing into the same entitlement ledger.
- Android follows iOS with equivalent core behavior (android/ scaffold EXISTS).
- Pal push-to-talk voice: post-core experiment, never a launch dependency (voice-token seam EXISTS: app/api/pub-pal/voice-token).
- City two: evidence scorecard (demand, pub density, data availability, transport, partners, moderation, community readiness). Requires London product proof, trust/data readiness, sustainable operations, technical stability, viable economics. Seeds already exist for oxford/manchester/glasgow under lib/cities/ but expansion is gate-locked, seeds are not a commitment.

## Cross-cutting contracts (live throughout, own tickets as waves touch them)

- **Versioned typed domain API:** today ~80 app/api routes with DTO discipline, lib/apiError.ts publicApiError envelope (additive contract), lib/convex/contracts.ts version:1 payloads. Ticket: extract a shared contract layer consumable by future native clients. No /v1 URL scheme exists; introduce versioning at the contract layer, not by URL churn.
- **Entitlement independent of processor:** one PUBMAXX User ID = one cross-platform entitlement state; Stripe/App Store/Play receipts are inputs, never the truth (4.6, 6.3).
- **Pal preference facts:** only explicitly confirmed facts, inspectable edit/delete centre (memory provenance EXISTS in the Pal store: user_confirmed/completed_plan/user_correction/pal_proposal; export endpoint EXISTS). AI stays an optional provider-agnostic layer over deterministic grounded behavior (concierge doctrine unchanged).
- **Metrics definitions:** Reach = Weekly Meaningful Pubmaxxers (at least one qualifying core action, not passive opens). Core outcome = confirmed Completed Planned Nights. Depth = completed loops ending in reviewed private Memory; Story publication measured separately. Activation = eligible grounded route explicitly accepted or saved within ~1 minute. Numeric thresholds set only after the first reliable London PostHog baseline.
- **Accessibility + performance:** WCAG 2.2 AA, non-map journeys for everything, keyboard/screen-reader, reduced motion, reflow, 44px targets, safe areas, web/native equivalence. p75 field budgets for Core Web Vitals plus explicit Map and Plan interaction and bundle budgets on representative mobile hardware.
- **AI features additionally require:** schema validity, grounded-source faithfulness, safety/constraint suites, fallback behavior, cost/latency budgets, sampled human review.

## Not yet specified

- Numeric Wave 4 entry threshold (set from Wave 2 baseline with owner).
- Sponsorship policy detail (3.6) beyond the separation invariants.
- DM encryption implementation depth (6.8).
- Final ASO screenshot set (sharpens once Wave 1 surfaces freeze).

## Out of scope (roadmap exclusions, restated as fences)

No marketplace transactions. No generic city-guide expansion. No public drinking leaderboards or consumption goals. No pay-to-rank in any form. No background location. No automatic sensitive Pal inference. No video in the first loop. User content stays creator-owned under a limited audience-scoped service licence; promotional or partner reuse requires separate consent.

## Approval boundaries (unchanged)

Product-policy changes, paywall/pricing changes, privacy/consent/safety changes, public-contract changes, destructive branch/data actions, and wave exits require owner approval. Fable reviews, decomposes, and assigns work to lanes by difficulty; Sol reads this file plus docs/UNIVERSAL_DAY0_PRD.md before touching anything.
