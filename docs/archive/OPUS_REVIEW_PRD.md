# PubMaxing PRD for Opus Review

> **Superseded** — see docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md and cc_plan.md

## Problem Statement

London pub discovery is currently split across price lists, generic map directories, social posts, and personal memory. A person planning a pub night can find cheap pints, or nearby venues, or a few famous historic pubs, but the experience rarely combines price, walkability, setting, venue heritage, and trusted local recommendations in one place.

PubMaxing is trying to solve a more specific problem than "find a pub": help people choose a Crawl Route that is worth leaving the house for. The product should make the tradeoff visible: a cheaper pint, a better room, a riverside setting, a stronger story, or a venue that someone knowledgeable actively recommends.

The current prototype proves the map-led crawl planner direction, but it now needs a more intentional product and UI layer. The OPUS proposal correctly pushed toward story, heritage, by-water discovery, and a seeded crawl. The latest work adds the first editorial curation layer around Alastair Hilton, `@London_W4`, and his book *The Greatest Pubs*, but this layer is still seed content. It needs validation, provenance, a better visual system, and a path toward community contributions.

## Solution

Build PubMaxing as a price-aware, story-led London pub crawl planner.

The first-screen experience should remain the actual tool: a full London map, control rail, and Crawl Route panel. Users should be able to search, filter, select a Crawl Preference, inspect Venue Heritage, and either accept a Suggested Crawl or build their own route by tapping venues on the map.

The product should use three layers together:

- Pint Price layer: observed pint prices by venue, with cheap, mid, expensive, and unknown visual states.
- Setting layer: "By the water", garden, sports, food, cocktails, and future near-park or route-window controls.
- Story layer: Venue Heritage, sourced editorial recommendations, writer-linked pubs, and later Pint Drops with Passed-Down Notes.

The design direction should make the product feel like a practical map tool with a London-pub editorial soul. It should not become a marketing page, a generic dashboard, or a nostalgia mood board. The interface needs density, fast scanning, and strong source/provenance signals, while using one memorable visual idea: a "pub guidebook margin" system where story, source, route order, and price sit together like annotated field notes beside the map.

## Current Prototype State

The current prototype includes:

- A client-rendered map using a dark CARTO/MapLibre basemap.
- Clustered venue points with price-bucket color.
- A search field for venue, area, and borough matching.
- Crawl Preferences for balanced, cheapest, historic, beer garden, live sports, and date night routes.
- A new Writer Trail Crawl Preference seeded from public Alastair Hilton context.
- Max Pint, Stops, and Route Window controls.
- Amenity filters for beer garden, live sports, food, and cocktails.
- Story filters for By the water and Heritage note.
- Suggested Crawl generation using price, amenities, route distance, heritage, water, source trust, and writer-pick signals.
- Build-your-own mode where tapping map venues adds or removes Crawl Stops.
- Route metrics for estimated round, distance, stops, story pubs, water-side stops, and writer picks.
- A selected venue inspector showing price list, amenities, story tags, and curated heritage notes.
- An editorial writer card for Alastair Hilton / `@London_W4`, linking to public sources around *The Greatest Pubs* and historic pub tours.
- A new curation layer that keeps editorial data separate from the generated Venue Dataset.
- ADR direction for a future community heritage layer using Pint Drops, Passed-Down Notes, and first-class Provenance.

## What Changed

The latest integration added the editorial and story layer that OPUS asked for:

- Added curated water, heritage, writer-pick, story-tag, and source-link metadata.
- Added Alastair Hilton as a source-backed editorial context rather than treating inaccessible X posts as data.
- Added `Writer Trail` route scoring.
- Added `By the water` and `Heritage note` filters.
- Added map styling for story venues and writer-linked venues.
- Added a visible writer/book/source card in the control rail.
- Added story, water, and writer metrics in the route panel.
- Added venue-level heritage notes and source links in the inspector.
- Preserved the existing generated price dataset by layering curation on top instead of modifying generated rows.

Important caveat: the prototype does not yet have the full list of 44 pubs from *The Greatest Pubs*. Publicly visible sources confirm the author, book, role, and some pub/print references, but not the full book contents. The app should show this as sourced editorial seed data until the team has permission or manual verification for a complete list.

## User Stories

1. As a pub night planner, I want to see London pubs on a map, so that I can understand where a Crawl Route will actually take me.
2. As a pub night planner, I want pint prices visible on venue pins, so that I can compare price without opening every venue.
3. As a cost-conscious drinker, I want to filter by maximum pint price, so that I can avoid venues outside my budget.
4. As a user planning for friends, I want an estimated round cost, so that I can understand the total price of the route.
5. As a user who cares about atmosphere, I want Venue Heritage notes, so that I can choose pubs with character rather than only cheap pints.
6. As a user looking for a memorable route, I want to filter to pubs by the water, so that the setting shapes the night.
7. As a user who trusts local expertise, I want writer-linked pubs to be highlighted, so that recommendations from knowledgeable people are easy to find.
8. As a user reading a recommendation, I want to see the source, so that I can judge whether the claim is editorial, contributor, or anecdotal.
9. As a user browsing quickly, I want story pubs to have a distinct marker treatment, so that they stand out from ordinary price pins.
10. As a user planning a crawl, I want a Suggested Crawl, so that I can start from a reasonable route instead of selecting every stop manually.
11. As a user with my own preferences, I want multiple Crawl Preferences, so that the route can optimise for price, history, gardens, sport, date night, or writer recommendations.
12. As a user who wants control, I want to build my own Crawl Route by tapping pubs, so that I can override the recommendation.
13. As a user building a route, I want selected stops to appear in order, so that I can understand the plan as a sequence.
14. As a user building a route, I want to remove a selected stop easily, so that I can correct mistakes without restarting.
15. As a user evaluating a route, I want distance between stops visible, so that I can decide whether the route is realistic.
16. As a user with limited time, I want a Route Window control, so that suggested stops stay within a tolerable walking range.
17. As a user searching for a venue, I want search to match venue name, address, area, and borough, so that I can find familiar places quickly.
18. As a user who wants outdoor space, I want a beer garden filter, so that the route suits the weather and group.
19. As a sports fan, I want a live sports filter, so that I can build a route around match viewing.
20. As a user planning food as part of the route, I want a food filter, so that the route does not require separate dinner planning.
21. As a user planning a date, I want cocktails and atmosphere to influence ranking, so that the route feels appropriate.
22. As a user inspecting a venue, I want a clear price list, so that I can see what price claim is driving the marker.
23. As a user inspecting a venue, I want amenities visible as compact tags, so that I can scan venue fit quickly.
24. As a user inspecting a venue, I want heritage notes separated from generic venue descriptions, so that sourced stories do not get lost.
25. As a user planning around local expertise, I want an Alastair Hilton / `@London_W4` editorial card, so that I understand why Writer Trail exists.
26. As a user who wants to buy or verify a source, I want links to the book and guide profile, so that I can follow the provenance.
27. As a future contributor, I want to submit a Pint Drop, so that my observed price or pub memory can improve the map.
28. As a future contributor, I want to attach a pint or venue photo, so that my Pint Drop has evidence.
29. As a future contributor, I want to add a Passed-Down Note, so that older local knowledge can live beside current prices.
30. As a user reading community content, I want provenance labels, so that I know whether a claim is sourced, contributed, or anecdotal.
31. As a moderator or maintainer, I want every community write to pass through one server route, so that validation, image handling, and abuse controls are centralised.
32. As a maintainer, I want editorial curation separated from the generated Venue Dataset, so that exports can be regenerated without losing hand-curated data.
33. As a maintainer, I want tests at the feature seam, so that route/filter regressions are caught without testing internal implementation details.
34. As Opus reviewing the direction, I want explicit current limitations, so that the next agent does not overclaim book contents or source authority.
35. As a demo presenter, I want the app to open directly to the working map, so that the pitch can show value immediately.
36. As a mobile user, I want controls, map, and route details to stack predictably, so that I can plan a route on a phone without text overlap.
37. As a user with keyboard or assistive technology needs, I want focusable controls and readable labels, so that the map experience is not mouse-only.
38. As a user on slow networks, I want loading and empty states, so that I know whether data is loading or no venues match.
39. As a user comparing options, I want route stops to show price, pint name, and story tag together, so that I can decide from the list without opening each venue.
40. As a user deciding whether to trust a route, I want to see how many stops are story pubs, water-side pubs, and writer picks, so that the route's character is legible.

## Implementation Decisions

- Keep the app map-led and tool-first. The first screen should be the working planner, not a landing page.
- Keep the generated Venue Dataset as the seed data source for venue names, coordinates, pint prices, amenities, and descriptions.
- Add editorial curation as a separate layer merged into the grouped Venue model at read time.
- Route all current map and route UI through a single venue grouping and filtering pipeline, so controls, marker styling, route scoring, and venue inspection share the same derived venue objects.
- Treat Venue Heritage as a product signal, not only text content. It affects filtering, marker styling, route scoring, route metrics, and the venue inspector.
- Treat "By the water" as a first-class setting signal. It should become a real geospatial join later, but seed inference is acceptable for the prototype.
- Add Writer Trail as a Crawl Preference rather than a separate page. It belongs beside Balanced, Cheapest, Historic, and other route intents.
- Do not overclaim the contents of *The Greatest Pubs*. Public sources should support author identity, book metadata, public product pages, visible pub prints, and guide profile context. Full book recommendations require manual verification or permission.
- Keep source links visible wherever editorial claims appear. This is the beginning of the Provenance model described in the community heritage ADR.
- Use one future server write-path seam for Pint Drops. Components should not call persistence directly.
- Merge future Pint Drops into the same curation object consumed by map styling and venue detail. Community content should not create a parallel render path.
- Use lightweight Contributor Handle identity for v1 community contributions. Full auth is out of scope until the contribution loop proves value.
- Store user photos through managed storage, not inline payloads.
- Validate and sanitize all user-generated content server-side, including text length, price ranges, image type, and empty submissions.
- Preserve Build Your Own mode as a complementary path to Suggested Crawl. It is useful for demos and for users who know some stops already.
- Use route scoring as a multi-signal model: price, amenities, source trust, story content, water setting, writer picks, and walking distance.
- Keep Route Window as an approximation until real walking routing is added.
- Maintain the product glossary: Venue, Pint Price, Crawl Route, Crawl Stop, Crawl Preference, Venue Heritage, Pint Drop, Passed-Down Note, Provenance, and Contributor Handle.

## Design Direction

Purpose: help users plan a London pub crawl by balancing price, route shape, setting, and story.

Audience: Gen Z users looking for affordable, shareable discovery; 30-50s users who value proper pubs and memory; presenters or judges who need the core wedge visible in seconds.

Tone: practical, editorial, London-specific, slightly nostalgic, but still fast and usable. The interface should feel more like a field guide and less like a SaaS dashboard.

Memorable detail: use a "pub guidebook margin" motif. The map remains dark and geographic; side panels act like annotated margins with price stamps, route numbers, sourced notes, and compact provenance labels.

Constraints:

- The product is an app/tool, not a marketing site.
- The layout must support dense scanning.
- The design must work on desktop and mobile.
- The color system must not collapse into one hue family.
- Do not use decorative blobs, generic gradient heroes, oversized cards, or vague explanatory copy.
- Use existing icons for recognizable controls.
- Cards should be reserved for repeated items, modals, and genuinely framed informational modules.

### Proposed Design System

Color tokens:

- `ink`: near-black green, for primary UI and selected state.
- `paper`: warm off-white, for panels and low-glare reading.
- `map-night`: near-black charcoal, for map background and dark spatial context.
- `pint-green`: price-cheap marker and positive active state.
- `brass`: route line, writer pick marker, and guidebook/source accent.
- `river-blue`: by-water and heritage/source accent.
- `ale-amber`: mid-price marker and warning-level price state.
- `brick-red`: expensive marker and destructive/clear actions.
- `line`: muted border color with enough contrast on paper.

Typography:

- Display: a restrained serif or condensed editorial face for the brand and major route titles only. It should evoke a printed guidebook without hurting scan speed.
- Body: a clear humanist sans for labels, venue names, controls, and descriptions.
- Data/utility: tabular numeric treatment for prices, counts, and route metrics.
- Avoid negative letter-spacing and viewport-scaled text.

Layout:

- Desktop: three-column tool layout: controls, map, route/venue inspector.
- Mobile: map first with compact controls and route detail below, avoiding nested panels.
- Route list: stable row height where possible, clear ordered stop number, price, pint, and story tag.
- Inspector: separate venue facts, story/provenance, and prices into scannable blocks.

Interaction:

- Segmented controls for Crawl Preference and mode.
- Checkboxes for binary filters.
- Sliders for max price, stop count, and route window.
- Map markers should encode price by fill, story by stroke, and selected/route state by ring or numbered overlay.
- Source links should be visible but secondary.
- Empty states should give a direct next action, such as lowering max price or clearing filters.

Accessibility:

- Add visible focus styles to all controls.
- Ensure map-only interactions have list equivalents.
- Keep touch targets at least 40px.
- Preserve text contrast in the writer card, route metrics, and map legend.
- Add reduced-motion handling if route transitions or panel animations are introduced.

## UI Improvement Suggestions

- Replace the current generic control rail styling with a stronger field-guide system: compact labels, source stamps, route-order markers, and provenance chips.
- Add a dedicated empty state when filters produce no venues.
- Add a selected venue mini-card overlay on mobile, so users do not need to scroll away from the map immediately.
- Add a "clear story filters" or "reset filters" action.
- Add hover/focus states for source links, route rows, and segmented controls.
- Add a real loading state for the dataset and map tiles instead of only a generic initial shell.
- Add a small explanation-free legend that uses visual markers rather than long text.
- Make the writer card collapsible on smaller screens.
- Add provenance chips to each heritage note: Sourced, Contributor, Anecdote.
- Add a "verified source needed" visual treatment for inferred heritage notes.
- Add a seed crawl with fixed stops for demo reliability. Suggested Crawl remains dynamic, but demo mode needs deterministic behavior.
- Add image support for venues where real, inspectable images are licensed or source-safe.
- Add screenshots to the review workflow for desktop and mobile before merge.

## Product Improvement Suggestions

- Verify and import the full list of pubs from *The Greatest Pubs* only with permission or manual source validation.
- Replace inferred water detection with a geospatial near-water join.
- Add an explicit era field for Venue Heritage: Tudor, Georgian, Victorian, Edwardian, modern, unknown.
- Add real provenance records for editorial claims instead of only URL fields.
- Add Pint Drops as the first community write feature.
- Make Log a price part of Pint Drops, not a separate write model.
- Add photo evidence to Pint Drops, with moderation and image validation.
- Add Passed-Down Notes to support the cross-generational product wedge.
- Add a moderation queue or hide/report path before accepting public user-generated content.
- Add route save/share as a later feature after route quality is credible.
- Add trusted recommendations later through friend or curator lists, not a generic social feed.
- Add real walking routes only after the product route scoring is stable.
- Add tube-aware route mode later, not in the current PRD.
- Add borough/neighbourhood presets once route discovery needs stronger entry points.

## Testing Decisions

Good tests should assert user-observable behavior, not implementation details. The ideal seam for the current app is the rendered planner with a controlled Venue Dataset fixture. The test should interact with controls and observe map/list/inspector outcomes.

Testing seams:

- Planner seam: render the app with a small fixture dataset and verify filters, Crawl Preference, Suggested Crawl, Build Your Own mode, and selected venue detail.
- Route scoring seam: test that Writer Trail, Historic, Cheapest, and other Crawl Preferences choose different expected stops from a controlled fixture.
- Curation seam: test that editorial seed data merges into grouped venues without modifying raw rows.
- Story filter seam: test that By the water and Heritage note filters include and exclude venues correctly.
- Future Pint Drop seam: test the single server write path with validation, image constraints, provenance assignment, and response shape.
- Accessibility seam: browser-level checks for focusable controls, labels, no obvious text overflow, and mobile layout stability.

Recommended verification:

- Unit tests for curation merge and route scoring with small fixtures.
- Component or browser tests for control interaction and route panel behavior.
- Build and lint checks on every agent handoff.
- Screenshot checks for desktop, tablet, and mobile.
- Manual source review for every editorial venue claim before broadening the writer/book layer.

## Out of Scope

- Full authentication.
- Social graph, friend feed, or comments.
- Production-grade moderation dashboard.
- Complete import of *The Greatest Pubs* without permission or manual verification.
- Live external calls to X, Overpass, or third-party APIs at page load.
- Real walking directions.
- Tube routing.
- Payment, booking, or table reservation flows.
- Full historical database of London pubs.
- Automated scraping of competitor price sites.
- Legal claims about pub licensing disputes beyond sourced editorial context.

## Further Notes

OPUS should review three things first:

- Whether Writer Trail is the right product shape for the Alastair Hilton material, or whether it should be a named seeded crawl instead.
- Whether the future community layer should prioritise Pint Drop price evidence, Passed-Down Notes, or source-backed Venue Heritage first.
- Whether the visual direction should lean more "field guide" or more "night map", because both are present in the current prototype and the next design pass should choose a hierarchy.

The recommended next build is not another large feature. It should be a focused polish pass:

1. Turn the current visual language into explicit tokens.
2. Add provenance chips and empty/loading states.
3. Add one deterministic seeded crawl for demo.
4. Add tests around the planner seam and curation seam.
5. Verify all public writer/book claims before expanding the Writer Trail data.

This PRD was prepared for review rather than published to an issue tracker because this workspace does not expose a configured tracker or triage label setup.
