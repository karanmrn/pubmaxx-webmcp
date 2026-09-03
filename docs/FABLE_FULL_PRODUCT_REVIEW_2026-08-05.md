# PubMaxxing full product review

Date: 5 August 2026  
Review base: `origin/main` at `f78593a247506f7fc6e492fcd2a72ae2d0600f3f`  
Prepared for: Fable and parallel implementation agents

## Decision

Do not widen feature scope or promote a new release until trust and security blockers below are fixed. Product already contains a strong London discovery and planning loop. Highest-value work now is to make its claims true, its data current, and its identity and memory boundaries safe.

This review made no application-code or production changes. It intentionally does not overlap PR #724, `chore(skills): refresh design skills and plugin skill packs`.

## Review coverage

- Refreshed Git state and reviewed exact `origin/main`.
- Mapped 4,550 repository files, 46 page routes, 126 API routes, and 876 test files.
- Reviewed architecture, auth, RLS, private memories, profiles, pub prices, planning, map, feed, mobile sheets, accessibility, performance, and data operations.
- Exercised production with Computer Use and browser automation on desktop and phone viewports.
- Audited `/`, `/today`, `/map`, `/tonight`, `/near`, `/plan`, `/feed`, `/discover`, `/drinks`, `/pubs`, `/pint-index`, and `/pal/chat`.
- Captured light and dark screenshots at 390px and 1440px for core routes.
- Exercised every one of the 46 page templates at 390px and 1440px, including representative dynamic, unavailable, signed-out, and admin-gated URLs.
- Ran validation, lint, TypeScript, full coverage suite, production build, dependency audit, and targeted E2E screenshot journeys in an isolated worktree.
- Checked current UK pint economics and public price-data constraints.

## Release blockers

### P1. Private Night Memory can be published around consent controls

Authenticated clients receive direct DML access to Night Memory and story tables in `supabase/migrations/20260803202000_0067_rls_wave2_owner_policies.sql`. Host-write policies allow a caller to create and publish a story, then attach another user's moment through join-table paths without going through consent-enforcing application services.

Evidence:

- Direct authenticated grants start at line 227.
- Host story write policy starts at line 287.
- Story-moment policies start at line 340.
- Public reads trust the resulting published state in `lib/nightMemoryStore.ts`.

Required fix:

1. Revoke authenticated DML for publication-sensitive tables.
2. Make service-side APIs or narrowly scoped RPCs the only mutation path.
3. Re-check consent atomically when attaching moments and when publishing.
4. Add negative PostgREST tests proving one account cannot expose another account's private memory.

### P1. Reserved profile handles can be claimed through first-touch linking

`lib/pubmaxxIdentity.ts` defines reserved handles such as `admin`, `staff`, and `support`. `lib/profileOwnership.ts` can link an unowned handle to the first authenticated caller without applying that canonical assessment on every write path.

Required fix:

- Call `assessPubmaxxHandle` before all implicit linking and profile creation.
- Remove implicit first-touch ownership for reserved or system handles.
- Add route-level tests for every write path, including ratings and social actions.

### P1. Pub Pal voice quota is both bypassable and ordered after paid allocation

Migration `20260803202000_0067_rls_wave2_owner_policies.sql` grants authenticated users direct update access to `pub_pal_voice_usage`. A user can reset their own counter. The server route requests an ElevenLabs signed URL before consuming quota in `app/api/pub-pal/voice-token/route.ts`, so denied or broken quota checks can occur after paid provider work.

Required fix:

- Revoke direct client mutation of quota rows.
- Grant the quota RPC only to the service role.
- Reserve quota before provider allocation, with rollback or expiry for failed allocations.
- Add concurrency and direct-client abuse tests.

### P1. Clerk login is not product authentication

Clerk account controls can complete social login, but product APIs resolve Supabase bearer identity through `lib/authServer.ts`. A successful Clerk user cannot reliably onboard, save, contribute, or message. Current UI therefore presents a second account surface, not an integrated login method.

Required decision:

- Either bridge Clerk identity to the product session and ownership model end to end, or remove Clerk login controls from production until that integration exists.

### P1. Night Crawl claims failed offline actions will sync, but no outbox exists

`lib/nightCrawl.ts` promises that failed arrive and skip actions will sync. `components/plan/NightCrawlMode.tsx` explicitly has no replay outbox, retains optimistic state after failure, and persists only an idempotency key and fingerprint through `lib/planMutationKey.ts`.

Immediate safe fix: roll state back and tell the user the action did not save. Durable fix: persist payload, identity scope, retry status, expiry, and conflict result, then prove exact-once replay across reconnect and reload.

### P1. Price presentation hides observation age

`lib/drinkPriceUpdates.ts` says observation time must be surfaced and stale observations must not look live. `components/drinks/DrinkMenu.tsx` displays source and licence but not `observedAt`. Validator rejects future dates but sets no row-age budget.

Current artifact contains 3,474 rows. 3,318 were observed on 11 July while artifact generation is dated 26 July. Artifact freshness can therefore look green while underlying observations are old.

Required fix:

- Show `observedAt` or human-readable age on every sourced price.
- Label aged values as `last seen`, not current.
- Include row-age distribution in freshness output and refresh PR review.
- Add stale-row rendering tests.

### P1. Production demo-off setting does not cover menu data

`FABLE_HANDOFF.md` records `NEXT_PUBLIC_DEMO_CONTENT=off`. `lib/demoContent.ts` describes a global kill switch, but `lib/drinkMenu.ts` always merges `lib/drinkSeeds.ts`, and the published update artifact contains demo-priced rows.

Required fix: route menu seeds and demo overlays through the same switch and add a production-off test covering venue menus.

### P1. Profile reactions silently fail after 100 items

Profiles can load 500 drops. `components/profile/ProfileTimeline.tsx` sends every visible ID in one query. `app/api/pint-drops/reactions/route.ts` silently caps input at 100. Missing responses are marked local-only, producing incorrect counts and device-only reactions.

Required fix: batch at 100 or less, distinguish omitted from unavailable entries, and paginate or window long profile history.

## Important P2 findings

- Mobile half and peek sheets draw a pointer-blocking scrim but only full sheets become modal and focus-trapped. Keyboard and screen-reader users can still reach obscured content.
- No shared skip link exists despite repeated navigation, violating WCAG 2.4.1.
- Persona picker mixes dialog and listbox semantics without listbox keyboard behavior or reliable focus return.
- Map List view loses focus when closed.
- Feed and profile loading states are hidden from assistive technology.
- Safe-area ownership is duplicated between page and navigation styles, causing excessive inset on installed iPhones.
- Route titles duplicate branding because child titles already contain `PUBMAXX` while root metadata appends it again. The crawl also found repeated topic text on recap metadata.
- Long feeds keep every heavy card in the DOM without windowing or `content-visibility` protection.
- Non-London price overlays cannot reach venue menus when baseline pint price is absent.
- Admin session cookie has client-side age but no signed server-side expiry claim.
- Night Moment upload performs multipart processing before checking access to the target memory.

## Production UX review

### Full route matrix

All 92 page-template and viewport cases returned below 500, rendered non-empty document content, and stayed within a two-pixel horizontal-overflow tolerance. Dynamic templates were exercised with representative public records where stable records exist and deliberate unavailable identifiers for private or ephemeral routes. This proves each production template fails safely while signed out. It does not substitute for credentialed admin, moderation, messaging, or private-memory journey tests.

Full-page screenshots were captured for non-map templates. Map templates passed the same document and layout assertions, with visual evidence supplied by the dedicated map screenshot suite because Chromium can hang when a broad parallel crawl snapshots a live WebGL surface.

### Strong

- Landing page has distinctive visual identity, clear core proposition, and strong CTA hierarchy.
- Mobile Plan flow has good type scale and clear progression.
- Feed composition is visually confident and cohesive.
- Global focus-visible and reduced-motion foundations are strong.
- Mobile touch targets generally meet the 44px floor.
- Map provides an accessible DOM List alternative to WebGL markers.
- Pint Index uses a real semantic table with captions and headers.
- Empty and error language is unusually honest and avoids leaking implementation details.

### Needs correction

- Desktop Tonight compresses content into a roughly 330px column with large unused space. Empty state feels like a phone panel placed on desktop rather than a considered desktop composition.
- Map visual snapshots capture the fallback `Rounding up the pubs` state, not a ready map. Current visual gate can pass without proving the primary experience rendered.
- Fixed mobile navigation overlaps bottom content in some captured Plan states.
- `/map`, `/map/london`, `/near`, and `/rounds` lack a page-level `h1` in signed-out production output.
- `/drinks` redirects to `/discover` but retains generic metadata.
- Tonight and Pint Index produce double-branded titles.
- Landing DOM includes redundant wordmark text for some non-AX extraction paths.

### Live Computer Use pass on production

A second hands-on pass used real Chrome against production, first at a 400px responsive viewport and then in the full desktop window. It covered the primary Today, Tonight, Plan, Map, venue-detail, Drinks, and Stories journeys. This pass supplements the 92-case route matrix with interaction and visual-composition evidence.

Strong live evidence:

- Mobile Map is the clearest expression of the product. Search, map movement, price markers, venue selection, and the detail sheet form a coherent discovery loop.
- Desktop Map uses the canvas well. Search and planning controls stay compact while the venue detail rail preserves map context.
- Mobile Plan communicates state changes clearly across area, time, group size, budget, and access needs. The resulting summary remains editable.
- Desktop Plan scales into a deliberate editorial composition instead of stretching the mobile form.
- Weather, price, source, route, and last-train language is generally concise and honest.

Corrections confirmed in the live product:

- Mobile Today contains a very tall empty panel between Getting Home and nearby-price content. The fixed tab bar then overlaps lower historic-pub cards during scrolling.
- Mobile Map presents an install prompt covering roughly 40% of the initial map viewport. Installation is secondary to first discovery and should wait until the user has received value.
- At 400px, venue-detail navigation shows five tabs while `Last train` is offscreen without a clear overflow cue. Provenance and practical-detail type is also too small for a primary mobile surface.
- The Drinks menu presents a sourced price and source link but no observation date. Users cannot tell whether a £4.20 row is current or merely historical.
- Desktop Tonight, Today, and the empty Stories state occupy small content islands surrounded by large unused canvas. Map and Plan already demonstrate the stronger responsive standard these pages should follow.
- Production root currently resolves to Tonight, so there is no distinct top-level product-introduction journey for a first-time desktop visitor.
- Production titles still expose double branding, including `Tonight in London · PUBMAXXING | PUBMAXX` and `Today in London · PUBMAXXING | PUBMAXX`.

Recommended design slice, separate from Fable's shipped product work: repair Today mobile flow and tab-bar clearance first, then make venue tabs and provenance readable, then give desktop Today, Tonight, and Stories purposeful two-column or contextual compositions. Do not redesign Map or Plan before these weaker surfaces reach the same standard.

## Verification results

| Check | Result |
|---|---|
| `npm run validate-data` | Completed. 17 datasets structurally valid. Price, weather, and what's-on files reported stale. |
| `npm run lint` | Passed with 29 warnings. Warnings include controller complexity up to 255. |
| `npm run typecheck` | Passed. |
| Coverage suite with 4 workers | 757 files and 7,686 tests passed. 79.81% statements, 72.55% branches, 85.08% functions, 83.66% lines. |
| Default unconstrained test run | 10 timeout failures under saturation. Every failed file passed alone, and full 4-worker coverage run passed. Treat as runner-stability debt, not known deterministic regressions. |
| Isolated production build | Passed with 466 pages. Edge warnings remain because OG code imports Node `fs`, `path`, and `process.cwd`. Current production image endpoints return PNG successfully, so warning is a deployment risk rather than a reproduced outage. |
| Dependency audit | No high or critical vulnerabilities. `npm ci` reported three moderate issues. |
| Screenshot harness | Core light/dark desktop and phone captures passed after dist-dir alignment. Three mobile journeys failed. |
| Full route crawl | 46 page templates at 390px and 1440px passed content, server-status, and horizontal-overflow checks. One transient Chromium screenshot failure passed on immediate isolated rerun. |

### Screenshot harness defect

The advertised `npm run shots:extended` command builds into a unique `.next-isolated` directory, while `playwright.config.ts` expects `.next`. It fails because `.next/BUILD_ID` is absent. Passing `NEXT_DIST_DIR=.next-prod PW_NEXT_DIST_DIR=.next-prod` aligns both sides.

After alignment:

1. Mobile map sheet test never found the expected `Arnos Arms` heading.
2. Plan location-success test repeatedly lost the `Use my location` button during click.
3. Shared-plan test created a fixture but never rendered `Friday around Arnos Grove`.

Fix the wrapper/config contract, then require a loaded-map signal instead of sleeping 1.5 seconds after `.mapCanvasWrap` appears.

## Data and market reality

- June 2026 UK CPI was 2.6% and CPIH was 2.8%, so price age still matters to users even after headline inflation slowed.
- Morning Advertiser's 2026 survey put average GB pint price at £5.34 and London at £6.55. It reported standard lager at £4.89, premium lager at £5.94, cask ale at £4.91, stout at £5.74, and low/no at £5.11.
- BBPA's February 2026 model put a typical £5.01 pint at £1.60 tax, £3.29 operating cost, and £0.12 pub profit.
- HMRC's 1 February 2026 draught-relief rate for qualifying 3.5% to 8.5% products is £19.45 per litre of pure alcohol.
- ONS stopped publishing detailed food, non-alcoholic drink, alcohol, and tobacco quote data from March 2026. PubMaxxing cannot rely on the old public quote feed for venue-level pint truth. First-party, community, menu, and licensed acquisition must remain core infrastructure.

Sources:

- ONS, Consumer price inflation, June 2026: https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/consumerpriceinflation/latest
- Morning Advertiser, 2026 pint survey: https://www.morningadvertiser.co.uk/Article/2026/05/21/average-pint-price-rises-33-to-534-the-morning-advertiser-finds/
- BBPA, price of a pint, February 2026: https://admin.beerandpub.com/media/e23jl2ww/price-of-a-pint-feb-2026.pdf
- HMRC, alcohol-duty calculation: https://www.gov.uk/guidance/work-out-how-much-alcohol-duty-you-need-to-pay

## Non-overlapping execution waves

### Wave 0: release safety, days 0 to 7

Owners should claim disjoint slices in a live ledger before starting.

1. RLS and Night Memory consent hardening.
2. Reserved-handle and auth-surface correction.
3. Voice quota authorization and ordering.
4. Price age, demo-off, and offline-copy truth fixes.
5. Profile reaction batching and accessibility P1 fixes.
6. Screenshot runner repair plus ready-state assertions.
7. Mobile Today dead-panel and bottom-clearance repair, plus a non-obstructive Map install prompt.

Acceptance: negative security tests, targeted browser tests, production-off demo test, stale-price test, full `npm run verify`, production build, and core screenshot matrix at 320px, 390px, and 430px with no covered actions or hidden cards.

### Wave 1: operate trust loop, days 7 to 30

Do not rebuild scheduler code from PR #721. Operate it.

1. Dry-run price scheduler and inspect semantic diff.
2. Install scheduler from a stable checkout after owner review.
3. Review first generated price refresh PR.
4. Publish artifact age and underlying row-age distributions.
5. Measure existing funnel: venue accepted, plan accepted, saved, arrived, completed.
6. Make all venue-sheet tabs reachable at 400px and raise provenance/date text to a readable trust-caption size.
7. Correct desktop Today, Tonight, and empty Stories composition in route-owned components. Leave Map, Plan, and shared desktop navigation alone.

Acceptance: at least one current non-demo observation with source, licence, and date; `Last train` reachable at 400px; two weeks of consent-gated funnel data; no duplicate navigation system.

### Wave 2: close the night-out loop, days 30 to 60

1. Build a real offline mutation outbox for arrive and skip actions.
2. Make Plan to Round to private recap survive reload and account claim.
3. Add explicit group preferences for budget, accessibility, zero-proof needs, weather tolerance, and mood.
4. Repair price-free-city menu lookup with one non-London fixture.

Acceptance: offline actions replay exactly once after reconnect, private recap remains editable and unpublished by default, and hard constraints are never silently relaxed.

### Wave 3: expansion and delight, days 60 to 90

1. Pilot Manchester only after London trust metrics stabilize. It has the largest non-London pack, but currently zero priced venues.
2. Add audience tiers, per-item approval, export/delete, and blocking before expanding public social features.
3. Ship Surprise Drink only after exact venue, exact drink, price, date, source, weather rationale, and zero-proof coverage pass a measured gate.
4. Keep membership and payments owner-gated until London activation and the memory loop are proven.

## Work that must not be duplicated

Already shipped or implemented:

- Today personalization and weather-aware recommendations
- MapLibre 6
- Plan to Round bridge
- Visit Reports
- Community venue signals and price moderation
- Drink lens and no-alcohol price policy
- Clerk two-key integration work
- RLS wave 2
- Local refresh scheduler implementation

Currently active:

- PR #724, design skills and plugin skill-pack refresh

Owner-gated:

- Scheduler installation
- Production migrations
- Event-provider credentials
- Native store enrolment
- Payments and membership
- Privacy-policy-changing social work

## Coordination requirement

`FABLE_HANDOFF.md` claims live authority but its last execution entries stop on 23 July. `docs/grok_prd.md` still asks agents to implement work already shipped, including MapLibre 6. Before starting another wave, publish one current execution ledger containing:

- exact `origin/main` SHA
- deployed Vercel SHA
- open PRs and claimed file boundaries
- agent and owner for each active slice
- owner gates
- stale issues and superseded documents
- acceptance checks and last verified evidence

Archive or clearly stamp old handoffs as historical. This is the simplest control against Grok, Composer, Fable, and Codex rebuilding the same product slice.
