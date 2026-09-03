# PUBMAXXING Stickiness, Durability, And Map Expansion PRD v3

## 2026-07-06 Opus Review Update

This PRD has been updated after reviewing the latest Opus commits through `ea5e6c0` and visually checking the local app in browser at desktop and mobile sizes. The product has moved forward materially since v2.

Shipped or substantially implemented since the previous plan:

- Durable `/crawls/[slug]` story pages.
- Standalone `/p/[id]` Pint Drop permalink pages with OG image support.
- Pint Drop comments with actor-hashed write path and visible-only public reads.
- Server-side venue-name index for feed/profile/permalink surfaces.
- Durable reactions/follows/profile backend patterns.
- Google sign-in scaffolding through Supabase Auth.
- Social share bar for X, WhatsApp, native share, and copy link.
- Map-first redesign with full-bleed MapLibre canvas, price clusters, POI layer, favorite-pint selector, and compact venue card.
- Durable saved-pub API/store and profile saved-pub surfaces.
- Feed defaulting to Latest so the first visit is not empty.
- Friends feed wired to the follow graph.
- Saved-only map filter.
- Then vs Now cards on Discover.
- Server-rendered `/borough` and `/borough/[slug]` discovery pages.
- Profile editor and "claim your handle" flow.
- New unit tests and read-only social-loop Playwright coverage.

Review findings from the current build:

- Good: lint, typecheck, Vitest, production build, and Playwright all pass.
- Good: the feed now shows real pub names and links back to the map.
- Good: the map-first redesign is a strong product improvement and feels much more distinctive.
- Good: borough pages are useful shareable discovery surfaces.
- Risk: in build mode, tapping a map pin still toggles that pub in/out of the crawl. Inspecting a pub should not mutate the route.
- Risk: profile editing is still handle-trust based. The code documents this, but now that Google auth exists, this should be upgraded to authenticated ownership before any public launch.
- Risk: mobile map has both top nav and bottom tab bar visible, and the venue card sits close to the tab bar. The next mobile pass should hide/condense top nav and use a true bottom sheet.
- Risk: borough page titles include the brand in the page metadata while the root title template also appends the brand, producing duplicated browser titles.
- Risk: `docs/ACTIVE_PLAN.md` is stale and still points to `cc_plan.md`.
- Risk: several new/old components still carry inline styles. Some are acceptable in OG image routes, but app UI components should move recurring styles into CSS.
- Risk: deployment docs still flag public storage URLs for hidden content. Private buckets/signed URLs remain a production-readiness requirement.

The next package should not add another broad surface. It should make the map the live social centre of PUBMAXXING.

## 2026-07-06 TfL And London API Addendum

Gemini's broader API list is useful, but the next integration should be disciplined. The first external API worth implementing is TfL because it directly supports the pub-night loop: "Can I have one more pint and still catch the train?"

Recommended Last Pint slice:

1. Server-proxy TfL calls. Never call TfL directly from browser UI with credentials.
2. Resolve existing static station POIs to TfL StopPoint IDs through StopPoint search.
3. Cache station ID mappings for long periods and live arrivals/line status for roughly 30-60 seconds.
4. Show nearby Tube, Elizabeth line, DLR, Overground, and rail options in the venue sheet.
5. Let the user set a destination station/postcode/area for the current session.
6. Calculate a leave-by time from live arrivals, pub-to-station walking estimate, and a buffer.
7. Render the answer in PUBMAXXING language: Order one more, Half pint only, Settle up now, or Train risk.
8. Treat destination as private and session-scoped unless the user explicitly saves it later.

After TfL, use APIs only where they deepen the same loop:

- postcodes.io for destination/borough lookup.
- Wikidata and Historic England for Story mode provenance.
- Overpass/OpenStreetMap for entrances, toilets, water points, and walking context.
- Food Hygiene Rating Scheme for meal-capable pub stops.
- London Datastore/GLA for borough and area metadata.
- Air quality, events, and safety datasets only after the core map, story, and Last Pint flow feels solid.

## Map Expansion PRD

### Problem Statement

The current map is finally close to the product's heart: full-screen, visual, price-aware, story-aware, and fun to explore. But it is still mostly a planner map. It needs to become a social, historical, and night-out map: a place where users can see where friends are, what pints are cheap tonight, what route fits their mood, what stories happened nearby, and what pubs are worth saving before they leave the house.

### Solution

Build the PUBMAXXING Live Story Map layer. This layer adds richer map modes and social overlays without replacing the existing map:

1. Tonight mode: live Pint Drops, recent presence, and cheapest pints logged today.
2. Story mode: Golden Days memories, landmarks connected to nearby pubs, and Landlord teasers.
3. Friends mode: followed users, saved pubs, shared crawls, and invite status.
4. Crawl mode: better route building, explicit pin inspect/add behavior, route cards, and mobile bottom sheet.
5. Pint mode: favorite beer heatmap, price comparison, and Then vs Now by area.
6. Progress mode: Pint Passport, badges, borough completion, and personal map memory.

### User Stories

1. As a map user, I want pin taps to inspect pubs without changing my crawl, so that I can explore safely.

2. As a crawl builder, I want an explicit Add or Remove action in the venue sheet, so that route changes are intentional.

3. As a mobile user, I want venue detail in a bottom sheet with tabs, so that the map remains usable while I inspect a pub.

4. As a mobile user, I want the top navigation hidden or condensed when bottom tabs are visible, so that the map is not crowded.

5. As a user going out tonight, I want a Tonight mode, so that I can see where recent Pint Drops and active pub energy are.

6. As a user at a pub, I want an opt-in "I'm here" action, so that friends can see where the night is happening.

7. As a privacy-conscious user, I want presence to expire automatically, so that I am not sharing stale location data.

8. As a friend opening the map, I want to see who sent me a crawl or who is already nearby, so that the app feels social from the first tap.

9. As a user choosing a drink, I want favorite-pint mode to show which pubs serve my pint and what it costs, so that I can plan around the drink I actually want.

10. As a bargain hunter, I want a live cheapest-tonight overlay, so that recently logged cheap pints stand out on the map.

11. As a history-driven user, I want Story mode to reveal heritage pubs, Golden Days memories, and nearby landmarks, so that the map teaches me London.

12. As a user tapping a landmark, I want to see nearby pubs connected to that place, so that landmarks become crawl starters instead of isolated dots.

13. As a Landlord user, I want map landmark/pub context to seed a grounded Landlord prompt, so that the AI answers from known facts rather than generic history.

14. As a Londoner, I want borough boundary/area cards, so that the map feels organized around how people actually talk about nights out.

15. As a crawler, I want a route quality card with distance, estimated time, total pint cost, cheap stops, story stops, and last-stop vibe, so that I can choose between routes quickly.

16. As a crawler, I want route warnings for far-apart stops or straight-line estimates, so that the product is honest about walking.

17. As a user planning with friends, I want to copy an invite link that opens the map with the crawl loaded, so that friends can join the plan.

18. As a returning user, I want my saved pubs marked on the map with a distinctive saved glyph, so that my personal pub memory is visible.

19. As a user building a personal archive, I want a Pint Passport layer showing pubs, boroughs, and beers I have logged, so that using the app feels collectible.

20. As a Discover user, I want Then vs Now cards to link into the exact map area, so that editorial discovery leads back to exploration.

21. As a demo viewer, I want the first map view to expose one clear next action, so that I am not overwhelmed by controls.

22. As a maintainer, I want map overlays implemented as typed layers and stable DTOs, so that adding future layers does not bloat the main map component.

### Implementation Decisions

- Split map state into named overlay modes: Default, Tonight, Story, Friends, Crawl, Pint, and Progress.
- Keep the existing full-bleed MapLibre canvas.
- Fix build-mode pin behavior first: pin tap is inspect-only; route mutation happens only through explicit Add/Remove controls.
- Add a mobile venue bottom sheet that replaces the current compact card on small screens.
- Add map overlay metadata through typed DTOs instead of passing raw store rows directly to the canvas.
- Treat presence as opt-in and short-lived. Store venue-level presence, not continuous location trails.
- Connect landmarks to nearby heritage pubs and Landlord prompts. Landmarks should become crawl/story entry points.
- Add a route quality card to the planner drawer with route stats and honest distance labeling.
- Add saved-pub and friend overlays as optional layers, not default noise.
- Add borough map links from `/borough/[slug]` and Discover cards.
- Keep OG image routes inline-styled if necessary for `next/og`, but move app UI inline styles into CSS.
- Update metadata titles to rely on the root title template instead of hardcoding `PUBMAXXING` twice.
- Update `docs/ACTIVE_PLAN.md` to point at this v3 PRD.

### Testing Decisions

Test the map at the highest user-visible seam with Playwright:

1. Open `/map` on desktop and verify map canvas or fallback renders.
2. Click a pin in build mode and verify the route stop count does not change.
3. Click Add to crawl in the venue sheet and verify the route stop count changes.
4. Open `/map` on a 375px viewport and verify bottom nav does not overlap the venue sheet's primary actions.
5. Toggle favorite-pint mode and verify non-serving pubs dim or filter correctly.
6. Toggle saved-only mode and verify the map/list narrows to saved pubs.
7. Open a borough page and click its map link; verify the map opens focused on that borough/query.
8. Open a landmark/story marker and verify nearby pub/story context is shown.
9. Toggle Tonight mode and verify recent Pint Drop or presence markers render without exposing precise location trails.

Add unit tests for:

- Overlay DTO normalization.
- Presence expiry.
- Landmark-to-nearby-pub matching.
- Route quality stats.
- Build-mode inspect-only behavior.
- Borough-to-map link generation.
- Metadata title generation for borough pages.

### Out Of Scope

- Native mobile app.
- Real-time chat.
- Payments or pub-owner dashboards.
- Continuous user location tracking.
- Complex ML recommendations.
- Replacing MapLibre.
- Production auth/RLS ownership enforcement beyond the profile-edit ownership ticket below.

### Further Notes

The map should now be treated as the product centre. Feed, Discover, Boroughs, Profiles, Pint Drops, and Crawls should all point back into the map with enough context to continue the user's journey.

Immediate fix order:

1. Fix build-mode pin tap mutation.
2. Clean mobile map chrome and bottom sheet.
3. Fix duplicate borough metadata titles.
4. Update active docs.
5. Add map overlay modes in this order: Story, Tonight, Friends, Progress.
6. Upgrade profile editing from handle-trust to authenticated ownership once Supabase Auth provider config is confirmed.

## Problem Statement

PUBMAXXING has moved past the first demo shell. The app now has the right product surfaces: landing, map, feed, profiles, crawl stories, discover, mobile tabs, Pint Drops with photos, and a social schema ready in Supabase migrations. The next problem is not "add more pages." The next problem is making the shipped surfaces feel sticky, connected, durable, and safe enough for real people to use during a night out.

Right now the product can still feel demo-like in several important moments:

- The feed can show raw venue IDs instead of pub names.
- Reactions, follows, saved pubs, comments, and crawl stories are partly local/demo-mode until persistence is finished.
- Crawl Story sharing is not yet a clean slug-based link with rich previews everywhere.
- Pint Drops are social posts, but they do not yet have standalone permalink cards.
- Mobile navigation exists, but venue detail and logging still need to feel native to one-handed pub use.
- Moderation, media privacy, structured logging, and Supabase migration application need to be tightened before public launch.
- Planning docs are now numerous, so agents need one current execution plan.

The product promise is strong: Letterboxd plus Instagram for pints, pub crawls, cheap nights, chaotic memories, history, art, and social stories. The next implementation package should make that promise obvious from the first shared link or first mobile session.

## Solution

Build the PUBMAXXING Stickiness And Durability layer. This is the layer that turns existing demo surfaces into loops users share with friends:

1. See a pint or crawl in the feed.
2. Tap the pub name and land on the map with that pub selected.
3. Save or build a crawl.
4. Share a clean Crawl Story or Pint Drop link with an OG card.
5. Invite friends into the crawl.
6. Log a pint quickly from mobile.
7. React, comment, follow, and see activity persist.
8. Return later because the app remembers your pubs, people, and stories.

This PRD assumes the broad social category is already set. Opus should not start new unrelated product categories. The work should strengthen the existing surfaces: feed, profiles, crawls, discover, map, mobile shell, and backend trust.

## Current Baseline

Already shipped or in active local implementation:

- PUBMAXXING brand and golden-days narrative.
- Landing page with Pint Drop strip.
- Map and crawl builder.
- `/feed` with InstaPint cards, filters, photo-first Pint Drops, and local reaction behavior.
- `/u/[handle]` profile pages with stats, saved pub lists, and profile header.
- `/discover` with cheap-pint leaderboard and editorial lanes.
- `/crawls` shareable recap surface.
- Mobile bottom tab bar for Map, Feed, Log, Crawls, and Profile.
- Supabase migrations for Pint Drop vibe tags and the social layer.
- In-progress profile, follow, and reaction stores/API routes using Supabase when configured and memory fallback otherwise.

Known gaps to close:

- Apply the Supabase social migrations in the production project before claiming durable persistence.
- Finish integrating durable reactions/follows into the UI.
- Add comments and saved-pub persistence.
- Persist Crawl Stories by slug rather than relying only on URL-encoded payloads.
- Add standalone Pint Drop permalinks and OG cards.
- Resolve venue names and venue links everywhere social content appears.
- Improve mobile venue detail and "I'm here" logging.
- Harden uploads, moderation, logging, rate limits, and docs.

## User Stories

1. As a visitor, I want the first shared PUBMAXXING link I receive to show a rich preview, so that I immediately understand why the crawl or pint is worth opening.

2. As a crawl planner, I want to save a route as a clean `/crawls/[slug]` story, so that I can send it without a long encoded URL.

3. As a crawl planner, I want the shared crawl preview to show title, stops, total price estimate, vibe tags, and cover image, so that friends can judge the night from the link preview.

4. As a crawl planner, I want to invite a friend to a crawl with attribution, so that the recipient knows who sent it and can join the same plan.

5. As a friend receiving a crawl link, I want the map to open with the crawl already loaded, so that I do not need to rebuild the route.

6. As a pub-goer, I want every Pint Drop to have a standalone `/p/[id]` page, so that I can share one pint as a real social post.

7. As a pub-goer, I want a Pint Drop share card to include photo, price, venue, handle, and vibe, so that it feels like a collectible memory.

8. As a feed reader, I want pub names instead of raw venue IDs, so that I recognize places immediately.

9. As a feed reader, I want to tap a pub name and open the map with that pub selected, so that the feed becomes a discovery path.

10. As a feed reader, I want reaction counts to persist across sessions and devices, so that the feed feels alive.

11. As a feed reader, I want to see which reactions I have already used, so that my own state is clear.

12. As a feed reader, I want to comment on Pint Drops, so that stories continue after the night.

13. As a profile viewer, I want follow and unfollow to persist, so that the Friends feed becomes meaningful.

14. As a user, I want my profile stats to include pints logged, crawls posted, cheapest pint, and badges, so that my drinking history feels like an identity.

15. As a user, I want to edit my profile once identity is durable, so that my profile feels owned rather than synthesized.

16. As a user, I want saved pubs to persist and appear on the map, so that saving a pub helps me plan future crawls.

17. As a mobile user, I want venue detail to open as a bottom sheet with Pints, Story, and Crawls tabs, so that I can inspect a pub without losing the map.

18. As a mobile user in a pub, I want the app to preselect the nearest venue when I log a pint, so that I can post quickly before the moment passes.

19. As a mobile user, I want infinite scrolling in the feed, so that browsing feels natural and continuous.

20. As a map user in build mode, I want tapping a pin to inspect only, so that I do not accidentally mutate my crawl.

21. As a user, I want an opt-in "I'm here" presence action, so that friends can see where the night is happening.

22. As a user, I want the Tonight feed to show recent presence and fresh Pint Drops, so that PUBMAXXING feels live.

23. As a Discover visitor, I want a live "cheapest pints tonight" leaderboard, so that the page changes with community activity.

24. As a Discover visitor, I want Golden Days lanes and era-filtered memories, so that pub nostalgia is visible and shareable.

25. As a Londoner, I want borough pages for places like Camden, Soho, and Hackney, so that I can discover pubs the way locals talk about areas.

26. As a pub-history reader, I want Then vs Now price cards, so that the app connects today's pint to old prices and old stories.

27. As a demo viewer, I want consistent navigation across every page, so that the site feels like one product.

28. As a demo viewer, I want the theme toggle to be discoverable, so that the visual system can be shown during the demo.

29. As a maintainer, I want one active plan and archived old PRDs, so that agents do not waste time following stale instructions.

30. As a maintainer, I want upload privacy hardening, so that users do not accidentally publish EXIF or unsafe files.

31. As a moderator, I want actor-scoped report rows, so that one actor cannot inflate reports and moderation history stays auditable.

32. As a maintainer, I want structured logs from API failures, so that production issues can be diagnosed quickly.

33. As a maintainer, I want one Playwright social-loop test, so that the core demo cannot regress silently.

34. As a maintainer, I want visual screenshots for landing, map, feed, profile, and crawl story, so that design regressions are caught before launch.

## Implementation Decisions

### 1. Highest Implementation Seam

Use the social persistence seam as the main seam: server APIs should decide between Supabase-backed stores and demo/memory fallback, while UI components consume stable DTOs and do not know which store is active.

This matches the current pattern already started for Pint Drops, profiles, follows, and reactions. Opus should continue that pattern instead of introducing a second client-side persistence model.

### 2. Finish Durable Reactions

Complete the in-progress reaction work:

- Use the canonical reaction allowlist from the shared reaction store.
- Load reaction summaries for visible feed items in one batched request.
- Toggle reactions through the server route.
- Keep local-only fallback only for sample/demo drops that are not persisted.
- Render counts next to reaction labels.
- Preserve optimistic UI, but reconcile from the server response.

Acceptance criteria:

- Refreshing the feed preserves reaction counts when Supabase is configured.
- Reacting from two browser sessions increments shared counts.
- Demo seed drops do not crash if the backend rejects them as unknown.

### 3. Finish Durable Follows

Complete the in-progress profile/follow work:

- Persist follow/unfollow through the server follow API.
- Show follower and following counts on profiles.
- Use follow state to power the Friends feed filter.
- Rate-limit follow changes.
- Prevent self-follow.
- Keep fallback behavior for demo environments.

Acceptance criteria:

- Following a profile updates counts without a full reload.
- The Friends filter shows content from followed handles when durable data exists.
- A signed-out/demo viewer without a handle sees a clear path to claim a handle.

### 4. Add Comments

Add comments as the next social primitive after reactions and follows.

Decisions:

- Store comments against Pint Drops.
- Use actor hash plus display handle until real auth lands.
- Support visible, hidden, and pending states.
- Fetch comments lazily when a feed card expands.
- Keep mobile comment threads collapsed by default.
- Rate-limit comment creation.

Acceptance criteria:

- A user can open comments on a Pint Drop, post a comment, and see it after refresh.
- Hidden or pending comments are not visible publicly.
- Comment API errors do not break feed rendering.

### 5. Persist Saved Pubs

Move saved pub lists from local-only behavior to the social schema while keeping local fallback.

Decisions:

- Preserve default list types: Want to Visit, Cheap Pint, Coding Pint, Historic, Date Night, Crawl Stop, Local Legend.
- Render saved state in venue detail, profile, and map pins.
- Add a "show saved only" map filter.
- Migrate local saved pubs opportunistically when a user has a profile handle.

Acceptance criteria:

- Saving a pub appears on the profile and map after refresh.
- Removing a pub updates all surfaces.
- Saved pubs remain available in local fallback mode when Supabase is not configured.

### 6. Persist Crawl Stories

Turn Crawl Stories into durable social objects.

Decisions:

- Add a server create route for Crawl Stories.
- Generate unique readable slugs from story titles.
- Store ordered stops, notes, linked Pint Drops, summary, visibility, and cover image.
- Render slug pages from durable data.
- Keep the existing URL-encoded share path as anonymous fallback.
- Add a story owner concept through profile handle now and auth later.

Acceptance criteria:

- A user can build a crawl, save it, receive a slug URL, open it in a fresh browser, and see the same story.
- Anonymous fallback still works.
- Draft/unlisted/public visibility behavior is clear.

### 7. Crawl Story OG Cards

Wire Crawl Story share previews to durable stories.

Decisions:

- Render the OG image from a story slug when available.
- Include title, stop count, total estimated pint cost, representative pub names, and vibe tags.
- Fall back to decoding the anonymous story payload when no slug exists.

Acceptance criteria:

- A crawl link produces a meaningful preview in tools that read Open Graph metadata.
- The preview does not expose private draft stories.

### 8. Pint Drop Permalinks

Add standalone Pint Drop pages.

Decisions:

- Add a public route for one Pint Drop.
- Include photo, price stamp, pub name, handle, note, vibes, reactions, comments, and report action.
- Add an OG image endpoint for Pint Drops.
- Link feed cards and profile grid items to the Pint Drop permalink.

Acceptance criteria:

- A Pint Drop can be shared independently of feed and venue detail.
- A hidden/reported drop does not expose its photo or private moderation fields.

### 9. Venue-Aware Feed And Profiles

Resolve venue IDs to pub names everywhere social content appears.

Decisions:

- Build one server-safe venue index from the existing dataset.
- Feed DTOs should include venue name, borough/area when available, and map selection URL.
- Profile Pint Drop cards should show venue names and link to the map.
- Landlord and Then vs Now features should reuse the same venue index.

Acceptance criteria:

- No public feed/profile card displays raw venue IDs as the main venue label.
- Tapping a venue on feed/profile opens the map with the venue selected.

### 10. Mobile Map Bottom Sheet

Improve mobile venue detail.

Decisions:

- On small screens, venue detail should appear as a bottom sheet over the map.
- Use tabs: Pints, Story, Crawls, Details.
- Keep the map visible behind or above the sheet.
- Use thumb-friendly actions for Save, Log, Add to Crawl, Share, and Report.

Acceptance criteria:

- Selecting a venue on mobile does not push the user into a long page scroll.
- Logging a pint from the selected venue takes one obvious tap.
- The sheet can be dismissed and reopened without losing map state.

### 11. "I'm Here" Presence

Add lightweight opt-in presence for the Tonight loop.

Decisions:

- Store recent presence with handle, venue, timestamp, and expiry window.
- Show a subtle presence indicator on venue pins.
- Show a Tonight lane in the feed.
- Expire presence automatically after roughly two hours.
- Do not collect precise GPS unless the user explicitly uses nearest-venue logging.

Acceptance criteria:

- Pressing "I'm here" makes the venue feel live on the map and feed.
- Old presence disappears automatically.
- Users can browse without sharing presence.

### 12. Mobile "Log Here" Composer

Make mobile logging fast.

Decisions:

- The Log tab should open a camera-first composer.
- With permission, geolocation preselects the nearest known pub.
- Without permission, the user can search/select manually.
- Composer should support pint photo, optional selfie, price, drink, vibe tags, and note.

Acceptance criteria:

- A user near a known pub can start logging with the pub preselected.
- Denied geolocation does not block logging.
- The new Pint Drop appears in feed and profile.

### 13. Map And Planner Fixes

Fix trust-breaking map behaviors and onboarding.

Decisions:

- In build mode, pin tap should inspect only. Add/remove should happen through explicit buttons.
- Saved pubs should have distinct map pin treatment.
- First-paint map onboarding should offer curated crawl cards when no route is active.
- Route distance labels should be honest when straight-line estimates are used.

Acceptance criteria:

- Inspecting pubs never accidentally changes the current crawl.
- Saved pubs are visible on the map.
- New users have a clear first action on the map.

### 14. Discover Stickiness

Make Discover worth reopening.

Decisions:

- Add "cheapest pints tonight" from recent Pint Drops.
- Promote Golden Days memories as a first-class lane.
- Add Then vs Now price comparison using baseline dataset price and recent Pint Drops.
- Add borough pages after the venue index exists.

Acceptance criteria:

- Discover has at least one live community-driven section.
- Historic/nostalgic content is visible without knowing a hidden filter.
- Borough pages are server-renderable and shareable.

### 15. Navigation And Visual Consistency

Extract consistent navigation and polish recurring UI.

Decisions:

- Use one site navigation component across landing-adjacent pages.
- Keep mobile bottom tab bar consistent with desktop nav.
- Make the theme toggle easy to find.
- Replace page-specific loading text with shared skeleton patterns.
- Give every empty state a headline, explanation, and primary action.
- Move obvious inline styles into the design system CSS.

Acceptance criteria:

- Main pages expose consistent routes and active states.
- Theme toggle is visible in the demo.
- Empty and loading states feel intentional.

### 16. Media, Privacy, And Moderation Hardening

Prepare user-generated content for public launch.

Decisions:

- Validate upload MIME and magic bytes.
- Strip EXIF and normalize images server-side before public storage.
- Resize and compress large photos.
- Prefer private/quarantined storage plus signed URLs for hidden or reported content.
- Keep actor-scoped report rows and derive report counts from rows.
- Add an admin review surface for reported drops and comments.
- Rate-limit uploads, comments, reactions, follows, reports, and story creation.

Acceptance criteria:

- Uploading a spoofed non-image file fails.
- Public images do not expose EXIF location data.
- Hidden content cannot continue to be fetched through a stale public URL indefinitely.
- Duplicate reports from one actor do not inflate counts.

### 17. Structured Logging

Add production-grade observability basics.

Decisions:

- Use a small structured logging helper for API and store failures.
- Log event names, severity, route/store context, and sanitized error messages.
- Never log secrets, raw tokens, raw uploaded file contents, or full IP addresses.
- Keep user-facing responses stable even when logs record details.

Acceptance criteria:

- Supabase, storage, rate-limit, and LLM fallback failures emit useful logs.
- Public responses do not leak implementation details.

### 18. Auth Direction

Do not block this PRD on full auth, but keep the path clear.

Decisions:

- Continue with handle plus actor-hash demo identity for immediate social durability.
- Add Supabase Auth as a separate focused epic once durable social actions are stable.
- Profiles should keep a reserved link to auth users.
- When auth lands, migrate existing handle-based actions into claimed profiles where possible.

Acceptance criteria:

- Current work can ship for demo without auth.
- Nothing added now makes auth migration harder.

### 19. Documentation Consolidation

Make the repo handoff clean for Opus, Fable, and future agents.

Decisions:

- Treat this file as the current execution PRD.
- Keep the previous social-memory PRD as background.
- Archive or banner older PRDs as superseded.
- Update the active plan to point at this file.
- Update the repo tour to include feed, discover, profiles, mobile nav, social stores, and migrations.
- Refresh the demo deck after implementation.

Acceptance criteria:

- A new agent can identify the current plan in under one minute.
- Old docs do not send agents to stale product goals.

## Priority Order

1. Finish in-progress durable reactions and follows.
2. Resolve venue names and map links in feed/profile.
3. Add comments.
4. Persist saved pubs.
5. Persist Crawl Stories by slug.
6. Add Crawl Story OG cards.
7. Add Pint Drop permalinks and OG cards.
8. Fix map build-mode pin mutation and improve map onboarding.
9. Add mobile venue bottom sheet and "Log here" composer.
10. Add Tonight presence.
11. Add Discover live leaderboard and Golden Days lane.
12. Extract consistent navigation, skeletons, empty states, and theme toggle placement.
13. Harden uploads, reports, signed URLs, rate limits, and structured logs.
14. Consolidate docs and refresh screenshots/deck.
15. Add Supabase Auth as a later focused epic.

## Testing Decisions

Test external behavior at the highest useful seam. The best first seam is one full Playwright social-loop test because it proves the user-visible product:

1. Open landing.
2. Navigate to map.
3. Select pubs and build a crawl.
4. Save as a Crawl Story.
5. Open the Crawl Story slug.
6. Log a Pint Drop with photo data mocked.
7. Open feed and see the drop with venue name.
8. React to the drop.
9. Comment on the drop.
10. Open the profile and see the drop/stats.
11. Follow another profile.
12. Open Discover and see live/community sections.

Add focused tests for:

- Feed DTO venue resolution.
- Reaction summary batching and toggling.
- Follow/unfollow counts and self-follow rejection.
- Comment creation and hidden-state filtering.
- Saved pub uniqueness and list grouping.
- Crawl Story slug generation and anonymous fallback.
- Pint Drop permalink hidden-content behavior.
- Magic-byte upload validation.
- Actor-scoped report uniqueness.
- Build-mode map pin tap inspect-only behavior.
- Cursor pagination.

Visual QA should capture:

- Landing desktop and mobile.
- Map desktop dark and light.
- Mobile map with bottom sheet.
- Feed desktop and mobile.
- Profile desktop and mobile.
- Crawl Story slug page.
- Pint Drop permalink page.
- Discover page.

Manual QA should include:

- Supabase configured.
- Supabase unavailable or social migrations not applied.
- Anonymous/demo user.
- User with local handle.
- Mobile viewport.
- Slow network.
- Failed image upload.
- Hidden/reported Pint Drop.

## Out Of Scope

These should not be part of this PRD unless explicitly re-scoped:

- Native iOS or Android app.
- Payments, pub subscriptions, or pub-owner monetization.
- Full pub-owner dashboard.
- Ticketing or event management.
- Real-time chat.
- Complex ML recommendations.
- Multi-city launch operations beyond London.
- Full password/OAuth account system in the same batch.
- Replacing the current map engine.

## Further Notes

The strongest next move for Opus is to finish the work already started locally: durable profiles/follows/reactions, then connect those to feed/profile UI. After that, make Crawl Stories and Pint Drops truly shareable with slug/permalink pages and OG cards.

Do not let the plan drift into new surface area before the core loop works:

Feed -> Map -> Crawl -> Share -> Pint Drop -> React/Comment -> Profile -> Follow -> Feed.

Recommended product line:

> Every pint has a story.

Recommended supporting line:

> PUBMAXXING brings back cheap pints, chaotic nights, and the pub stories worth remembering.
