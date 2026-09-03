## Destination

Merge the valuable work from `prd-product-security-wave` into current `main` without regressing the deployed mobile UI/drop-speed fixes now at `59ab543`.

## Current State

- `origin/main`: `59ab543` (`Speed up mobile drop composer`)
- `origin/prd-product-security-wave`: `e04f96d`
- Branch delta: `origin/main...origin/prd-product-security-wave` = `19 2`
- Unique branch commits:
  - `f9e15f8 feat: ship PRD map composer and seed polish`
  - `e04f96d fix: polish mobile map chrome`

The branch diverged from `8e1e73a`, before the later mobile UI repair work. A direct merge produces conflicts and would reintroduce older UI choices.

## Decision

Do not merge `prd-product-security-wave` directly.

Treat it as a salvage branch:

1. Start from current `origin/main`.
2. Cherry-pick or manually port only still-useful security/data/build changes.
3. Drop superseded UI changes that conflict with the current mobile shape system and Drop speed work.
4. Verify with the full repo gate before pushing back to `main`.

## Salvage Tickets

### Ticket 1: API No-Store Response Hardening

Question: Does `prd-product-security-wave` contain `jsonNoStore` response hardening that is still missing on `main`?

Inspect:
- `app/api/pint-drops/route.ts`
- `app/api/ratings/route.ts`
- `lib/apiResponses.ts`

Expected action:
- If `main` already has equivalent no-store behavior, do nothing.
- If missing, manually port the response helper usage without touching unrelated route logic.

Acceptance:
- API tests pass.
- No social/write API response accidentally becomes cacheable.

### Ticket 2: WebP Metadata Safety

Question: Should the VP8X EXIF/XMP flag clearing from the branch be ported?

Inspect:
- `lib/imageSafety.ts`
- `__tests__/imageSafety.test.ts`

Expected action:
- Port the VP8X flag clearing logic if missing on `main`.
- Port the focused test only.

Acceptance:
- `npm test -- __tests__/imageSafety.test.ts` passes.
- No broad image upload refactor.

### Ticket 3: Venue Image URL Guard

Question: Is `directVenueImageUrl` still useful with current data ingestion?

Inspect:
- `lib/venueImages.ts`
- `__tests__/venueImages.test.ts`
- current seed builder image/url handling

Expected action:
- If current seed data still has redirect/share image URLs, add the helper and wire it only where direct image URLs are consumed.
- If there is no consumer, defer this as a follow-up and do not add dead code.

Acceptance:
- No broken image URLs from `images.app.goo.gl` or `search.app.goo.gl`.
- Helper has focused unit coverage if added.

### Ticket 4: Seed Builder Delta

Question: What seed-builder changes from the branch are still missing after `main` added `build_pubmaxxing_seed.mjs`?

Inspect:
- `scripts/build_pubmaxxing_seed.mjs`
- `public/data/pubmaxxing_seed_snapshot.json`
- `data/pubmaxxing/*`
- `__tests__/buildScripts.test.ts`
- `scripts/validate-data.mjs`

Expected action:
- Manually compare the two versions.
- Port only correctness fixes, provenance fixes, or validation improvements.
- Regenerate the seed snapshot through the existing script instead of hand-editing JSON.

Acceptance:
- `npm run validate-data` passes.
- Snapshot remains deterministic enough for CI.
- No massive snapshot churn unless the script change requires it.

### Ticket 5: Drop Superseded UI Polish

Question: Are any UI changes from `e04f96d` still better than the current deployed mobile UI?

Inspect:
- `app/globals.css`
- `components/nav/siteNav.css`
- `app/discover/discover.css`
- `components/map/PintDropComposer.tsx`
- `components/map/venueSheet.css`
- `components/map/spillComposer.css`

Decision:
- Default to drop these changes.
- Current `main` already includes the mobile shape-system repair, stable price badges, Home affordance, and faster Drop composer.
- Only port a CSS token if visual QA proves it improves current UI without reintroducing tilted/stamped data UI.

Acceptance:
- No price stamp regression.
- No mobile nav overlap regression.
- No Drop composer slowdown.

## Execution Plan

1. Create a fresh branch from `origin/main`:
   `git switch --detach origin/main && git switch -c salvage-prd-product-security-wave`

2. Work ticket-by-ticket, not by whole-commit cherry-pick.

3. For each ticket:
   - compare branch file vs `main`;
   - port the smallest useful diff;
   - run focused tests immediately.

4. Final verification:
   - `npm run lint -- --quiet`
   - `npm run typecheck`
   - focused unit tests for touched files
   - `npm run validate-data`
   - `npm run ci`
   - mobile browser QA only if any UI file is touched.

5. Push:
   - If only low-risk API/data/security deltas are ported, push branch and merge after CI.
   - If UI is touched, require mobile screenshots before merging.

## Out of Scope

- Directly merging `prd-product-security-wave`.
- Reverting current mobile UI/drop-speed work.
- Reintroducing rotated price/data badges.
- Broad theme overhaul from the old branch.
- Merging unrelated GNHF badge-events work in this branch.
