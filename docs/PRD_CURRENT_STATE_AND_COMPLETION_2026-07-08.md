# PRD: PUBMAXXING Current State and Completion Plan

> **SUPERSEDED SNAPSHOT (2026-07-16):** use [`MASTER_PRD.md`](./MASTER_PRD.md)
> for current roadmap authority.

Date: 2026-07-08

> **Next wave (2026-07-08):** After Mobile UX (#51) and Design/Map/Drink (#53),
> see [`PRD_PLACE_DRINK_FOOD_NEXT_WAVE_2026-07-08.md`](./PRD_PLACE_DRINK_FOOD_NEXT_WAVE_2026-07-08.md)
> for Hungry CTA, Place story deep-links, Feed Last Train stamps, slim
> brand/cuisine hints, story crawl packs, and durable admin import notes.
>
> **Stickiness wave (Wave G):** see
> [`PRD_STICKINESS_MEMORY_WAVE_2026-07-08.md`](./PRD_STICKINESS_MEMORY_WAVE_2026-07-08.md)
> for Last Train at compose time, crawl-complete memory prompt, Place story
> deep-link onboarding, and For You friends boost.
>
> **Wave H (2026-07-09):** see
> [`PRD_MEMORY_SHARE_OUTER_LONDON_WAVE_2026-07-09.md`](./PRD_MEMORY_SHARE_OUTER_LONDON_WAVE_2026-07-09.md)
> for shareable crawl memories, trusted Drop nearby picker, place-quest events,
> and Outer London P1 coverage ([`PRD_OUTER_LONDON_COVERAGE.md`](./PRD_OUTER_LONDON_COVERAGE.md)).
> **Shipped on main:** #63 (Layers declutter), #65 (Wave H), #67 (security
> Phases 1–4), #69 (message gate status), #76 (Wave J map taste/fluidity).
> Do not rebuild them.
>
> **Wave I (2026-07-09):** see
> [`PRD_MEMORY_TIMELINE_SOCIAL_UX_WAVE_2026-07-09.md`](./PRD_MEMORY_TIMELINE_SOCIAL_UX_WAVE_2026-07-09.md)
> for Memory Timeline, trusted DMs (`authedFetch` + linked actor), and UX
> declutter/speed.
>
> **Wave J (2026-07-09):** see
> [`PRD_MAP_TASTE_FLUIDITY_WAVE_2026-07-09.md`](./PRD_MAP_TASTE_FLUIDITY_WAVE_2026-07-09.md)
> for Taste/Emil skills install, warmer colorful map, Cost/Layers affordances,
> ease-out fluidity, and landing/feed taste within DESIGN_SYSTEM.

## Problem Statement

PUBMAXXING has moved from a concept into a credible demoable product: a London
pub map, price data, crawl planning, venue sheets, Pint Drops, feed/profile
surfaces, Last Pint transport help, drink discovery, ledger/permalink pages,
ratings, saved pubs, comments, reactions, messages, rounds, admin moderation,
Supabase-backed storage paths, and Vercel deployment plumbing all exist.

The problem now is not lack of features. The problem is completion pressure:
the demo needs to feel fast, smooth, coherent, and trustworthy on mobile, while
the codebase has accumulated broad parallel work from Codex, Opus, Fable, and
Sonnet. Some features are production-ready, some are implemented in the current
dirty branch but not yet shipped, and some are still only roadmap items. If the
next agent treats all of it as unbuilt, it will duplicate work. If it treats all
of it as shipped, it will overclaim.

The product needs one current PRD that states:

- what is already built and should not be rebuilt;
- what is implemented in the current branch and needs final verification;
- what must be finished before a full-functioning demo;
- what should wait until after the demo;
- how to test, review, push, and deploy without mixing unrelated changes.

## Solution

Ship the product through a mobile-first completion wave. The website should feel
like a pocket London pub atlas: open the map, find a cheap or interesting pub,
map a crawl, check whether the group can still get home, drop a pint, share the
memory, and come back through profile/feed/passport loops.

The immediate product shape is:

1. **Map as the home of the product.**
   The map is the primary experience, not a side page. It must load quickly,
   disclose layers progressively, and make the next action clear on mobile.

2. **Venue sheet as the command center.**
   The pub sheet owns the pub decision: price, drinks, story, drops, save,
   crawl stop, share, and Last Train.

3. **Pint Drop as the core contribution loop.**
   Every important route should make "Drop a pint" reachable, but all entry
   points must resolve to one composer path.

4. **Trust labels everywhere.**
   Seeded demo content, sourced facts, contributor reports, and anecdotal story
   claims must stay visually distinct.

5. **Mobile smoothness before new spectacle.**
   The demo will be judged on first load, one-thumb map use, sheet behavior,
   route confidence, and no obvious overlap. Add new content only after that is
   solid.

6. **Vercel as the reliable deploy gate.**
   GitHub Actions has previously failed before job allocation. Treat Vercel and
   local `npm run ci` as the product-code gate until GitHub runner allocation is
   healthy.

## Current Product State

### Built And Should Be Preserved

- Landing page with the PUBMAXXING proposition, live Pint Drop strip, visual
  product framing, and map calls to action.
- Map with slim first payload, keyless vector map, dark/light style paths,
  price-coloured pins, venue search, filters, favourite-pint repricing,
  non-alcoholic support, POIs, TfL rail lines, landmarks, story bands, and
  curated crawls.
- Lazy venue detail loading through a server route rather than loading every
  detail on first map paint.
- Venue sheet with mobile tabs for pub overview, Pint Drops, drinks/menu,
  story/lore, Pubmaxxer ask flow, and Last Train.
- Pint Drops with photo/price/story/vibe fields, demo fallback, Supabase store
  path, moderation, report handling, privacy visibility vocabulary, comments,
  reactions, and feed/profile reuse.
- Feed, activity, profile, saved pubs/lists, ratings, comments, messages,
  rounds, crawl stories, borough pages, discover pages, bar tab, ledger pages,
  and Pint Drop permalink pages.
- Last Pint / Last Train API path with TfL-derived station and train timing
  logic, plus graceful fallback behavior.
- Data validation/build scripts for slim venue index, Pubmaxxing seed data,
  price updates, drinks, POIs, crawls, venues, and other bundled data.
- Vercel deployment runbook and production env var documentation.
- Test coverage across pure logic, API routes, social stores, data validation,
  profile/passport logic, routing helpers, Last Train logic, map payload
  behavior, screenshots, and Playwright smoke flows.

### Implemented In Current Branch But Not Yet Cleanly Shipped

These changes are present in the active worktree and should be treated as
current-wave implementation, not future speculation:

- Mobile route intent:
  - suggested routes do not draw a line until the user maps them;
  - curated and Near Me crawls map immediately because user intent is explicit;
  - mapped routes stay visible after the planner closes;
  - route lines can be hidden without deleting route stops;
  - a mapped-route chip shows stop count, distance, and walking estimate;
  - the route chip can reopen editing;
  - Last Train handoff selects the final stop and opens the Last Train tab.
- Mobile layout fixes:
  - planner drawer sits above map chrome on phones;
  - map toolbar, legend, POI controls, story card, and route chip are suppressed
    when planner/detail states would cause overlap;
  - route chip no longer overlaps the mobile story card;
  - built-in map zoom/compass controls are hidden on mobile where they compete
    with app-owned controls.
- Map warmup:
  - landing map CTAs and mobile tab interactions warm small map payloads;
  - warmup respects Save Data and slow network hints;
  - warmup is best-effort and never blocks navigation;
  - tests cover no navigator, missing network information, Save Data, 2G,
    normal connections, fetch failures, and per-session dedupe.
- `/map?log=1`:
  - the mobile Drop tab points at map log intent;
  - once the fast venue list exists, the map selects the best visible pub,
    opens the sheet, and opens the existing Pint Drop composer.
- Pint Drop draft persistence:
  - composer text, visibility, and vibe tags are scoped per venue in
    `sessionStorage`;
  - switching tabs or closing/reopening the same pub preserves the draft;
  - switching to another pub does not leak the old draft into the wrong venue;
  - successful posts clear the saved draft;
  - photo files are deliberately not persisted.
- Discover performance:
  - the heavy public pint dataset is deferred until the ranking/analysis
    sections are near the viewport;
  - requestIdleCallback and timeout fallbacks exist for browsers without
    intersection observer support;
  - tests cover observer, idle, and timeout scheduling paths.
- Navigation polish:
  - public Admin links are removed from the landing nav/footer;
  - the mobile bottom tab bar is hidden on the landing page;
  - top nav labels are shorter;
  - the mobile wordmark/home affordance remains visible;
  - mobile tap behavior is improved.
- Shared-page escape hatches:
  - Pint Drop permalink pages and ledger pages now have PUBMAXXING home links,
    so shared/standalone surfaces are not dead ends.
- Current verification already run for this wave:
  - targeted warmup tests passed;
  - typecheck passed;
  - lint passed with existing complexity warnings only;
  - diff whitespace check passed;
  - map performance Playwright tests passed earlier in the wave;
  - screenshot suite passed earlier before the final small landing/nav patch,
    but the final screenshot refresh was stopped because it triggered another
    full production build.

### Known Risks And Blockers

- The current branch is dirty. It must be staged intentionally, not with blind
  `git add -A`.
- Several current changes came from parallel agents. Do not revert them without
  checking whether they are part of the active mobile/UI wave.
- GitHub Actions startup failures should not be treated as product code
  failures unless jobs allocate and logs show command failures.
- Supabase Preview may still fail from migration-history drift. Fix by
  reconciling migration history, not by deleting local migrations.
- Auth/ownership is still the largest trust boundary. Several social flows
  still rely on handles or demo-friendly assumptions.
- Last Train logic has had post-midnight audit findings. Keep those tests green
  and verify live/scheduled/fallback labels before presenting it as fully live.
- Public photo storage and hidden media takedown are acceptable for demo, but
  not a final UGC privacy model.
- `PubMap` and `PubMapCanvas` are over the configured complexity target. This is
  currently a warning, not a blocking error, but new work should avoid adding
  more complexity to those components.

## User Stories

1. As a first-time visitor, I want the landing page to explain PUBMAXXING fast,
   so that I understand it before opening the map.
2. As a first-time visitor, I want the primary CTA to open the map quickly, so
   that the demo does not stall.
3. As a mobile visitor, I want the landing page to avoid duplicated navigation,
   so that the first screen feels intentional.
4. As a mobile visitor, I want public navigation to hide admin tooling, so that
   the site feels like a consumer product.
5. As a map user, I want pins to appear from a slim payload, so that the map
   becomes useful before all venue detail is available.
6. As a map user, I want the map to keep working if full venue detail is slow,
   so that I can still browse pubs.
7. As a map user, I want a pub sheet to open with the relevant tab, so that a
   map action lands me in the right context.
8. As a mobile map user, I want controls to avoid the bottom tab bar and safe
   area, so that I can tap without misfires.
9. As a mobile map user, I want the planner and venue sheet to hide competing
   map chrome, so that overlays never stack incoherently.
10. As a crawl planner, I want suggested routes to remain unmapped until I ask,
    so that the first map view stays clean.
11. As a crawl planner, I want curated crawls to map immediately after selection,
    so that a chosen route feels concrete.
12. As a crawl planner, I want Near Me routes to map immediately after location
    intent, so that the app answers where to go now.
13. As a crawl planner, I want a mapped-route chip, so that I can recover and
    edit a route after closing the planner.
14. As a crawl planner, I want to hide the route line without losing stops, so
    that I can declutter the map without losing the plan.
15. As a crawl planner, I want distance and walking time shown honestly, so that
    I know whether the crawl is realistic.
16. As a late-night user, I want Last Train from the route final stop, so that I
    can decide whether to order one more.
17. As a late-night user, I want the Last Train tab to open directly from the
    route action, so that I do not have to hunt for it.
18. As a late-night user, I want live, scheduled, and fallback train data labelled
    honestly, so that I know how much to trust the advice.
19. As a mobile contributor, I want the Drop tab to start an actual Pint Drop
    flow, so that the main action is not a dead link.
20. As a mobile contributor, I want all Drop entry points to use one composer, so
    that posting behavior stays consistent.
21. As a contributor, I want the composer to preserve my intent while a sheet
    opens, so that I do not lose momentum.
22. As a contributor, I want to log price, drink, photo, vibe, story, and privacy,
    so that a Pint Drop captures the night.
23. As a contributor, I want demo, sourced, contributor, and anecdote labels to
    be distinct, so that trust is visible.
24. As a sober-curious user, I want low/no drinks and non-beer options visible,
    so that PUBMAXXING is not beer-only.
25. As a cocktail or wine user, I want drink discovery to include categories
    beyond pints, so that I can plan a full night.
26. As a Discover user, I want heavy ranking data to load only when needed, so
    that the first page remains fast.
27. As a Discover user, I want useful idle/loading/error states, so that delayed
    analysis does not feel broken.
28. As a feed user, I want a clear path from every story to map/log/profile, so
    that the feed drives product action.
29. As a profile user, I want my Pint Passport, badges, boroughs, drinks, and
    crawl history to feel collectible, so that I have a reason to return.
30. As a shared-link viewer, I want Pint Drop and ledger pages to link home, so
    that standalone cards pull me into the app.
31. As a group planner, I want shareable crawl links, so that friends can open
    the same night plan.
32. As a group planner, I want rounds to connect to Pint Drops, so that the night
    becomes a shared record.
33. As a ratings user, I want pub ratings and drink ratings to stay distinct, so
    that quality signals are honest.
34. As a ratings viewer, I want low-sample rankings hidden or labelled, so that
    one rating does not create fake authority.
35. As a follower, I want comments, reactions, notifications, and activity to
    sync consistently, so that social feedback feels alive.
36. As a privacy-conscious user, I want hidden or private parent content to hide
    child comments/reactions, so that privacy claims are true.
37. As a profile owner, I want my handle tied to account ownership, so that
    another user cannot impersonate or edit me.
38. As a message user, I want conversations protected by participant identity, so
    that private threads are actually private.
39. As an admin, I want reported/hidden content to be reviewable, so that
    moderation is not a black box.
40. As a maintainer, I want raw Supabase social rows protected behind server DTOs
    or constrained views, so that public APIs do not leak private state.
41. As a maintainer, I want scheduled price/drink refreshes to open reviewable
    PRs, so that data changes are governed.
42. As a maintainer, I want every price row to carry source and freshness, so
    that stale data is never presented as live.
43. As a maintainer, I want bundled data validated in CI, so that a bad JSON file
    cannot silently break the map.
44. As a maintainer, I want Vercel to run the full gate, so that production only
    updates from a verified build.
45. As a reviewer, I want small PRs with clear scope, so that Greptile,
    CodeRabbit, and humans can review without confusion.
46. As an agent, I want clear file ownership per workstream, so that parallel
    agents do not overwrite each other.
47. As a demo lead, I want mobile screenshots at 390px and 430px, so that the
    target phone experience is verified.
48. As a demo lead, I want a known-good Vercel URL after each push, so that I can
    rehearse the demo from production-like infrastructure.
49. As a future product user, I want PWA/offline basics, so that the map and saved
    crawls remain useful in low-signal pub environments.
50. As the founder, I want the app to feel like London culture rather than a pub
    database, so that the product has a clear emotional identity.

## Implementation Decisions

### Release Sequencing

1. **Current branch cleanup and ship.**
   Keep the active mobile/UI/performance changes together only if they all pass
   the product gate. Stage intentionally. Exclude generated local artifacts,
   screenshots, agent scratch files, and secrets.

2. **Mobile demo completion.**
   Finish the map, route, sheet, Drop, Discover, and nav polish before starting
   deeper auth or social expansion. The demo should be judged on the mobile core
   loop first.

3. **Trust and ownership.**
   Move private/destructive social operations from self-asserted handles to
   Supabase Auth ownership. Keep anonymous/demo read paths explicit.

4. **Social coherence.**
   Unify comments, reactions, notifications, messages, visibility, reports,
   ratings, and saved lists behind one privacy and DTO vocabulary.

5. **London utility and expansion.**
   Add richer route packs, Last Pint decisions, drink-category exploration, price
   freshness, and PWA/offline behavior after the core mobile loop is stable.

### Mobile App Shell

- The bottom tab bar owns primary mobile navigation.
- The landing page should not render the bottom tab bar.
- The top nav should remain a compact brand/utility strip on mobile.
- Admin links are not part of public consumer navigation.
- The mobile map should never show overlapping critical controls. Planner,
  detail sheet, route chip, legend, POI controls, and story cards need explicit
  visibility rules.
- The wordmark is a home affordance on shared surfaces.

### Map And Route Model

- The map starts clean. A route line appears only after explicit intent.
- Route stops and route visibility are separate state. Hiding a line does not
  remove the planned stops.
- Curated, landmark, and Near Me crawls are explicit route intents and may map
  immediately.
- Suggested crawls should require a "Map route" action before drawing the line.
- Route distance/time labels must describe the current estimate honestly.
- Last Train from a route uses the final stop as context and opens the venue
  sheet on the transport tab.
- Route chips should be persistent recovery controls, not decorative badges.

### Venue Sheet And Pint Drop Flow

- The venue sheet remains the pub command center.
- Programmatic selection must be able to open the correct initial tab.
- Last Train decision state must reset on venue changes.
- The mobile Drop action resolves to `/map?log=1` and then into the existing
  composer path.
- The next iteration should add a real nearby pub picker and search fallback for
  log intent rather than always selecting the first visible pub.
- Draft preservation belongs at the composer/sheet seam, not in each entry
  point.
- "Drop a pint" should be reachable from map, feed, activity, profile, rounds,
  bar tab, and shared pages, but all of them should converge into one composer.

### Discover And Data Loading

- Do not download the full public pint dataset just to paint the first Discover
  viewport.
- Heavy analysis sections can load when near viewport, on idle, or via timeout
  fallback.
- Ranking sections need explicit idle, loading, error, and ready states.
- The map remains the source of truth for immediate venue exploration.
- Initial map load must stay slim-first. Full venue detail should remain lazy.

### Trust, Identity, And Privacy

- The product keeps public browsing and demo mode, but owned writes need account
  ownership before public launch.
- Profiles should be linked to Supabase Auth user identity.
- Raw public reads of social tables should be denied or constrained.
- Server DTOs should be the public contract for feed, profiles, comments,
  reactions, ratings, messages, saved lists, and Pint Drops.
- Hidden parent content hides child comments/reactions everywhere.
- Reports must be per-actor deduped and concurrency-safe.
- Public photo URLs are acceptable for demo, but private buckets or signed URLs
  are required for true UGC takedown semantics.

### Last Pint And Transport

- Last Pint is a signature feature, not a utility footnote.
- Post-midnight service-day behavior must stay covered by tests.
- "Live from TfL" should be shown only when live data is actually present.
- Timetable or fallback states must be labelled as such.
- Future decision cards should use states such as:
  - order one more;
  - half pint only;
  - settle up now;
  - train risk;
  - live data unavailable.
- The app should never store or infer home addresses by default.

### Drinks, Ratings, And Price Freshness

- Beer/pint prices remain the original map layer.
- The drink model should support beer, wine, whisky, gin, vodka, rum, cocktails,
  shots, low/no, soft drinks, coffee, and other.
- Drink ratings and venue ratings are separate concepts.
- Ranking claims require sample-size floors.
- Scheduled refreshes should create reviewable PRs, not push directly.
- Every refreshed price must include source, URL, observed time, venue match key,
  and freshness state.
- Stale prices should be visible as stale, not silently mixed into live claims.

### Agent Workflow

- Use one workstream per feature slice.
- Assign file ownership before parallel work starts.
- Avoid multiple agents editing the same map shell or venue sheet at once.
- Keep PRs small enough for AI and human review.
- Capture verification commands in every PR body.
- Treat Vercel failures as blockers. Treat GitHub startup failures as
  infrastructure until logs prove otherwise.

## Testing Decisions

### Release Gate

Use the existing production gate:

- data validation;
- lint;
- typecheck;
- coverage;
- production build.

For this repo that is `npm run ci`.

### Required Tests For Current Completion Wave

- Unit tests for map warmup network gating and dedupe.
- Unit tests for Discover deferred-load scheduling.
- Unit or component-level coverage for route intent where practical.
- Last Train post-midnight and live/fallback label tests.
- Pint Drop composer entry from `/map?log=1`.
- Venue sheet initial-tab behavior.
- Hidden parent content suppressing comments/reactions.
- Per-actor report dedupe/concurrency behavior.
- Data validation for slim venue index and all generated public data.

### Browser QA

Use browser QA because map layout regressions are often visual:

- landing mobile first viewport;
- landing desktop first viewport;
- map mobile clean state;
- map mobile planner open;
- map mobile route mapped with planner closed;
- map mobile venue sheet half snap;
- map mobile Last Train tab from route final stop;
- discover mobile before and after deferred analysis loads;
- feed mobile with Drop CTA;
- shared Pint Drop permalink mobile;
- ledger mobile;
- desktop map clean state;
- desktop venue detail.

Preferred mobile widths:

- 390 x 844;
- 430 x 932;
- 768 x 1024.

### Review Quality

- Findings should be classified as blocker, high, medium, low, or non-finding.
- Existing complexity warnings in the map components are known. Do not add new
  complexity there unless the work has no better seam.
- Avoid tests that assert MapLibre internals. Assert user-visible behavior,
  route state, network requests, and rendered controls.

## Priority Backlog

### P0: Demo Completion And Ship

1. Stage only the intended mobile/UI/performance changes.
2. Run `npm run ci`.
3. Run focused browser QA on the mobile map and landing page.
4. Commit, push, and deploy through Vercel.
5. Verify the production URL manually on mobile viewport.
6. Document any known caveats in the PR/deploy note.

### P0: Current Branch Hardening

1. Verify `/map?log=1` opens the composer reliably after navigation from the
   mobile Drop tab.
2. Add a nearby/search fallback to log intent if time permits before demo.
3. Verify Discover deferred loading does not leave sections permanently idle on
   Safari/mobile browsers.
4. Re-run mobile screenshots after the final landing bottom-tab suppression.
5. Confirm no generated local artifacts or secrets are staged.

### P0: Trust Fixes

1. Fix or verify post-midnight Last Train service-day behavior.
2. Ensure Last Train labels distinguish live, scheduled, and unavailable data.
3. Ensure report dedupe is per actor and concurrency-safe.
4. Gate public child content by parent visibility.
5. Keep Admin hidden from production public navigation.

### P1: Auth Ownership

1. Link profile ownership to Supabase Auth.
2. Migrate device/demo handle data into the signed-in profile on first auth.
3. Gate profile edits, crawl-story edits, deletes, messages, saved lists,
   ratings, and destructive Pint Drop operations on account identity.
4. Keep anonymous/demo contribution explicit and limited.

### P1: Social Product

1. Make Pint Passport visually prominent on profiles.
2. Add notification bell and activity reliability polish.
3. Add comments/reactions consistency across feed, venue, profile, and permalink
   surfaces.
4. Add shareable cards for crawls, drops, profiles, ratings, and Last Pint
   moments.
5. Make follows and saved lists account-backed.

### P1: Drinks And Discovery

1. Expand drink category filters beyond beer.
2. Preserve pint-price-first map behavior.
3. Add sample-size-aware drink and venue ratings.
4. Add "best low/no nearby", "best cocktails by borough", and "best pint under
   X" only after sample thresholds exist.
5. Add price freshness labels everywhere prices appear.

### P2: London Exploration

1. Turn landmarks into story chapters with nearby pubs and start-crawl actions.
2. Add route packs: Thames, old London, writers, markets, theatre, coding pint,
   cheap chaos, late train.
3. Add walking/running mode labels without pretending to be turn-by-turn
   navigation.
4. Add borough passports and story progress.
5. Add PWA/offline basics for saved crawls and recently viewed venues.

## Out Of Scope

- Native iOS or Android apps.
- Payments, split bills, or pub-owner dashboards.
- Taxi booking or live ride-hailing.
- DMs beyond the current message system until auth ownership is complete.
- Storing home addresses by default.
- Turn-by-turn navigation before a real routing engine is introduced.
- Scraping competitor price sites or unapproved data sources.
- Multi-city expansion before London is excellent.
- Replacing the current visual identity wholesale.

## Further Notes

- This PRD was the execution handoff on 2026-07-08. It no longer updates the
  active roadmap.
- The highest leverage before the demo is not a new feature. It is finishing,
  testing, pushing, and deploying the current mobile completion wave cleanly.
- The strongest demo path is:
  landing page -> map -> curated/nearby crawl -> mapped route -> final stop
  Last Train -> drop a pint -> feed/profile/permalink.
- Do not claim production-grade private social networking until auth ownership,
  raw-table privacy, and media takedown semantics are finished.
- Do not claim all prices are live. Use freshness and provenance labels.
- If another agent continues this, they should start by checking current git
  status, running the fast gates, and confirming which dirty files are intended
  for the current ship.
