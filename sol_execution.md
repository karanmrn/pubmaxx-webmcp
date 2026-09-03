# Sol Execution Handoff for Fable

Last updated: 20 July 2026, Europe/London  
Prepared by: Sol 5.6 execution swarm  
Repository: `karanmrn/pubmax`  
Canonical product map: `docs/WAYFINDER_PRODUCT_MAP_2026-07-20.md`

## Purpose of this document

This is the review handoff for everything executed after the Fable PRD and UI redesign were reconciled with the repository.

The next implementation wave is paused. Fable should review the merged work and all open pull requests before Wave 2.3, Wave 2.8, or any production migration begins.

## Executive status

Current `main`:

- Commit: `ee1730e0c747db2fb0b2aadd183065d4dd4d02c0`
- Latest merged feature: progressive Plan intake, PR #461
- Working tree was clean when this handoff was prepared

Completed and merged during this execution:

- Repository/PRD reconciliation and release-baseline hardening
- Wrapped-app readiness and guarded first-run onboarding
- Governed restaurants/attractions ingest pipeline
- Secure passwordless email authentication
- Progressive, resumable Plan intake

Implemented, reviewed, verified, and still open:

- Replay-safe core-loop analytics, PR #456
- Guarded VAPID web push, PR #457
- Push identity join and revocation model, PR #459
- Grounded Plan generation and hard-constraint fences, PR #462

Nothing was applied to production during this execution:

- No Supabase migration 0045, 0046, or 0047 was applied
- No production secret was generated or stored
- No VAPID keypair was generated or stored
- No Supabase Email provider or SMTP configuration was changed
- No billing, credits, scheduled jobs, App Store, Play Store, APNs, AASA, or asset-links configuration was changed
- No user worktree or unmerged user work was deleted

## Review order for Fable

Review in this order because the dependencies are meaningful:

1. PR #462: grounded generation and constraint fences
2. PR #456: replay-safe analytics
3. PR #457: VAPID web push
4. PR #459: push identity join, stacked on PR #457
5. PR #460: passwordless authentication, already merged
6. PR #461: progressive intake, already merged

Pull requests:

| PR | State | Branch | Base | Purpose |
|---|---|---|---|---|
| [#456](https://github.com/karanmrn/pubmax/pull/456) | Open | `codex/wave0-loop-analytics` | `main` | Replay-safe loop analytics |
| [#457](https://github.com/karanmrn/pubmax/pull/457) | Open | `codex/wave1-web-push` | `main` | Guarded VAPID web push |
| [#459](https://github.com/karanmrn/pubmax/pull/459) | Open | `codex/wave1-push-identity` | `codex/wave1-web-push` | Account/session push identity join |
| [#460](https://github.com/karanmrn/pubmax/pull/460) | Merged | `codex/wave2-passwordless-auth` | `main` | Passwordless email authentication |
| [#461](https://github.com/karanmrn/pubmax/pull/461) | Merged | `codex/wave2-progressive-intake` | `main` | Progressive resumable intake |
| [#462](https://github.com/karanmrn/pubmax/pull/462) | Open | `codex/wave2-grounded-generation` | `main` | Grounded generation and executable hard fences |

Important branch state:

- PR #456 and PR #457 were fully green at their reviewed heads, but `main` has advanced. Rebase and refreshed gates are required before merge.
- PR #459 is intentionally stacked on PR #457. It must not merge independently.
- PR #462 was rebased after PR #461 merged. Its Git tree was byte-identical before and after the rebase.
- PR #462 passed both Vercel preview builds after the rebase. Cursor skipped the identical-tree rerun after previously passing. CodeRabbit is currently rate-limited; that is an external quota condition, not a code finding.

## Canonical planning and repository reconciliation

The repository was first reconciled against the Fable PRD and the Wayfinder roadmap.

Primary document:

- `docs/WAYFINDER_PRODUCT_MAP_2026-07-20.md`

The product map records:

- What already existed in the repository
- What Fable had redesigned or specified
- What was partial, missing, owner-gated, or infrastructure-gated
- Wave ordering and entry/exit gates
- The deliberate decision to ship solo Plan activation before collaborative trial work
- The requirement that Wave 4 waits for a real Wave 2 activation baseline

Foundation pull requests merged before feature execution:

| PR | Result |
|---|---|
| #448 | Added the Fable/Wayfinder PRD crosswalk and canonical planning map |
| #449 | Made the events rate-limit contract hermetic in tests |
| #450 | Contained Convex to the Pub Pal boundary |
| #451 | Split the area-news Node dataset loader from the client bundle |
| #452 | Added core application route smoke coverage |
| #453 | Excluded nested/detached worktrees from lint scope |
| #454 | Hardened wrapped-app launch readiness |
| #455 | Added guarded native first-run onboarding |
| #458 | Added governed night-out place ingest |

## Wave 0: analytics baseline, PR #456

Branch:

- `codex/wave0-loop-analytics`
- Reviewed head: `5640b5ae344ea8899af20b98eb580245f7b9851d`

Implemented:

- Closed privacy allowlists for analytics events and properties
- Plan generated, accepted, saved, and related loop events
- Exact-once verified event outbox and receipt model
- Stable `$insert_id` behavior
- Operation-bound, expiring grounding proof
- Consent-abort epoch handling
- Server-owned occurrence timestamps
- Production signing that fails closed
- Per-process random signing only in true keyless/local operation
- Test and Playwright signing-secret isolation without command-line leakage

Security issue found and fixed during review:

- An earlier version contained a predictable hard-coded signing fallback
- It was replaced with fail-closed production behavior and a random keyless-only local fallback

Verification at the reviewed head:

- `npm run verify` passed
- 447 test files passed
- 4,190 tests passed
- Zero high-severity audit vulnerabilities
- Both Vercel projects passed
- Cursor security passed
- CodeRabbit passed

Production gate:

- Requires migration `20260720150000_0045_analytics_event_receipts.sql`
- Requires `PLAN_IDEMPOTENCY_SECRET` or `RATE_LIMIT_SALT`, at least 32 bytes
- Must be rebased on current `main` and fully reverified
- Migration and secret remain unapplied/unprovisioned

## Wave 1.1 and 1.2: onboarding and wrapped-app readiness

Merged results:

- PR #454: wrapped-app launch readiness
- PR #455: guarded native first-run onboarding

Onboarding contract implemented:

- London-first entry
- Companion selection
- One useful Plan as the landing action
- Notification prompt only after a relevant Plan action
- Notification prompt never on boot
- Existing deep-link bypass and `/tonight` behavior preserved

Wrapped-app work covered:

- Capacitor remote-URL shell assumptions
- Safe-area and status-bar readiness
- Offline fallback expectations
- Wrapped-build evidence requirements

Owner/device work still outstanding:

- Xcode and physical-device evidence
- Java 17 and Android SDK evidence
- AASA Team ID and `assetlinks.json` fingerprint
- APNs and store enrollment
- Final store listing assets

## Wave 1.3: guarded VAPID web push, PR #457

Branch:

- `codex/wave1-web-push`
- Reviewed head: `1c5d932e33a616376a4dd25242b493947c36ab03`

Implemented:

- Web-push VAPID provider behind the existing push-provider seam
- Service-worker push display and click-through handling
- Manual daily-brief sender because scheduled jobs are not reliable
- Installed-PWA contextual prompt after an in-document Plan action
- No boot-time prompt
- Loud keyless no-op when VAPID keys are absent
- Exact FCM, Mozilla, and Apple endpoint origin/path/default-port allowlisting
- Registration, storage, and send-time SSRF fences
- Safe payload parsing and click navigation

Verification at the reviewed head:

- Full suite passed
- 449 test files passed
- 4,184 tests passed
- Production build and end-to-end checks passed
- Zero high-severity audit vulnerabilities
- Both Vercel projects, Cursor security, and CodeRabbit passed

Production gate:

- Requires migration `20260720160000_0046_web_push_subscriptions.sql`
- Requires `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- Requires `VAPID_PRIVATE_KEY`
- Migration 0046 must follow migration 0045
- Must be rebased on current `main` and fully reverified

## Wave 1.4: push identity join, PR #459

Branch:

- `codex/wave1-push-identity`
- Head: `f6d65d80b8ee760521b6d55fdf4a1e1fb93a92a1`
- Base: PR #457 / `codex/wave1-web-push`

Purpose:

- Pre-auth push subscriptions previously carried no trusted account or Plan identity
- Targeted account/Plan push was prohibited until an identity join existed
- Installation IDs remain identifiers, not authorization

Implemented:

- Verified account/session identity joins
- Plan-scoped identity seams without enabling targeted sends prematurely
- Monotonic account, Plan, installation, and session mutation watermarks
- Durable account/session revocation tombstones
- Thirty-day tombstone cleanup contract
- Delete-before-POST and delayed-link fencing
- Account-wide logout atomicity
- Supabase local-scope sign-out behavior
- AbortController and service-worker timeouts
- Response deadline spanning headers and body
- Streaming 64 KiB response limit with early cancel/abort
- Memory and SQL behavior parity
- Flat wrong-owner/nonexistent responses to reduce enumeration

Adversarial findings fixed across review iterations:

- Wrong-owner installation unlink could poison another account's watermark
- Old-session unlink could clear a newer session link
- Logout body parsing could hang after response headers
- `{ all: true }` could partially commit
- Memory and SQL missing-token tombstones diverged
- Mixed-owner installations could falsely report logout success
- Account-wide unlink could race a delayed link from another installation
- Anonymous `MAX_SAFE_INTEGER` watermarks could block another account's logout
- Response-size enforcement buffered an oversized body before rejecting it
- Memory deletion did not mirror SQL cascade semantics

Final verification:

- Independent adversarial review: safe
- `npm run verify` passed
- 457 test files passed
- 4,285 tests passed
- Zero high-severity audit vulnerabilities
- Both Vercel projects and Cursor security passed

Known validation limitation:

- Migration 0047 was contract-tested and statically reviewed
- No local Supabase CLI or `psql` was available for a real concurrent PostgreSQL race test
- This limitation must be addressed in preview/staging before production

Production gate:

- Requires migration `20260720170000_0047_push_identity_join.sql`
- Migration order is 0045, then 0046, then 0047
- PR #457 must land before PR #459
- Targeted sending must remain dormant until the identity contract and production migration are live

## Wave 1.5: governed restaurants and attractions ingest, PR #458

Merged as:

- Commit `f32a4345`

Implemented:

- Restaurants and attractions ingest through the existing slop-filter, provenance, and freshness contracts
- Per-row source URL and observation date requirements
- Exact requested/source/final/canonical/JSON-LD URL identity checks
- Tracking-only query removal
- Honest empty artifact when no governed evidence exists
- Validate-before-atomic-write behavior
- TLS verification and DNS-boundary handling
- No provider calls during normal build/test execution

Owner/infrastructure gates:

- Exa and Firecrawl credentials/credits for population
- GitHub Actions billing/capacity for scheduled jobs
- The code ships safely with an honest empty dataset

## Wave 2.5: passwordless email authentication, PR #460

Merged as:

- Commit `d31e6c10`

Implemented:

- Supabase `signInWithOtp` magic-link authentication
- Existing Google and Microsoft OAuth preserved
- Shared same-origin redirect guard
- Explicit, observable PKCE exchange
- Immediate authorization-code URL scrubbing before network waits
- Cryptographically random per-attempt IDs
- Per-attempt TTL fragment records
- Browser-wide PKCE coordination with Web Locks
- Capability fragments remain browser-local and never enter provider, server-query, or email URLs
- Neutral account-state responses to reduce user enumeration
- Actionable transient/configuration failures
- Accessible loading, success, error, and focus behavior
- Honest keyless behavior: auth UI remains hidden without public Supabase configuration

Adversarial findings fixed:

- Fragment-only Plan invite capability could leak into Supabase/SMTP callback URLs
- Cross-browser PKCE failures could be silent and leave codes in the URL
- Account-state normalization depended on brittle provider messages
- Disabled controls could break the focus trap
- Cross-tab attempts could overwrite or consume each other's fragments/verifier
- Authorization codes were initially scrubbed after, rather than before, exchange
- Injected callback attempt B could consume active attempt A's verifier
- Operational 401/403/408/425 responses could be falsely reported as success

Verification before merge:

- Independent adversarial review: safe
- `npm run verify` passed
- 450 test files passed
- 4,215 tests passed
- Zero high-severity audit vulnerabilities
- Both Vercel projects, Cursor security, and CodeRabbit passed

Owner configuration still required:

- Enable Supabase Email auth
- Configure production SMTP and a verified sender/domain
- Configure reply-to and launch rate limits
- Preserve the `ConfirmationURL`-based email template contract
- Allowlist production, localhost, and approved preview callback URLs
- Complete wrapped-shell universal/app-link device QA

## Wave 2.1: progressive resumable intake, PR #461

Merged as:

- Commit `ee1730e0`

Implemented:

- One question at a time, not a form wall
- Area, time window, group size, budget, and accessibility requirements
- Every step skippable
- Entire remaining intake bypassable through the free-description path
- Versioned v1 intake model and typed generation handoff
- Twenty-four-hour resumable draft envelope
- Remembered area stored separately from sensitive intake answers
- Intake cleanup after successful Plan creation
- Future-safe Europe/London exact-time handling
- DST overlap and rollover handling
- Generated preview invalidation when intake changes
- Strict corrupt-draft canonicalization/rejection
- Visible keyboard focus and Enter-to-advance behavior
- Responsive, reduced-motion, reflow, and 44 px target support
- Deep-link, `/tonight`, onboarding, and prompt-budget behavior preserved

Adversarial findings fixed:

- Reopened-and-skipped steps could leave old generated constraints active
- Accessibility requirements persisted indefinitely and across later Plans
- Late-night time choices could resolve to a past Plan
- Exact-time edits could leave a stale preview looking current
- Corrupt drafts could resume with contradictory workflow state
- Enter could submit the outer Plan form instead of advancing intake
- Reloading a near-expiry draft could refresh its sensitive-data lifetime
- Cleanup of one storage surface could prevent intake cleanup from running
- Initial Playwright setup had a hydration timing race; tests now wait for enabled state while preserving real Enter coverage

Verification:

- Independent lifecycle/accessibility review: safe after fixes
- Focused Chromium intake tests passed
- Plan creation loop passed, including forced storage-cleanup failure
- Pre-rebase `npm run verify`: 448 test files and 4,214 tests passed
- The later combined intake + auth + generation tree passed 454 test files and 4,301 tests
- Zero high-severity audit vulnerabilities

Important honest behavior:

- Hackney is never silently coerced to Shoreditch
- Unsupported data is surfaced honestly
- Intake collection does not imply the generator can satisfy every constraint

## Wave 2.2 and 2.4: grounded generation and executable fences, PR #462

Branch:

- `codex/wave2-grounded-generation`
- Head: `ac76dc9004600c0312dd881fd1b08ac0289f62f4`
- Base: current `main`

Implemented:

- Strict bounded request parsing before expensive work
- Plain-record and exact-key validation
- Unknown-version and malformed-intake fail-closed behavior
- Legacy no-intake API compatibility
- Per-field context source reconciliation
- Mapped-patch confidence separated from availability
- Hard accessibility evidence fences
- Attributable, freshness-aware price evidence for explicit budget ceilings
- Reviewed-signal and promoted-venue exclusion fences
- Recurring-hours evidence labelled as recurring, with exception warnings
- Exhaustive deterministic permutations for every three-stop set
- Walking-time-derived visit windows and uncertainty
- Constraint-checked swap alternatives
- Per-stop and per-alternative constraint flags
- Additive `constraintReport` and honest soft-relaxation disclosures
- Deterministic DTO seam for Wave 2.3 rendering

The original implementation was rejected during review and substantially decomposed.

Major review findings fixed:

- Coverage readiness incorrectly hard-blocked five mapped patches
- Only score-sorted stop order was evaluated, causing false no-route results
- Ten-minute transfer windows contradicted allowed walking distances
- `seatedService` was incorrectly treated as reliable-seating evidence
- Arbitrary quiet-hours text was incorrectly treated as visit-time low-noise evidence
- Cheapest slim-index price lacked enough provenance/freshness for a hard budget claim
- Recurring weekly hours were overstated as exact-date confirmation
- Parser accepted unknown keys, contradictory state, null bodies, and unbounded inputs
- Final inference reasons could contradict authoritative intake
- Night Area radius filtering was described as exact Night Patch geometry
- A clean canonical price row was incorrectly used as operational reliability/group-safety evidence
- Group-size disclosure falsely claimed group size shaped ranking when no capacity evidence existed

Final module boundaries:

- `planGenerationRequest`: bounded request boundary
- `planGenerationIntake`: strict handoff semantics and planning horizon
- `planGenerationContext`: authoritative per-field context/provenance
- `planGenerationRanking`: evidence-safe ranking reasons
- `planRouteEvidence` and `.server`: pure evidence model and canonical loaders
- `planRouteOptimizer`: permutations, transport, visit windows, and hard fences
- `planGenerationSelection.server`: server-side candidate selection
- `planGenerationDto`: response assembly
- `planGenerationEndings.server`: ending/closure assembly
- `planRoute`: reduced canonical facade

Honest limitations deliberately retained:

- Reliable seating and visit-time low-noise lack distinct canonical evidence; hard requests therefore return no route
- Recurring opening schedules do not prove holiday or exceptional opening
- Transport feasibility uses direct-distance walking estimates, not live TfL or pavement routing
- Exact patch geometry is not claimed where only mapped Night Area radius evidence exists
- Explicit ceilings fail closed when price evidence is stale, unknown, or unattributed

Verification:

- Independent adversarial constraint/evidence review: safe after fixes
- Full combined top-of-stack `npm run verify` passed
- 454 test files passed
- 4,301 tests passed
- Coverage thresholds passed
- Data validation, lint, and typecheck passed
- Zero high-severity audit vulnerabilities
- Both Vercel preview projects passed
- No inline Cursor security findings
- CodeRabbit is rate-limited; no CodeRabbit code finding is recorded on the current head

## Verification discipline used

The work was executed in separate worktrees with Sol 5.6 effort selected by task risk.

Review method:

- Implementation agent produced a focused branch
- Independent high/x-high reviewer probed adversarial cases
- Every confirmed blocker was returned to the implementation lane
- Narrow re-reviews verified each fix
- Full `npm run verify` ran only after focused review declared the branch safe
- Full test runs were serialized to avoid shared `.next` and resource contention
- External checks included both Vercel projects, Cursor security, and CodeRabbit where quota/base-branch policy allowed it
- Inline security comments were inspected rather than trusting badges alone

Security and truthfulness themes enforced:

- Installation IDs are never account authority
- Fragment-only capabilities never enter query strings, email pipelines, or provider logs
- Unknown evidence is never converted into a satisfied hard constraint
- Data cleanliness is never presented as safety, capacity, opening reliability, or operational confidence
- Recurring schedules are not presented as exact-date exception-aware truth
- Wrong-owner responses remain flat where enumeration matters
- Production behavior fails closed when signing or identity requirements are absent

## Current worktrees created for this execution

These worktrees remain available for review and follow-up:

| Worktree | Branch | Purpose |
|---|---|---|
| `pubmax-codex-wave0-analytics` | `codex/wave0-loop-analytics` | PR #456 |
| `pubmax-codex-wave1-web-push` | `codex/wave1-web-push` | PR #457 |
| `pubmax-codex-wave1-push-identity` | `codex/wave1-push-identity` | PR #459 |
| `pubmax-codex-wave2-passwordless` | `codex/wave2-passwordless-auth` | PR #460 history |
| `pubmax-codex-wave2-intake` | `codex/wave2-progressive-intake` | PR #461 history |
| `pubmax-codex-wave2-generation` | `codex/wave2-grounded-generation` | PR #462 |

Pre-existing user/Claude worktrees were treated as protected. No cleanup or deletion was performed.

## Production sequence that remains blocked

The required database order is:

1. `20260720150000_0045_analytics_event_receipts.sql`
2. `20260720160000_0046_web_push_subscriptions.sql`
3. `20260720170000_0047_push_identity_join.sql`

Required secrets/configuration:

- `PLAN_IDEMPOTENCY_SECRET` or `RATE_LIMIT_SALT`, at least 32 bytes
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Required pre-production process:

1. Rebase PR #456 and PR #457 on current `main`
2. Rebase the PR #459 stack on the refreshed PR #457
3. Run full verification again
4. Execute 0045, 0046, and 0047 in preview/staging with ledger checks
5. Run live PostgreSQL concurrency probes for the 0047 RPCs
6. Provision secrets in both Vercel projects
7. Verify key rotation/recovery documentation
8. Apply the sequence to production only with explicit owner authorization

Owner authorization has not been provided, so none of this production sequence has started.

## Other owner and infrastructure blockers

- GitHub scheduled jobs have reported startup failures associated with billing/capacity
- Ticketmaster integration requires `TICKETMASTER_API_KEY`
- Exa/Firecrawl population requires credentials and credits
- Supabase Email requires SMTP/provider configuration
- Native evidence requires Apple/Google developer and device configuration
- Numeric Wave 4 entry threshold must wait for a real Wave 2 PostHog activation baseline
- Membership price must be chosen through owner WTP research before checkout implementation

## Work explicitly not started

The next wave is paused for Fable review.

Not started in this execution:

- Wave 2.3 stop-card rendering of reasons, provenance, freshness, warnings, and alternatives
- Wave 2.8 activation instrumentation on the new intake-to-acceptance flow
- Wave 2.6 Apple sign-in provider/device work
- Wave 2.7 final account-claim completion against configured providers
- Wave 3 evidence-gated London coverage expansion
- Wave 4 collaborative trial implementation
- Any membership, Stripe, or entitlement checkout work

## Requested Fable review output

For every finding, please include:

- Severity: P0, P1, P2, or P3
- PR and file/line
- Reproduction or failing invariant
- Whether the issue is code, data truthfulness, UX, accessibility, security, privacy, or product-contract drift
- Exact expected behavior
- Required test or evidence to close it

Highest-value review questions:

1. Does PR #462 faithfully render the intent of the Fable intake/Plan concept without inventing evidence?
2. Are the no-route outcomes acceptable and honest for sparse accessibility, opening, and price evidence?
3. Are the per-field provenance and soft-relaxation contracts sufficient for Wave 2.3 UI?
4. Does the passwordless flow preserve the intended invitation and identity experience?
5. Does progressive intake still feel like the redesigned Fable UI rather than a conventional form?
6. Are analytics events minimal, consent-aware, and sufficient for the Wave 2 activation baseline?
7. Are notification prompts contextual enough and safely delayed?
8. Is the migration/secret sequence acceptable before any production authorization is granted?

Do not begin the next implementation wave until Fable's findings are triaged and all blocking findings are resolved.
