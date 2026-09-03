# PUBMAXX Master Product Requirements Document

**Status:** Canonical product and delivery contract

**Version:** 1.0

**Date:** 2026-07-16

**Target:** Mobile-web v1 in August 2026, followed by the complete gated programme
**Vocabulary authority:** [`CONTEXT.md`](../CONTEXT.md)

This document is the sole roadmap for PUBMAXX. Older PRDs remain useful evidence,
history, or specialist appendices only as classified in the crosswalk below. When
an older document conflicts with this one, this document wins. `CONTEXT.md`
continues to own canonical language and domain definitions; accepted ADRs continue
to own architectural decisions unless this document explicitly requires a new ADR.

## 0. Executive contract

PUBMAXX helps adults turn affordable time out into moments worth remembering:
discover a place that fits now, coordinate the night, arrive with confidence,
capture what happened, share it with consent, and make the next night easier.

The product celebrates friendship, exploration, culture, side quests, and memory.
It never measures a good night by alcohol quantity, rewards intoxication, or hides
evidence limitations behind confident copy.

### V1 hierarchy

1. **London flagship.** The deepest price, event, route, transport, heritage, and
   neighbourhood experience.
2. **Nine-city core parity.** London, Manchester, Liverpool, Oxford, Durham,
   Glasgow, Bristol, Cambridge, and Bath share one discover-to-return journey.
3. **Honest previews.** Provider-dependent or evidence-incomplete capabilities
   remain labelled previews until their release gates pass.
4. **Mobile website first.** V1 is responsive mobile web. Native applications are
   deliberately outside the August release.

### Binding product decisions

- The brand is **PUBMAXX**, always with two Xs. The activity is **Pubmaxxing** and
  a community member is a **Pubmaxxer**.
- Coral is the primary identity and action accent. Light and dark modes use the
  same semantic system, with limited city, mood, event, and Pub Pal accents.
- Futurism comes from spatial maps, atmospheric colour, translucent materials,
  purposeful motion, and responsive data. Production does not use humanoid
  cyberpunk characters.
- Pub Pal is optional, account-owned, interruptible, and subordinate to the shared
  factual, recommendation, moderation, and safety engines.
- There are no streaks, freezes, drinking counts, or consumption-based rewards.
- PUBMAXX identity remains canonical. X, Instagram, and TikTok are optional
  integrations, never identity authorities.
- Supabase remains authoritative for v1. Convex is a reversible, server-only pilot
  until dual-read evidence proves parity.

## 1. The problem

The price of going out is rising while disposable income and planning energy are
falling. Useful information is fragmented across maps, venue pages, ticket sites,
group chats, transport apps, and social feeds. The organiser does unpaid work;
the joiner receives context too late; the morning after produces scattered photos
instead of a shared memory.

PUBMAXX compresses that coordination cost without turning the night into an
optimisation spreadsheet. Price is the wedge, not the whole product. The durable
value is a trusted loop connecting real-world discovery, coordination, presence,
memory, and social return.

## 2. Users and jobs

### The organiser

Needs to turn constraints into a credible Plan, explain it quickly, collect
commitments, change course without chaos, and get everyone home.

### The joiner

Needs one link that answers where, when, price, vibe, travel, and who is going,
without being forced through account creation before receiving value.

### The explorer

Needs nearby places and side quests suited to time, mood, budget, accessibility,
and transport—even when they are alone or visiting another city.

### The storyteller

Needs drafts that survive interruption, private memories by default, contributor
consent, and public Stories that feel expressive without copying another platform's
visual trade dress.

## 3. Product loops

### Loop A — Discover and plan

Map or Tonight → city/daypart/mood → evidence-aware venue or route → Planned Night
→ share/invite.

The first useful result remains keyless. The product earns an account when durable
identity, collaboration, memory, or Pub Pal ownership becomes valuable.

### Loop B — Navigate and experience

Open Plan → choose travel mode → arrive at a stop → see relevant route, price,
event, and get-home information → adapt the Plan through confirmed actions.

### Loop C — Capture and recap

Create a Night Moment or Pint Drop → preserve it privately → complete the Plan with
a Crawl Ending → generate an editable recap → obtain contributor approval → publish
or keep private.

### Loop D — Share, connect, and return

Share a crawl, recap, Moment, or Story → receive a response or invitation → collect
places, quests, mastery, and memories → commit to another night.

## 4. Information architecture and experience contract

The same five jobs appear on mobile and desktop:

1. **Map** — price-aware discovery, routes, transport, distance, and layers.
2. **Tonight** — time-sensitive events, moods, side quests, and nearby opportunities.
3. **Moment** — capture a Pint Drop or another private Night Moment.
4. **Stories** — relive approved nights and discover public community Stories.
5. **You** — canonical identity, Pub Pal, Moments, Passport, saved places, privacy,
   connected accounts, and settings.

Map-specific actions such as Prices, Ask your Pub Pal, Layers, and transport status
remain contextual controls, not extra global destinations. Mobile sheets and actions
must clear the persistent tab bar and browser safe areas at 390×844 and 430×932.

## 5. North star and metric tree

### Planned Nights Completed (PNC)

Count one PNC only when all of the following are true:

- a canonical Planned Night exists;
- at least one Plan arrival was recorded through the authorised Plan lifecycle;
- a host explicitly chooses Food, Get Home, or Keep Going;
- the idempotent completion write succeeds for the active route revision.

Repeated requests, recap views, status changes, and unqualified endings do not add
another completion.

The idempotent `plan_completions` row is the authoritative PNC event. Browser
telemetry is never the counter because a committed write can outlive a lost response.
PostHog may receive PNC only through a future server outbox keyed by completion ID.
Operators aggregate the service-role-only `pnc_qualified_completions` view described
in `docs/PNC_OBSERVABILITY_RUNBOOK.md`; it excludes legacy rows that lack a qualifying
arrival or explicit ending selection and exposes no user identity or free text.

### Supporting metrics

- **Activation:** useful discovery, Plan created, invite sent/opened, crew committed.
- **Experience quality:** arrival recorded, route changed safely, get-home viewed,
  Moment saved, completion with valid ending.
- **Retention:** next-night commitment, collection/quest/mastery progress, memory
  return, social response, repeat PNC.
- **Virality:** public link opened, share-to-Plan conversion, contributor joined.
- **Guardrails:** error rate, denied permissions, stale evidence exposure, moderation,
  alcohol-quantity event absence, provider failure, deletion/export success.

PostHog EU is the product-interaction analytics authority; the durable completion
ledger remains the PNC authority. Vercel owns deployment/runtime logs,
pageviews, and Web Vitals. Arize Phoenix receives only redacted Pub Pal AI traces and
evaluations. No anonymous identifier is created or persisted and no product event is
forwarded to PostHog, Vercel Analytics, Arize, or any other analytics destination
until the user explicitly consents. Withdrawing consent stops future persistence and
forwarding, removes the local anonymous identifier, and exposes the documented
provider process for deleting previously collected pseudonymous analytics data.
Analytics properties are closed, low-cardinality, and never contain
handles, names, email addresses, free text, messages, voice content, or precise
coordinates.

## 6. Design system

### Colour and material

- Coral communicates the primary action, selection, and brand pulse.
- Neutral surfaces carry structure. Remove brown wash from dark mode and preserve
  legible roads, buildings, labels, pins, routes, and selected states.
- Accent worlds are semantic and bounded: city, daypart, event, mood, and Pal.
- Glass and translucency require solid reduced-transparency fallbacks.

### Motion

Motion communicates hierarchy, spatial movement, continuity, or feedback. Use
critically damped springs for interface movement, preserve native scrolling, and
disable autoplay/parallax/pinned effects under reduced motion. Map loading never
flashes a blank canvas or repeatedly re-fits after the user begins interacting.

### Mobile quality floor

- No horizontal overflow, clipped sheets, competing sticky bars, or bottom-nav
  overlap.
- Minimum 44px targets, visible focus, WCAG AA contrast, and screen-reader order.
- Light, dark, reduced-motion, reduced-transparency, and increased-contrast modes.
- Warm navigation P95 below 300ms, INP below 200ms, CLS below 0.1, and LCP below
  2.5 seconds on the agreed representative mobile profile.

## 7. System and data architecture

### Rendering and caching

- Launch keeps the current per-request nonce CSP and dynamic HTML rendering.
  The [CSP and caching decision brief](evidence/csp-vs-caching.md) owns the
  post-launch choice between retaining that boundary and prototyping static
  public routes with hash-based CSP.
- Authentication, owner profiles, private memories, and Pub Pal remain
  private/no-store under either public-route decision.
- Serve versioned city-scoped slim map data with CDN caching, ETags,
  stale-while-revalidate, and visible freshness.
- Never cache secrets, precise location history, voice transcripts, unapproved
  memories, or private drafts in shared caches.

### Persistence

- Supabase remains the production system of record and server routes remain the
  authorisation boundary.
- Keyless local stores remain honest fallbacks, not replicas of durable production.
- A Convex pilot may implement typed server functions and dual-read comparison.
  Cutover requires measured parity, reversible routing, and no direct privileged
  browser-to-database access.
- Moment draft text and metadata use a versioned browser contract. Temporary media
  uses IndexedDB/object references, not localStorage.

### Abuse and reliability

- Consequential writes, including production Plan creation, fail closed when durable
  rate limiting is unavailable.
- Keyless Plan creation may use a process-local budget only in non-production,
  Supabase-unconfigured development: at most eight attempts per hashed IP per rolling
  60 seconds. This exception never applies to a configured or production outage.
- Public reads remain available with bounded abuse controls.
- Every provider integration has timeout, rate, quota, failure, disable, and native
  fallback behaviour.

## 8. City capability contract

Every enabled city exposes a `CityCapabilityProfile` covering prices, events,
routes, transport, heritage, evidence freshness, and release tier. UI copy and
available actions derive from this profile rather than city-name conditionals.

London is `flagship`. Other cities are `core` until each evidence dimension earns
promotion. Missing evidence produces a useful alternative and explanation; it never
produces synthetic prices, invented events, or an unexplained empty state.

The release-defining journey is:

`discover → plan → invite → arrive → capture → complete → recap → share/save → return`

## 9. Social identity and memories

- Account-owned immutable user IDs remain the root of identity truth. Handles and
  aliases are account-owned but mutable under the canonical rename and alias-retention
  policy; connected providers never become identity authorities.
- A versioned Night Profile stores account-owned planning preferences without precise
  location history, voice content, secrets, or unapproved Pal memories. Anonymous
  preferences remain device-local; bringing them into an account always requires an
  explicit merge choice and an optimistic-concurrency token.
- You presents identity and social proof before account machinery.
- Night Memories are private by default. Night Stories are deliberate publications.
- Contributor likeness and Moments require affirmative consent; withdrawal removes
  the material from future public renders without deleting the private original.
- X, Instagram, and TikTok use a provider capability matrix: public link, compliant
  connection, consented discovery, permitted publishing, and native share fallback.
- Provider availability is derived server-side from complete credential configuration.
  The client never guesses that an OAuth capability exists; manual profile links remain
  separate from provider authentication.
- No password capture, browser automation, or silent cross-posting.
- Retention uses responses, friends, collections, quests, mastery, lore, memories,
  and next-night commitments. Alcohol quantity never creates progress.

## 10. Pub Pal voice and intelligence

Pub Pal remains a curated hound, raven, or fox owned by an authenticated adult. A
person controls its name, appearance, voice, personality, relationship style,
visibility, approved memories, and mute/delete state.

- Typed conversation always remains available.
- Voice is user-initiated push-to-talk, never always-listening.
- The browser receives only a short-lived ElevenLabs conversation grant issued by
  an authenticated server endpoint.
- Provider configuration disables audio saving and uses zero-day/zero-retention
  settings where the account tier supports them.
- Plan changes, invitations, posts, privacy changes, and memory writes return a typed
  proposal plus one-use confirmation token before mutation.
- Only individually approved typed facts become Pal Memory. Raw audio, transcripts,
  and generated prose never do.
- Arize records redacted operation type, tool/result category, latency, cost, error,
  and evaluation tags. Production, staging, and evaluation projects are separate.

## 11. Delivery waves and gates

### Wave 0 — Trust and observability

Baseline the production mobile defects; configure PostHog EU, Vercel metrics, and
Arize AI telemetry; remove streak telemetry; formalise PNC; complete risk-tiered
rate limiting. Gate: observable failures, honest measurement, no unlimited writes.

### Wave 1 — Mobile UI, map, and performance

Repair flicker, dark-map legibility, location denial, compact controls, sheet/nav
overlap, route presentation, CSP/ISR split, slim city payloads, prefetch, draft
recovery, and CI budgets. Gate: mobile matrix and performance budgets pass.

### Wave 2 — Nine-city night loop

Complete the shared core journey and capability-driven degradation in all nine
cities, with London receiving the deepest price/event/route/transport suite. Gate:
the end-to-end acceptance seam passes per city.

### Wave 3 — Social memory and return

Finish You, media grid, durable drafts, crawl/recap share pages, consent, kudos,
replies, discovery, collections, quests, mastery, and provider capability fallbacks.
The friends-only launch floor is `prd/SOCIAL_LAUNCH_PRD.md`. The post-launch
Night OS thesis (Wanted + reel paste, taste personality, Tonight snaps, Stories)
is `prd/SOCIAL_NIGHT_OS_VISION_PRD.md`. Gate: share-to-Plan is measurable and
consent withdrawal is correct.

### Wave 4 — Pub Pal concierge

Finish typed and push-to-talk assistance, server-issued grants, usage metering,
proposal confirmation, inspectable memory, Arize evaluation, and all text/provider
fallbacks. Gate: permission, quota, expiry, outage, and interruption cases pass.

### Wave 5 — Installability and release

Earn the PWA prompt only after demonstrated value. Keep push behind consent and
evidence flags. Promote a pinned commit only after both production hostnames pass
the live walkthrough and release evidence is attached to the Wayfinder map.

## 12. Public interfaces

Public product APIs use the flat, no-store `PublicApiError` contract: `error`, `code`,
`retryable`, and optional structured `details`. Legacy Heritage responses retain their
documented compatibility shape until a separately versioned migration.

- `CityCapabilityProfile` — city, release tier, feature evidence states, freshness.
- `PlannedNightCompletion` — Plan, actor, ending, time, qualifying arrival, route
  revision, terminal venue/final Moment, idempotency.
- `MomentDraftV1` — version, owner scope, text/metadata, attachment references,
  timestamps, recovery state.
- `SocialProviderCapability` — provider, connection, link, discovery, publishing,
  consent scopes, fallback.
- `VoiceSessionGrant` — short-lived grant, expiry, allowance, connection type,
  privacy mode.
- `PubPalProposal` — action, readable diff, risk class, expiry, one-use confirmation.
- `PubPalMemoryProposal` — typed fact, provenance, confidence, visibility, approval.
- `AITraceContext` — pseudonymous session, operation, result category, latency, cost,
  error, evaluation tags.

Existing `DrinkCategory`, public routes, map query semantics, price meanings, Plan
route contracts, and server authorisation boundaries remain compatible.

## 13. Verification contract

Every release wave runs focused unit/API/component tests, `npm run lint`,
`npm run typecheck`, `npm test`, `npm run verify`, an isolated production build,
and the relevant mobile Playwright/visual suites.

The full release matrix includes:

- 390×844 and 430×932 mobile light/dark, plus London desktop widths;
- the nine-city core journey and London deep scenarios;
- keyboard, screen reader, focus, contrast, reduced preferences, and target size;
- denied location/microphone/orientation, offline, slow network, WebGL loss;
- expired tokens, provider/quota outages, missing city evidence, deletion/export;
- CSP separation, OAuth state/PKCE, server-only secrets, confirmation tokens;
- exact production commit on `pubmaxxing.com` and `www.pubmaxxing.com`.

## 14. Operating model

- The Wayfinder parent issue is the programme map. Child issues own delivery state.
- Every child names its owner, dependencies, acceptance seam, observability proof,
  feature flag, and disable/rollback path.
- No product-surface merge occurs without focused tests, two-axis code review, owner
  walkthrough evidence, and exact post-deployment commit verification.
- Preview status is visible to users and reversible. A preview never relaxes privacy,
  factuality, moderation, accessibility, or alcohol-safety constraints.

## 15. Legacy PRD and Wayfinder crosswalk

| Document | Classification | Material retained here or elsewhere |
|---|---|---|
| `CURRENT_IMPLEMENTED_STATE_PRD.md` | Superseded snapshot | Historical implementation evidence only |
| `DESIGN_LANGUAGE_AND_NEXT_FEATURES_PRD_2026-07-08.md` | Absorbed | Provenance, rhythm, and interaction guidance |
| `FABLE_PRODUCTION_AND_BROAD_APPEAL_PRD.md` | Absorbed | Broad-appeal and production defects |
| `CYCLE15_PRD.md` | Authoritative appendix | Living London layer: fresh-facts dataset, Tonight Conditions, Social Loop v1, native readiness, anti-slop enforcement |
| `PERSONA_DRINKS_AND_DESKTOP_PRD.md` | Authoritative appendix | Desktop parity lanes + sourced persona-drinks discovery lens with endorsement guardrails |
| `grok_prd.md` | Execution rationale | Reasoning behind Firstmate backlog items; not a second queue |
| `IOS_APP_PRD.md` | Authoritative appendix | iPhone-app build/activation contract; native shell over this PRD's web product |
| `FIRST_PRINCIPLES_MAP_SOCIAL_PRD.md` | Absorbed | Map/social first-principles framing |
| `MASTER_FEATURES_ROADMAP_PRD.md` | Superseded | Feature inventory reconciled into waves |
| `NEXT_WAVE_FEATURES_AND_DESIGN_PRD_2026-07-08.md` | Absorbed | Mobile and provenance principles |
| `PRD_ALL_DRINKS.md` | Authoritative appendix | Drink-family domain expansion; no taxonomy fork |
| `PRD_CANONICAL.md` | Superseded | Earlier engineering baseline; this PRD wins |
| `PRD_CURRENT_STATE_AND_COMPLETION_2026-07-08.md` | Superseded snapshot | Completed-work evidence only |
| `PRD_CYCLE_TRUST_TONIGHT.md` | Authoritative appendix | Trust/Tonight data governance and shipped work |
| `PRD_ENDGAME_TRUST_SOCIAL_ROADMAP_2026-07-07.md` | Absorbed | Security/social backlog |
| `PRD_FOR_FABLE.md` | Authoritative appendix | Visual review evidence and design bar |
| `PRD_MAP_TASTE_FLUIDITY_WAVE_2026-07-09.md` | Implemented | Shipped map/taste wave evidence |
| `PRD_MEMORY_SHARE_OUTER_LONDON_WAVE_2026-07-09.md` | Absorbed | Sharing and coverage requirements |
| `PRD_MEMORY_TIMELINE_SOCIAL_UX_WAVE_2026-07-09.md` | Absorbed | Timeline, messages, and performance |
| `PRD_MOBILE_FIRST_NEXT_WAVE_2026-07-08.md` | Absorbed | One-handed mobile journey requirements |
| `PRD_MOMENT_TO_STORY.md` | Authoritative appendix | Consent and publication journey contract |
| `PRD_NEXT_FEATURE_WAVE_2026-07-09.md` | Superseded | Remaining items reclassified by current waves |
| `PRD_NEXT_FEATURE_WAVE_L_2026-07-09.md` | Superseded | Remaining items reclassified by current waves |
| `PRD_NEXT_WAVE.md` | Absorbed | Salvage and flagship lane evidence |
| `PRD_NEXT_WAVE_2026-07-07.md` | Superseded | QA findings carried into Wave 1 |
| `PRD_OUTER_LONDON_COVERAGE.md` | Authoritative appendix | Coverage gates and evidence policy |
| `PRD_PLACE_DRINK_FOOD_NEXT_WAVE_2026-07-08.md` | Absorbed | Food/place context and admin boundaries |
| `PRD_PUBMAXX_UNIFIED_PRODUCT_2026-07-15.md` | Absorbed | Current identity, navigation, memory, and Pal contract |
| `PRD_SEARCH_GROWTH_2026-07-16.md` | Authoritative appendix | SEO/GEO integrity and search roadmap |
| `PRD_SORT_MY_NIGHT_V1.md` | Authoritative appendix | Keyless wedge and Plan flagship thesis |
| `PRD_STICKINESS_MEMORY_WAVE_2026-07-08.md` | Absorbed | Memories and return loop, excluding streaks |
| `PRD_UI_NEXT.md` | Superseded | Design evidence retained; roadmap replaced |
| `PRD_UK_MULTI_CITY_MAPS_2026-07-09.md` | Absorbed | Nine-city foundation and dossiers |
| `PRD_WHATS_ON.md` | Authoritative appendix | Shipped data governance; remainder in Tonight wave |
| `PRD_WORKTREE_COMPLETION_AND_REVIEW_2026-07-07.md` | Superseded snapshot | Historical worktree/review evidence |
| `PRD_YOU_PUB_PAL_SOCIAL_PROFILE_2026-07-15.md` | Authoritative appendix | Owned profile and Pal implementation seam |
| `prd/PUBPAL_CONNECTIONS_PRD.md` | Authoritative appendix | PubPal voice, get-home ride handoff, and food-ending connection packages |
| `prd/SOCIAL_LAUNCH_PRD.md` | Authoritative appendix | Friends-only social launch and uploaded, pre-publish-moderated profile pictures; captain decisions D1-D3 locked |
| `prd/SOCIAL_NIGHT_OS_VISION_PRD.md` | Draft vision appendix | Post-launch social Night OS: Wanted + reel paste import, taste personality, friends-only Tonight snaps, Night Stories, kudos; sits on Social Launch floor |
| `prd/UK_MAP_COVERAGE_AND_SEARCH_PRD.md` | Draft execution appendix | National UK pub search, intent classifier, Wikidata notable pubs, London bar densification roadmap; never merge base into slim |
| `prd/UI_UX_FIX_PRD.md` | Authoritative appendix | Screenshot-audited UI/UX fix wave with mission preamble; one PR per numbered item |
| `PUBMAXXING_ULTIMATE_PRD_2026-07-07.md` | Superseded | Vision and personas reconciled here |
| `SECURITY_AND_RELIABILITY_PRD_2026-07-07.md` | Authoritative appendix | Threat model and control catalogue |
| `TASTEFUL_EVOLUTION_PRD_2026-07-08.md` | Absorbed | Density, belonging, and interaction taste |
| `THE_SPILL_FIRST_PRINCIPLES_PRD.md` | Superseded terminology | Social intent retained under Moment/Memory/Story |
| `UNIVERSAL_DAY0_PRD.md` | Authoritative appendix | Cycle 17 launch-week lane spec: morning brief, tonight, concierge, web push, category ingest |
| `WAYFINDER_PRODUCT_MAP_2026-07-20.md` | Authoritative execution map | Owner-locked wave sequencing reconciled against shipped main; explicit corrections supersede this PRD |
| `WAYFINDER_LIVE_DATA.md` | Authoritative appendix | Live-data cadence, activation matrix, and freshness-registry contract |
| `WAYFINDER_MOMENT_TO_STORY.md` | Authoritative appendix | Active consent delivery route |
| `WAYFINDER_PRD_PRODUCT_SECURITY_WAVE_MERGE.md` | Authoritative appendix | Security salvage audit trail |
| `WAYFINDER_YOU_PUB_PAL_2026-07-15.md` | Authoritative appendix | Active identity/Pal delivery route |
| `archive/OPUS_REVIEW_PRD.md` | Superseded archive | Historical review evidence |
| `archive/PRD_ADDENDUM_BUILD_REVIEW.md` | Superseded archive | Historical build review evidence |
| `archive/PRD_FABLE_FINAL_REVIEW_AND_LAUNCH.md` | Superseded archive | Historical launch brief |
| `archive/PRD_FINAL_FOR_FABLE.md` | Superseded archive | Historical design brief |
| `archive/PRD_MAP_FIRST_REDESIGN.md` | Superseded archive | Historical map redesign brief |
| `archive/PRD_OPUS_AFTER_MAP_UPGRADE_2026_07_06.md` | Superseded archive | Historical post-map review |
| `archive/PRD_OPUS_FINAL_POLISH_2026_07_05.md` | Superseded archive | Historical polish review |
| `archive/PRD_OPUS_NEXT_IMPROVEMENTS_2026_07_06.md` | Superseded archive | Historical improvement backlog |
| `archive/PRD_PINT_DROPS.md` | Superseded archive | Historical Pint Drop contract |
| `archive/PRD_PRODUCTION_READINESS_FOR_OPUS.md` | Superseded archive | Historical readiness review |
| `archive/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md` | Superseded archive | Historical social-memory proposal |

Files under `docs/archive/` are historical evidence and never implementation
authority. Root-level `sol2.md` and `implement.md` are uncommitted working notes;
verified decisions were absorbed here and the raw files must not be published.
