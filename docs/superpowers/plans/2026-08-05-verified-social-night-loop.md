# Verified Social Night Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development and test-driven-development. Complete tasks in order. Each implementation task needs a fresh implementer, focused review, and verification evidence.

**Goal:** Ship a mobile-first invite beta where verified adults can post freely, build mutual friendships, organise a consent-based pub crawl with an explicit safe-home handoff, and preserve consent-driven memories without turning venue observations into ratings.

**Architecture:** `/social` is the canonical responsive shell. Server-owned policy gates separate safe public previews from verified-adult Social reads and writes. A new durable Social post model reuses stable profile ownership, moderation, media, and follow seams without overloading Pint Drops, Visit Reports, or Night Memories. Crew planning and safe-home state remain separate domains linked by identifiers and explicit transitions.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Clerk, Yoti, Supabase/PostgreSQL, Vitest, Playwright, OpenAI moderation, web push.

## Global constraints

- Work on `codex/social-night-loop-20260805` in its isolated worktree.
- Test first. Observe every new behaviour test fail for the expected reason before implementation.
- Keep the site keyless locally. External identity, age, moderation, media, and push services must fail closed for protected actions and remain mockable in tests.
- Full Social content requires a Clerk product session plus verified 18+ state. Logged-out and unverified readers may see safe metadata previews only.
- A Clerk session is not silently equivalent to a legacy Supabase account. Migration requires proof of both sessions.
- Legacy unverified handles stay frozen. No first-touch ownership claim.
- Pseudonyms are allowed. No public age badge or date of birth.
- Posts support `standard` and `feature_request`; visibility is `public`, `friends`, or `private` per post.
- Feeds are chronological. No paid reach, trends, popularity ranking, or venue ratings.
- Public area may be shown. Exact venue context is friends-only. Imported unmatched places remain private.
- Photo tags require consent before publication. Night Stories are consent-driven.
- Friend-gated crawl joins, friends-only direct messages, and crawl chat expires after 30 days.
- AI may assist composition and planning but never appears as a participant.
- Reuse existing moderation queues. Owner and named backup must be able to resolve reports within 24 hours.
- Captain applies production migrations. Agents create and test forward and rollback SQL only.
- Avoid files owned by PR #726 release lanes until those commits land: v1 security, price truth, and mobile map obstruction seams.
- Follow `docs/VOICE.md`: British spelling, no em dashes, no exclamation marks, no fake counts.

---

### Task 1: Programme control and policy ledger

**Files:**

- This plan
- Create: `docs/social/SOCIAL_BETA_CONTRACT.md`
- Create: `docs/social/SOCIAL_THREAT_MODEL.md`
- Modify only if data practice changes in code: `app/privacy/page.tsx`, `app/terms/page.tsx`

- [x] Record route, identity, age, visibility, moderation, retention, deletion, analytics, and beta-exit contracts in `docs/social/SOCIAL_BETA_CONTRACT.md`.
- [x] Record assets, trust boundaries, abuse cases, controls, and release evidence in `docs/social/SOCIAL_THREAT_MODEL.md`.
- [x] Create umbrella [#728](https://github.com/Singularityszn/pubmax/issues/728) with Tasks 2-9 as linked child issues [#729](https://github.com/Singularityszn/pubmax/issues/729), [#730](https://github.com/Singularityszn/pubmax/issues/730), [#731](https://github.com/Singularityszn/pubmax/issues/731), [#732](https://github.com/Singularityszn/pubmax/issues/732), [#733](https://github.com/Singularityszn/pubmax/issues/733), [#734](https://github.com/Singularityszn/pubmax/issues/734), [#735](https://github.com/Singularityszn/pubmax/issues/735), and [#736](https://github.com/Singularityszn/pubmax/issues/736). GitHub blocked-by metadata records their safety dependencies; child bodies explain each relationship.
- [x] Make named moderation primary and backup a blocking launch control. Both roles remain unassigned, so every invite-beta flag stays off outside deterministic test environments.

Task 1 changes no data practice. Do not edit `/privacy` or `/terms` until implementation changes the practice they describe.

### Task 2: Product identity and adult-verification policy

**Files:**

- Create: `lib/socialAccess.ts`
- Create: `lib/socialAccessServer.ts`
- Create: `__tests__/socialAccess.test.ts`
- Create: `app/api/social/access/route.ts`
- Create: `__tests__/socialAccessRoute.test.ts`
- Create: forward and rollback migrations for private verification state
- Modify narrowly: `lib/authServer.ts`, `lib/clerkIdentity.ts`, `proxy.ts`
- Modify with the Yoti data-practice change: `app/privacy/page.tsx`, `app/terms/page.tsx`

- [x] Define `SocialAccessState`: `preview`, `sign_in_required`, `age_verification_required`, `verified`, `suspended`.
- [x] Store Yoti subject reference, provider, decision, verified-at, expiry, and audit state server-side. Store no public date of birth or age badge.
- [x] Bind verified state to stable product account ownership, not a client-supplied handle.
- [x] Require both Clerk and legacy Supabase sessions for account migration. Make retries idempotent and auditable.
- [x] Freeze legacy unverified handles and remove first-touch claim paths.
- [x] Gate protected Social APIs through one server policy seam.
- [x] Update `/privacy` and `/terms` in the same implementation change that adds Yoti processing or stores Yoti verification references.

### Task 3: Durable Social post domain and API

**Files:**

- Create: `lib/socialPosts.ts`
- Create: `lib/socialPostStore.ts`
- Create: `__tests__/socialPosts.test.ts`
- Create: `__tests__/socialPostStore.test.ts`
- Create: `app/api/social/posts/route.ts`
- Create: `app/api/social/posts/[postId]/route.ts`
- Create: route tests
- Create: forward and rollback migrations

- [ ] Model text, photo references, optional area, friends-only venue context, hashtags, edit history marker, and feature-request metadata.
- [ ] Enforce per-post visibility on every read path. Friendship is mutual follow state.
- [ ] Expose chronological `following`, `nearby`, and `discover` lanes with bounded cursors.
- [ ] Create and edit only through verified product ownership. Delete is recoverable moderation state, not provenance loss.
- [ ] Run OpenAI omni moderation after submission. Queue results without blocking safe local tests.
- [ ] Keep Visit Reports and venue observations outside post scoring.

### Task 4: Social interactions and governance

**Files:**

- Create interaction domain, store, API, migrations, and tests under `lib/` and `app/api/social/`
- Reuse existing follows, notifications, and moderation seams where contracts match

- [x] Add Cheers, comments, saves, reposts, and quote posts with idempotent writes and pagination.
- [x] Let authors choose comment policy and lock comments later.
- [x] Treat saves as private. Never use engagement for paid or popularity ranking.
- [x] Render feature requests as a dedicated post kind with staff status and response history.
- [x] Notify through in-app delivery first. Web push remains opt-in.

### Task 5: Canonical mobile-first `/social` shell

**Files:**

- Create: `app/social/page.tsx`, `app/social/SocialPageClient.tsx`, `app/social/social.css`
- Refactor reusable bodies from `app/feed/` and `app/discover/`
- Modify: navigation model, mobile tab bar, redirects, sitemap, analytics path, route pattern, warmup, tracing declarations, and focused tests

- [x] Make `/social` canonical. Redirect `/feed` and `/stories` to `/social`; redirect `/discover` and `/drinks` to `/social?tab=discover`.
- [x] Preserve safe metadata preview while protected posts show an honest sign-in or verification boundary.
- [x] Provide one 44px top-level switcher, then child feed controls. Avoid stacked control chrome before first content.
- [x] Preserve chronological Following, Nearby, and Discover state across refresh and back navigation.
- [x] Reserve fixed mobile-tab clearance at 320px, 390px, and 430px with no horizontal overflow.
- [x] Keep desktop responsive as a three-column Social layout without forking the domain or API.

### Task 6: Composer, media, consent, and feature requests

- [x] Build text-first mobile composer with optional photo, area, friends-only venue, visibility, hashtags, and post kind.
- [x] Reuse private media storage and signed delivery. Validate type, size, ownership, and moderation state.
- [x] Add explicit tag proposals. Tagged people approve before their identity appears on a published photo.
- [x] Allow edits with an edited marker and immutable audit metadata.
- [x] Preserve drafts locally when upload or moderation dependencies fail.

### Task 7: Crew Pages and complete night loop

- [ ] Build London Crew Pages with owner, members, roles, visibility, and focused voting.
- [ ] Friend-gate crawl join requests and invitations.
- [ ] Link plans, live crawl state, friends-only venue sharing, check-ins, safe-home handoff, and 30-day chat expiry.
- [ ] Surface current weather and events as contextual cards with provenance and freshness, never as posts from AI.
- [ ] Make safe-home escalation explicit and consent-based. Never imply emergency-service monitoring.

### Task 8: Consent-driven Night Stories and imports

- [ ] Convert a completed loop into a draft Night Story only after contributor consent checks.
- [ ] Import Google Maps saved places first through explicit user export or OAuth consent.
- [ ] Keep unmatched imported places private until the owner deliberately links or shares them.
- [ ] Add account export and complete erasure across Social, crews, media, notifications, verification references, imported places, provider connection metadata, and analytics identifiers. Never export provider credentials. Revoke upstream grants and delete credentials on erasure.

### Task 9: Beta rollout, measurement, and release gate

- [ ] Put new surfaces behind progressive invite-beta flags.
- [ ] Track funnel events only after analytics consent. Record no raw viewer coordinates.
- [ ] Browser-test signed-out preview, unverified adult boundary, verified posting, visibility, moderation, crew join, safe-home, deletion, and mobile layouts.
- [ ] Run `npm run verify`, `npm run ci`, focused Playwright suites, migration forward/rollback proof, and accessibility checks.
- [ ] Exit beta only after 25 verified adults, 10 completed loops, two stable weeks, report handling within 24 hours, no P1 defects, and Social API error rate below 1%.
