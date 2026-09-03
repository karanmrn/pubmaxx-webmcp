# PRD - Opus Continuation Plan for PubMaxing Production Readiness

> Prepared for Opus from the current `prd-implementation-review` workspace, the existing PRDs, the Conductor worktree audit, and six GPT-5.5 subagent review tracks. This is a continuation PRD, not a replacement for `docs/PRD_PINT_DROPS.md` or `docs/PRD_PRODUCTION_READINESS_FOR_OPUS.md`.

## Current State

The workspace is `prd-implementation-review` in `/Users/karanmanoharan/conductor/workspaces/pubmax/chengdu`.

Current head includes:

- `5938c6a` - community pub map layers, Pint Drop API, Supabase adapter, heritage layer, MapLibre map, tests.
- `7d76aa1` - light/dark theme toggle with no-flash theme setup.
- `4fa5daf` - landing page at `/`, planner moved to `/map`.
- `fd2c333` - production mode refuses in-memory Pint Drop storage when Supabase is absent.

Registered PubMax worktrees:

- `/Users/karanmanoharan/conductor/repos/pubmax` - clean `main` at `origin/main`.
- `/Users/karanmanoharan/conductor/workspaces/pubmax/chengdu` - continuation branch, ahead of `origin/prd-implementation-review`.
- `/Users/karanmanoharan/conductor/workspaces/pubmax/prd-implementation-review` is only a symlink to `chengdu`, not separate work.

Context artifacts under `.context/londonszn` are a different London map product. Borrow its MapLibre discipline, Supabase client/server split, data-honesty badges, and screenshot QA pattern only. Ignore its rental listings, neighbourhood intelligence, crime, air, flood, rent, account, and concierge features.

## Grilled Decisions Before Implementation

Opus should resolve these before building. They are product or architecture conflicts, not simple TODOs.

1. **Product entry: map-first or landing-first?**
   Existing `docs/OPUS_REVIEW_PRD.md` says the first screen should remain the working planner. Current head renders a landing page at `/` and moves the tool to `/map`. Choose one:
   - Map-first: `/` opens the planner and landing content moves elsewhere.
   - Landing-first: update the PRD, acceptance criteria, copy, and screenshots to treat `/` as an acquisition surface and `/map` as the product.

2. **Photo URL strategy: public bucket or signed URLs?**
   Pint Drops require pint and venue photos. Decide whether visible photos are served by public-read Supabase Storage URLs or short-lived signed URLs. This affects storage policies, API response shape, hidden-content behavior, and browser tests.

3. **Moderation owner and workflow.**
   The API can hide a reported drop, but there is no report UI, report metadata, review queue, restore path, or owner. Decide who reviews hidden content and whether v1 uses a lightweight admin route, Supabase dashboard workflow, or a proper moderator surface.

4. **Provenance model: merged signal or claim list?**
   Current `mergeVenueDrops` folds one contributor note into `curation`. That is useful for map signals but risks flattening Sourced, Contributor, and Anecdote claims. The product language says provenance must never flatten. Choose a model where map summary signals can be derived from a distinct claim list.

5. **The Landlord trust boundary.**
   `/api/heritage` currently accepts client-supplied context and treats it as structured facts. That is too soft for a grounded narrator. Decide that trusted heritage context is reconstructed server-side by stable Venue id, and that contributor notes are always labeled as contributor/anecdote, never Sourced.

6. **Production failure boundary.**
   Current code returns 503 in production when Supabase is absent. Decide whether missing production Supabase env should fail build, fail server startup, fail deploy smoke, or fail only write/read requests at runtime. Document this clearly.

## Problem Statement

PubMaxing has a compelling prototype: a price-aware London pub crawl planner with MapLibre, crawl routes, venue context, story signals, Pint Drops, and a landing-page direction. It is not ready for Opus to treat as production complete.

The current branch still has gaps that could break trust:

- Pint Drops are described as photo-backed, but the UI still submits JSON only.
- The schema supports only one pint photo key, not the PRD's pint photo plus venue photo.
- Storage bucket creation and RLS policy setup are not executable or fully documented.
- Report/moderation is API-only and has no user or moderator workflow.
- Rate limiting is in-memory and handle-only.
- The Landlord can treat client-provided context as fact and does not post-validate model output.
- Landing-page copy overclaims some behaviors that the map flow does not yet support.
- Browser, mobile, Supabase, migration, and release validation are not yet strong enough.

The problem for Opus is to turn the working prototype into a launchable, trust-preserving product slice without widening into unrelated London/rental/social features.

## Solution

Complete a focused production-readiness pass around four connected seams:

1. **Pint Drop write/read seam**
   `/api/pint-drops` remains the only write path. It must support text, price, pint photo, venue photo, moderation, durable rate limiting, production failure behavior, and read DTOs that hide storage internals.

2. **Venue presentation seam**
   The map, route list, and Venue Detail should derive from one Venue model that keeps editorial claims, Pint Drops, and baseline data distinct while still exposing summary signals for map markers and route scoring.

3. **The Landlord heritage seam**
   `/api/heritage` should only answer from trusted server-retrieved facts. Model answers must be structured, cited to fact ids, and rejected when unsupported.

4. **Release and visual QA seam**
   CI, browser tests, Supabase local validation, screenshots, production smoke, and rollback docs become required launch criteria, not optional cleanup.

## User Stories

1. As a visitor, I want `/` and `/map` to have a clear product relationship, so that I understand whether I am entering a landing page or the planner.
2. As a planner, I want the map to load reliably on desktop and mobile, so that I can start planning without blank map states.
3. As a planner, I want a Suggested Crawl that clearly states whether distance is straight-line or walking distance, so that I do not overtrust an estimate.
4. As a route builder, I want inspect, add, remove, clear, and selected-stop states to be distinct, so that tapping a pub does not accidentally mutate my Crawl Route.
5. As a mobile planner, I want selected venue details in an immediate bottom sheet or mini-card, so that I do not need a long scroll after tapping the map.
6. As a contributor, I want to log a Pint Drop with a handle, drink, price, era, Passed-Down Note, pint photo, and venue photo, so that my contribution carries evidence and memory.
7. As a contributor, I want camera/file upload with preview and remove controls, so that I can check what I am about to publish.
8. As a contributor, I want clear public-photo consent copy, so that I know the image and note may be visible to others.
9. As a contributor, I want image type and size errors before and after submit, so that failures are understandable.
10. As a reader, I want visible Pint Drop photos to render in the Venue Detail, so that price and memory claims feel tangible.
11. As a reader, I want Pint Drop cards to show price, note, drink, era, created time, photo, provenance, and report action, so that I can evaluate each contribution.
12. As a reader, I want reported drops to disappear from public reads immediately, so that harmful content is not left visible.
13. As a moderator, I want hidden or pending Pint Drops to be queryable with report metadata, so that I can restore or keep them hidden.
14. As an operator, I want report reasons, report counts, reported time, and moderator notes persisted, so that moderation is auditable.
15. As an operator, I want Supabase migrations to create or precisely document required tables, constraints, RLS, and storage policies, so that production setup is reproducible.
16. As an operator, I want production Pint Drops to fail loudly without Supabase, so that public contributions are never acknowledged into process memory.
17. As an operator, I want uploads and database writes to be transactional enough to avoid orphaned storage objects, so that failed inserts do not leak files.
18. As an operator, I want durable rate limiting by handle and IP hash, so that serverless instances cannot be bypassed by process restarts.
19. As an editor, I want every Sourced venue claim to carry a source ref or be downgraded, so that provenance labels are honest.
20. As a reader, I want Sourced, Contributor, Anecdote, Needs Source, Baseline, and Demo labels to remain distinct, so that trust is visible.
21. As a Landlord user, I want answers grounded only in trusted facts, so that the app does not invent pub history.
22. As a Landlord user, I want citations that correspond to the exact facts used, so that I can inspect the source of each claim.
23. As an operator, I want OpenRouter model usage to be bounded by timeout, deterministic settings, and safe fallback, so that The Landlord cannot block or hallucinate silently.
24. As a reviewer, I want stale screenshots replaced with current desktop, tablet, and mobile captures, so that visual review matches the branch.
25. As a reviewer, I want CI to run lint, typecheck, tests, build, and data checks, so that regressions are caught before review.
26. As a reviewer, I want browser tests for `/`, `/map`, map selection, route building, Pint Drops, upload failures, report flow, and theme toggle, so that the user flows are covered end to end.
27. As a maintainer, I want a local Supabase reset/smoke workflow, so that migrations, RLS, storage, and report behavior can be verified before production.
28. As a maintainer, I want rollback docs for app deploy, migrations, storage, and env rotation, so that launch risk is manageable.

## Implementation Decisions

### Product Entry

- Resolve the `/` versus `/map` conflict first.
- If landing-first is retained, update the older map-first PRD and make landing copy honest about incomplete photo and grounded-answer behavior.
- If map-first is restored, keep the landing page as a secondary route such as `/about` or `/start`.
- Acceptance: routes, copy, metadata, screenshots, and tests all reflect the chosen product entry.

### Pint Drop API And Schema

- Keep `/api/pint-drops` as the only write path.
- Extend the contract to support `pint_photo` and `venue_photo` multipart fields.
- Add `venue_photo_key` to `visit_reports`.
- Add migration-safe database checks for:
  - allowed `status`
  - allowed `provenance`
  - sane `price_gbp`
  - at least one meaningful contribution: price, note, pint photo, or venue photo
- Return a read DTO rather than raw storage keys. Proposed fields:
  - `id`
  - `venueId`
  - `handle`
  - `drink`
  - `priceGbp`
  - `passedDownNote`
  - `era`
  - `provenance`
  - `status`
  - `createdAt`
  - `pintPhotoUrl`
  - `venuePhotoUrl`
- Keep storage object keys server-side unless there is an explicit reason to expose them.
- Acceptance: old rows without photos still read; new rows can store and return both photo URLs.

### Storage And RLS

- Choose public-read or signed URL strategy.
- Write an executable migration or a precise runbook for creating the `pint-drops` bucket and storage object policies.
- Keep writes service-role-only.
- Hidden or pending drops must not expose photo URLs through public API responses.
- Acceptance: anon cannot insert or update `visit_reports`; anon can only read `status = visible`; browser can load visible photos using the chosen strategy.

### Upload Failure Handling

- Avoid acknowledged writes that lose data.
- Avoid orphaned storage objects when DB insert fails.
- Preferred implementation:
  - Generate drop id before upload.
  - Upload photos under deterministic keys such as `venueId/dropId/pint.ext` and `venueId/dropId/venue.ext`.
  - If DB insert fails after upload, delete uploaded objects before returning 503.
  - Log storage and DB failures with non-secret context.
- Acceptance: mocked failure tests prove insert failure leaves no orphaned photos and returns no successful Pint Drop.

### Pint Drop UI

- Convert the composer from JSON-only to `FormData`.
- Add separate pint photo and venue photo inputs with camera-friendly mobile behavior.
- Add preview and remove controls for each photo.
- Add public-photo and rights/consent copy before submit.
- Render photo thumbnails in Pint Drop cards.
- Include validation states for unsupported type, too-large file, missing contribution, and network/storage failure.
- Acceptance: user can create a text-only drop, price-only drop, photo-backed drop, and combined drop from the UI.

### Moderation

- Add a Report action on each visible Pint Drop.
- Collect report reason where practical.
- Persist moderation metadata:
  - `reported_at`
  - `report_reason`
  - `report_count`
  - `moderator_note`
  - `moderated_at`
  - optional `moderated_by`
- Add a minimal moderator read path for hidden/pending drops.
- Add restore and keep-hidden actions.
- Rate-limit report spam.
- Acceptance: report hides a drop from public reads, records metadata, appears in moderator review, and can be restored.

### Rate Limiting

- Replace process-memory handle-only rate limit for production.
- Use Supabase table/RPC, Redis, or host-native KV.
- Key by normalized handle plus hashed IP. Do not store raw IP unless product/legal explicitly approves.
- Document forwarded-IP handling for the deployment host.
- Acceptance: rapid submissions and report spam are limited across serverless instances; tests can fake the limiter.

### Stable Venue Identity

- Preserve current stable Venue id derivation from normalized grouping key.
- Do not regress to array index ids.
- Before dataset reimport, create one of:
  - a venue id snapshot table
  - an alias table mapping old ids to new ids
  - a migration script that reports orphan risk before import
- Acceptance: dataset reorder does not orphan Pint Drops; grouping-field changes are detected before launch.

### Venue Claims And Provenance

- Do not collapse all claims into one `curation` note.
- Model Venue presentation as:
  - baseline dataset prices
  - editorial claims
  - sourced heritage claims
  - contributor Pint Drops
  - anecdotal Passed-Down Notes
  - derived summary signals for map/route scoring
- Keep badges distinct: `Baseline`, `Sourced`, `Contributor`, `Anecdote`, `Needs Source`, `Demo`.
- `mergeVenueDrops` can still produce summary signals, but source claims must remain separately renderable.
- Acceptance: a Venue with both a Sourced editorial claim and an Anecdote Pint Drop renders both badges and both pieces of content.

### The Landlord

- `/api/heritage` should reconstruct trusted context server-side from `venueId`.
- Client-supplied `context` must not become `structured` fact material.
- Contributor notes can be included only as contributor/anecdote facts with explicit labels.
- Facts should carry:
  - `id`
  - `claim`
  - `sourceType`
  - `sourceRef`
  - `retrievedAt`
  - `confidence`
  - `provenance`
- Model output should use structured JSON that maps answer sentences to fact ids.
- Add `temperature: 0`, max token bound, timeout/abort handling, and safe fallback.
- Reject model responses that cite missing fact ids or introduce unsupported named entities, dates, or events.
- Fix the heritage schema mismatch: migration uses `pub_id`, retrieval queries `pub_id`, but enrichment script writes `venue_name`.
- Acceptance: The Landlord never treats client-supplied or contributor text as Sourced; citation chips correspond to facts actually used; schema keys align.

### Editorial Source Review

- Do not expand Alastair Hilton or book-derived claims without permission or manual verification.
- Every Sourced claim needs a source reference. If no source exists, downgrade to Needs Source or Anecdote.
- Record content rights status for:
  - Writer Trail claims
  - book mentions
  - heritage cache facts
  - pub photos
  - landing page examples
- Acceptance: no Sourced claim ships without an inspectable source or an explicit rights note.

### Route Builder And Map UX

- Define route states explicitly:
  - available
  - inspected
  - route stop
  - active route stop
  - removed
- Separate inspect from add/remove where possible.
- Add explicit actions:
  - Add stop
  - Remove stop
  - Clear route
  - Reorder later, only if included in scope
- Label route distance honestly as estimated straight-line distance unless walking routing is implemented.
- Add mobile bottom-sheet or mini-card after map selection.
- Add map controls or list equivalents for:
  - recenter
  - visible mode hint
  - route stop count
  - layer/legend clarity
- Acceptance: no ambiguous tap both inspects and mutates without clear affordance; mobile users can inspect and add/remove without long scrolling.

### Landing Page Honesty

- Landing page copy must not claim completed photo-backed Pint Drops, grounded source behavior, or production durability until those flows pass acceptance tests.
- Examples may be illustrative, but must be labeled as illustrative or demo.
- Acceptance: copy review confirms no unsupported product claims.

### CI, Browser Tests, And Release

- Add scripts:
  - `typecheck`
  - `ci`
  - optionally `verify:data`
  - optionally `test:browser`
- Add GitHub Actions or equivalent CI on Node 22:
  - `npm ci`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - data export/fixture validation if practical
- Add Playwright smoke coverage:
  - `/` route
  - `/map` route
  - desktop and mobile viewports
  - map canvas nonblank
  - route controls
  - venue selection
  - Build Your Own add/remove/clear
  - theme toggle
  - Pint Drop submit
  - photo validation failure
  - report flow
- Replace stale screenshots in `docs/screenshots` with current desktop, tablet, and mobile captures.
- Acceptance: CI blocks merge on failures; browser smoke runs against production build; screenshots match the current UI.

### Supabase Local And Production Workflow

- Add Supabase CLI config or a precise equivalent local workflow.
- Add local reset/smoke docs:
  - apply migrations from scratch
  - create bucket and policies
  - service-role write
  - visible public read
  - report-to-hidden
  - storage upload/read
- Add production checklist:
  - set server-only env
  - apply migrations
  - create/verify bucket
  - deploy app
  - run hosted smoke
  - verify logging
  - verify rollback path
- Acceptance: staging Supabase can run the full create/read/photo/report smoke before production.

### Observability And Rollback

- Add structured server logs for:
  - Supabase insert/read/update failures
  - storage upload/delete failures
  - rate-limit denials
  - OpenRouter fallback
  - production missing-env failures
- Do not log secrets, raw service keys, full photo payloads, or raw IPs.
- Define alert destination for API 5xx and failed uploads.
- Document rollback:
  - app deploy rollback
  - migration rollback or forward fix
  - storage policy rollback
  - env rotation
  - DB backup/restore expectation before public UGC launch
- Acceptance: an operator can debug failed Pint Drop writes without exposing secrets.

## Testing Decisions

Good tests should assert user-observable behavior and trust boundaries. Avoid tests that only lock internal implementation details.

Required test seams:

- **Pint Drop handler tests**
  - valid text/price creates visible drop
  - valid multipart creates photo-backed drop
  - invalid image type/size returns 400
  - report hides public read
  - production missing Supabase returns 503
  - Supabase failure does not fall back to memory

- **Supabase adapter tests**
  - row mapping includes `pint_photo_key` and `venue_photo_key`
  - read DTO returns URLs or signed URLs according to chosen strategy
  - hidden drops do not return photo URLs
  - failed insert after upload cleans up storage

- **Venue merge/provenance tests**
  - contributor price affects summary marker/route signal
  - Sourced and Anecdote claims remain separately visible
  - stable Venue ids survive dataset reorder
  - dataset grouping-field changes surface orphan risk

- **Heritage/Landlord tests**
  - malicious client context is not trusted
  - contributor note is labeled contributor/anecdote, not Sourced
  - no-context fallback does not invent story
  - model output with unsupported fact ids is rejected
  - cache/DB key mismatch is covered after fix

- **Planner browser tests**
  - map loads and canvas is nonblank
  - filters update route/list
  - Build Your Own add/remove/clear works
  - mobile selected venue card appears
  - route distance label is honest
  - theme toggle persists
  - landing page and `/map` agree with chosen entry strategy

- **Release tests**
  - CI runs lint, typecheck, unit tests, build
  - production build smoke passes
  - local Supabase reset applies migrations
  - staging hosted smoke creates, reads, uploads, reports, hides

## Acceptance Criteria

Opus can treat the continuation work as complete when all of the following are true:

1. Product entry decision is explicit and implemented across routing, copy, docs, tests, and screenshots.
2. Pint Drop composer supports pint and venue photos end to end.
3. Supabase schema stores both photo keys and moderation metadata.
4. Storage bucket and RLS setup are executable or documented precisely enough to reproduce.
5. Public API returns safe read DTOs, not raw internal storage assumptions.
6. Hidden or pending drops and their photos are not exposed publicly.
7. Production cannot silently use in-memory Pint Drops.
8. Failed DB insert after upload leaves no orphaned storage objects.
9. Rate limiting is durable across production instances and covers submissions plus reports.
10. Report UI, immediate hide, moderator review, restore, and keep-hidden paths exist.
11. Venue presentation preserves distinct claim provenance while still deriving map/route summary signals.
12. The Landlord trusts only server-retrieved facts and validates model output against fact ids.
13. Editorial Sourced claims all have source refs or are downgraded.
14. Build Your Own mode has clear inspect/add/remove semantics.
15. Route distance is labeled as straight-line unless real walking routing is implemented.
16. Mobile map selection has an immediate inspect/add/remove affordance.
17. Landing page copy does not overclaim incomplete features.
18. Current desktop/tablet/mobile screenshots are regenerated.
19. CI and browser smoke tests pass.
20. Local and staging Supabase smoke tests pass.
21. Release checklist includes migrations, bucket, secrets, deploy, smoke, monitoring, and rollback.

## Out Of Scope

- Full accounts, login, profile pages, followers, or a social feed.
- Friend graph, likes, comments, notifications, or activity feeds.
- Paid venue-owner dashboards.
- Automated AI moderation.
- Real walking directions unless explicitly selected instead of honest straight-line labeling.
- Tube routing and OpenRouteService isochrones for this slice.
- Importing rental/neighbourhood intelligence features from `.context/londonszn`.
- Expanding the full contents of *The Greatest Pubs* without rights or manual source verification.
- Replacing Supabase with another backend.
- Publishing real secrets into the repo, PRD, chat, screenshots, or Conductor context.

## What Opus Needs From Karan

Required before production validation:

- Supabase project access path: CLI access token, DB connection string, or dashboard migration path.
- Production `SUPABASE_URL`.
- Production `SUPABASE_SERVICE_ROLE_KEY`, provided only through the deployment secret store.
- Storage bucket decision: public-read or signed URLs.
- Deployment target and access: Vercel or equivalent, production URL, preview policy, secret rotation owner.
- Moderation owner and expected review workflow.
- Public upload/privacy/terms copy and takedown contact.
- Content rights status for writer/book claims, seeded heritage claims, and any real pub photos.
- Observability destination for server errors and upload failures.

Optional:

- `OPENROUTER_API_KEY` and preferred `OPENROUTER_MODEL` for The Landlord.
- Decision on whether `/` should be landing-first or planner-first.
- Whether real walking routes are worth adding now or distance should simply be labeled honestly.

## Further Notes

- This PRD intentionally prioritizes trust, production storage, moderation, and QA over new discovery features.
- Keep the current stable Venue id contract. Do not regress to array-index ids.
- Build on the current community read-merge pattern instead of adding a separate Pint Drop presentation pipeline.
- Borrow from `.context/londonszn` only where it improves discipline: MapLibre patterns, data-honesty labels, seed fallback clarity, server/client Supabase separation, and screenshot QA.
- The next Opus pass should start by resolving the six grilled decisions, then implement the smallest coherent slice that gets Pint Drops production-ready.
