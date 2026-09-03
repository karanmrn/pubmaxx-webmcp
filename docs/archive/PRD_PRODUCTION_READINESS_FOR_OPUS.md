# PRD - Production Readiness for Pint Drops and PubMaxing

> **Superseded** — see docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md and cc_plan.md

> Synthesised from the current implementation and conversation via `to-prd`. Vocabulary follows `CONTEXT.md`; production boundary recorded in `docs/adr/0003-production-readiness-boundary.md`. This repo has no issue-tracker publishing configuration, so this document is the handoff for Opus.

## Problem Statement

PubMaxing now has the core product loop: a map of London venues, Crawl Route planning, curated heritage signals, and Pint Drops for community prices, photos, and Passed-Down Notes. The local build is working, but it is not yet production-ready because durable credentials, hosted data stores, content policies, deployment ownership, and moderation decisions are outside the codebase.

Without those production inputs, the app can demo the experience but cannot safely accept public contributions. Supabase credentials and migrations are the critical path; legal/privacy copy, verified source permissions, and moderation ownership are the trust path.

## Solution

Prepare a production handoff that lets Opus gather the missing operational inputs without guessing. Keep the implementation boundary intact: all community writes go through `/api/pint-drops`, all photos use Supabase Storage, all user claims retain Provenance, and production persistence must use Supabase rather than the in-memory fallback.

Opus should fetch or confirm the items in this PRD, apply them to the deployment environment, and return any unresolved decisions as explicit product questions instead of burying them in code.

## User Stories

1. As a visitor, I want submitted Pint Drops to survive deploys and server restarts, so that community contributions are not lost.
2. As a visitor, I want Pint Drop photos to load reliably from production storage, so that photo-backed prices feel trustworthy.
3. As a visitor, I want the map to show community story and price signals before I select a venue, so that the map feels alive immediately.
4. As a contributor, I want clear public-photo and public-note expectations, so that I know what I am publishing.
5. As a moderator, I want reported Pint Drops hidden and queued for review, so that harmful or false content does not stay public.
6. As an operator, I want secrets stored only in the hosting provider's server environment, so that the Supabase service role is never exposed to the browser or committed.
7. As an operator, I want migrations applied to the production database before launch, so that the API does not fail on first use.
8. As an operator, I want production failure modes to be loud, so that the app never silently stores public contributions in volatile memory.
9. As an editor, I want source permissions for heritage/book claims confirmed, so that day-one editorial content can ship without rights ambiguity.
10. As a reviewer, I want a concise launch checklist, so that production readiness is auditable.

## Implementation Decisions

- **Supabase is required for production.** Production must set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` on the server host. The current default bucket is `pint-drops`.
- **Service-role key is server-only.** Do not paste the real key into chat, docs, committed files, screenshots, or client environment variables. Put it directly into the deployment secret store.
- **Migrations are part of launch.** Apply `supabase/migrations/0001_visit_reports.sql` and `supabase/migrations/0002_pub_heritage.sql` to the production Supabase project before enabling public submissions.
- **Storage policy must match the route.** The route stores object keys and returns public URLs. Opus must confirm the `pint-drops` bucket exists and whether it is public-read or uses signed URLs. Current implementation expects public-read URLs from `getPublicUrl`.
- **No silent production fallback.** Local/demo can use the in-memory Pint Drop store when Supabase is absent. Production should be configured so missing Supabase values are a deployment error, not a runtime surprise.
- **Stable Venue ids are locked.** Venue ids are derived from normalised grouping data, not array indexes. Opus must preserve this when importing or replacing the venue dataset.
- **All-visible community read is intentional.** `GET /api/pint-drops` can return visible drops across venues so the map can show contributor price/story signals before a user opens a venue detail.
- **Moderation v1 is hide-first.** A report action hides the Pint Drop. Opus must define who reviews hidden content and where that review happens until an admin dashboard exists.
- **OpenRouter is optional.** `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` improve the Landlord heritage narrator. They are not required for Pint Drop production persistence.
- **No auth in v1.** Contributor Handle remains lightweight device-level identity. Real accounts, author edits, and social features remain separate product decisions.

## What Opus Needs to Fetch or Confirm

- **Supabase project access:** project URL, service-role key, project ref, and preferred migration path: Supabase CLI access token, database connection string, or dashboard SQL execution.
- **Storage setup:** bucket name, public-read decision, max upload policy, and whether image transformations or CDN rules are required at launch.
- **Deployment target:** Vercel project or other host, production URL/domain, environment-variable access, preview environment policy, and who can rotate secrets.
- **Launch data source:** the intended production venue dataset, import owner, and whether venue grouping fields can change after launch.
- **Content rights:** permission status for Alastair Hilton/book-derived claims, curated Writer Picks, heritage blurbs, and any supplied pub photos.
- **Moderation owner:** the person or team responsible for reviewing hidden Pint Drops, expected response time, and escalation route.
- **Legal/privacy copy:** public upload notice, photo consent wording, terms/privacy links, takedown contact, and whether contributors must confirm they own upload rights.
- **Observability:** preferred error monitoring, analytics, and alert destination for failed uploads, Supabase errors, and API 5xx responses.
- **Production hardening preference:** whether missing Supabase env vars should fail `next build`, fail server startup, or fail only write requests with a production-specific error.
- **Editorial expansion priorities:** whether the next product push should focus on more heritage content, friend/social crawl loops, venue owner tools, or richer route planning.

## Testing Decisions

- **Keep the current gates green:** `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- **Test stable ids:** keep coverage that Venue ids are stable across dataset reordering.
- **Test all-visible reads:** keep coverage that `GET /api/pint-drops` without a Venue id returns visible drops for the map layer.
- **Test production env separately:** add a deployment smoke test once real Supabase credentials exist: create a Pint Drop, confirm row persistence, confirm photo URL loads, report it, confirm public read hides it.
- **Test migrations on a staging clone first:** run migrations against staging Supabase before production and capture any manual SQL changes in the repo.
- **Browser QA after deployment:** verify mobile map load, venue detail, route building, Pint Drop submit, image upload, and report flow on the hosted URL.

## Out of Scope

- Full accounts, login, profiles, followers, or friend graph.
- Paid venue-owner dashboards.
- Automated AI moderation.
- Image transformations, watermarking, or advanced media pipeline.
- Replacing Supabase with another backend.
- Rebuilding the map, crawl optimiser, or app design system.
- Publishing real secrets into this repository or Conductor transcript.

## Further Notes

- For credentials, the user should provide access through the host or Supabase dashboard, not by pasting secrets into chat.
- If Opus needs a minimal credential set first, ask for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, and deployment environment access.
- The next useful product questions for Karan are: which launch audience matters first, which community feature should deepen retention, and which venue/editorial sources are legally cleared.
- This PRD is intentionally operational. The Pint Drop product PRD remains `docs/PRD_PINT_DROPS.md`.
