# PRD: OPUS Next Improvements For PUBMAXXING

## Problem Statement

PUBMAXXING has grown from a pub price map into a real social product direction: a map-first London pub-crawl planner with Pint Drops, feed, profiles, crawl stories, share cards, borough pages, comments, saved pubs, and the start of auth. The core idea is still clear: bring back the old golden days of cheap pints, chaotic nights, pub stories, art, history, coding pints, shared crawls, and nights that people remember.

The problem now is focus. There are many good pieces, but the app needs one stronger product loop:

Map -> Pub -> Pint Drop -> Story -> Crawl -> Share -> Friends -> Return.

Right now, the product is promising but uneven:

- The map looks much better, but it is still more planner than live social memory layer.
- Mobile works, but the map chrome is crowded and venue detail needs a proper bottom sheet.
- Build mode still has a trust issue: tapping a pin can mutate the crawl instead of only inspecting it.
- Profiles and auth exist, but ownership is not yet enforced by authenticated identity.
- Social objects exist, but presence, progress, badges, and personal map memory are not yet complete.
- Discover and borough pages are strong, but they should route users back into the map more deliberately.
- The map has station POIs, but it does not yet answer the real night-out question: "Can I finish one more pint and still catch my train?"
- Production readiness still needs storage hardening, signed URLs for hidden media, and cleaner docs.

Opus should improve what exists rather than inventing unrelated product categories. The next work should make PUBMAXXING feel like Letterboxd plus Instagram for pints, with the map as the centre of the night.

## Solution

Build the next iteration around the **Live Story Map** and the **Social Memory Loop**.

The Live Story Map should let users choose what kind of night they want:

- **Tonight**: recent Pint Drops, cheap pints logged today, and opt-in presence.
- **Story**: Golden Days memories, heritage pubs, landmarks, and grounded Landlord prompts.
- **Friends**: followed users, shared crawls, saved pubs, and invites.
- **Pint**: favorite beer heatmap and Then vs Now prices.
- **Progress**: Pint Passport, borough completion, badges, and personal pub memory.
- **Crawl**: route quality, explicit add/remove controls, shareable invite links, and mobile-first planning.
- **Last Pint**: nearest station options, TfL line status, live train arrivals, and a clear "leave by" countdown.

The social loop should make every action lead to another action:

1. A user opens the map.
2. They inspect a pub without accidentally changing their crawl.
3. They save it, log a Pint Drop, or add it to a crawl.
4. Before ordering another pint, they check whether the nearest train still works for their destination.
5. Their Pint Drop becomes a permalink and feed item.
6. Friends react, comment, follow, or join the crawl.
7. The user's profile, passport, and map memory update.
8. The app gives them a reason to return for the next night.

## User Stories

1. As a new visitor, I want the first screen to show PUBMAXXING as a live map of cheap pints, pub stories, and crawls, so that I understand the product immediately.

2. As a map user, I want tapping a pub pin to inspect it only, so that I do not accidentally change my crawl.

3. As a crawl builder, I want explicit Add to crawl and Remove from crawl actions, so that route editing feels trustworthy.

4. As a mobile user, I want venue detail to open in a bottom sheet, so that the map remains visible while I read, save, log, or add the pub.

5. As a mobile user, I want the top navigation hidden or condensed when bottom tabs are visible, so that the map does not feel crowded.

6. As a mobile user, I want the venue sheet to expose Pints, Story, Crawls, and Details tabs, so that I can scan the pub quickly.

7. As a user going out tonight, I want a Tonight map mode, so that I can see where fresh Pint Drops and cheap pints are happening.

8. As a user at a pub, I want an opt-in "I'm here" button, so that friends can see the night is active without me continuously sharing location.

9. As a privacy-conscious user, I want presence to expire automatically, so that I am not visible after I leave.

10. As a feed user, I want fresh Pint Drops to appear on the map, so that the feed and map feel connected.

11. As a bargain hunter, I want a cheapest-tonight map overlay, so that I can find live cheap pint discoveries.

12. As a Guinness drinker, I want favorite-pint mode to show who pours my pint and at what price, so that I can plan around my actual drink.

13. As a user comparing pubs, I want Then vs Now price context on the map, so that old prices and today's prices become part of the story.

14. As a history-driven user, I want Story mode to surface Golden Days memories, heritage pubs, and landmarks, so that the map feels cultural and not only transactional.

15. As a user tapping a landmark, I want nearby story pubs and crawl starters, so that landmarks lead me into pub routes.

16. As a Landlord user, I want landmark and venue context to seed grounded prompts, so that The Landlord answers from known facts.

17. As a crawler, I want a route quality card with total estimated pint cost, walk distance, estimated time, story stops, cheap stops, and route warnings, so that I can pick a route confidently.

18. As a crawler, I want the app to label straight-line distance honestly, so that I do not mistake it for walking distance.

19. As a user planning with friends, I want an invite link that opens the same crawl on the map, so that a plan can become a group night.

20. As a friend receiving an invite, I want to see who sent it and what pubs are included, so that the link feels personal.

21. As a user, I want saved pubs to show on the map with a distinctive marker, so that my personal pub memory is visible.

22. As a user, I want saved-only mode to work across mobile and desktop, so that I can plan from places I already care about.

23. As a returning user, I want a Pint Passport that tracks pubs visited, boroughs explored, beers logged, and crawls completed, so that using the app feels collectible.

24. As a user, I want badges such as Cheap Legend, Golden Days, Crawl Author, Borough Regular, and Coding Pint, so that my profile has identity.

25. As a profile owner, I want profile editing to be tied to my authenticated account, so that another user cannot edit my handle's profile.

26. As a signed-in user, I want local/demo handle activity migrated into my profile where possible, so that I do not lose earlier activity.

27. As a profile viewer, I want a user's Pint Drops, crawl stories, badges, saved pubs, and passport progress to tell a coherent story, so that profiles feel like Letterboxd for pints.

28. As a Discover user, I want borough and Then vs Now cards to link directly into the map with context, so that discovery leads to action.

29. As a borough page visitor, I want page titles and previews to be clean and not duplicate the brand, so that shared pages look professional.

30. As a user sharing a Pint Drop or Crawl Story, I want rich previews to remain accurate and visual, so that links are worth sending.

31. As a user uploading photos, I want image metadata stripped and uploads normalized, so that I do not accidentally expose private location data.

32. As a moderator, I want hidden or reported media to stop being publicly accessible, so that takedowns are real.

33. As a maintainer, I want social actions rate-limited and actor-scoped, so that abuse does not break the demo or production app.

34. As a maintainer, I want old PRDs archived and active docs current, so that agents do not implement stale plans.

35. As a demo presenter, I want one polished flow from landing to map to Pint Drop to feed to profile to crawl share, so that the app feels ready.

36. As a London drinker, I want PUBMAXXING to show nearby Tube, Elizabeth line, DLR, Overground, and rail options from the pub, so that I can plan the end of the night without leaving the map.

37. As a crawler, I want a "Last Pint" card that tells me whether I can order one more pint and still make the train, so that the app feels useful in the exact pub moment.

38. As a user with a destination in mind, I want to set a station, postcode, or area as my trip home target for this session, so that PUBMAXXING can calculate a useful leave-by time without storing my home address by default.

39. As a privacy-conscious user, I want destination and transport choices to be session-scoped unless I explicitly save them, so that the app does not collect sensitive routine-location data.

40. As a user out late, I want line disruption warnings and last-safe-leave buffers, so that I do not trust a route that is already broken.

41. As a user who misses the train, I want PUBMAXXING to surface late-night fallback options such as night bus-aware routing in a later phase, so that the app still helps after the original plan fails.

42. As an accessibility-conscious user, I want transport cards to eventually include step-free and lift-disruption context, so that a route is not presented as viable when it is not viable for me.

43. As a maintainer, I want TfL API calls proxied and cached server-side, so that browser users do not receive API keys and live API failures do not break the map.

44. As a maintainer, I want static station POIs resolved to real TfL StopPoint IDs and cached, so that live arrivals can attach to the existing map layer instead of creating duplicate station data.

45. As a pub-history user, I want the map to combine transport, landmarks, boroughs, and pub stories, so that a crawl feels like London culture rather than a bare route planner.

## Implementation Decisions

### 1. Keep The Map As The Product Centre

Do not add more disconnected pages before improving the map. Feed, Discover, Boroughs, Profiles, Pint Drops, and Crawl Stories should all link back into the map with useful state.

Map links should support:

- Selected venue.
- Search or borough context.
- Loaded crawl route.
- Optional overlay mode.
- Optional inviter attribution.

### 2. Fix The Build-Mode Trust Bug First

Pin click should inspect only. It must not add or remove a route stop.

Route mutation should happen through explicit controls:

- Add to crawl.
- Remove from crawl.
- Clear route.
- Reverse route.
- Load curated route.

This is the first fix because it affects user trust.

### 3. Mobile Map Bottom Sheet

Replace the current mobile selected-pub card with a true bottom sheet.

Sheet tabs:

- Pints: prices, favorite pint availability, Pint Drops, Log a Pint Drop.
- Story: heritage, Golden Days memories, Landlord, landmark links.
- Crawls: Add/Remove, route position, nearby curated crawls.
- Details: address, amenities, saved lists, share/report.

Mobile layout rules:

- Hide or condense top nav when bottom tabs are visible.
- Keep primary actions above the bottom tab bar.
- Avoid nested scroll traps where possible.
- Use stable sheet heights and clear drag/close affordances.

### 4. Live Story Map Modes

Add map modes as typed overlays rather than one-off booleans scattered through the map.

Suggested modes:

- Default.
- Tonight.
- Story.
- Friends.
- Pint.
- Progress.
- Crawl.

Each mode should define:

- What pins or overlays are visible.
- What legend is shown.
- What card opens on marker tap.
- What empty state appears.
- What query state is encoded in the URL.

### 5. Tonight Mode And Presence

Add opt-in venue-level presence.

Presence should store:

- Profile or handle.
- Venue ID.
- Created timestamp.
- Expiry timestamp.
- Optional crawl ID or source.

Presence should not store continuous GPS trails.

Default expiry: roughly two hours.

Tonight mode should combine:

- Recent Pint Drops.
- Recent presence.
- Cheapest Pint Drops today.
- Friend activity if available.

### 6. Story Mode And Landmarks

Landmarks should not be isolated decorative dots. A landmark should connect to nearby pubs, sourced heritage, Golden Days memories, and Landlord prompts.

Story mode should show:

- Heritage pubs.
- Sourced claims.
- Golden Days Pint Drops.
- Nearby landmarks.
- Curated story crawls.

The Landlord should continue to be grounded in server-owned context. Do not pass arbitrary client context as source material.

### 7. Friends Mode

Friends mode should use the follow graph and saved/crawl activity.

It should show:

- Pubs saved by people I follow.
- Crawls posted by people I follow.
- Recent Pint Drops from people I follow.
- Invite links sent to me or from me when available.

For demo mode, use existing handle/follow fallbacks without pretending they are verified identity.

### 8. Pint Mode

Favorite-pint mode is already a strong idea. Expand it into a more deliberate Pint mode.

Pint mode should show:

- Pubs serving the selected beer.
- Cheapest known price for that beer.
- Recent Pint Drop price if fresher than dataset baseline.
- Then vs Now deltas where available.
- Missing-data prompts: "Log this pint here."

### 9. Progress Mode And Pint Passport

Add a Progress mode that turns usage into identity.

Track:

- Pubs logged.
- Boroughs explored.
- Beers logged.
- Crawls completed.
- Saved pubs.
- Cheapest pint found.
- Story Pint Drops posted.

Suggested badges:

- Cheap Legend.
- Golden Days.
- Crawl Author.
- Borough Regular.
- Coding Pint.
- Riverside Regular.
- Landlord's Favourite.

### 10. Last Pint TfL Layer

Add a transport layer that makes PUBMAXXING useful at the end of the night: users should be able to check whether they can finish one more pint and still catch a realistic train.

Use the official TfL Unified API behind server routes. The official Swagger at `https://api.tfl.gov.uk/swagger/docs/v1` currently exposes the required seams:

- StopPoint search for station resolution.
- StopPoint arrivals for live predictions.
- Line status by mode for disruption context.
- Journey results for route planning between a pub/station and a destination.

The product should not call TfL directly from the browser. Add a server-side TfL client that:

- Accepts a pub or coordinate pair, an optional destination, and the current session context.
- Finds nearby station POIs from the existing tube/station layer.
- Resolves station display names to TfL StopPoint IDs using StopPoint search.
- Caches station-name-to-StopPoint mappings for long periods.
- Caches live arrivals and line status for short periods, roughly 30-60 seconds.
- Returns normalized transport cards to the UI rather than raw TfL payloads.
- Redacts or avoids storing user destination data unless the user explicitly saves it.
- Degrades gracefully when TfL is unavailable.

Last Pint calculation:

1. Find the nearest viable departure station or station cluster.
2. Fetch live arrivals for relevant modes: tube, Elizabeth line, DLR, Overground, national rail where supported, and later bus.
3. Optionally fetch a Journey Planner result to the user's chosen destination.
4. Estimate walking time from pub to station using straight-line fallback first, clearly labeled.
5. Add a configurable buffer, defaulting to ten minutes.
6. Calculate a leave-by time.
7. Translate it into a pub-native answer:
   - "Order one more."
   - "Half pint only."
   - "Settle up now."
   - "Train risk: disruption on your line."

Initial UI surfaces:

- Venue sheet: Last Pint tab or compact transport strip.
- Crawl route card: final-stop transport warning.
- Tonight mode: late-night route risk badge.
- Share card: optional "made the last train" / "missed the last train" story badge.

Privacy rules:

- Never infer or store a user's home address.
- Let the user enter a destination station, postcode, or area per session.
- Only persist saved destinations if the user explicitly chooses that later.
- Do not combine presence, destination, and profile into a long-term movement trail.

Failure states:

- TfL unavailable: show nearest stations and "Live timings unavailable."
- No destination set: show nearby departures only and invite the user to add a destination.
- No StopPoint match: keep static POI display and avoid false live claims.
- Disrupted line: show the disruption before the countdown.

### 11. London API Expansion Roadmap

The attached API list should be treated as a roadmap, not a reason to add every data source at once. Prioritize APIs that deepen the core pub-night loop.

Recommended order:

1. TfL Unified API: Last Pint, station arrivals, line status, route-to-destination context.
2. postcodes.io: postcode and borough lookup for user-entered destinations and pub area labels.
3. Wikidata and Historic England: sourced pub, landmark, and heritage context for Story mode.
4. Overpass/OpenStreetMap: entrances, pedestrian context, toilets, water points, late-night amenities, and later safer walking routes.
5. Food Hygiene Rating Scheme: food-serving pub confidence, especially for crawl stops with meals.
6. London Datastore/GLA: borough boundaries and area metadata where current static data is weak.
7. London Air/Breathe London: optional "fresh air route" or beer-garden context, low priority.
8. data.police.uk: safety-context research only. Do not build fear-based pub rankings or present raw crime counts without careful framing.
9. Eventbrite/Meetup: nearby events that can become crawl starters, low priority until the core map loop is stronger.

Every external-data feature should answer one of these questions:

- Where should I drink tonight?
- What is the story behind this place?
- Can I get home after one more pint?
- What can I share afterwards?

### 12. Auth Ownership Upgrade

Google auth scaffolding exists, but ownership is not yet enforced. Opus should upgrade profile editing and future destructive/private actions to authenticated ownership.

Rules:

- A signed-in user can claim or link a handle.
- A profile row should link to an auth user.
- Only the owner can edit that profile.
- Existing handle/demo activity should be migrated or associated carefully.
- Anonymous browsing remains public.
- Demo mode remains available for non-production or unconfigured environments.

### 13. Media And Moderation Hardening

Before public launch:

- Strip EXIF from uploaded images.
- Normalize image dimensions and size.
- Validate MIME and magic bytes.
- Prefer private buckets plus signed URLs for user media.
- Do not issue signed URLs for hidden or quarantined content.
- Keep actor-scoped reports.
- Add moderation visibility for Pint Drops and comments.
- Rate-limit uploads, reports, comments, reactions, follows, saves, and crawl story creation.

### 14. Visual And Product Polish

Keep the visual identity specific to pubs, nights, and stories:

- Beer mats.
- Receipts.
- Pub chalkboards.
- Crawl route stamps.
- Photo strips.
- Brass/ink map language.
- Historic plaque cues.

Avoid generic SaaS panels where a pub-native object can work better.

Polish priorities:

- Mobile map chrome.
- Shared navigation consistency.
- Skeleton and empty states.
- Duplicate metadata titles.
- Inline styles in normal app UI.
- Active docs and screenshots.

### 15. Documentation And Handoff

Update docs so Opus and future agents have one source of truth.

Required:

- Treat this PRD as the Opus execution plan.
- Keep `cc_plan2.md` as broader background.
- Keep `docs/ACTIVE_PLAN.md` pointed at the current PRD.
- Archive or mark older PRDs as superseded.
- Refresh demo deck once the next map work lands.
- Update deployment docs around private storage, Supabase migrations, auth provider configuration, and Vercel environment variables.

## Testing Decisions

### Highest-Value E2E Seam

The highest-value test seam is the user-visible social map loop:

1. Open landing.
2. Navigate to map.
3. Switch to build mode.
4. Tap a pub pin and verify route stop count does not change.
5. Add the pub through the explicit Add action.
6. Save or share a crawl.
7. Log a Pint Drop.
8. See the Pint Drop in feed with a real pub name.
9. Open the Pint Drop permalink.
10. React/comment.
11. Open the profile.
12. Return to map with the same pub selected.

### Browser QA

Run Playwright checks at:

- Desktop 1440px.
- Tablet 768px.
- Mobile 375px.

Pages and states:

- Landing.
- Map default.
- Map build mode.
- Map mobile sheet.
- Feed.
- Pint Drop permalink.
- Profile.
- Crawl Story.
- Discover.
- Borough page.

### Unit And Integration Tests

Add focused tests for:

- Build-mode inspect-only behavior.
- Map mode DTO normalization.
- Presence expiry.
- Landmark-to-nearby-pub matching.
- Route quality calculations.
- Favorite-pint price resolution.
- Nearest-station matching from venue coordinates.
- StopPoint resolution and cache behavior.
- TfL arrivals normalization and sorting.
- Last Pint leave-by calculation including walk time and buffer.
- Line disruption fallback messaging.
- TfL outage handling without map failure.
- Destination privacy: session-only by default.
- Progress/passport stats.
- Auth ownership for profile edits.
- Media validation.
- Hidden media URL behavior.
- Borough metadata title generation.

### Acceptance Criteria

The next Opus batch is done when:

- Pin tap no longer mutates crawls.
- Mobile map has no top/bottom nav crowding and venue detail is a bottom sheet.
- At least Story mode and Tonight mode exist as map overlays.
- Landmarks connect to nearby story pubs.
- Favorite-pint mode feels like a real map mode.
- A Last Pint transport card works with mocked TfL responses.
- TfL calls are server-proxied, cached, and never expose API credentials to the browser.
- The UI clearly distinguishes live arrivals from static station POIs.
- A user can set a destination for the current session or skip destination-based routing.
- Profile edits require authenticated ownership in configured environments.
- Borough title duplication is fixed.
- Active docs point to the current plan.
- Existing lint, typecheck, unit tests, build, and Playwright tests pass.
- New tests cover the new map behavior.

## Out Of Scope

Do not include these in this Opus batch:

- Native iOS or Android app.
- Payments.
- Pub-owner dashboard.
- Event ticketing.
- Real-time chat.
- Complex recommendation ML.
- Storing a home address by default.
- Guaranteeing train availability or replacing TfL's own journey planner.
- Taxi booking.
- Full multimodal transport optimization beyond the first TfL-backed Last Pint slice.
- Replacing MapLibre.
- Multi-city launch beyond London.
- Full production launch/deployment work unless explicitly requested.

## Further Notes

Keep the product line simple:

> Every pint has a story.

Supporting line:

> PUBMAXXING brings back cheap pints, chaotic nights, and the pub stories worth remembering.

The next implementation should make the app feel less like a feature collection and more like a night out: open the map, find the story, log the pint, invite the friend, remember the crawl.
