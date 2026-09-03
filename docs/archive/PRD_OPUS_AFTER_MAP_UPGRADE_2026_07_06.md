# PRD: OPUS After Map Upgrade - Story, Last Pint, Passport

## Problem Statement

PUBMAXXING has moved beyond the older "price map" phase. The latest branch now has a premium OpenFreeMap basemap, 3D buildings, recognizable London landmark markers, real landmark photos, exact TfL-style transport symbols, colored London rail lines, curated crawls on the `/crawls` empty state, a shared mobile-safe nav, hidden public Admin links, baseline security headers, `/data` cache headers, and the PUBMAXXER rename.

That means the next Opus batch should not repeat the previous fixes. The new problem is that the product has rich visual ingredients but still needs a stronger guided loop:

Map landmark -> story image -> nearby pubs -> route -> Last Pint transport check -> Pint Drop -> profile/passport -> share.

Current gaps:

- The map has beautiful static landmark and transport layers, but landmarks do not yet become full pub-story journeys.
- The transport layer is visually recognizable, and a first `/api/last-train` seam exists locally, but it is not yet integrated into the venue sheet or upgraded into a real "can I finish one more pint?" decision.
- Mobile map UI is much improved, and a first venue tab scaffold exists locally, but route, story, and transport surfaces still need a deliberate sheet/tab model that feels finished on phones.
- `/u/you` and profile surfaces still need a richer first-run/demo state and a real Pint Passport identity loop.
- Google auth is scaffolded, but profile ownership and social writes still need authenticated ownership before public launch.
- Security headers exist, but the full CSP, signed-media strategy, API caching, and observability are not complete.
- Landmark content exists, but source quality, image licensing/crediting, and pub-nearby connections need a hardening pass.

## Solution

Build the **Story And Last Pint Map Layer** on top of the upgraded map.

The next batch should make the map feel like a living London pub atlas:

- Landmark story cards with real photos, source credits, nearby pubs, and route starters.
- Story bands or routes that connect landmark history to heritage pubs and crawl memories.
- Finish the started Last Train seam into a Last Pint transport card using server-proxied TfL data for station resolution, arrivals, line status, and leave-by decisions.
- Finish the started mobile venue sheet into clear tabs: Pints, Story, Crawl, Last Pint.
- A profile/passport layer that turns pub actions into collectible identity.
- A tighter production-readiness pass around auth ownership, caching, CSP, media privacy, and source provenance.

The product sentence remains:

> Every pint has a story.

The operational product loop should now become:

1. Open the map.
2. Tap a landmark, transport symbol, pub, or crawl route.
3. See a grounded, visual story card.
4. Start or join a nearby crawl.
5. Check Last Pint before ordering another round.
6. Log a Pint Drop.
7. Share the pint/crawl.
8. Update the user's passport and profile.

## User Stories

1. As a new visitor, I want the first map view to show pubs, stories, landmarks, and transport without overwhelming me, so that I understand PUBMAXXING quickly.

2. As a map user, I want tapping a landmark to open a rich visual story card, so that London history becomes part of my night out.

3. As a history-driven user, I want each landmark card to show a real image, a short sourced history, and a source link, so that I can trust what the app says.

4. As a crawler, I want a landmark card to show nearby pubs worth walking to, so that a landmark becomes a route starter rather than a decorative marker.

5. As a tourist, I want a "start crawl here" action from a landmark, so that I can begin with Big Ben, Tower Bridge, Borough Market, Camden Lock, or another recognizable place.

6. As a Londoner, I want landmark stories to connect to pub stories rather than generic tourism copy, so that the product still feels pub-native.

7. As a user, I want PUBMAXXER prompts to be seeded from the selected landmark or pub, so that the assistant answers with grounded local context.

8. As a user, I want story bands on the map that connect clusters of landmarks and pubs, so that I can follow a cultural thread across London.

9. As a mobile user, I want venue detail to be a true bottom sheet with tabs, so that I can move between Pints, Story, Crawl, and Last Pint without losing the map.

10. As a mobile user, I want the sheet's primary action to stay above the bottom tab bar, so that I can save, log, add, or check transport without awkward scrolling.

11. As a crawler, I want route cards to include nearby landmark/story stops, so that a crawl has character beyond price and distance.

12. As a crawler, I want route quality to show total estimated pint cost, straight-line distance, estimated walk warning, story stops, cheap stops, and transport risk, so that I can compare routes honestly.

13. As a user going out tonight, I want a Last Pint card for a selected pub, so that I can know if I can order another pint and still leave on time.

14. As a user with a destination, I want to enter a station, postcode, or area for this session, so that leave-by timing is useful without storing my home address.

15. As a privacy-conscious user, I want destination data to stay session-only unless I explicitly save it, so that the app does not build a movement profile.

16. As a user, I want nearby station options to include Tube, Elizabeth line, DLR, Overground, National Rail where available, bus, and river where useful, so that London transport feels complete.

17. As a user, I want Last Pint to show line disruption warnings before the countdown, so that I do not rely on a broken route.

18. As a user, I want the answer to be pub-native, such as "Order one more", "Half pint only", "Settle up now", or "Train risk", so that it feels like PUBMAXXING rather than a transit dashboard.

19. As a user who has not set a destination, I want to see nearby live departures and a prompt to add a destination, so that the feature is still useful.

20. As a user, I want TfL failures to degrade to static station context, so that the map never feels broken.

21. As a returning user, I want a Pint Passport on my profile, so that pubs visited, beers logged, boroughs explored, crawls completed, and story posts become collectible.

22. As a demo visitor, I want `/u/you` to show a compelling first-run profile state, so that the profile tab does not feel empty before sign-in.

23. As a signed-in user, I want my profile edits, follows, saved pubs, and future private preferences tied to my authenticated account, so that another user cannot act as my handle.

24. As a user who contributed before signing in, I want local/demo activity to migrate or link safely after auth, so that I do not lose my earlier Pint Drops.

25. As a feed user, I want story and transport context to appear on Pint Drops where relevant, so that a pint can say "made the last train" or "started at Tower Bridge."

26. As a Discover user, I want editorial lanes to deep-link into the exact map mode, landmark, crawl, or beer, so that discovery always leads to action.

27. As a borough page visitor, I want borough pages to include story/transport/crawl entry points, so that each borough has a clear night-out path.

28. As a maintainer, I want external API calls to be server-proxied and cached, so that keys stay private and provider outages do not break the UI.

29. As a maintainer, I want map data payloads monitored and optimized, so that the rail network and POI layers do not make the first map load feel heavy.

30. As a maintainer, I want landmark facts and images to carry source and license metadata, so that the app can be shared publicly without weak provenance.

31. As a maintainer, I want a full Content Security Policy tested against MapLibre, Supabase, Wikimedia images, TfL, and the inline theme script, so that security improves without silently breaking the map.

32. As a moderator, I want user media to use private storage plus signed URLs for non-public/hidden content, so that moderation takedowns are real.

33. As a maintainer, I want read endpoints to use explicit cache headers where safe, so that the demo and production app stay fast under repeated visits.

34. As a QA reviewer, I want mobile and desktop browser tests to assert the actual map UI contract, so that visual regressions are caught before demo day.

35. As Opus, I want one current PRD that marks old work as done and prioritizes the next slice, so that implementation does not waste time on stale tasks.

## Implementation Decisions

### 1. Treat Latest Map Work As The New Baseline

Do not re-implement:

- Shared mobile-safe navigation.
- Admin link hiding in production navigation.
- Handle-display normalization.
- Baseline security and `/data` cache headers.
- Curated crawl cards on the `/crawls` empty state.
- Static landmark markers with photos/history.
- Real-colored London rail line geometry.
- TfL-style static transport symbols.
- PUBMAXXER rename.

Also do not duplicate the local uncommitted Last Train and venue-tab scaffolding. Build on these seams:

- `app/api/last-train/route.ts`
- `lib/tfl.ts`
- `components/map/LastTrainCard.tsx`
- `components/map/VenueInspector.tsx` Getting Home tab placeholder
- `components/map/venueSheet.css`

The next batch should finish, integrate, harden, and test these seams.

### 2. Landmark Story Cards And Story Bands

Promote landmarks from marker cards into route/story entry points.

Each landmark card should include:

- Real image with visible credit.
- Short sourced history.
- Source link.
- Nearby pubs by distance and story relevance.
- "Start crawl here" action.
- "Ask PUBMAXXER" action.
- Optional "save for later" action.

Story bands should be typed map overlays, not ad hoc UI:

- River history.
- Writers and Fleet Street.
- Old markets and theatre.
- Royal/civic London.
- Industrial/Thames-side pubs.
- Coding pint / work-friendly pubs.

Each band should define its landmark anchors, nearby pub candidates, suggested copy, URL state, and empty/fallback state.

### 3. Last Pint TfL Slice

Finish Last Pint as a server-owned feature.

Current local seam:

- `/api/last-train?lat=..&lng=..` resolves a nearby station and last trains via TfL.
- `lib/tfl.ts` contains pure helpers for TfL line colours, day types, and after-midnight formatting.
- `__tests__/tfl.test.ts` covers the pure helper logic.
- `LastTrainCard` fetches the route and renders station/last-train rows.
- `VenueInspector` has a Getting Home tab with a placeholder mount, but it does not yet render `LastTrainCard`.

Immediate integration work:

- Render `LastTrainCard` inside the Getting Home tab using the selected venue coordinates.
- Replace or remove the placeholder copy once the card is mounted.
- Move the card's inline styles into `venueSheet.css` or a scoped map CSS module to keep the visual system maintainable.
- Add mocked integration tests for `/api/last-train` success, TfL failure, invalid coordinates, and station-with-no-trains states.
- Add a browser test proving the Getting Home tab opens and renders mocked transport state on mobile.
- Keep `TFL_APP_KEY` optional locally, but document it for production to improve rate-limit headroom.

Required server seams:

- TfL StopPoint search/resolution for station IDs.
- TfL arrivals for live predictions.
- TfL line status for disruption context.
- Optional Journey Planner request for destination-aware routing.
- postcodes.io lookup for postcode/area destination support.
- Cache layer for station resolution and live arrivals/status.

Initial normalized DTO:

```ts
type LastPintDecision =
  | "order_one_more"
  | "half_pint_only"
  | "settle_up_now"
  | "train_risk"
  | "live_data_unavailable";

type LastPintCard = {
  pubId: string;
  generatedAt: string;
  decision: LastPintDecision;
  leaveByIso: string | null;
  stationName: string | null;
  lineNames: string[];
  disruptionSummary: string | null;
  walkMinutesEstimate: number | null;
  bufferMinutes: number;
  destinationLabel: string | null;
  live: boolean;
};
```

Privacy rules:

- Never infer home.
- Destination is session-scoped by default.
- Persist saved destinations only behind explicit opt-in after auth ownership exists.
- Do not combine presence, destination, and profile into a long-term movement trail.

### 4. Mobile Sheet Model

Replace compressed desktop panels with an intentional sheet model on small screens.

Venue sheet tabs:

- Pints: prices, favorite-pint availability, Pint Drops, log action.
- Story: landmark/pub history, images, PUBMAXXER, source links.
- Crawl: add/remove, route position, nearby curated crawls.
- Last Pint: station, departure, line status, leave-by answer.

Sheet behavior:

- Stable height states.
- Clear close affordance.
- Primary action above mobile tab bar.
- No nested scroll traps where avoidable.
- Keyboard/focus order remains predictable.

### 5. Profile And Pint Passport

Make profile the memory layer, not only a feed list.

Passport metrics:

- Pubs logged.
- Boroughs explored.
- Beers logged.
- Crawls completed.
- Saved pubs.
- Cheapest pint found.
- Story Pint Drops posted.
- Last-train saves/misses as optional story badges.

Default `/u/you` should not feel empty. It should either:

- Show a first-run profile builder with clear actions and sample passport state, or
- Route demo users to a seeded profile until auth/profile activity exists.

### 6. Auth Ownership Upgrade

Google auth is scaffolded, but ownership is the next production boundary.

Rules:

- Profiles should link to Supabase Auth user IDs.
- Profile edits require authenticated ownership.
- Future saved destinations require authenticated ownership.
- Self-asserted handles may remain as demo/anonymous contribution labels, but not as authority for private/destructive actions.
- Existing handle activity should be linkable with explicit user action.

### 7. Performance, Caching, And Payload Discipline

The rail geometry and static datasets add product value, but map load must stay fast.

Actions:

- Measure `/map` transfer size after gzip/brotli in production.
- Consider simplifying or tiling `tfl_lines.json` if it materially slows first load.
- Keep rail/POI lines lazy and zoom-gated.
- Cache `/data/*` aggressively, already started in `next.config.mjs`.
- Add cache headers for safe public reads.
- Add short server cache for TfL live data and long cache for StopPoint resolution.
- Add observability logs for external API latency and fallback rates.

### 8. Security And Source Hardening

Security headers exist, but CSP is intentionally deferred. Add CSP only after validating:

- MapLibre workers and blob URLs.
- OpenFreeMap tile/style hosts.
- Supabase Auth and Storage.
- Wikimedia Commons images.
- TfL and postcodes.io server routes.
- Inline no-flash theme script hash/nonce.

Source hardening:

- Prefer primary sources over Wikipedia where available.
- Keep image credit visible on story cards.
- Track image URL, source URL, license/credit, and last reviewed date.
- Do not present anecdotal pub claims as sourced history.

## Testing Decisions

Use high-level browser seams first. The goal is to test user-visible behavior, not MapLibre internals.

Required E2E coverage:

1. Desktop map loads with pub pins, landmark icons, transport symbols, and rail lines or a clear fallback.
2. Mobile `/map` shows no top/bottom nav crowding and sheet primary actions clear the bottom tab bar.
3. Tapping a landmark opens a story card with image, credit, source link, nearby pubs, and route action.
4. Starting a crawl from a landmark opens the map in build mode with route stops.
5. Venue sheet tabs switch among Pints, Story, Crawl, and Last Pint.
6. Last Pint mocked response renders each decision state.
7. TfL outage mocked response renders "live data unavailable" without breaking the map.
8. `/u/you` renders a useful first-run profile/passport state.
9. Auth-owned profile edit is rejected for non-owners and accepted for owners.
10. Public pages still render under the final CSP.

Required unit/integration coverage:

- Landmark-to-nearby-pub matching.
- Story band DTO normalization.
- StopPoint resolution cache.
- TfL arrivals sorting and line-status normalization.
- Last Pint leave-by calculation.
- Destination privacy/session behavior.
- Passport metrics aggregation.
- Profile ownership checks.
- Cache header helpers.
- CSP header generation, if implemented as a helper.

Regression coverage:

- Existing map smoke test should wait for dynamic loading to resolve or a clear fallback state.
- Existing feed/profile tests should continue to prove raw `venue-*` IDs and double-`@@` handles do not leak.
- Existing admin API tests should continue to prove header-only moderation token behavior.

## Out Of Scope

- Native mobile apps.
- Payments or pub-owner dashboards.
- Taxi booking.
- Full multimodal optimization beyond the first TfL-backed Last Pint slice.
- Storing home addresses by default.
- Replacing MapLibre or OpenFreeMap.
- Rewriting the whole design system.
- Expanding beyond London before the London loop is excellent.

## Further Notes

The next iteration should make the upgraded map feel inevitable: not a generic map with pub dots, but a London night-out instrument. The strongest feature bet is **Last Pint** because it is specific, useful, and memorable. The strongest design bet is **landmark-to-pub story bands** because it turns history, photos, and pub crawls into one product loop.

Keep the copy grounded:

- Every pint has a story.
- Bring back cheap pints, chaotic nights, and the pub stories worth remembering.
- Last Pint: know when to order one more, and when to settle up.
