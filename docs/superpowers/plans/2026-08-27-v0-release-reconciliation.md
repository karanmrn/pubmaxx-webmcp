# PUBMAXX v0 release reconciliation plan

**Goal:** Release one honest, fast London product that lets a person find a pub, create a Plan, invite a friend, complete the outing, and add one real Pint Drop.

**Source rule:** Build only from a clean worktree at fetched `origin/main`. Preserve `/Users/karanmanoharan/Documents/pubmax` as evidence. Do not merge, reset, clean, deploy, or apply migrations from that dirty checkout.

**Release rule:** Production deploy is the final step. Captain applies database migrations and gives explicit Vercel deployment authority. Deploy only to `pubmax69/chengdu` from the reviewed `main` SHA.

## Current evidence

- GitHub has zero open pull requests. Audited local candidate branches contain no unshipped product-code salvage.
- `origin/main` is `9b2efa13e11a6c11b25211780d19cf78a45b0c13`.
- Production is behind current source.
- Primary local checkout is 420 commits behind `origin/main` and contains 63 tracked product changes plus 34 untracked product paths.
- Most dirty changes are older versions of work already shipped on `main`.
- UK Base contains 38,215 OSM pubs. This is a separate, unpriced discovery layer.
- Earlier Exa enrichment produced usable content for 2,443 pubs. Sample review found about 27 percent wrong-name matches. Opening-hour coverage is zero.
- Fresh bar enrichment stopped at 2,200 of 6,892 targets because Exa returned `402 NO_MORE_CREDITS`. Partial shards are preserved. Website-content enrichment has not started and must follow it.
- Production What's-On reads are empty or degraded. Migration `0119` is not applied.
- Migrations `0120`, `0121`, and `0122` also remain owner-controlled release operations.
- GitHub Actions is configured but cannot start because of account billing or runner allocation.

## Reconciliation decisions

### Keep on current main

- One-tap `/near?locate=1` entry from deliberate calls to action.
- Near price trust, contribution impact, Tonight main-list-first, mixed-route honesty, and failed What's-On freshness handling.
- Current `/drink/[slug]` publication gates and `lib/pricedLanding.ts`.
- Current durable provider refresh in `/api/cron/refresh-whats-on`.
- Current Plan, Invite, Open Crew, Pint Drop, Community Price, Social provider lifecycle, and Wanted promotion contracts.

### Do not port

- Dirty Night Crawl cursor guard. It makes the first final-stop action a silent no-op.
- Dirty cron refresh. It removes current provider retrieval and persistence.
- Dirty `/area/[slug]` pages. Route remains held until a separate publication decision.
- Dirty `/drink/[category]`. Current main has a stronger route and shared model.
- Dirty global walk-route limiter. It can deny cached and invalid requests for all users.
- Dirty Clerk private-module test and speculative keyless flag.
- Migration `20260805090000_0070_departed_contributor_name.sql`. Number collides with the migration ledger and deletion is not atomic.

### Reproduce and salvage narrowly

1. Plan mini-map bounds include routed detour vertices.
2. Venue price-story requests cannot overwrite current Venue state after a context change.
3. Successful confirmed price submission refreshes the current price story.
4. TfL daylight-saving boundary conversion uses the correct London offset.
5. Retired-handle metadata canonicalises safely in durable, degraded, and keyless paths.
6. Night Mode uses accurate live leave-by and straight-line distance labels.

Each salvage item needs a failing test on current `main`. No dirty file is copied unchanged.

## Phase 1 - release blockers

### 1.1 Data and schema

- Captain applies migrations `0119`, `0120`, `0121`, and `0122` in ledger order.
- Run one What's-On refresh after `0119`.
- Record provider retrieval, date filter, London filter, canonical Venue match, and served-row counts.
- Require either useful venue-matched rows or one precise monitored provider-empty result.
- Do not publish theatre-only or unmatched rows as pub recommendations.

### 1.2 Core journey proof

- Signed-out visitor finds one London Venue with honest price authority.
- Guest creates and edits a three-stop Plan.
- Signup claims the same Plan without loss.
- WhatsApp, Copy, private invite, and eligible Open Crew acceptance create one membership model.
- Two browsers record final stop, ending, completion, recap, and Plan-again exactly once.
- Signed-in contributor creates one real Pint Drop.
- Verify `pint_drops` increases and `structured_visit_reports` does not.
- Verify first Community Price marks but does not paint the Map. Second independent fresh report may paint it.

### 1.3 Browser and accessibility proof

- Test 390x844 and 1440x900, light and dark, signed out and signed in.
- Test home, Map, Near, Plan, Today, Tonight, Out, Pal, profile, invite, recap, and Pint Drop.
- Measure every visible interactive target. Fix targets below 44 by 44 pixels unless they are inline text links with sufficient spacing and semantics.
- Verify no horizontal overflow, trapped backdrop, silent no-op, dead card, or error text overlapping its trigger.
- Verify Map useful state within four seconds on the current production profile, then target three seconds.
- Verify keyboard focus order, Escape and Back behaviour, accessible names, and reduced motion.

## Phase 2 - data fold

### 2.1 Finish harvest

- Let the existing bar enrichment process finish. Do not start a duplicate.
- Start website-content enrichment only after bars complete.
- Preserve slots 3 and 4 until all harvest data and manifests are copied and verified.

### 2.2 Quality gate

- Match by OSM id. Never match by name alone.
- Require name and town agreement plus citation URL for heritage copy.
- Require HTTPS for official website and menu links.
- Treat an empty row as unknown.
- Sample wrong-Venue rate by source and town before folding.
- Reject opening hours, price, access, and social claims without direct current evidence.

### 2.3 Publish without payload growth

- Keep UK Base separate from curated Venue Dataset.
- Put lore and official links in lazy Venue detail, not pins or slim payloads.
- Rebuild fold-ready artifacts once after both enrichment passes.
- Run size, tracing, data validation, attribution, and representative identity checks.

## Phase 3 - product quality

### 3.1 One product language

- Use PUBMAXX as product mark and PUBMAXXING only where the existing brand contract requires it.
- Keep one Map destination and one primary Plan call to action.
- Explain UK Base as pub discovery without implying price coverage.
- Add a compact first-run guide only where it prevents user error. Do not add repeated helper copy.

### 3.2 Honest live answers

- Show one shared price collection date on all baseline-price surfaces.
- Keep verified, provisional, estimated, stale, and unknown states distinct.
- Keep Tonight and Out honest when provider supply is empty.
- Show only current, venue-matched listings as primary pub answers.

### 3.3 Performance and reliability

- Measure before adding caches.
- Keep Map, Plan, Tonight, Out, and Pal bundles isolated.
- Keep runtime data paths in explicit Next tracing includes.
- Split any city enrichment unit that approaches Vercel duration limits.
- Fix all console errors and warnings found in release journeys.

## Phase 4 - launch and growth

- Certify PostHog events for Map useful state, Plan creation, invite open, invite acceptance, second participant, completion, Pint Drop, recap share, and repeat Plan.
- Keep consent denial free of analytics.
- Submit only useful current-evidence pages to Search Console and Bing.
- Run five Londoner, five tourist, and five organiser sessions.
- Start creator and Venue pilots only after the core journey works in production.
- Keep Social launch gated until moderation, privacy, join, leave, close, and abuse paths pass.
- Defer Stripe, voice, native stores, and additional city parity until London v0 activation is proven.

## Verification sequence

During implementation, run only focused tests and one worker. Before merge, run in order with memory checks between commands:

```bash
npm run validate-data
npm run lint
npm run typecheck
npm run coverage
npm run build
```

Then run focused browser journeys with one Playwright worker. Inspect production trace manifests for runtime data. Record every known baseline failure separately. Do not call a slice complete because hosted GitHub checks could not start.

## Release gate

Release only when all statements are true:

- Open PR count is zero for release set.
- Required migrations match source.
- What's-On is healthy or has a named monitored provider-empty result.
- Core two-browser Plan journey passes.
- One real Pint Drop persists without creating a Visit Report.
- Map, Plan, Tonight, Out, and Pal pass mobile and desktop smoke.
- No price-authority or private-capability leak exists.
- Full local verification and clean production build pass.
- 390x844 and 1440x900 screenshots are captured.
- Captain gives explicit Vercel deployment authority.

After deployment, confirm `/api/version`, aliases, signed-out Pint Drop 401, one signed-in read/write path, Vercel errors, PostHog exceptions, and Web Vitals. Hold a 24-hour canary before declaring v0 stable.
