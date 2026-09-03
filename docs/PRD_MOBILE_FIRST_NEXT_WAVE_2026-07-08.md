# PRD: PUBMAXXING Mobile-First Next Wave

Date: 2026-07-08

## Problem Statement

PUBMAXXING already has the ingredients of a strong London pub product: a fast
slim-index map, venue sheets, Pint Drops, Last Pint transport help, crawl
planning, route exports, drinks menus, social feed surfaces, ledger pages,
profiles, ratings, and a landing page with a clear cultural point of view.

The demo risk is now concentrated on mobile. Most real use will happen on a
phone outside a pub, in a group chat, on a train platform, or during a crawl.
That context is unforgiving:

- The map must feel useful in the first few seconds, before the user reads copy.
- The primary action, dropping a pint, must be reachable from anywhere.
- The route planner must not feel like an abstract control panel; it must answer
  "where are we going, how far is it, and can we still get home?"
- The venue sheet must work as a thumb-first bottom sheet, not a desktop sidebar
  squeezed into a phone.
- Landing-to-map must be instant enough that a demo viewer does not bounce before
  the product reveals itself.
- Provenance and demo labels must stay honest while the interface feels alive.
- Any active parallel work in the current branch must be completed, tested, or
  deliberately left out before production claims.

The current dirty worktree already contains useful mobile-facing work:
map-route persistence, a mapped-route chip, a "Map route" prompt, Last Train
handoff to the final stop, route data warmup from the mobile tab bar, compact nav
labels, removal of public Admin links, and home links on permalink/ledger pages.
This PRD treats that as in-progress work to finish rather than work to discard.

## Solution

Ship the next wave as a mobile-first consolidation and feature pass. The product
should open like a pocket London pub guide: fast map, obvious action, route
confidence, and a venue sheet that lets someone decide, log, share, and get home
without hunting.

The work is split into four product layers:

1. **Mobile App Shell**
   Make the phone layout stable, thumb-reachable, and unambiguous. The bottom tab
   bar owns primary navigation. The floating top nav becomes compact utility
   chrome. Overlay chips must never fight the bottom sheet, POI controls, legend,
   or mobile safe area.

2. **Mobile Map Core Loop**
   Make the map answer the first three user questions: "what is cheap near me?",
   "what crawl should we do?", and "where do I drop this pint?" Route lines should
   appear only after intent and remain visible when mapped. Pint logging should
   be globally reachable and land in the existing single composer path.

3. **Venue Sheet as the Mobile Command Center**
   Treat the venue sheet as the core mobile surface. Tabs should keep the sheet
   scannable: Overview, Drops, Drinks, Lore, Ask, Last Train. The sheet should
   carry sticky actions for Drop a pint, Add to crawl, Save, Share, and Last Train
   when context supports them.

4. **Perceived Speed and Demo Trust**
   Preload only the cheap things. Keep the slim map first. Warm map data from
   navigation intent only when network conditions allow it. Use skeletons and
   cached data to make the app feel ready, while every demo, sourced, contributor,
   and anecdote claim remains visibly labelled.

## User Stories

1. As a mobile visitor, I want the first screen to make the product obvious in
   under three seconds, so that I understand why I should open the map.
2. As a mobile visitor, I want the landing page CTA to take me to a ready map, so
   that the demo does not stall during the transition.
3. As a mobile visitor on a slow network, I want a branded loading scene that
   explains what is loading, so that the app feels alive rather than broken.
4. As a mobile map user, I want pins to appear without downloading every venue
   detail, so that the map feels instant.
5. As a mobile map user, I want controls kept out of the safe-area and tab bar,
   so that I can tap them without accidental navigation.
6. As a mobile map user, I want one primary bottom navigation pattern, so that I
   do not have to choose between two competing nav systems.
7. As a mobile map user, I want the floating top nav to stay compact, so that it
   never overlaps the map or mode controls.
8. As a mobile map user, I want route lines hidden until I ask for them, so that
   the first map is not visually noisy.
9. As a mobile map user, I want a "Map route" action on suggested crawls, so that
   a crawl becomes spatial only when I have intent.
10. As a mobile map user, I want the mapped route chip to show distance and time,
   so that I know whether the crawl is realistic.
11. As a mobile map user, I want to hide a route line without losing my stops, so
   that I can clean up the map while keeping the plan.
12. As a mobile map user, I want to edit a mapped crawl from the route chip, so
   that the route remains recoverable after I close the planner.
13. As a mobile map user near a pub, I want a "Near me" route that explains the
   distance from me to the first stop, so that I know whether it is walkable.
14. As a mobile crawl planner, I want the route panel to offer walking time,
   straight-line caveats, and on-the-way places, so that the plan feels grounded.
15. As a mobile crawl planner late at night, I want to check the last train at
   the final stop, so that the crawl has a responsible endpoint.
16. As a mobile crawl planner, I want Last Train to open in the venue sheet, so
   that the transport decision stays tied to the pub I will end at.
17. As a mobile user anywhere in the app, I want the Log tab to actually start a
   pint-drop flow, so that the main action is never a dead link.
18. As a mobile user with location allowed, I want Log to suggest nearby pubs, so
   that dropping a pint takes two taps.
19. As a mobile user without location allowed, I want Log to fall back to search,
   so that privacy choices do not block contribution.
20. As a contributor, I want all entry points to use one Pint Drop composer, so
   that posting behavior is consistent.
21. As a contributor, I want my draft preserved while the sheet changes tabs, so
   that I do not lose a note in a pub.
22. As a contributor, I want the composer to make price, drink, photo, vibe, and
   visibility clear on mobile, so that posting is fast and deliberate.
23. As a sober-curious user, I want low/no and non-beer options to be visible in
   the venue sheet, so that the app does not feel beer-only.
24. As a cocktail or wine user, I want drinks menu data exposed where it exists,
   so that PUBMAXXING can plan a full night out.
25. As a user deciding between pubs, I want cheapest pint, latest contributor
   price, story, and travel risk in one sheet, so that I do not have to inspect
   multiple pages.
26. As a mobile user, I want venue tabs to be short and thumb-friendly, so that I
   can switch context quickly.
27. As a keyboard or screen-reader user, I want venue tabs to follow expected tab
   semantics, so that the mobile redesign does not reduce accessibility.
28. As a user reading a shared Pint Drop, I want a home affordance, so that a
   shared card can pull me back into the product.
29. As a user reading a ledger page, I want a home affordance, so that the ledger
   is not a dead-end.
30. As a public viewer, I do not want Admin links in the public landing nav, so
   that the product feels intentional.
31. As a public viewer, I want demo content to be labelled honestly, so that I
   understand what is seeded and what is user-submitted.
32. As a demo lead, I want demo activity to feel current without faking source
   provenance, so that the city feels alive and truthful.
33. As a mobile feed user, I want every card to offer a clear map/action path, so
   that the feed is not a passive timeline.
34. As a profile user, I want badge progress to tell me what I can do next, so
   that the product has a reason to return.
35. As a group planning a night out, I want to share a crawl link, so that friends
   can open the same route.
36. As a group planning a night out, I want calendar export available but not
   dominant, so that the mobile UI stays focused.
37. As a user near closing time, I want "settle up now" or "one more is safe"
   guidance labelled as live, scheduled, or fallback, so that I know how much to
   trust it.
38. As a maintainer, I want mobile changes to have behavior tests where possible,
   so that CSS and state regressions are caught before a demo.
39. As a maintainer, I want browser QA at 390px and 430px widths, so that the
   exact demo phone experience is checked.
40. As a maintainer, I want the generated `next-env.d.ts` dev-path churn removed
   before shipping, so that commits do not carry local dev artifacts.
41. As a maintainer, I want route mapping tests to prove the line appears only
   after intent, so that the clean first-map principle remains true.
42. As a maintainer, I want mobile prefetch to respect Save Data and 2G, so that
   performance improvements do not punish constrained devices.
43. As a maintainer, I want map warmup to be best-effort and non-blocking, so that
   navigation never depends on a prefetch.
44. As a maintainer, I want all public social surfaces to use the same privacy
   vocabulary, so that "demo", "sourced", "contributor", and "anecdote" never
   drift.
45. As a future Opus/Fable/Codex agent, I want a sequenced mobile roadmap, so
   that parallel work can happen without file conflicts.

## Implementation Decisions

### Mobile Design Direction

- The mobile product should feel like a pocket pub atlas, not a generic map app:
  dark brass accents, data stamps, compact labels, and a strong London/pub
  vocabulary.
- Spend visual boldness on the map and route confidence surfaces. Keep controls
  dense, quiet, and obvious.
- Avoid card-in-card layouts. Use sheets, bands, chips, and pinned controls.
- Use icons for navigation and compact controls. Text labels remain only where
  clarity matters.
- The mobile bottom tab bar owns primary navigation. Top nav compresses to brand
  plus utility controls and should never compete for thumb attention.
- All mobile touch targets should be at least 44px where they are primary
  actions, with safe-area padding where controls approach the bottom edge.

### Wave 1: Finish Active Mobile Route Work

- Complete the current route-intent model:
  - Suggested routes exist without drawing a route line.
  - "Map route" makes the line visible.
  - Curated crawls and Near Me routes map immediately because user intent is
    explicit.
  - A mapped route chip persists when the planner closes.
  - Hide line hides only the line, not the stop list.
- The route chip should never overlap the mobile venue sheet, bottom tab bar,
  POI controls, legend, or story-band picker.
- The route panel should present walking distance/time and the straight-line
  caveat without making it sound like turn-by-turn routing.
- Last Train from a crawl should select the final stop and open the venue sheet
  on the Last Train tab.
- Tests should cover stateful route intent at the component/helper seam where
  feasible, and browser QA should cover final layout.

### Wave 2: Make Log a Real Global Mobile Action

- `/map?log=1` should be a real entry point.
- The mobile Log tab should route to `/map?log=1`, not a dead query string.
- On map load with `log=1`, the app should:
  - request geolocation only after a user-visible action or clear prompt;
  - use nearest venue suggestions when location is available;
  - fall back to search/select when location is unavailable;
  - open the existing venue sheet and Pint Drop composer, not a second composer.
- Feed, Activity, profile, and shared drop pages should link to the same logging
  seam rather than inventing local posting surfaces.
- Draft persistence should be handled at the composer/sheet seam before adding
  more fields.

### Wave 3: Mobile Venue Sheet Polish

- The venue sheet remains the single command center for a pub.
- Tabs should stay:
  - Overview for price/story/access quick decision.
  - Drops for community activity and composer.
  - Drinks for full menu.
  - Lore for sourced/anecdotal story.
  - Ask for Pubmaxxer/assistant flow.
  - Last Train for transport decision.
- Add or preserve sticky primary actions:
  - Drop a pint.
  - Add/remove crawl stop.
  - Save pub.
  - Share.
  - Check last train when context supports it.
- Ensure tab reset logic supports programmatic initial tabs without leaving stale
  tabs across venues.
- Ensure the Last Train decision never leaks from one venue to another.

### Wave 4: Mobile Landing-to-Map Speed

- Keep landing page copy first on mobile, but reduce any visual weight that delays
  the map CTA.
- Remove public Admin affordances from public nav and footer.
- Warm `/map` and small data payloads on map CTA intent only.
- Do not prefetch heavy full venue detail on the landing page.
- The map route should use the existing map skeleton and loading state so the
  transition feels deliberate.

### Wave 5: Trust, Privacy, and Social Readiness

- Keep "demo" as the label for seeded demo content.
- Reserve "sourced" for externally sourced price/history claims.
- Gate comments/reactions by parent visibility.
- Redact ledger-only public drops until account-backed privacy exists.
- Keep public browse possible, but avoid raw private/social table exposure.
- Treat Supabase Auth and true ownership as a later phase unless the feature
  requires it.

### Wave 6: Performance and Release Hygiene

- Keep `venues_slim.json` as the first map payload.
- Keep venue details lazy and cacheable.
- Use mobile tab/network warmup as a best-effort hint only.
- Respect Save Data and 2G/slow-2G.
- Add tests for warmup behavior without relying on real network.
- Remove local generated churn from `next-env.d.ts` before committing.
- Use Vercel/local `npm run ci` as the reliable deployment gate while GitHub
  Actions startup failures remain platform-level noise.

### Future Feature Catalog

- Real Log flow from every route.
- Nearby pub picker with search fallback.
- Draft-preserving Pint Drop composer.
- Mobile venue sheet sticky action bar.
- Responsible Last Pint decision cards.
- Crawl route packs: Thames, heritage, quiet table, cheap chaos, late train.
- Shareable crawl cards and route snapshots.
- Tonight board: fresh demo/user activity with honest provenance.
- Badge progress chips for profile/activity/venue.
- Pub passport by borough, drink category, and story type.
- Friends/following lists with account-backed ownership.
- Comments/reactions privacy hardening.
- Message thread privacy and ownership.
- Ratings by drink and venue with sample-size floors.
- All-drinks filters: beer, wine, cocktails, spirits, low/no.
- Price freshness and stale-price UI.
- Scheduled governed price refresh PRs.
- Offline-friendly map/list fallback.
- Add-to-home-screen/PWA install polish.
- Push-like notification groundwork once auth exists.
- Account-backed profile ownership and private resources.
- Admin moderation with server-side sessions.

## Testing Decisions

- Prefer behavior tests at seams the user experiences:
  - mobile tab warmup behavior;
  - route intent state;
  - Last Train final-stop handoff;
  - query-param logging entry;
  - composer opening from the map;
  - venue tab reset by selected venue and initial tab;
  - public Admin links absent from landing.
- Keep pure helper tests for distance, route legs, and badge progress.
- Use browser QA for layout:
  - mobile 390x844;
  - mobile 430x932;
  - desktop 1440x900.
- Mobile browser QA acceptance should include screenshots of:
  - landing first viewport;
  - `/map` initial clean state;
  - planner open;
  - route mapped with planner closed;
  - venue sheet half snap;
  - Last Train tab opened from a route.
- `npm run ci` remains the release gate: data validation, lint, typecheck,
  coverage, and production build.
- Known non-blocking warnings should be listed explicitly rather than hidden.

## Out of Scope

- Native iOS/Android apps.
- Payments, split bills, or pub-owner dashboards.
- New scraping of third-party price sources.
- Supabase Auth migration unless required by the specific slice being shipped.
- New database migrations for the first mobile polish wave.
- Turn-by-turn navigation. Route distances remain honest straight-line/walking
  estimates until a real routing engine is introduced.
- Replacing the current design system wholesale.

## Further Notes

- The current branch already has uncommitted mobile/UI changes from parallel
  agents. Treat them as WIP. Do not revert them casually.
- `next-env.d.ts` currently points at `.next/dev/types/routes.d.ts`; that looks
  like local dev churn and should be restored before a clean commit unless a
  Next.js version change explicitly requires it.
- The first implementation wave should finish and verify the active mobile route
  work before starting the full global Log flow. The Log flow is the highest
  product leverage after route confidence, but it touches more state and should
  be a separate, reviewable slice.
- The demo should favor mobile map quality over adding new desktop-only surfaces.
