# PRD: PUBMAXXING Current Worktree Completion + Review

## Problem Statement

PUBMAXXING has moved quickly across map performance, The Spill, TfL Last Pint, realtime social surfaces, design polish, moderation hardening, and the all-drinks expansion. The current branch is now ahead of `origin/main` with four local commits, plus active untracked feature work for prefetch, Cheers, and Last Train badges. Before this becomes a demo or production candidate, the team needs a single handoff that states what exists, what is still scaffold-only, what has been reviewed, and what must be finished without accidentally committing local agent artifacts or incomplete feature stubs.

## Solution

Ship the current work as a focused “demo-ready consolidation” pass:

- Keep the fast map architecture: slim venue index first, lazy detail, and intent prefetch.
- Keep the TfL Last Pint corrections: post-midnight service-day rollback, correct minute math, and honest live-vs-scheduled provenance.
- Keep the moderation and realtime fixes, but finish durable trust gaps before production.
- Keep the all-drinks model, menu components, data validation, seeds, and migration, but integrate them into the actual venue sheet before claiming the feature is delivered.
- Treat drink price refresh as a governed scaffold until a real permissible first-party parser is implemented and reviewed.
- Keep local/tooling artifacts ignored and out of product commits.
- Treat untracked A1/A4/A5 feature work as active WIP until wired into product surfaces and verified.

## User Stories

1. As a mobile map user, I want pubs to appear quickly, so that the app feels alive before I choose where to go.
2. As a map user, I want venue details to be prefetched when I show intent, so that opening a pub sheet feels instant.
3. As a pub crawler, I want full venue detail to load only when needed, so that the initial map does not download the full dataset.
4. As a user tapping a pub, I want a clear unavailable state if full detail fails, so that the sheet never stays stuck in loading.
5. As a late-night user, I want Last Pint to understand post-midnight trains, so that I do not miss the real final service.
6. As a late-night user, I want scheduled times labelled honestly when live arrivals are unavailable, so that I know when to double-check TfL.
7. As a contributor, I want one report per actor per drop, so that one person cannot hide a Spill alone.
8. As a moderator, I want hidden drops to preserve report metadata, so that review decisions are auditable.
9. As a feed user, I want relative times to be consistent across feed cards, comments, and presence, so that the social UI feels coherent.
10. As a social user, I want concurrent reaction toggles to be idempotent, so that fast taps do not produce false errors.
11. As a venue explorer, I want a menu beyond pints where available, so that PUBMAXXING feels like a full pub companion rather than beer-only.
12. As a sober-curious or non-beer user, I want future drink categories to be added deliberately, so that dry/coffee/mocktail features do not enter through invalid data rows.
13. As a maintainer, I want all drink update files validated in CI, so that bad price data cannot ship.
14. As a maintainer, I want every drink price to carry source, licence, and observed time, so that provenance remains visible.
15. As a maintainer, I want generated refreshes to open PRs rather than pushing to main, so that every price change is reviewed.
16. As a designer, I want the Space Grotesk visual pivot documented, so that future surfaces use the same type and stamp language.
17. As a demo lead, I want unfinished feature stubs either completed or left out of commits, so that demo behavior matches the code being shipped.
18. As a reviewer, I want untracked local agent files ignored, so that commits stay product-focused.
19. As a deployer, I want the repo’s local CI to pass, so that Vercel has a clean build candidate.
20. As a production owner, I want GitHub Actions strategy clarified, so that “manual-only CI” is not mistaken for branch protection coverage.

## Implementation Decisions

- The map remains a two-stage load: slim map index first, then full venue detail through the single-venue API.
- Venue detail prefetch uses the existing lazy detail cache and is triggered by venue intent, not by loading all detail on map mount.
- Prefetch failures only become user-visible when the user actually selects that venue.
- TfL service-day logic uses a pre-4am rollback window so after-midnight trains resolve against the previous day’s timetable.
- Last Pint provenance separates “TfL reached” from “live arrivals available.”
- Report moderation now requires distinct actors to reach the hide threshold during the report window.
- Durable per-actor report uniqueness is still not complete; a database-backed report actor table or equivalent RPC change is required before production trust claims.
- The all-drinks model uses a closed category taxonomy shared by app types, migration constraints, refresh validation, and bundled data validation.
- Dry/coffee/mocktail expansion should extend the taxonomy intentionally through model, migration, validators, UI, and tests. It must not enter via arbitrary category strings.
- Drink price refresh is a no-op scaffold until a reviewed first-party parser is implemented. It must respect robots.txt, Terms of Use, rate limits, stable parse fixtures, and per-row attribution.
- Local Cursor/agent scratch output and raw research transcripts are ignored and should not be product commits.
- The public scratch showcase route is no longer present in the current worktree. Keep it out unless it is deliberately restored as an internal-only route.
- The untracked prefetch helper, Cheers button, optimistic toggle, and Last Train badge are promising but must be wired into product surfaces before they count as delivered.

## Testing Decisions

- Keep `npm run ci` as the local required gate: data validation, lint, typecheck, coverage, and production build.
- Add/keep tests at behavior seams rather than implementation internals:
  - map lazy detail and no full dataset on initial map load;
  - TfL service-day rollback and departure minute math;
  - Last Pint provenance display;
  - moderation hide threshold with distinct actors;
  - drink taxonomy and drink update validation;
  - drink menu grouping, seeded demo rows, and legacy pint adapters;
  - reaction unique-violation idempotency.
- Data validation must fail on malformed drink update files, missing source/licence, future `observedAt`, non-http source URLs, negative prices, and invalid categories.
- Playwright map tests should remain the acceptance seam for initial load speed and lazy detail behavior.
- Pure helper tests for prefetch, optimistic toggles, and Last Train badges are useful, but they must be paired with at least one product-surface test once the helpers are wired.

## Code Review Findings

Resolved during this review:

- Stale moderation tests were updated to use two distinct actors when they expect a drop to be hidden.
- Map prefetch was fixed so an in-flight hover prefetch can still mark the selected venue unavailable on failure.
- Drink update category validation was aligned with the closed drinks taxonomy.
- Local `.cursor` state and raw research `.output` files were added to ignore rules.
- The previous public scratch showcase route is no longer present.

Remaining blockers:

- All-drinks is not yet delivered in the venue user flow. The model, seed data, menu components, tests, refresh scaffold, and migration exist, but the actual venue sheet still needs to render the new menu surface.
- The drink refresh workflow is intentionally a no-op until a real parser is implemented. Do not present it as live price ingestion yet.
- GitHub CI is manual-only. Vercel/local CI can gate demos, but branch protection cannot rely on the current GitHub workflow.
- Durable report uniqueness is not complete; rate limiting is a windowed mitigation, not a permanent trust model.
- The Supabase drinks migration has not been applied or advisor-reviewed.
- The untracked Cheers optimistic toggle has a product-risk to resolve before wiring: same-value rollback can be indistinguishable from “still pending” unless the parent sends an explicit reconciliation/failure signal or the component owns a bounded timeout.
- The untracked prefetch helper duplicates the inline `PubMap` prefetch path. Pick one seam before committing so the map does not grow two prefetch systems.
- The untracked Last Train badge helper is honest and pure, but it is not yet attached to Spill creation/feed rendering.

## Acceptance Criteria

- `npm run ci` passes locally.
- `/map` does not fetch the full pint dataset on initial load.
- Venue detail can be prefetched and still degrades to an unavailable state on failure.
- Last Pint correctly handles 00:00–04:00 service-day rollback.
- Drink update validation rejects categories outside the closed taxonomy.
- All-drinks menu is visible in the real venue sheet before the feature is described as shipped.
- Scratch/local-agent artifacts are not committed.
- A1/A4/A5 helpers are either wired and tested through product surfaces or explicitly left out of the demo commit.
- Production/deploy notes state whether GitHub Actions or Vercel is the active gate.

## Out of Scope

- Native mobile apps.
- Pub owner dashboards.
- Payments or split-bill flows.
- Real scraping/parsing of third-party or competitor price sites.
- Dry/coffee/mocktail taxonomy expansion unless implemented across schema, validators, UI, and tests.
- Applying Supabase migrations without authenticated Supabase access.

## Further Notes

The current branch is close to a strong demo candidate after consolidation, but it should not be marketed as “all-drinks live ingestion” yet. The best next execution path is: integrate the drink menu into the venue sheet, decide whether to finish or park A1/A4/A5 untracked work, complete durable moderation reporting, apply/review the drinks migration, then run browser QA on desktop and mobile map/feed/venue flows.
