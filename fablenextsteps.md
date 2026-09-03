# PUBMAXX Fable Next Steps

> **For agentic workers:** Read `AGENTS.md`, every repository `CONTEXT.md`, `docs/VOICE.md`, and this document before work. Use test-driven development for each defect or feature. Use no more than two concurrent agents on the 8 GB development Mac.

**Goal:** Preserve the PUBMAXX work completed through 24 August 2026 and define one MECE path from the live London MVP to a trusted, repeatable group-night product.

**Architecture:** GitHub `main` is the only source of truth. `chengdu` is the Vercel project. Supabase is the Production Store and data-integrity authority. PostHog owns consented product analytics. London is the full market. Other cities stay honest previews until their data and complete-night journeys meet the same release gates.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, MapLibre, Supabase, Vercel, PostHog, Vitest, Playwright, Capacitor, OpenRouter, and existing provider adapters.

**Spec:** This file is the current handoff and next-steps specification. It supersedes stale deployment facts and stale launch decisions in `cursorplan.md` and `docs/RELEASE_LEDGER_2026-08-23.md`. Those files remain historical evidence.

## Global constraints

- Use `PUBMAXX` for the brand and `PUBMAXXING` for the app.
- Use London terminology from `CONTEXT.md`.
- Never invent a price, freshness date, publisher, event, opening time, accessibility fact, or user contribution.
- A Pint Drop, Community Price, Visit Report, Social Post, and Night Story are separate domain objects.
- A first price report can mark a venue. It cannot colour a pin until a second independent, fresh report corroborates it.
- Estimates can never become verified prices, Pint Index observations, history, or publisher claims.
- No account is required to browse, view the Map, inspect a draft Plan, or view a public Open Crew preview.
- A verified account and adult assertion are required for Social host and join actions.
- Social is live by default. Set `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` only for a full emergency rollback; Social then stays in static preview and its reads and writes are unavailable.
- Do not add LangChain, LangGraph, Langfuse, Sentry, or Depot without evidence that PostHog, Vercel, Supabase, and the existing trace adapter leave a measured gap.
- Do not add a database table unless a named task requires it and an existing table or event cannot carry the contract safely.
- Keep production deployments clean, pinned to fetched `origin/main`, and traceable by deployment ID.
- Do not run parallel full builds, TypeScript checks, or Playwright suites on the 8 GB Mac.

---

## 1. Current source-of-truth snapshot

Snapshot time: 24 August 2026, Europe/London.

| Item | Current state | Evidence |
| --- | --- | --- |
| GitHub repository | `Singularityszn/pubmax` | Repository remote |
| Open pull requests | 0 | GitHub query on 24 August |
| GitHub `main` | `cce648fe3346198cd51bbc461b0ed938dba84859` | Local and `origin/main` match |
| Latest merged PR | #1175, readable `PUBMAXX` wordmark | GitHub merged PR |
| Production site | `https://pubmaxxing.com` | Vercel alias |
| Vercel project | `pubmax69/chengdu` | `.vercel/project.json` and CLI |
| Production deployment | `dpl_HBPSaLMSbNpzzg7BoZcvdbiLtEcr` | `/api/version` |
| Production state | Ready | Vercel inspection |
| Supabase project | `iankajxliutqogqkmvdg` | Production Store |
| Migration state | See [`docs/SOFT_LAUNCH_RUNBOOK.md`](docs/SOFT_LAUNCH_RUNBOOK.md#13-migrations) for current source-ledger reconciliation; use `supabase migration list` for the remote ledger | Runbook and live ledger |
| Social launch flag | Unset, so Social is live by default; `0` is full emergency rollback | Vercel environment inventory and `lib/socialLaunch.ts` |
| Open GitHub issues | 8 | #727, #443, #437, #392, #390, #287, #282, #252 |

### Production smoke at this snapshot

- `/`, `/map`, `/plan`, `/out`, `/today`, `/tonight`, `/api/pint-drops`, and `/api/whats-on` returned HTTP 200.
- Signed-out `POST /api/pint-drops` returned HTTP 401 with `UNAUTHENTICATED`.
- The mobile Map reached a useful pin state at 390x844.
- Blank Plan arrival showed an enabled `Guide me` action.
- Social links follow live-by-default launch state; rollback keeps a visible preview destination.
- Vercel build completed TypeScript and generated 519 static pages.
- No new runtime error group was attributed to the current production deployment during release smoke.
- Two moderation alert groups returned by Vercel belonged to the prior deployment and its one pending Social post.

### Release verification completed

- 22 release-focused test files passed, 213 tests total.
- Wordmark and core UI regression pass covered 45 tests.
- ESLint passed across the release diff.
- Branch protection was restored after merges: strict checks, 12 contexts, admin enforcement, conversation resolution, no force pushes, and no branch deletion.
- GitHub-hosted jobs currently fail before runner logs because of account allocation or billing state. Local and Vercel evidence is the current release gate. Fixing GitHub Actions remains an owner action.

---

## 2. Product definition and launch bar

PUBMAXX must answer one question well:

> Where should our group go tonight?

London MVP is complete only when a real user can:

1. Find a useful venue with a price whose authority is clear.
2. Create and edit a three-to-six-stop Crawl Route without signing in first.
3. Claim the Plan after account creation without losing it.
4. Invite at least one friend through one canonical membership path.
5. Run and complete the Planned Night.
6. See a recap, contribute one real observation, and plan again.

The application has the code for most of this loop. Production usage has not yet proved the loop. Activation and fresh data are now more important than more surface area.

---

## 3. Shipped feature inventory

This section is MECE by product responsibility. A feature appears in one primary group only.

### 3.1 Discovery and Map

Status: **SHIPPED**

- London MapLibre map with curated venue pins, clusters, search, area choice, filters, price lenses, dark and light basemaps, and collision-safe labels.
- Separate UK Base layer with approximately 38,000 unpriced OSM pubs streamed by viewport and zoom. It does not enter the curated Venue Dataset.
- Curated London index with 1,997 venues in the latest production build output.
- Other enabled city packs for Manchester, Liverpool, Oxford, Durham, Glasgow, Bristol, Cambridge, Bath, and Llandudno.
- First-visit Map card with location or area choice.
- Simplified mobile arrival chrome with search, filters, area, and More controls.
- Canonical `/map` navigation and city routes.
- Distinct overlapping pin hit resolution.
- Venue detail, accessible list parallel, price captions, provenance, historical prices, Community Venue Signals, occupancy, saved venue controls, and Add to Plan entry.
- Search indexes for UK places and UK pubs.
- OSM attribution attached to the Map itself.

Important merged slices:

- #1094, #1097, #1107: mobile Map arrival and failure honesty.
- #1123, #1152, #1160, #1165: loading, approximate routes, cold chrome, and overlapping pins.
- #1049, #1050, #1055: performance and mobile form foundations.

### 3.2 Plan and complete-night journey

Status: **BUILT, NEEDS REAL-JOURNEY CERTIFICATION**

- Describe-first planning with area, time, group, budget, access, atmosphere, food, and stop count.
- Guest planning and editable draft routes.
- Three-to-six-stop route generation.
- Pub Pal handoff into Plan.
- Canonical Plan create context and idempotency seams.
- Chosen-venue carry-through into route, price receipt, and invitation.
- Plan collaboration, presence, group preferences, constraints, proposals, votes, and action log.
- Private invites, public invite card, RSVP, invite redemption, rotation, member leave, member removal, and capability revocation.
- Ending choice: Food, Get Home, or Keep Going.
- Idempotent completion, recap route, pending recap handling, and published recap statistics.
- Enabled blank-state `Guide me` action on mobile and desktop.

Important merged slices:

- #1057, #1070, #1096, #1110, #1129: planner state and safe ownership.
- #1134: recap statistics.
- #1148, #1151: Open Crew reads and stale mini-map state.
- #1174: useful blank Plan action.

Production evidence:

- `plans`: 9 rows.
- `plan_stops`: 26 rows.
- `plan_crew_members`: 9 rows.
- `plan_completions`: 0 rows.
- `plan_invites`: 0 rows.
- `plan_actions`: 0 rows.

Conclusion: people have created Plans, but the complete-night and invite loop is not proven in production.

### 3.3 Pint Drops, Community Prices, and trust

Status: **SHIPPED WRITE PATH, ZERO PRODUCTION STOCK**

- One-tap Pint Drop composer from a venue surface.
- Account-bound author identity in Production.
- Keyless local demo fallback, with no silent in-memory fallback in Production.
- Pint Drop physical table separated from Structured Visit Reports.
- Optional observed Pint Price or Passed-Down Note, plus photo handling.
- Public reporting, verified-report counter, moderation queue, reversible hide, and audit seams.
- Community Price submission with stable profile actor, date, drink taxonomy, independent corroboration, freshness gates, and one moderation queue.
- Provisional Map marks separated from price authority.
- Non-alcohol drink categories use trust rules but never become Pint Index authority.
- Price evidence missions, trust credits, contribution funnel events, and moderator restore.
- Price authority protected from anonymous or legacy report-count manipulation.
- Production migration state is maintained in the [soft-launch runbook](docs/SOFT_LAUNCH_RUNBOOK.md#13-migrations); do not duplicate its version list here.

Important merged slices:

- #1108: original one-tap contribution flow.
- #1137, #1141, #1142, #1143, #1144: deterministic acceptance, legacy reports, freshness, review lanes, and multipart safety.
- #1157, #1159, #1164, #1172, #1173: moderation, verified authority, account identity, physical separation, and Production authentication.

Production evidence:

- `pint_drops`: 0 rows.
- `pint_drop_reactions`: 0 rows.
- `pint_drop_comments`: 0 rows.
- `pint_drop_reports`: 0 rows.
- `pint_drop_verified_reports`: 0 rows.
- `community_prices`: 0 rows.
- `community_price_reports`: 0 rows.
- `structured_visit_reports`: 0 rows.
- `price_trust_events`: 0 rows.
- `price_trust_credits`: 0 rows.
- `venue_occupancy_reports`: 0 rows.

Conclusion: trust rules are built, but there is no Production community evidence yet.

### 3.4 Now, Today, Tonight, Out, and transport

Status: **SHIPPED WITH SUPPLY GAP**

- Today surface with current recommendations, weather, cheap-pint summary, and transport context.
- Tonight surface with share flow, last-train support, disruption context, and event-aware planning.
- Out surface with Tonight, Tomorrow, Weekend, provider grouping, venue matching, and honest empty states.
- Event rows without a matching PUBMAXX Venue are hidden or grouped away from product recommendations.
- Empty `/api/whats-on` now produces a clear unavailable or empty state rather than theatre cards with no matching pub.
- Share errors render separately from the Share button.
- Last-train response has a bounded latency path.
- London DST departure countdown fixed.
- TfL rail, bus, and disruption adapters are keyless by default.
- Weather refresh runs on Vercel every six hours.

Important merged slices:

- #1076, #1086, #1114, #1153, #1163: Out supply and honesty.
- #1109: Today Top Picks.
- #1150, #1161, #1167: TfL DST, share state, and latency.

Current limitation:

- `/api/whats-on` can return no useful rows even with Ticketmaster configured.
- Event supply needs current, venue-matched London rows and attribution approval.
- Eventbrite can only return events owned by the authenticated Eventbrite organisations. It is not a general discovery feed.

### 3.5 Accounts, profiles, messaging, and private history

Status: **SHIPPED, LOW ACTIVATION**

- Supabase account identity with immutable PUBMAXX User ID and changeable PUBMAXX Handle.
- Private account identity fields and adult self-assertion.
- Profiles, aliases, follow graph, profile covers, avatar moderation, saved lists, check-ins, messages, and message attachments.
- Rounds diary and spend observations without debt or settlement semantics.
- Night Profiles, Night Memories, Night Moments, Night Stories, consent, contributor control, and publication proposals.
- Account-free discovery remains available.
- Admin surface remains authentication-gated.

Production evidence:

- `profiles`: 27 rows.
- `private_account_identities`: 6 rows.
- `follows`: 11 rows.
- `conversations`: 4 rows.
- `messages`: 22 rows.
- `rounds`: 3 rows, with 6 Round Stops.
- `saved_pubs`: 0 rows.
- `saved_lists`: 0 rows.
- `night_memories`: 0 rows.
- `night_stories`: 0 rows.

### 3.6 Social and Open Crews

Status: **LIVE BY DEFAULT, ROLLBACK-GATED**

- Verified Social access boundary and adult assertion.
- Social Posts, media, privacy, moderation, interactions, reports, and audit tables.
- Open Crew visibility selection.
- Open Crew host join-request queue with accept and decline.
- Account-free public Open Crew preview.
- Public Open Crew discovery in Out.
- Verified-account join request and host decision.
- Host removal, member leave, invitation, visibility update, and closure seams.
- Social provider connection models for X, Instagram, and TikTok.

Important merged slices:

- #1077: Open Crew discovery foundation.
- #1138: host join queue.
- #1139: visibility selector.
- #1140: public preview.
- #1148: surface read coverage.
- #1170, #1174: hide gated Social from primary mobile, desktop, and landing chrome.

Production state:

- `PUBMAX_SOCIAL_FRIENDS_LAUNCH` is unset, so Social is live by default.
- `/social` is in primary navigation when live and remains visible as static Social preview during `=0` rollback.
- `private_social_accounts`: 5 rows.
- `social_posts`: 1 row.
- `social_post_moderation_jobs`: 1 row.
- `social_crews`: 0 rows.
- `social_crew_members`: 0 rows.
- `social_crew_join_requests`: 0 rows.
- External Social provider credentials are not configured.

Conclusion: keep Social live by default; set `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` only for a full emergency rollback while host, join, moderation, abuse, and first-cohort evidence are reviewed.

### 3.7 Pub Pal and AI

Status: **TYPED PATH SHIPPED, VOICE DEFERRED**

- Typed Pub Pal planning and venue assistance.
- Structured, confirmed Pal Memory model.
- Plan handoff and invitation draft.
- Existing OpenRouter adapter and moderation model.
- Voice grant, privacy, quota, and metering schema foundations.
- Voice release response and fallback handling.
- No always-listening behaviour.

Production evidence:

- `pub_pals`: 1 row.
- `pub_pal_memories`: 0 rows.
- `pub_pal_voice_usage`: 0 rows.

Voice remains deferred under issue #282 until provider privacy approval, server-issued grants, real trace evidence, and typed planning reliability pass.

### 3.8 Brand, design, SEO, and content

Status: **WEB FOUNDATION SHIPPED**

- Canonical brand naming through `lib/brandNaming.ts`.
- Readable literal `PUBMAXX` wordmark at 390px and desktop.
- One primary landing CTA: Plan tonight together.
- Secondary Map and Find my pint actions.
- Mobile tab bar keeps Social visible and names it Social preview during `=0` rollback.
- Consent notice cleared above phone tab bar.
- Sitemap, robots, canonical host, OG cards, structured metadata, venue routes, borough routes, drink routes, and Pint Index routes.
- Published Pint Index archive contract with immutable monthly editions and corrections.
- Paginated Historic and Pubs indexes to reduce HTML size.
- Shared OG text clamp and regression tests.

Important merged slices:

- #1112, #1113, #1162, #1174, #1175: chrome, consent, canonical routes, launch actions, and wordmark.
- #1146: shared OG clamps.
- #1171: Historic and Pubs pagination.

### 3.9 Reliability, security, and release integrity

Status: **SHIPPED WITH ONE OWNER BLOCKER**

- RLS Wave 2 policies and PostgREST proof harness.
- Service-role write paths with browser deny on capability and secret tables.
- Dynamic runtime data packs declared for Vercel output tracing.
- Freshness registry, API, cron, alerts, and unresolved-vs-stale distinction.
- Retired experimental late-night feed removed.
- Server-only and I/O module boundaries hardened.
- Durable Production Store fallback parity.
- Chunked city enrichment and bounded provider calls.
- Duplicate Social moderation alerts cooled down.
- Release deployment ID exposed through `/api/version`.
- Production deployment now comes from clean `main`.
- Branch protection restored after merges.

Important merged slices:

- #1127, #1128: release trust and London MVP hardening.
- #1129 to #1136: private planner data, server-only boundaries, recap, dead code, and retired feed cleanup.
- #1149, #1155, #1158, #1168, #1169: route contract, review guards, durable stores, alert cooldown, and city timeouts.

Owner blocker:

- GitHub Actions jobs fail before useful runner logs because of account allocation or billing state. Required checks remain configured. Repair the GitHub account state, then prove all 12 required checks can run and pass without bypass.

---

## 4. Remaining bugs, risks, and gaps

### 4.1 P0 release blockers

No known crash, schema mismatch, open PR, or new current-deployment error group is blocking the live website at this snapshot.

Any new P0 is one of:

- Production cannot create a signed-in Pint Drop.
- Map cannot reach a useful pin state.
- Plan cannot generate or inspect a route.
- Authentication loses a guest Plan.
- A private capability or account record becomes public.
- A price without authority reaches pin colour, Pint Index, history, or publisher copy.
- Production schema stops matching the current source ledger in `supabase/migrations/`; see the [migration runbook](docs/SOFT_LAUNCH_RUNBOOK.md#13-migrations).

### 4.2 P1 product gaps

| Gap | User impact | Current evidence | Resolution |
| --- | --- | --- | --- |
| No Production Pint Drops | Community promise is unproved | 0 rows | Run first-cohort contribution activation and observe durable rows |
| No Community Prices | No community trust stock or corroboration | 0 rows | Collect independent, current bar observations |
| No completed Plans | Full-night loop is unproved | 0 `plan_completions` | Certify organiser and guest journey, then first cohort |
| No durable invite usage | Network loop is unproved | 0 Plan Invites | Test all share channels and measure acceptance |
| Out can be empty | Weak answer for “what is on” | Honest empty state | Repair current event supply and venue matching |
| Price baseline is old | Lower price usefulness | 3 July 2026 baseline | Re-collect prices or keep exact date on every surface |
| GitHub Actions cannot run | Reduced merge confidence | Jobs fail before logs | Owner repairs billing or runner allocation |
| One old Social moderation job remains | Queue health not clean | 1 pending job | Resolve or remove through moderator workflow, never direct deletion |

### 4.3 P2 quality and growth gaps

- Search Console and Bing ownership, sitemap submission, and indexing evidence are not certified.
- PostHog product dashboards and release certification are not documented as complete.
- No first-party weekly London data story cadence exists.
- No creator or venue pilot has produced measured acquisition or venue updates.
- Saved Pubs, Night Memories, Night Stories, Open Crews, occupancy, and price missions have zero Production rows.
- The Production Vercel environment still contains Clerk keys. Clerk is optional, while Supabase is the canonical PUBMAXX identity. Decide to retain and certify Clerk or remove both Clerk keys and its CSP origins.
- `package.json` permits Node `>=22`, so a future major can change build behaviour. Pin the supported major after the next dependency review.
- Vercel reports install-script approval warnings for `core-js`, two `esbuild` versions, and `unrs-resolver`. Review and approve only required scripts through the repository policy.
- Production function bundles are approximately 25 MB for common routes. Continue route-island and trace containment work before this becomes a cold-start regression.
- The `.co.uk` alias certificate command returned a transient Vercel response error during reassignment, although later inspection showed all aliases on the current deployment. Recheck certificate health in the Vercel domain panel.

### 4.4 Known unknowns

- What stops a visitor from submitting the first Pint Drop: account friction, trust, copy, venue selection, or low traffic.
- Whether a guest Plan survives real signup and becomes the same owned Plan on every browser.
- Which invitation channel produces a second committed participant.
- Whether users understand verified, provisional, estimated, stale, and unknown price states.
- Which London areas have enough demand to justify deeper venue curation.
- Why Ticketmaster configuration does not consistently produce useful venue-matched Out rows.
- Whether last-train latency remains under two seconds at peak TfL load.
- Whether Social moderation can operate with current OpenRouter configuration before OpenAI or provider-specific keys are added.

### 4.5 Unknown-unknown discovery system

- Review current-deployment Vercel errors every morning and after each release.
- Review PostHog exception groups and consented session recordings for Map, Plan, and contribution failures.
- Add a short optional feedback action after a failed Plan and after an unknown-price venue view. Do not collect free text through analytics.
- Conduct five observed Londoner sessions, five tourist sessions, and five group-organiser sessions at 390px and desktop.
- Record each problem as a reproducible GitHub issue with route, viewport, consent state, account state, deployment ID, expected result, and actual result.
- Do not turn one interview statement into a product fact. Confirm with behaviour or repeated evidence.

---

## 5. Data required next

### 5.1 Fresh London Pint Prices

Priority: **highest**

Required fields per observation:

- Canonical Venue ID.
- Drink category and named drink when known.
- Amount in pence.
- Observation date and time.
- Contributor actor or named official publisher.
- Source URL for publisher observations.
- Venue and source match evidence.
- Moderation state.

Collection rules:

- A contributor records what they saw at the bar.
- Do not seed Community Prices to make a surface look populated.
- Two independent, fresh contributors are required before a Community Price can paint the Map.
- Legacy anonymous rows cannot create authority.
- A hidden row leaves the sheet, candidate set, and corroboration count through one filter.
- Start with 50 high-demand London venues across ten Night Areas, with two independent observations per target venue and category where possible.
- Expand borough coverage only after the first 100 valid observations pass moderation and duplicate checks.

### 5.2 Comparable-price model dataset

Do not turn on public estimates until each model segment has:

- At least 30 comparable current observations.
- Drink category.
- Night Area or borough.
- Venue class.
- Verified observation date.
- Train and validation split that avoids venue leakage.
- Mean absolute error at or below £0.50.
- An 80% prediction interval that meets its coverage target.

The model must be deterministic. Generative AI must not create prices.

### 5.3 Venue essentials

For each launch-priority venue, collect:

- Current trading status.
- Official name and canonical slug.
- Address and coordinates.
- Opening hours and evidence date.
- Age or door policy where officially published.
- Step-free entrance and step-free toilet as separate observations.
- Booking status and official booking URL.
- Menu or official drink-price source when public.
- Nearest station and route-home state.
- Venue class and Night Area.

Unknown must remain unknown. A single old accessibility report cannot become a confirmed venue fact.

### 5.4 Out and event supply

Required event record:

- Provider event ID.
- Title, start, and end.
- Venue name, address, and coordinates.
- Canonical PUBMAXX Venue ID when matched.
- Provider and attribution URL.
- Retrieval time and provider expiry.
- Event category and age restriction when supplied.

Work required:

- Audit Ticketmaster rows before filtering and after canonical venue matching.
- Measure provider-to-Venue match rate.
- Remove past or expired rows.
- Keep unmatched entertainment listings out of pub recommendations.
- Obtain Skiddle written commercial approval before using its key.
- Use Eventbrite only for owned-organisation events.

### 5.5 Product and growth data

Certify these events and dashboards from `docs/METRICS_FUNNEL.md`:

- Plan generated.
- Plan created or saved.
- Invite created, opened, accepted, and redeemed.
- Second participant committed.
- Planned Night completed.
- Recap viewed and shared.
- Repeat Plan.
- Pint Drop composer opened, submitted, and failed.
- Community Price submitted and newly trusted.
- Map useful state and Web Vitals.

North-star metric:

> Share of Planned Nights that reach at least two committed people.

Do not use Social page views as the north star.

### 5.6 SEO data

- Search Console queries, pages, countries, devices, impressions, clicks, click-through rate, and index coverage.
- Bing Webmaster index coverage.
- Sitemap submitted and discovered counts.
- Canonical and redirect errors.
- Venue pages with current useful evidence.
- Borough and drink pages with enough unique evidence to avoid thin content.
- One original London data story per week, sourced from publishable first-party or open data.

---

## 6. Keys, accounts, and owner access

Never commit a secret. Store server secrets in Vercel or the provider secret store. Keep browser keys public only when the provider defines them as publishable.

### 6.1 Present in Production

Value presence was checked without reading secret values.

| Capability | Environment names |
| --- | --- |
| Supabase Production Store | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, additional Vercel Supabase and Postgres integration variables |
| Admin and rate limits | `ADMIN_TOKEN`, `RATE_LIMIT_SALT` |
| PostHog browser analytics | `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST` |
| OpenRouter planning and moderation | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Event supply | `TICKETMASTER_API_KEY`, `EVENTBRITE_API_TOKEN` |
| Research and menus | `EXA_API_KEY`, `FIRECRAWL_API_KEY` |
| Walking routes | `ORS_API_KEY` |
| Scheduled jobs | `CRON_SECRET` |
| Web push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Optional Clerk identity | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |
| Community link | `NEXT_PUBLIC_DISCORD_INVITE_URL` |
| Demo control | `NEXT_PUBLIC_DEMO_CONTENT` exists; owner must verify Production value is off |

### 6.2 Missing, disabled, or not visible in Production

| Key or access | Needed for | Decision |
| --- | --- | --- |
| `PUBMAX_SOCIAL_FRIENDS_LAUNCH` | Primary Social navigation and open launch | Leave unset for live Social; set to `0` only for a full emergency rollback |
| `POSTHOG_PROJECT_API_KEY` | PostHog management and dashboard automation | Add scoped project access, not a personal all-project key |
| Search Console owner access | Index certification and query data | Owner action |
| Bing Webmaster owner access | Bing sitemap and index certification | Owner action |
| GitHub Actions billing or runner allocation | Required hosted checks | Owner action, highest platform priority |
| `SKIDDLE_API_KEY` | Additional events | Add only after written commercial approval |
| `TFL_APP_KEY` | Higher TfL rate limits | Optional until rate-limit evidence requires it |
| `SOCIAL_CONNECTION_ENCRYPTION_KEY` | Durable external Social tokens | Required before provider connections launch |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X connection | Add only with approved provider application |
| `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` | Instagram connection | Add only with approved provider application |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok connection | Add only with approved provider application |
| `ELEVENLABS_API_KEY`, agent and voice IDs, shared secret | Pub Pal push-to-talk | Deferred under #282 |
| `NEXT_PUBLIC_UBER_CLIENT_ID` | Optional ride handoff | Add only if the transport product requires it |
| `OPENAI_API_KEY` | Direct OpenAI moderation or model path | Do not add while OpenRouter satisfies measured needs |
| `PLAN_IDEMPOTENCY_SECRET` | Explicit Plan idempotency signing | Audit current fallback, then add a rotated Production secret if required |
| `NEXT_PUBLIC_SITE_URL` | Explicit canonical public origin | Add `https://pubmaxxing.com` if the runtime does not already derive it safely |

### 6.3 Store accounts and certificates

Owner actions under #390:

- Apple Developer enrolment.
- Google Play Console enrolment.
- Apple signing certificates and provisioning.
- Android upload keystore.
- App Store Connect and Play Console records.
- APNs credentials.
- Universal Links and Android App Links evidence.
- Store privacy and alcohol-age questionnaire confirmation from `docs/STORE_READINESS.md`.

---

## 7. MECE execution plan

Each phase has one outcome and one release gate. Do not start a later phase to avoid an earlier failing gate.

### Phase 0: Restore continuous integration

Outcome: hosted checks run normally and branch protection no longer requires temporary admin-enforcement changes.

**Files:** `.github/workflows/*`, branch protection only if check names change, no product code unless a real check fails.

- [ ] Owner fixes GitHub Actions billing or runner allocation.
- [ ] Re-run CI, Browser tests, and RLS tests on current `main`.
- [ ] Confirm validation, lint, typecheck, coverage, build, browser law, migration, freshness, performance, and UX checks produce logs.
- [ ] Fix any real failure with a reproduction and focused PR.
- [ ] Confirm all 12 required contexts pass without bypass.

Commands:

```bash
npm run verify
npm run ci
npm run test:rls
```

Done when: one protected PR merges normally with all required checks green.

### Phase 1: Prove the Pint Drop trust loop

Outcome: real signed-in users create durable Pint Drops and Community Prices without weakening authority.

**Primary files:** `components/map/PintDropComposer.tsx`, `components/map/usePintDrops.ts`, `app/api/pint-drops/route.ts`, `app/api/price-submit/route.ts`, `lib/pintDropsStore.ts`, `lib/communityPriceStore.ts`, `lib/communityPrice.ts`.

- [ ] Run one signed-in production Pint Drop with a real bar observation.
- [ ] Confirm `pint_drops` increases and `structured_visit_reports` does not.
- [ ] Confirm author identity uses the account-owned profile actor.
- [ ] Confirm the first report marks but does not paint the Map.
- [ ] Collect a second independent fresh observation for the same venue and category.
- [ ] Confirm corroboration count becomes two and Map authority changes only then.
- [ ] Confirm report, hide, restore, audit, and privacy paths.
- [ ] Recruit a controlled first cohort to reach 100 valid observations across 50 priority venues.

Tests:

```bash
npx vitest run __tests__/pintDrops.test.ts __tests__/pintDropUserFlow.test.ts
npx vitest run __tests__/communityPrice.test.ts __tests__/communityPriceModeration.test.ts
```

Done when: Production has at least one verified two-person price cluster, no anonymous authority, and no schema or moderation error.

### Phase 2: Restore useful Out supply

Outcome: Out answers with venue-matched current London rows or a precise empty state with an actionable supply finding.

**Primary files:** `app/api/out/route.ts`, `app/api/whats-on/route.ts`, `lib/whatsOnStore.ts`, `scripts/refresh_whats_on.mjs`, provider adapters under `lib/events/`.

- [ ] Record counts at provider retrieval, date filtering, city filtering, and Venue matching.
- [ ] Identify whether zero rows come from provider supply, date parsing, attribution, or canonical venue matching.
- [ ] Add a failing regression for the actual loss point.
- [ ] Repair the minimum adapter or matcher.
- [ ] Prove past events do not serve.
- [ ] Prove unmatched theatre rows do not become pub recommendations.
- [ ] Certify attribution and provider terms before public promotion.

Tests:

```bash
npx vitest run __tests__/outRoute.test.ts __tests__/outDesktopGrouping.test.ts
npx vitest run __tests__/whatsOn*.test.ts
```

Done when: seven consecutive days produce either useful matched rows or a named, monitored provider-empty result.

### Phase 3: Certify the full group-night journey

Outcome: organiser and guest complete one Planned Night across two browsers.

**Primary files:** `components/plan/*`, `app/api/plans/*`, `app/invite/[token]/*`, `lib/planCollaborationStore.ts`, `lib/planStore.ts`.

- [ ] Guest creates and inspects a draft Plan.
- [ ] Guest signs up and atomically claims the same Plan.
- [ ] Host shares by WhatsApp, Copy, private invite, and Open Crew where enabled.
- [ ] Guest acceptance produces one canonical membership without duplicate RSVP-only state.
- [ ] Host removes a member and rotates the invite.
- [ ] Member leaves and loses revoked capabilities.
- [ ] Plan records final Crawl Stop and Crawl Ending exactly once.
- [ ] Recap shows consent-cleared statistics and Plan again action.
- [ ] Offline, retry, replay, and concurrent revision cases pass.

Tests:

```bash
npx playwright test e2e/plan-invite.spec.ts --workers=1
npx playwright test e2e/plan-loop.spec.ts --workers=1
npx playwright test e2e/crews-and-people.spec.ts --workers=1
```

Done when: Production records at least one consented real `plan_completion`, one second participant, and no capability leak.

### Phase 4: Certify analytics and growth loops

Outcome: PostHog answers acquisition, activation, contribution, completion, and retention questions without PII.

**Primary files:** `lib/analyticsEvents.ts`, `lib/analytics.ts`, `app/api/events/route.ts`, `docs/METRICS_FUNNEL.md`.

- [ ] Add scoped `POSTHOG_PROJECT_API_KEY` or complete dashboards manually.
- [ ] Certify events and property schemas against `lib/analyticsEvents.ts`.
- [ ] Build dashboards for acquisition, Map useful state, Plan activation, invite conversion, crew commitment, completion, repeat Plan, contribution trust, Web Vitals, and exceptions.
- [ ] Mark release `cce648fe3` and current Vercel deployment.
- [ ] Exclude staff and test accounts.
- [ ] Confirm consent denial sends no analytics.
- [ ] Publish a weekly review with counts, conversion, top drop-off, and one action.

Done when: the north-star crew-night rate and first Pint Drop funnel can be answered from certified dashboards.

### Phase 5: SEO and first-cohort launch

Outcome: qualified London visitors reach useful evidence pages and complete the core loop.

**Primary files:** sitemap and metadata routes, venue and borough pages, `docs/STORE_READINESS.md`, launch runbook under `docs/`.

- [ ] Verify Search Console and Bing ownership.
- [ ] Submit sitemap and confirm canonical host.
- [ ] Inspect structured data and redirects from opaque legacy URLs.
- [ ] Index only pages with current useful evidence.
- [ ] Run five Londoner, five tourist, and five organiser sessions.
- [ ] Pilot five London creators with first-party data packs and tracked links.
- [ ] Pilot five to ten venues with update tools and demand reporting.
- [ ] Keep payment separate from organic rank.
- [ ] Publish one original London data story each week.

Done when: first cohort creates measurable Plans, a second participant joins, and at least one real contribution enters the trust loop.

### Phase 6: Social launch decision

Outcome: Social is live by default; `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` is the full emergency rollback.

**Primary files:** `lib/socialLaunch.ts`, `lib/trustedHandoffFlags.server.ts`, `components/nav/MobileTabBar.tsx`, `components/nav/SiteNav.tsx`, `components/social/*`, Social API routes.

- [ ] Clear the one pending moderation job through the moderator workflow.
- [ ] Prove host queue, join, decline, remove, leave, close, abuse, and privacy paths.
- [ ] Prove public Open Crew viewing remains account-free.
- [ ] Confirm exact location stays private and off by default.
- [ ] Configure `SOCIAL_CONNECTION_ENCRYPTION_KEY` before external provider tokens.
- [ ] Complete provider approval before enabling X, Instagram, or TikTok connections.
- [ ] Run a controlled cohort and measure useful crew activation, not Social page views.
- [ ] Leave `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset for live Social; set it to `0` only for a full emergency rollback, then redeploy and capture both viewport proofs.

Done when: Social creates committed group nights, moderation remains within service level, and no private data appears in public reads.

### Phase 7: Performance and 24-hour canary

Outcome: core journeys meet release budgets under real field conditions.

- [ ] LCP P75 below 2.5 seconds.
- [ ] INP P75 below 200 ms.
- [ ] CLS P75 below 0.1.
- [ ] Warm navigation P95 below 300 ms.
- [ ] Mobile Map useful state below 3 seconds on the tested mid-tier profile.
- [ ] Last-train response below 2 seconds at P95 or returns a bounded honest fallback.
- [ ] No new critical error for 24 hours.
- [ ] Freshness audit reports no unresolved required feed.
- [ ] Production schema matches migration ledger.

Done when: Vercel and PostHog release dashboards hold all budgets for a 24-hour canary.

### Phase 8: Native store readiness

Outcome: issues #390, #437, and #443 close with device and store evidence.

- [ ] Complete Apple and Google enrolment.
- [ ] Produce signed iOS and Android builds.
- [ ] Verify authentication, deep links, push, camera, location, consent, and account deletion on real devices.
- [ ] Capture both themes and required store sizes from the wrapped build.
- [ ] Complete privacy, alcohol, and age questionnaires honestly.
- [ ] Submit only after London web activation and data trust pass.

Done when: store builds pass review evidence and do not create a second product contract.

### Phase 9: Post-London milestones

Outcome: expand only after London evidence and capability gates.

- [ ] #287: complete discover-to-recap loop in all nine cities with honest unavailable states.
- [ ] #282: certify Pub Pal push-to-talk with privacy, grants, quota, fallback, and trace evidence.
- [ ] #252: execute The Local retention specification as separate independently testable slices.
- [ ] #727: reduce store duplication only where policy and semantics are identical.

Done when: each milestone has an assigned owner, rollout flag, rollback path, data supply, and acceptance evidence.

---

## 8. Open issue disposition

| Issue | Classification | Next action | Closure evidence |
| --- | --- | --- | --- |
| #727 | Deferred architecture | Apply narrow store cleanup after product activation | Reduced duplication with unchanged policy tests |
| #443 | Owner and native evidence | Refresh wrapped-build proof | Both themes and required device sizes on signed build |
| #437 | Native milestone | Finish app-store-ready frontend | Wrapped journey and store visual proof |
| #392 | Owner launch operations | Execute first-user runbook | Search, sitemap, demo-off, analytics, and cohort evidence |
| #390 | Owner credentials and cost | Enrol Apple and Google accounts | Certificates, keystore, store records, accepted evidence |
| #287 | Post-London product milestone | Assign owner after London gates | Complete nine-city night loop |
| #282 | Deferred voice milestone | Keep typed Pub Pal primary | Approved push-to-talk release evidence |
| #252 | Strategic product specification | Break into scoped releases | Each Local slice produces measurable retention value |

Do not close an owner-action issue because code exists. Close it only when external evidence exists.

---

## 9. Release and operating procedure

### Before every PR

- Fetch `origin/main` into a clean isolated worktree.
- Read `AGENTS.md`, all `CONTEXT.md` files, and the relevant domain tests.
- Reproduce the defect as a real user.
- Write a failing regression.
- Keep one coherent responsibility per PR.
- Use at most two subagents and only for independent file ownership.

### Before every merge

```bash
npm run validate-data
npm run lint
npm run typecheck
npm run coverage
npm run build
```

Use targeted commands during implementation. Run the full set only with memory headroom and no parallel build.

### Before Production

- Open PR count is zero for the release set.
- Required migrations are applied before compatible code.
- Build comes from clean `origin/main`.
- `/api/version` identifies the candidate deployment.
- Preview smoke passes on home, Map, Plan, Out, Today, Tonight, Pint Drops, and What’s On.
- Mobile 390x844 and desktop 1440x900 browser proofs pass.
- Signed-out and signed-in contribution states are correct.
- No new schema error, private-data leak, or price-authority violation exists.

### After Production

- Confirm aliases point to the new deployment.
- Confirm `/api/version` changed.
- Test signed-out Pint Drop write returns 401.
- Test one signed-in read and write without creating fake observations.
- Inspect Vercel build and runtime errors.
- Inspect PostHog exceptions and Web Vitals.
- Hold a 24-hour canary before declaring a release stable.

---

## 10. Definition of the next successful milestone

The next milestone is not another large feature set. It is this measured result:

- At least one real two-person group creates, joins, completes, and recaps a Planned Night.
- At least one real signed-in Pint Drop persists in Production.
- At least one Community Price reaches two independent fresh observations and correctly gains Map authority.
- Out shows current venue-matched London supply or a monitored provider-empty result.
- PostHog can show the complete activation funnel without PII.
- GitHub protected checks run and pass normally.
- No new critical error appears during a 24-hour canary.

Once this result holds, continue Social canary evaluation and native store evidence. Until then, improve activation, trust, data supply, and reliability before adding product breadth.
