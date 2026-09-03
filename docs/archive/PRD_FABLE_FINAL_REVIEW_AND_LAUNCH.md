# PRD - Fable Final Review and Launch

> **Superseded** — see docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md and cc_plan.md

> Synthesised via `to-prd` from Opus' implementation, Codex review, and parallel subagent reviews. This is the final Fable-facing execution PRD: make the app production-worthy, beautiful, accessible, and deployable to Vercel. Vocabulary follows `CONTEXT.md` and the production boundary ADRs.

## Problem Statement

PubMaxing now has the core product: a price-aware London pub map, Crawl Route planning, Pint Drops, photo-backed community contributions, provenance claims, a moderation console, seeded heritage, and The Landlord heritage narrator. The app builds locally and the main flows are implemented, but a public launch still carries avoidable risk.

The remaining problem is not "build the feature". It is final product hardening: prevent abuse of public reporting and paid AI calls, make the map and route builder accessible beyond pointer/touch input, complete Vercel production setup, and turn the competent map into the crafted Fable demo.

## Solution

Ship in two phases.

Phase 1 makes the current product launchable: close security and moderation risks, lock environment setup, keep local gates green, deploy to Vercel with required secrets, and run smoke tests against the hosted URL.

Phase 2 makes it Fable-quality: improve the map into a 3-D, story-led London experience; add accessible route-building alternatives; polish the admin console; and add browser QA that protects the flows a judge or first user will actually touch.

## User Stories

1. As a first-time visitor, I want the map to load quickly and clearly, so that I understand PubMaxing before reading long copy.
2. As a crawl planner, I want to build a Crawl Route by mouse, touch, or keyboard, so that the product is usable without relying on map clicks.
3. As a keyboard user, I want route stops and mode controls to be real controls, so that I can inspect, add, remove, and reorder stops.
4. As a screen-reader user, I want form errors and submission results announced, so that Pint Drop contribution is understandable.
5. As a contributor, I want my Pint Drop to persist in production, so that my photo, Pint Price, and Passed-Down Note are not lost after deploys.
6. As a contributor, I want clear public-photo wording, so that I understand the upload is public and may require takedown.
7. As a reader, I want reported harmful content handled quickly, so that the community layer stays trustworthy.
8. As a malicious user, I should not be able to hide every visible Pint Drop by scripting public reports.
9. As an operator, I want report and submit rate limits to survive serverless instance restarts, so that abuse controls work on Vercel.
10. As an operator, I want `/api/heritage` protected from cost spikes, so that OpenRouter usage cannot be abused.
11. As a moderator, I want hidden-but-reviewed items to leave the review queue, so that moderation does not repeat the same resolved cards.
12. As a moderator, I want admin credentials kept out of URLs, logs, and browser history, so that the console is not weakened by its own fetch calls.
13. As a moderator, I want row-level pending states, so that restore/keep-hidden cannot be double-submitted.
14. As a reviewer, I want hidden photos to be inspectable at useful size, so that photo abuse can be judged accurately.
15. As a visitor, I want provenance badges to distinguish Sourced, Contributor, Anecdote, Needs Source, Baseline, and Demo, so that seed content is honest.
16. As a deployer, I want Vercel settings and env vars documented, so that production does not accidentally run with demo storage.
17. As a deployer, I want migrations applied before traffic, so that production APIs do not fail on first write.
18. As a product owner, I want the Fable PRD to separate launch blockers from design polish, so that the team can cut scope without cutting safety.
19. As a demo viewer, I want the map to feel like London, so that the product reads as a crafted guide rather than a data table.
20. As a future editor, I want seed/demo Pint Drops labelled as Demo, so that day-one liveliness never masquerades as organic community activity.

## Implementation Decisions

- **Keep the single Pint Drop API seam.** All create/report/moderation writes continue through the server route. Do not introduce client Supabase writes.
- **Keep production Supabase as mandatory.** In production, missing Supabase env vars should fail Pint Drop API requests loudly. The in-memory store remains local/demo only.
- **Use header-only admin auth from the console.** The admin console should send `x-admin-token`, not `?admin=...`. The API should remove query-token support before public launch unless there is a deliberate emergency-link workflow.
- **Fix report abuse before public UGC.** The current public report action can hide content immediately from a single unauthenticated report. Replace it with one of: moderator queue without immediate public hide; thresholded hide after multiple actor-scoped reports; or authenticated/trusted reports. Actor-scoped durable rate limiting must include hashed IP or another non-public key.
- **Protect paid heritage generation.** Add rate limiting, max context length, abort timeout, and cache/reuse behavior around The Landlord route when OpenRouter is configured.
- **Move public photos toward revocable access.** Public bucket URLs are acceptable for prototype demo, but real takedown requires private storage with signed URLs or quarantine/delete-on-report behavior.
- **Validate image bytes, not MIME alone.** Server upload validation should check magic bytes or decode/re-encode before public serving.
- **Bound public Pint Drop reads.** `GET /api/pint-drops` should use limits/pagination and select only DTO fields needed by the map.
- **Expose non-map route building.** Add a keyboard-accessible filtered venue list with Add/Remove controls. Treat the MapLibre canvas as visual enhancement, not the only interaction path.
- **Use semantic controls for route rows and segmented controls.** Route rows should be buttons; mode/style selectors should expose selected state with radio or pressed semantics.
- **Use live regions for status.** Pint Drop submit messages, admin messages, and Landlord response states should use `role="status"` or `role="alert"` as appropriate.
- **Fable map work stays layered.** Implement 3-D pitch, idle orbit, building extrusion, fog/sky, landmarks, custom story/price markers, clustering, and cinematic fly-to using MapLibre sources/layers, not React markers at scale.
- **Vercel deploy should use Git or CLI after commit.** Current working-tree changes and untracked files must be committed/pushed for Git deploys. CLI deploy is possible only after Vercel project linking and env setup.

## Testing Decisions

- **Required local gates:** `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- **Current review gates:** unit tests pass, typecheck passes, lint has warnings only, and production build passes after fixing the missing Demo provenance label.
- **Add report-abuse tests.** Assert that one unauthenticated actor cannot hide arbitrary visible drops across the map.
- **Add admin queue tests.** Assert that keep-hidden records review metadata and removes the drop from the review queue while keeping it hidden publicly.
- **Add heritage cost-control tests.** Assert context truncation, timeout fallback, and rate-limit behavior around OpenRouter calls.
- **Add accessibility tests.** Use Playwright and axe-style checks for keyboard route building, route-row buttons, form error announcement, and admin action pending states.
- **Add hosted smoke tests.** Against the Vercel URL, test `/`, `/map`, `/admin`, Pint Drop create/read/report/moderate, photo upload, theme toggle, and The Landlord fallback/answer.
- **Add browser screenshots.** Capture desktop, tablet, and mobile for both themes after the Fable map pass.

## Out of Scope

- Full user accounts, social graph, likes, comments, notifications, or profiles.
- Paid venue-owner dashboards.
- Automated AI moderation or image classification.
- Real walking directions or tube routing.
- Replacing Supabase.
- Expanding copyrighted book/editorial material without rights confirmation.
- Treating demo/seed drops as organic community content.

## Further Notes

- Fixes already made during final review: `.context` is ignored by ESLint; admin console fetch no longer places the token in the URL; reviewed hidden drops leave the moderation queue; Demo provenance now has a label/style; `.env.example` now documents production-required env vars.
- Vercel CLI is available through `npx vercel@latest` and the shell is logged in as `karanmrn`, but this repo is not linked to a Vercel project and no Vercel env vars are present in the shell.
- Required Vercel env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `ADMIN_TOKEN`, `RATE_LIMIT_SALT`. Optional: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.
- Required Vercel settings: Next.js preset, root directory `.`, install command `npm ci`, build command `npm run build`, Node.js `22.x`, default output directory.
- Required Supabase migrations before traffic: `0001_visit_reports.sql`, `0002_pub_heritage.sql`, `0003_rate_limits.sql`; create the `pint-drops` bucket with public read for prototype or private signed URLs for production takedown.
- Deployment is blocked until the Vercel project is linked and required env vars are set. A CLI deploy before those steps would produce a hosted shell whose Pint Drop production API intentionally returns 503.
