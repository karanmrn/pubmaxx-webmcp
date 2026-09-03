# PubMaxing Final Polish PRD for Opus

> **Superseded** — see docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md and cc_plan.md

Status: ready for agent
Target branch: `prd-implementation-review`
Reviewed base: `effc970` after `git fetch --all --prune` and `git pull --ff-only`
Source inputs: GLM improvement list, current repository state, existing demo/product PRDs

## Problem Statement

PubMaxing is now a working demo product: landing page, 3-D London map, crawl planner, curated routes, Pint Drops, The Landlord, moderation, Supabase persistence, and Vercel deployment are all in place. The remaining work is not a rebuild. It is the final polish layer that makes the product feel trustworthy, stable, and production-conscious when a judge, user, or future agent clicks through the app.

The main risks left are:

- A few trust-boundary gaps remain around user-submitted images, admin auth, and client-supplied heritage context.
- The map still has small "fighty" behaviours during filter tuning and theme rebuilding.
- Pint Drops are present but not yet first-class enough in filters, route summaries, and moderation context.
- The codebase has some stale docs, agent-signature comments, and small dead-code pockets that will slow future contributors.
- Browser E2E coverage exists but does not yet cover the product loops most likely to be demoed.

## Solution

Opus should implement a focused final-polish pass in three priority bands:

1. **Security/trust hardening**: remove weak auth paths, verify image bytes, stop trusting client-supplied Landlord context, and make moderation status more transparent.
2. **Demo UX polish**: improve map camera control, add a recenter route action, surface Pint Drops in planning flows, and make small accessibility fixes.
3. **Handoff quality**: update tests and docs so the shipped app can be maintained and deployed without reading stale PRDs.

Do not add new product surfaces. Strengthen the surfaces already shipped.

## User Stories

1. As a crawl planner, I want the map to stop snapping back while I tune filters, so that I can inspect an area without fighting the camera.
2. As a crawl planner, I want a visible Recenter route control, so that I can return to the full crawl after panning around.
3. As a mobile user, I want Pint Drop photos to load without layout jumps, so that venue detail feels stable on a phone.
4. As a community-minded user, I want to filter for pubs with Pint Drops, so that I can plan around places people have actually logged.
5. As a route planner, I want each route stop to show its Pint Drop count, so that I can compare community activity without opening every pub.
6. As a user reporting a Pint Drop, I want to understand when a report hides content, so that the report action does not feel broken.
7. As a moderator, I want each reported drop to show its venue name and a View on map link, so that I can review context quickly.
8. As a user asking The Landlord, I want answers grounded only in server-known pub facts, so that forged client context cannot be echoed as pub history.
9. As a screen-reader user, I want The Landlord answer region to announce new answers, so that the async answer flow is accessible.
10. As a user planning a real crawl, I want route distance labelled as straight-line distance, so that I do not mistake it for walking distance.
11. As a hand-builder, I want to reverse a route, so that I can start from the opposite end without rebuilding it.
12. As a hand-builder, I want my chosen stops to survive refresh, so that I do not lose work accidentally.
13. As a keyboard user, I want `/` to focus search and `Esc` to clear selection, so that the planner is faster to operate.
14. As a maintainer, I want dead code and stale agent comments removed, so that the codebase reads like a product, not a relay race.
15. As a maintainer, I want deployment instructions in one place, so that Vercel/Supabase/OpenRouter setup is reproducible.
16. As a maintainer, I want browser tests for Pint Drops and curated crawls, so that demo-critical flows do not regress.

## Implementation Decisions

### P0 - Security and Trust

- **Remove query-string admin tokens.** Moderator APIs should accept `x-admin-token` only. Delete support for `?admin=` because query tokens leak through history, logs, analytics, and referrers. The existing admin console already uses headers.
- **Validate image magic bytes.** Keep the current MIME/size checks, but also inspect the first bytes for JPEG, PNG, and WebP signatures before upload. Reject mismatches with the same user-safe image error path. This closes the main public UGC upload gap.
- **Reconstruct Landlord context server-side.** The heritage route should accept `venueId`, `venueName`, and `question`, then derive any venue context from server-owned data. Do not accept a client `context` object. If venue facts are missing, use the existing honest fallback and contribution loop.
- **Expose report transparency safely.** Public DTOs may expose `reportCount` only when a visible drop has `reportCount > 0`. Do not expose reasons, reporter metadata, moderator notes, or hidden photos publicly.

### P1 - Map and Crawl UX

- **Debounce/gate route fitBounds.** Fit the route when the route identity changes materially, when a curated crawl is loaded, or when Pubs near me creates a route. Do not refit on every filter-induced reorder of effectively the same route while a user is panning.
- **Add Recenter route.** Add a small route recenter control near the legend or map controls. It should be disabled when fewer than two stops exist and should reuse the same fitBounds logic.
- **Pause orbit on window blur.** Extend the existing hidden-tab/reduced-motion logic so blur pauses orbit and focus resumes normal idle behaviour.
- **Label distance honestly.** Change the route metric label to "straight-line, between stops" and add a title explaining Haversine distance; walking distance will be longer.
- **Add reverse route in Build mode.** In Build mode, expose a Reverse route action when there are at least two stops. It should reverse `builtIds` and preserve URL sync.
- **Persist hand-built routes locally.** Store build-mode `builtIds` in localStorage and clear that stored value on explicit Clear. URL state remains the canonical share format.
- **Add keyboard shortcuts.** `/` focuses the map search input unless the user is already typing in an input/textarea. `Esc` clears selected venue and closes transient inspector state where applicable.
- **Show curated crawl blurbs in the route panel.** Track the active curated crawl and show its blurb under the route title. Clear it once the user manually mutates stops.

### P1 - Pint Drops as a Planning Signal

- **Add a Pint Drops story filter.** Add `requirePintDrops` to filters, wire it to Story Filters, use venue signals for filtering, and encode/decode it in crawl URLs.
- **Show Pint Drop counts on route stops.** Route list rows should show a compact count badge when a venue has drops.
- **Stabilize photo previews.** Add explicit dimensions and async decoding to composer previews. Replace VenueInspector Pint Drop `<img>` tags with `next/image` plus `unoptimized`, matching the admin console pattern.
- **Improve admin context.** Moderator rows should include venue name and a link to `/map?sel=<venueId>`. The lookup can use the app dataset; do not add a database dependency just for names.

### P2 - Cost and Performance

- **Cache Landlord answers briefly.** Add a five-minute in-memory cache keyed by normalized venue key and question hash. Skip or simplify this when OpenRouter is not configured, since fallback answers are cheap.
- **Consider image transformation only after confirming Supabase support.** If the storage bucket supports Supabase image transformations, serve public thumbnails at around 800px and keep full-resolution URLs for moderators only. If not confirmed, leave this out of the first pass.
- **Memoize expensive GeoJSON rebuilding.** Avoid rebuilding the full pubs GeoJSON on every venue selection when signal values did not change.

### P2 - Code Quality

- **Remove dead code.** Delete unused `priceColor`, `averagePrice` if truly unread, and the exported `writerTrail` array if no imports exist. Do not remove the `writerTrail` crawl style.
- **Remove agent-signature comments.** Delete or rewrite `ponytail:` comments. Keep comments that document real trust boundaries or non-obvious MapLibre behaviour.
- **Make Supabase env reads test-friendly.** Replace module-load `STORAGE_BUCKET` with a lazy getter and add a small test reset for the cached Supabase client.
- **Keep local guardrails.** The current uncommitted `verify`, `setup`, `.githooks/pre-push`, and `vercel.json` changes are sensible. Opus should either commit them as a small chore or intentionally move them into the PRD/handoff.

### P3 - Documentation

- **Rewrite README.** It currently describes the pre-Supabase, pre-Pint-Drops app. Update it to describe landing, map, Pint Drops, The Landlord, moderation, demo data, Supabase, OpenRouter, and Vercel.
- **Add a deployment runbook.** Create one deployment document covering required Vercel env vars, optional OpenRouter vars, Supabase migration order, storage bucket setup, admin token, rate-limit salt, and the `x-forwarded-for` trust note.
- **Mark stale PRDs as superseded.** Add a clear banner to older PRDs so future agents do not optimize against stale acceptance criteria.
- **Refresh screenshots deliberately.** Existing screenshots are mobile-focused. Add current desktop light/dark, landing, map, mobile, and admin captures if this is needed for judges or handoff.

## Testing Decisions

- Run the standard gate before handoff: lint, typecheck, unit tests, and build.
- Add unit tests for image magic-byte validation.
- Update heritage route tests so forged client context is rejected/ignored because the API no longer accepts context.
- Extend crawl URL tests to cover `requirePintDrops`, reverse/build order preservation, and curated crawl IDs.
- Add tests for public DTO report-count exposure without leaking report reasons or moderator metadata.
- Add a high-value Playwright test for the Pint Drop submit/list/report flow using network mocks, not real Supabase.
- Add a Playwright test for curated crawl loading: click a featured crawl, assert route title/count/URL state.
- Decide whether E2E runs in GitHub Actions now or later. If added now, install Playwright browsers in CI and expect some runtime cost.

## Out of Scope

- Do not restructure the map data load into a server component in this pass.
- Do not split the landing page into server/client islands in this pass.
- Do not add walking directions, routing APIs, accounts, Stripe, or new product surfaces.
- Do not remove demo seeds; just keep them labelled and separate from organic contributor signals.
- Do not change the deployed domain or Vercel project.

## Further Notes

- GLM suggestions that are already done or stale: admin already uses `next/image`; mobile/empty/loading polish is already substantially improved; OG image work is already present; `.context/` is already gitignored; `mergeVenueDrops` already has several focused tests, though one integrated claim-preservation test is still acceptable.
- Highest confidence first batch for Opus: admin query-token removal, image magic bytes, Landlord server-side context, distance label, Landlord aria-live, composer/VenueInspector image stability, Pint Drops filter/count, admin View on map, README/deployment docs.
- Risky structural work to avoid unless explicitly approved: server-importing the 6MB dataset into the map route, landing server-shell extraction, and API caching that might accidentally cache moderator reads or stale public writes.
