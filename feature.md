# PUBMAXX Complete Product and Feature PRD

**Status:** Living source document for Fable and future implementation agents

**Snapshot date:** 15 July 2026

**Repository:** `karanmrn/pubmax`

**Current integration branch:** `codex/mobile-integration-recovery`

**Product stage:** Working mobile-first web application with a broad production foundation and several incomplete vertical slices

## 1. Why this document exists

PUBMAXX has accumulated a large product surface, several design explorations, more than 260 pull requests, multiple roadmap documents, and a growing social and memory model. This document consolidates the product into one readable contract so Fable can propose a more ambitious plan without mistaking foundations for finished features or rebuilding things that already work.

This document combines:

- the founder's product philosophy and naming decisions;
- features proven in the current repository;
- foundations that exist but still need complete user journeys;
- design and architecture recommendations developed during audits;
- the visible Git and pull-request lineage available in this checkout;
- activation, retention, trust, safety, and performance requirements;
- a sequenced roadmap for the next implementation waves.

When this file conflicts with an older speculative PRD, use this file together with `docs/PRD_PUBMAXX_UNIFIED_PRODUCT_2026-07-15.md`. Security, privacy, data provenance, moderation, and factuality rules in the canonical documents remain binding.

## 2. The product in one sentence

PUBMAXX helps adults find a great-value place, shape an interesting night, bring people together, and keep the moments worth remembering.

## 3. The world PUBMAXX is building

Modern city life is expensive, fragmented, and increasingly mediated through feeds that encourage observation rather than participation. People still want spontaneous friendship, local discovery, stories, romance, laughter, music, and a sense that their city belongs to them. They often lack the time, local knowledge, price certainty, coordination tools, and confidence to make a good night happen.

PUBMAXX is not an alcohol consumption game. It is an experience and connection system built around the pub as one of Britain's most durable social spaces.

The product reframes a night out around:

- moments rather than units consumed;
- people rather than status;
- exploration rather than repetitive venue lists;
- price awareness rather than financial anxiety;
- memories rather than disposable content;
- side quests rather than rigid itineraries;
- verified local knowledge rather than invented recommendations;
- safe completion rather than endless drinking.

The emotional test is simple: years later, a user should be able to look back and think, “That was an epic night. I met the wildest people, found places I never knew existed, and I can still relive the best parts.”

## 4. First-principles problem definition

### 4.1 Human need

People need belonging, safety, esteem, play, discovery, and self-expression. A night out can satisfy several of those needs when it is affordable, consensual, inclusive, and well coordinated.

Maslow's hierarchy is useful as a design lens, not as a claim that alcohol itself satisfies human needs:

| Need | PUBMAXX response |
| --- | --- |
| Physical and practical | Food, transport, opening times, seating, accessibility, route length, price clarity |
| Safety | 18+ boundary, private-by-default memory, last-train information, route recovery, moderation, visible provenance |
| Love and belonging | Crews, rounds, invitations, shared plans, friends, collaborative Memories |
| Esteem | Useful contributions, trusted local knowledge, recognition, personal profiles, respectful progression |
| Self-actualisation | Exploration, city lore, side quests, storytelling, creative identity, a personal archive of lived experiences |

### 4.2 Market failure

The existing journey is split across map search, event sites, group chat, transport apps, social feeds, booking pages, and notes. Each tool optimises its own task. None owns the complete loop from “What should we do?” to “That night became part of our story.”

### 4.3 Product solution

PUBMAXX compresses that loop into one map-native system:

1. See live, relevant possibilities.
2. Understand price, atmosphere, events, food, distance, and transport.
3. Choose a Night Area, place, drink family, event, or mood.
4. Build or accept one understandable route.
5. Invite a crew and coordinate the night.
6. Record useful live evidence through Pint Drops and Moments.
7. Complete the night safely.
8. Keep a private Memory.
9. Deliberately shape selected Moments into a Story.
10. Return for the next side quest.

## 5. Language and naming contract

Consistency is a product requirement.

| Term | Meaning |
| --- | --- |
| **PUBMAXX** | The product and brand. Always two X characters. |
| **PUBMAXXING** | The act and culture of making more of a city night. |
| **PUBMAXXER** | A person who uses PUBMAXX to explore, plan, contribute, or remember. |
| **Pub Pal** | The user-owned planning companion and concierge. Never “Pet Pal” and never “The Landlord.” |
| **Night Area** | The canonical place-based nightlife district term. |
| **Pint Drop** | A time-stamped, source-aware field report about a drink, price, venue, or atmosphere. |
| **Moment** | One private atomic recollection, reference, photo, quote, event, person, venue, or side quest. |
| **Memory** | A private account-owned container for Moments from one experience. |
| **Story** | A deliberately edited, consent-aware publication built from selected Moments. |
| **Plan** | A proposed or active night route with stops and constraints. |
| **Round** | A live group session and shared presence context. |
| **Tonight** | Time-sensitive events, signals, deals, and opportunities relevant now. |

Avoid introducing competing labels for the same job. Existing public URLs remain stable even when visible terminology evolves.

## 6. Primary audiences

### 6.1 The spontaneous pair

Two people have an open evening and want a good first decision in under one minute.

### 6.2 The group organiser

One person absorbs the coordination cost for several friends and needs a route others can understand and join.

### 6.3 The price-conscious explorer

A user wants a cold beer, cocktail, wine, food, or event without discovering too late that the area is beyond budget.

### 6.4 The city side-quest seeker

A user wants unusual places, heritage, music, raves, quizzes, sport, hidden rooms, gardens, views, or local rituals.

### 6.5 The memory keeper

A user values photos, stories, people, and personal history more than public reach.

### 6.6 The visitor

A user wants the confidence of local knowledge with clear distance and transport choices.

### 6.7 The daytime PUBMAXXER

The system must also work for morning and afternoon use: riverside walks, lunches, heritage, markets, gardens, sport, alcohol-free choices, and a cold daytime beer.

## 7. Core product loop and north-star outcome

### 7.1 Core loop

**Discover → decide → plan → gather → experience → contribute → remember → share selectively → repeat**

### 7.2 North-star outcome

The preferred north-star is **worthwhile nights completed**, not drinks logged.

A worthwhile night can include:

- a plan accepted or meaningfully used;
- one or more places reached;
- a route completed or deliberately ended;
- a private Memory created;
- a useful contribution made;
- a crew member successfully coordinated;
- a Story later edited or shared.

### 7.3 Guardrail metrics

- no progression based on drink count, alcohol quantity, or spend;
- recommendation quality never depends on paid cosmetics;
- factual and safety controls cannot be disabled by Pal personality;
- private content never becomes public through a single ambiguous action;
- no sensitive conversational content in product analytics;
- no dark patterns around location, microphone, contacts, or social connections.

## 8. Current repository snapshot

At this snapshot the repository contains approximately:

- 149 files under `app`;
- 234 component files;
- 248 library files;
- 347 test files;
- 29 Supabase migrations;
- 113,000 lines across application TypeScript, TSX, and CSS;
- 80+ public pages and server routes;
- 120+ API route handlers;
- a 2,800-test Vitest suite in the latest verified integration commit.

The application is one Next.js 16 App Router service using React 19 and TypeScript. It runs keyless for core demonstration and tests, with memory stores standing in for external services where appropriate.

## 9. What is implemented now

“Implemented” means a route, component, domain model, persistence adapter, test contract, or verified runtime surface exists. It does not imply that every feature has a polished end-to-end UI.

### 9.1 Landing and shared shell

- Map-led homepage with a clear promise and primary route to city selection.
- Dark and light themes using shared semantic tokens.
- Space Grotesk display typography, Inter body typography, and JetBrains Mono for price and data moments.
- Five-job mobile navigation: Map, Tonight, Moment, Stories, You.
- Responsive desktop navigation with activity, messages, theme, and product routes.
- First-run tour with skip controls.
- Multi-city chooser and location-based suggestion.
- Consistent PUBMAXX naming in the current integration work.
- Current homepage has no humanoid cyberpunk characters.

### 9.2 Map and discovery

- MapLibre map with 3-D buildings, themed basemap, clustering, camera transitions, and map controls.
- London price-aware venue map and multiple UK city maps.
- Search by venue, area, borough, and drink context.
- Drink filters and price-band filtering.
- Pint price legend and clustered price markers.
- Selected-venue spotlight and visual de-emphasis of irrelevant POIs.
- Venue inspector with responsive mobile sheet and desktop treatment.
- Night Area, borough, landmark, historic pub, and crawl surfaces.
- City switching without remount-driven flicker.
- Empty-search recovery and honest explanations.
- Nearby suggestion remains opt-in.
- Layers for transport, parks, place stories, events, and other map context.
- Active Plan route lines and stop markers.
- Context-loss and low-power considerations in map architecture.

### 9.3 Prices, drinks, food, and provenance

- Canonical drink categories and expanded all-drinks data foundations.
- Pint prices with source, confidence, checked date, and freshness semantics.
- Price confirmation flow.
- Greene King, Nicholson's, Wetherspoons, and other chain enrichment foundations.
- Food menus and price information where provenance exists.
- Venue menu hub and booking links.
- Source-aware community price contributions through Pint Drops.
- “Honest zero” policy: the product should explain missing evidence rather than invent availability or certainty.

### 9.4 Tonight and live opportunity

- Dedicated Tonight route and map lane.
- Unified What's On data spine.
- Music, quizzes, sport, deals, and time-sensitive event rows.
- Event-aware Plan generation.
- Venue identity reconciliation between event feeds and map data.
- On-map event chips and planning handoff.
- City and transport status banners.
- Late-food and last-train family routes.

### 9.5 Planning and routes

- Plan composer with constraints and route generation.
- Price-aware and preference-aware stop selection.
- Curated crawl packs and generated Plans.
- Plan lifecycle states: draft, ready, active, ending, completed, and abandoned.
- Active Plan persistence and map rendering.
- Event-aware weighting.
- Plan sharing, join, presence, action, and completion endpoints.
- Plan Completion domain with idempotent completion.
- Crawl endings and terminal venue references.
- Transport legs and handoff links.
- Draft recovery for in-progress Plan composition.

### 9.6 Social field layer

- Pint Drop creation with privacy controls and optimistic local recovery.
- Comments, replies, reactions, ratings, reporting, and moderation foundations.
- Visibility gating for public interactions.
- Feed and Discover surfaces.
- Saved pubs and followable saved lists.
- Profiles, following, notifications, messages, activity, and rounds.
- Presence and “Here now” foundations.
- Real-time publication migrations and keyless in-memory equivalents.

### 9.7 Identity and connected accounts

- Account authentication through Supabase when configured.
- PUBMAXX handles with availability, claim, rename, alias, and resolution routes.
- Historical handle links survive rename through aliases.
- Current-user profile route and public handle pages.
- X, TikTok, and Instagram connection foundations.
- Opaque one-time OAuth state on supported provider paths.
- Manual Instagram profile link for personal accounts.
- Connected-account status storage.
- Account claim telemetry.

### 9.8 Night Memory, Moment, and Story

- Private account-owned Memory domain.
- Atomic Moment kinds: photo, Pint Drop, event, venue, quote, person, and side quest.
- Private-by-construction Moment validation.
- Collaborative Story contributor roles.
- Per-Moment publication consent and withdrawal.
- Story publication proposals with expiring one-time confirmation tokens.
- Revalidation of consent during transactional publication.
- Public Story shape excludes private Memory and account identifiers.
- Supabase schema, indexes, RLS, and server-only database access.
- Keyless memory-store implementation and focused tests.
- User-facing Memory creation in the You surface.
- In the current implementation wave: ordinary private Moment creation, draft Story creation, Story listing, and refresh-safe studio fields.

### 9.9 Pub Pal

- User-owned Pub Pal domain replacing the earlier presentation-only assumption.
- Account signup with a public handle, required private date of birth, and
  optional private full name and sex. Contributions are not blocked by age.
- Hound, raven, and fox species foundations.
- Name, material, accessory, Signal affinity, relationship style, personality, and voice settings.
- Pal onboarding experience.
- Pal home route and summon affordance.
- Mute and hidden state.
- Structured Pal memories with approval principles.
- Mastery events and unlock foundations.
- ElevenLabs React dependency and server token route.
- Typed and voice fallback architecture.
- The product term is “Ask your Pub Pal.”

### 9.10 Heritage and city knowledge

- Grounded heritage endpoint that works in structured-only keyless mode.
- Cited historic pub collection and detail routes.
- Borough heritage rollups and crawl integration.
- Large expanded London heritage dataset.
- Landmark and city-story routes.
- CityMCP place, area, buzz, journey, and things-to-do proxies with rate limits.

### 9.11 Trust, moderation, privacy, and security

- RLS and deny-anonymous-read hardening for sensitive tables.
- Server-side service-role access for private Memory and identity data.
- CSP nonce work and tightened image proxy rules.
- Rate limits on public and abuse-sensitive routes.
- Moderation/reporting stores and admin surfaces.
- No direct provider keys in browser code.
- Voice privacy design calls for zero retention where available.
- Confirmation-first protocol for consequential Pal actions.
- Private routes return no-store responses.
- User content validation and text cleaning at trust boundaries.

### 9.12 Accessibility and resilience

- Reduced-motion paths and deterministic screenshot states.
- Minimum mobile touch-target work.
- Focus-visible and keyboard interaction coverage across core surfaces.
- Light and dark screenshot matrices at 390, 430, 1280, and 1440 pixel widths.
- Keyless operation for product demonstration.
- Poster/static fallback principles for future animated assets.
- Local draft recovery for Plans, Pint Drops, map-built stops, and the Memory studio.
- Isolated build option to avoid shared `.next` collisions.

### 9.13 Analytics

- Self-owned, allow-listed, privacy-first event rail.
- Do Not Track support.
- No user identifier in the standard client beacon.
- Existing activation signals for map entry, venue selection, plan creation, Pint Drops, account claim, social connection, Memory actions, and draft recovery.
- Lane-to-Plan provenance only counts canonical source tokens.

## 10. Multi-city status

The repository includes data and map routes for:

- London;
- Manchester;
- Liverpool;
- Oxford;
- Durham;
- Glasgow;
- Bristol;
- Cambridge;
- Bath.

London remains the deepest dataset and the primary quality bar. Other cities should communicate coverage honestly and should not imply London-level freshness where it does not exist.

## 11. Current design direction

### 11.1 Product read

A map-native consumer nightlife product for adults, combining futuristic editorial energy with Apple-like clarity and restraint.

### 11.2 Design dials

- `DESIGN_VARIANCE 7`: distinctive enough to create a world without weakening task clarity.
- `MOTION_INTENSITY 5`: meaningful transitions and responsive feedback, not constant spectacle.
- `VISUAL_DENSITY 6`: enough live city signal for confident decisions, with layered disclosure on mobile.

### 11.3 Visual principles

- Map first, content second, decoration last.
- Both dark and light modes are first-class.
- Futurism comes from spatial depth, responsive data, translucent materials, typography, choreography, and live state.
- Do not use a generic neon-on-black cyberpunk template.
- Do not introduce human-looking synthetic characters until the visual standard is proven.
- Pub Pal can carry more personality than the map interface.
- Glass is a web approximation with a solid fallback for reduced transparency and contrast modes.
- One accent family should signal action, selection, or live state rather than decorate every surface.
- Motion must explain hierarchy, state, location, continuity, or feedback.
- Copy should be direct, warm, useful, and British without becoming theme-park pub language.

### 11.4 The logo brief

The PUBMAXX logo should create affection, art, and recognition at favicon scale.

Recommended direction:

- a unique geometric **P** as the primary mark;
- negative space or small abstract vessels may imply beer, wine, cocktail, whisky, and spirit forms without becoming a literal collage;
- the two X characters can become a subtle “crossed paths” or “two routes meet” signature;
- the mark must work in one colour before gradient or animation variants;
- test at 16, 32, 48, 180, and 512 pixels;
- provide app icon, favicon, monochrome, light, dark, social avatar, map pin, and motion variants;
- avoid real alcohol brand silhouettes, clip-art bottles, crests, shields, and generic pub signs;
- use the full wordmark only where enough width exists.

### 11.5 Cyberpunk and character direction

The rejected direction is realistic or semi-realistic humanoid drinking imagery.

If Night Signals return later, they should be:

- clearly fictional adult synthetic entities;
- translucent face, hand, and glass fragments rather than full people;
- material-led, abstract, and non-identifiable;
- one active real-time canvas rather than six canvases;
- capability-tiered with video and poster fallbacks;
- optional brand storytelling, never required for navigation;
- evaluated through a separate concept gate before product integration.

For the present release, focus on the UI, map, Pub Pal, and Memory journey.

## 12. Mobile information architecture

The five persistent mobile jobs are:

1. **Map**: find places, prices, routes, and layers.
2. **Tonight**: see what is worth doing now.
3. **Moment**: capture a live Pint Drop or private Moment.
4. **Stories**: discover useful public experiences and city lore.
5. **You**: identity, connected accounts, Pub Pal, Memories, privacy, and settings.

The central Moment action should remain visually prominent without making alcohol logging the product's primary reward.

Desktop must expose the same jobs with more room, not a separate product vocabulary. Secondary utilities such as activity, messages, Layers, Prices, and Ask your Pub Pal should be available without crowding the map.

## 13. Daypart model

PUBMAXX should adapt recommendations and copy to intent and time:

### Morning

- heritage walks;
- markets and coffee-adjacent starts;
- alcohol-free options;
- brunch and food;
- calm city discovery;
- plan the evening.

### Afternoon

- gardens, terraces, sport, lunch, waterside routes;
- cold beer and low-friction social starts;
- galleries, parks, markets, and nearby side quests;
- price-aware early routes.

### Evening

- dinner, gigs, quizzes, dates, comedy, and group plans;
- transport-aware route building;
- crew coordination and booking confidence.

### Late night

- live music, raves, clubs, late venues, last transport, late food;
- route simplicity and clear recovery options;
- explicit confirmation before consequential actions.

## 14. Activation strategy

### 14.1 Definition

A new user is activated when they experience PUBMAXX's unique value, not when they merely create an account.

Recommended activation event:

> Within the first session or seven days, the user selects a relevant place or event, opens or creates a Plan, and saves one durable preference or Moment.

### 14.2 Onboarding target

Keep first value under three interactions where possible. Account and Pal setup may be longer, but should stay below ten clear steps and be resumable.

Suggested first-run sequence:

1. Choose city or allow one-time coarse location.
2. Choose immediate intent: cheap pint, tonight, side quest, food, music, or plan.
3. Show three understandable options on the map.
4. Let the user inspect distance, price, atmosphere, and ways there.
5. Offer save, Plan, or invite only after value is visible.

### 14.3 Activation experiments

- anonymous “one tap to a useful map” versus guided intent;
- Tonight card versus price card as the first map overlay by daypart;
- lightweight “save this side quest” before account wall;
- Pub Pal summon after two meaningful actions rather than immediately;
- post-Plan prompt to create a private Memory shell;
- returning draft recovery banner with direct continuation.

## 15. Retention and stickiness

Retention must emerge from accumulated personal value and changing city signal.

### 15.1 Daily and weekly reasons to return

- tonight's events and deals change;
- price reports age and need confirmation;
- crew plans and messages evolve;
- saved Night Areas reveal new opportunities;
- Pub Pal can surface a relevant side quest;
- route and transport conditions change;
- public Stories reveal places not found through ranking alone.

### 15.2 Long-term reasons to return

- private Memory archive;
- personal map of visited and loved places;
- friendships and crew history;
- earned cosmetics and city-lore chapters;
- reputation for useful contributions;
- a recognisable PUBMAXX identity and handle;
- ability to revisit an old night by people, places, music, drink, or route.

### 15.3 Healthy progression

Reward:

- completed planning;
- new venue discovery;
- verified Pint Drops;
- helpful corrections;
- heritage reading;
- crew coordination;
- safely completed nights;
- thoughtful Story creation.

Never reward:

- number of drinks;
- alcohol strength;
- money spent on alcohol;
- staying out later;
- unsafe speed or route completion;
- public posting volume without quality.

## 16. Performance, caching, and continuity

### 16.1 Targets

- LCP below 2.5 seconds at p75 on supported mobile networks.
- INP below 200 milliseconds at p75.
- CLS below 0.1.
- Critical server API p95 targets set per endpoint class, not as one vague number.
- Map shell interactive quickly even if secondary feeds are still loading.

P95 means 95 percent of measured requests or interactions complete at or below that duration. It exposes the slower tail that an average can hide.

### 16.2 Cache by data class

| Data | Recommended policy |
| --- | --- |
| Static city and venue seed | CDN and versioned immutable cache |
| Basemap and vector tiles | Provider cache policy plus client cache |
| Heritage and editorial facts | Long server cache with source-based revalidation |
| Opening times and menus | Medium cache with visible checked date |
| Events and deals | Short cache with stale-while-revalidate |
| Price summaries | Short cache, optimistic updates, visible freshness |
| Live presence and route state | No shared cache; account or session scoped |
| Private Memories and messages | No-store at HTTP boundary; client state cache only after auth |
| Pal configuration | Account-scoped query cache with mutation invalidation |

### 16.3 Refresh continuity

Typing should survive refresh where doing so does not expose another account's content:

- Plan composer: implemented session draft.
- Pint Drop composer: implemented venue-scoped session draft.
- Built map stops: implemented local persistence.
- Memory and Story studio: implemented session draft in the current wave.
- Messages: next candidate for safe per-conversation draft persistence.
- Pal onboarding: next candidate for encrypted/account-scoped resume.

Clear drafts after successful submission, explicit discard, sign-out, or account change. Do not persist microphones, precise location, OAuth state, or publication confirmation tokens.

### 16.4 Tab-to-tab speed

- persist the map instance when product structure permits;
- prefetch likely next routes after intent is known;
- share canonical venue objects rather than refetching inconsistent variants;
- use optimistic local updates for comments, saves, and Moment capture;
- avoid serial server waterfalls;
- lazy-load heavy map, admin, and voice code;
- release hidden WebGL and media resources;
- measure route transitions and input readiness rather than only API time.

## 17. Data and system architecture

### 17.1 Current stack

- Next.js 16 App Router;
- React 19;
- TypeScript;
- MapLibre GL;
- Supabase Auth and Postgres for durable relational and sensitive data;
- in-memory adapters for keyless operation and isolated tests;
- Convex dependency and migration runbook;
- ElevenLabs React client with server-issued session-token architecture;
- Vercel hosting and analytics infrastructure, with the primary product event rail self-owned.

### 17.2 Client-server boundary

Browser code should not directly mutate sensitive database tables. The intended relationship is:

`Client UI → authenticated Next server route/action → policy/domain service → Supabase or Convex adapter`

The server boundary owns:

- authentication and ownership;
- validation and normalisation;
- rate limits;
- confirmation tokens;
- provider credentials;
- moderation and safety policy;
- database selection and migration compatibility;
- audit metadata.

### 17.3 Supabase and Convex strategy

Do not perform a big-bang migration.

Keep Supabase as the authority for:

- authentication;
- durable identity and handles;
- sensitive private content;
- relational ownership and consent;
- moderation and audit-critical state;
- Plan Completion and financial/provider usage records.

Pilot Convex for application-facing, high-churn, low-regulatory surfaces where realtime subscriptions materially improve the product:

- crew presence;
- live Plan state;
- ephemeral reactions;
- Pub Pal session state;
- event and map signal projections.

Use server-side dual-read or shadow-write adapters during migration. Every capability requires parity metrics, an owner, rollback, and a source-of-truth declaration. The detailed runbook is in `docs/architecture/convex-migration-runbook.md`.

### 17.4 Recommendation engine boundary

Map, Plan, Pub Pal, and Tonight must use the same factual ranking and constraint engine. Pub Pal personality may change explanation style, not facts, prices, transport, safety, or ranking entitlement.

## 18. Pub Pal product contract

Pub Pal is a user-owned digital companion that performs three jobs:

1. planning companion;
2. voice or typed concierge;
3. cosmetic progression and long-term relationship layer.

Users control:

- species;
- name;
- appearance;
- voice;
- pace, warmth, energy, and verbosity;
- personality traits;
- relationship style;
- approved memories;
- visibility, mute, and hide state;
- Signal-inspired cosmetics.

PUBMAXX controls:

- factual accuracy;
- legal boundaries;
- moderation;
- recommendation safety;
- confirmation requirements;
- alcohol-harm guardrails;
- provider cost and rate limits.

Voice requirements:

- push-to-talk and typed fallback;
- official ElevenLabs SDK;
- WebRTC with server-issued token or signed URL;
- no API key in browser code;
- curated licensed voices only in v1;
- no voice cloning;
- zero retention and no saved audio where provider capabilities permit;
- no conversation-content analytics;
- visible confirmation card before Plans, invitations, settings, memories, or published content change.

## 19. Memory and social publishing contract

The product must separate living from publishing.

### 19.1 Moment

A Moment is private when created. It can refer to a place, quote, person, event, photo, side quest, or Pint Drop.

### 19.2 Memory

A Memory is an account-owned private container. It can be created manually or after a completed Plan. A shared night does not imply shared ownership of every Moment.

### 19.3 Story

A Story is an edited presentation. It must support:

- title and summary;
- selected Moment ordering;
- contributor roles;
- per-Moment owner consent;
- preview;
- unlisted or public visibility;
- visible publication confirmation;
- consent withdrawal without deleting the private source Moment.

### 19.4 Social graph

Profiles and feeds should help users discover trustworthy people and places, not create an engagement casino. Ranking should value relevance, provenance, recency, relationship, and usefulness. Follower count must not be the only status signal.

## 20. Safety and alcohol stance

PUBMAXX can celebrate sociability, culture, and memorable nights without presenting alcohol as harmless or necessary.

Required principles:

- the product is for adults;
- alcohol-free venues, drinks, food, music, and daytime experiences belong in discovery;
- intoxication is never a progression mechanic;
- transport and route-exit information remain easy to reach;
- critical safety messages have a non-character equivalent;
- Pub Pal must not pressure users to continue drinking;
- recommendations respect accessibility, distance, transport, budget, and explicit preferences;
- public content is moderated and reportable;
- price language does not encourage excessive quantity.

## 21. Codebase health and bloat audit

The repository has strong tests and meaningful domain boundaries, but visible hotspots require continued decomposition.

### 21.1 Largest hotspots

- `app/globals.css`: about 4,900 lines.
- `components/PubMapCanvas.tsx`: about 1,875 lines.
- `app/feed/feed.css`: about 1,789 lines.
- `components/PubMap.tsx`: about 1,460 lines.
- `components/map/venueSheet.css`: about 1,220 lines.
- `app/discover/discover.css`: about 1,210 lines.
- `lib/citymcp/client.ts`: about 1,030 lines.
- `app/u/[handle]/profile.css`: about 995 lines.
- several stores between 600 and 900 lines.

### 21.2 What not to do

- do not split files by arbitrary line count;
- do not create generic “utils” layers that hide domain meaning;
- do not replace tested stores during feature work without a migration reason;
- do not move every component into a design-system abstraction;
- do not combine Supabase and Convex calls in client components;
- do not copy animation libraries into the repository.

### 21.3 Recommended decomposition

- move route-specific global CSS into co-located modules in measured waves;
- continue splitting map orchestration by state ownership, not visual fragments;
- give every large store a domain interface and persistence adapter boundary;
- consolidate repeated Supabase/in-memory adapter mechanics through the existing store factory where semantics match;
- isolate heavy client code behind dynamic imports;
- add contract tests before moving logic;
- use `knip`, bundle analysis, route timing, and screenshot parity as gates;
- treat generated data and screenshots separately from product source metrics.

### 21.4 Current wave improvement

The You account hub previously owned handle management, social connections, and Memory creation in one component. The current wave extracts a dedicated Night Memory studio with its own API lifecycle and draft recovery. This reduces change coupling while completing a user-facing product loop.

## 22. Git and pull-request lineage

### 22.1 Current branch state at snapshot

- Local branch: `codex/mobile-integration-recovery`.
- Local integration commit: `e98538dbb feat: unify PUBMAXX identity and night memories`.
- Remote branch head known locally: `6ad77a57d fix(vercel): isolate plan completion CI`.
- Local branch was one commit ahead before this document and current implementation wave.
- `origin/main` known locally: `a6b9c3265 feat(theme): Apple-neutral dark mode ... (#261)`.

### 22.2 Important active remote lineages visible locally

- `origin/codex/mobile-integration-recovery`;
- `origin/codex/map-search-honesty`;
- `origin/codex/pr263-hardening`;
- `origin/codex/pr264-privacy-hardening`;
- `origin/codex/pubmax-review-push-20260713`.

These names do not prove that GitHub currently considers each branch an open pull request. Live GitHub PR status could not be authenticated from this workspace during this snapshot, so this section intentionally distinguishes local evidence from current server state.

### 22.3 Representative merged PR sequence visible in Git history

The checkout contains merge or squash evidence for at least PRs #100 through #262. Representative milestones include:

- #100 map visual polish;
- #101 outer-London coverage and map declutter;
- #103 map flicker fix;
- #105 multi-city maps;
- #108 instant city switching;
- #114 CityMCP London integration;
- #121 glass pins, clusters, Discover, and Plan handoff;
- #125 friends-on-map round continuity;
- #139 revived scraped chain prices;
- #163 map copy and truncation improvements;
- #165 map decomposition;
- #168 shared store factory;
- #173 information architecture unification;
- #183 journey maps;
- #185 What's On spine;
- #191 global command palette;
- #202 venue identity canonicalisation;
- #207 Gate 0 baseline sweep;
- #211 Tonight surface and analytics foundations;
- #216 PubMap decomposition;
- #219 selection spotlight;
- #221 POI initiation gating;
- #223 camera choreography;
- #226 dusk and night map look;
- #228 donut price clusters;
- #232 next-features roadmap merge;
- #239 dark home and Discover state fixes;
- #241 concierge as map home;
- #247 cited heritage layer;
- #250 event-aware planning;
- #251 active Plan drawn on map;
- #260 expanded Wikipedia heritage dataset;
- #261 Apple-neutral dark theme;
- #262 donut-cluster coverage.

### 22.4 Integration work after main

The current integration lineage then added or recovered:

- Tonight parity and mobile IA;
- map pinpointing, route recovery, and private journey hardening;
- Pub Pal and Plan Completion foundations;
- Night Signals design experiments;
- Vercel preview hardening;
- map flow restoration;
- PUBMAXX naming, identity, connected accounts, and Night Memory foundations.

Do not blindly merge or cherry-pick old design experiments. Reconcile by domain and tests.

## 23. Feature maturity matrix

| Capability | Maturity | Next proof required |
| --- | --- | --- |
| London map and venue inspection | Strong foundation | performance and visual regression certification |
| Multi-city maps | Functional foundation | coverage honesty and city-specific quality |
| Price provenance | Functional | freshness operations and confidence UX |
| Tonight | Functional | broader reliable feeds and conversion measurement |
| Plans | Strong foundation | simpler mobile completion loop |
| Routes and transport | Functional | mode comparison, distance clarity, route beauty |
| Pint Drops | Functional | clearer private/public choice and contribution quality |
| Profiles and follows | Foundation | coherent social value loop |
| Messages and rounds | Foundation | draft recovery, notification and presence polish |
| Identity handles | Functional | settings UI, disconnects, export, deletion |
| Connected social accounts | Foundation | provider production configuration and disconnect UI |
| Night Memories | Foundation becoming usable | full Moment and Story editor |
| Consent-aware Stories | Domain complete, UI incomplete | selection, ordering, consent, preview, publish UI |
| Pub Pal ownership | Foundation | complete daily planning and voice vertical slice |
| Voice | Architecture foundation | privacy-certified provider integration and quota UX |
| Mastery and unlocks | Foundation | economy design and anti-abuse proof |
| Heritage | Strong | personalised lore and route integration |
| Moderation | Foundation | operations workflow and response targets |
| Analytics | Functional foundation | dashboards and metric definitions |
| Offline and PWA | Limited | explicit offline product contract |

## 24. Next implementation roadmap

### Wave 0: protect the baseline

- reconcile the active Git lineage without rewriting history;
- keep all existing routes, types, analytics contracts, and public URLs stable;
- run keyless and configured-path checks;
- preserve the mobile visual matrix;
- document live versus local deployment state.

### Wave 1: complete the Memory vertical slice

Already started in this implementation wave:

- list the current user's Stories;
- list private Moments in a selected Memory;
- create ordinary private Moments in You;
- create a private Story draft;
- recover unfinished studio fields after refresh;
- split Memory concerns out of the account hub.

Next:

- Story editor with Moment selection and ordering;
- existing-Moment inclusion proposals;
- contributor invitation and acceptance UI;
- per-Moment consent inbox;
- preview and explicit public/unlisted publication confirmation;
- photo upload through a private object-key flow;
- edit, export, and delete controls;
- public Story route integration without leaking private fields;
- `night_story_published` analytics.

### Wave 2: make Tonight convert into a completed night

- unify map, Tonight, Plan, and active route state;
- compare walk, cycle, public transport, taxi handoff, and accessible options;
- show distance from the opted-in current location;
- beautify route line hierarchy and stop transitions;
- simplify route recovery and “change the plan” actions;
- make last transport and late food part of completion;
- capture completion without forcing a public post;
- emit `next_night_committed` only from a defined action.

### Wave 3: Pub Pal useful daily vertical slice

- resume Pal onboarding across refresh;
- complete You and Pal-home integration;
- summon from Map, Tonight, and Plan;
- typed planning grounded in the shared engine;
- server-issued ElevenLabs session token;
- push-to-talk with interruption and text fallback;
- usage allowance, latency, failure, and cost metering;
- proposed-memory review cards;
- confirmation protocol for every consequential tool call;
- provider outage and quota UX;
- privacy and retention certification.

### Wave 4: social identity and network

- connected-account management and disconnect;
- profile media and bio controls;
- relevant friend and creator discovery;
- crew formation from Plans and shared Stories;
- notification centre based on user intent;
- feed ranking transparency;
- anti-spam, moderation, and blocking;
- optional cross-post preparation without automatic external posting.

### Wave 5: mastery and living city

- idempotent mastery ledger;
- Signal-material cosmetic system without humanoid characters;
- city-lore chapters;
- contribution quality and verification rewards;
- seasonal side quests;
- venue and Night Area collections;
- personal city map and revisit prompts;
- healthy completion streaks based on experiences, not alcohol.

### Wave 6: selective Convex pilot

- choose one realtime capability with measurable Supabase pain;
- define source of truth and rollback;
- implement server-only adapter;
- shadow traffic and compare parity;
- monitor p50, p95, error rate, stale reads, and cost;
- expand only after the pilot proves user value.

## 25. Acceptance criteria for the next major release

### Product

- an anonymous user reaches a useful map choice in under one minute;
- a signed-in user can create a handle, Plan, private Memory, Moment, and Story draft;
- a Story cannot publish without a separate visible confirmation;
- a contributor can withdraw consent after publication;
- Pub Pal can plan through text and fail safely without voice;
- a completed Plan can seed a private Memory;
- the user can continue an unfinished supported form after refresh.

### Design

- coherent light and dark modes at 390, 430, 1280, and 1440 pixels;
- no horizontal overflow;
- mobile and desktop expose the same product jobs;
- 44-pixel touch targets;
- visible keyboard focus;
- reduced motion, reduced transparency, and increased contrast fallbacks;
- no generic neon glow or realistic cyberpunk characters;
- route and state motion has a functional explanation.

### Performance

- LCP below 2.5 seconds, CLS below 0.1, and INP below 200 milliseconds at p75;
- endpoint-specific p95 budgets documented and observed;
- only critical map and hero assets load above the fold;
- tab transitions do not refetch stable private account data unnecessarily;
- hidden media and WebGL work pauses or releases resources.

### Trust

- prices, events, heritage, and venue claims expose provenance;
- private content uses server-mediated access and no-store responses;
- OAuth state is opaque, one-time, and expiring;
- microphone denial leaves typed functionality intact;
- account deletion removes Pal, Memories, connected accounts, and derived private state according to policy;
- progression cannot be earned from alcohol quantity.

### Engineering

- focused API and component tests;
- `npm run lint`;
- `npm run typecheck`;
- `npm test`;
- isolated production build;
- mobile Playwright journeys;
- screenshot and short interaction recordings;
- no unreviewed database migration applied remotely;
- no push or deployment without explicit approval.

## 26. Research and design questions for Fable

Fable should explore these without reopening settled product boundaries:

1. How can the map feel like a living cultural instrument in both light and dark mode?
2. What is a uniquely PUBMAXX visual language that is futuristic without generic cyberpunk clichés?
3. How should Moment capture differ from a public social post?
4. How can private Memories feel emotionally valuable before any sharing occurs?
5. What makes Pub Pal lovable without obstructing map tasks?
6. How should morning, afternoon, evening, and late-night atmospheres change while preserving one system?
7. How can route lines communicate beauty, mode, confidence, distance, and live status at a glance?
8. How should desktop expose richer utilities while maintaining parity with the five mobile jobs?
9. What logo mark remains recognisable as a favicon, map pin, Pal object, and social avatar?
10. How can the product celebrate memorable social life while remaining inclusive of alcohol-free users and avoiding harmful incentives?

## 27. Fable output requested

Fable should return:

- a grand product narrative grounded in this PRD;
- a revised end-to-end user journey for anonymous, new-account, organiser, contributor, and returning-memory users;
- mobile-first wireframes for Map, Tonight, Moment, Stories, You, and Pub Pal;
- desktop parity layouts;
- light and dark design tokens;
- logo system and favicon studies;
- route visual language;
- Memory and Story editor flows;
- Pub Pal summon, typed, voice, confirmation, failure, and privacy states;
- motion choreography with reduced-motion equivalents;
- component inventory mapped to existing code rather than a full rewrite;
- a sequenced delivery plan with dependencies and measurable acceptance criteria;
- an explicit list of what should be removed, consolidated, or left unchanged.

## 28. Non-goals for the next release

- voice cloning;
- arbitrary generated Pal species;
- AR characters;
- realistic or celebrity-like synthetic people;
- progression based on alcohol;
- paid ranking advantage;
- subscriptions and paid cosmetics before core retention is proven;
- full Supabase-to-Convex migration;
- automatic cross-posting to X, Instagram, or TikTok;
- public-by-default Memories;
- rebuilding the map or Plan engine from scratch;
- changing public URLs without migration and analytics plans.

## 29. Risks

### Product breadth

The repository contains many foundations. The primary risk is continuing to add horizontal capability without finishing a small number of excellent vertical journeys.

### Visual incoherence

Past design waves include coral, amber, purple, Apple-neutral, cyberpunk, and field-guide directions. One living token system and one current product contract must win.

### Data confidence

Prices, events, hours, and menus age at different speeds. Freshness and provenance must remain visible.

### Social harm

Public content, presence, photos, and location can create privacy and moderation risk. Private defaults and precise consent are core product architecture.

### Provider cost

Voice and realtime services can create unbounded cost. Token issuance, quotas, timeouts, usage metering, and fallback are release requirements.

### Performance

The map, feeds, motion, and future media can compete for mobile resources. Capability tiers and route-level loading are mandatory.

### Migration complexity

Running Supabase and Convex without a clear authority model can create split-brain data. Each migrated capability needs one declared source of truth.

## 30. Source map

Primary product and design sources:

- `PRODUCT.md`
- `DESIGN.md`
- `CONTEXT.md`
- `docs/PRD_CANONICAL.md`
- `docs/PRD_PUBMAXX_UNIFIED_PRODUCT_2026-07-15.md`
- `docs/MASTER_FEATURES_ROADMAP_PRD.md`
- `docs/CURRENT_IMPLEMENTED_STATE_PRD.md`
- `docs/PRD_FOR_FABLE.md`
- `docs/PRD_CYCLE_TRUST_TONIGHT.md`
- `docs/PRD_MEMORY_TIMELINE_SOCIAL_UX_WAVE_2026-07-09.md`
- `docs/PRD_MEMORY_SHARE_OUTER_LONDON_WAVE_2026-07-09.md`
- `docs/PRD_STICKINESS_MEMORY_WAVE_2026-07-08.md`
- `docs/FABLE_PRODUCTION_AND_BROAD_APPEAL_PRD.md`
- `docs/FIRST_PRINCIPLES_MAP_SOCIAL_PRD.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/MOBILE_FLOW_SPEC.md`
- `docs/CODE_HEALTH_REMEDIATION.md`
- `docs/SECURITY_POSTURE.md`
- `docs/architecture/convex-migration-runbook.md`
- `docs/adr/0006-pub-pal-user-owned-digital-companion.md`

Primary implementation sources:

- `app/page.tsx`
- `app/map/page.tsx`
- `app/map/[city]/page.tsx`
- `components/PubMap.tsx`
- `components/PubMapCanvas.tsx`
- `components/nav/MobileTabBar.tsx`
- `components/plan/PlanComposer.tsx`
- `components/pal/PalExperience.tsx`
- `components/profile/PubmaxxAccountHub.tsx`
- `components/profile/NightMemoryStudio.tsx`
- `lib/nightMemory.ts`
- `lib/nightMemoryStore.ts`
- `lib/pubPal.ts`
- `lib/pubPalStore.ts`
- `lib/plan.ts`
- `lib/planStore.ts`
- `lib/analyticsEvents.ts`
- `supabase/migrations/20260715091533_0027_pub_pal_and_plan_completion.sql`
- `supabase/migrations/20260715133000_0028_night_memories.sql`
- `supabase/migrations/20260715134000_0029_identity_and_social_connections.sql`

## 31. Final product principle

PUBMAXX should reduce the cost of deciding, increase the chance of genuine connection, and preserve the parts of city life that people are proud to have lived.

The map gets someone out the door. The Plan keeps the group together. Pub Pal lowers the effort. Moments keep the truth. Stories preserve the meaning. The city provides the adventure.
