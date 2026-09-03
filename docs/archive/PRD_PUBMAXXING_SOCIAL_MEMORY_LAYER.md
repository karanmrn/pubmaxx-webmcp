# PUBMAXXING PRD — Social Memory Layer for Pint Nights

Status: ready for agent
Target branch: `prd-implementation-review`
Reviewed base: `3fac492`
Date: 2026-07-05

## Problem Statement

The product is currently a strong map-led pub-crawl planner. Claude/Opus have shipped the hard parts: a living 3-D London map, real pint-price data, crawl planning, curated routes, Pint Drops, The Landlord, Supabase persistence, moderation, Vercel deployment, mobile responsive sheets, and a proper README/deployment runbook.

But the product vision is bigger than a planner. The site should be **PUBMAXXING**: a social, nostalgic, story-led place for pints and pub crawls. The idea is to bring back the old golden days when pint prices were cheap, nights were chaotic and fun, and pubs were where art, history, coding, friendship, flirting, arguing, writing, music, and drinking all collided. There is a story behind every pint. There is a story behind every pub crawl. Drinking and partying bring people together.

The current app has the raw materials for that idea, but not the social loop yet:

- Pint Drops exist, but they are mostly buried inside venue detail.
- Crawl sharing exists, but it is a URL, not a post, log, recap, or memory.
- Contributor identity is a local handle, not a profile.
- There is no feed, follow graph, likes, comments, saves, lists, or crawl diary.
- Mobile is responsive, but not yet a mobile-native night-out capture flow.
- The brand still says `PubMaxing` across UI, docs, metadata, and OG assets; the product should be **PUBMAXXING**.

## Solution

Turn the working planner into **PUBMAXXING: Letterboxd + Instagram for pints, pub crawls, and drinking stories**.

The planner remains the acquisition wedge: users arrive to find cheap pints, heritage pubs, and a crawl worth walking. The next layer makes them return: they log the pint, post the crawl, follow friends, browse stories, and build a public memory archive around London pub culture.

Build this in phases:

1. **Brand and narrative pass:** rename the public website/app to PUBMAXXING and make the nostalgic/social proposition visible.
2. **Crawl Stories:** make a crawl a persistable social object with stops, prices, photos, captions, vibe tags, and shareable recap cards.
3. **Profiles and feeds:** add lightweight accounts, user profiles, follows, reactions, comments, saves, and feeds.
4. **Mobile-native logging:** once desktop is solid, make mobile feel like a night-out app, not a compressed dashboard.
5. **Truthful handoff and launch hardening:** before public social launch, clean stale docs, harden reports, media takedowns, EXIF stripping, moderation identity, browser coverage, and production smoke tests.

## User Stories

1. As a first-time visitor, I want the brand to say PUBMAXXING, so that I instantly understand this is not a generic pub directory.
2. As a first-time visitor, I want the landing page to communicate cheap pints, chaotic nights, art, history, and pub-crawl memories, so that the product feels culturally alive.
3. As a crawl planner, I want to build a route and save it as a crawl story, so that my night becomes a record, not just a route.
4. As a user, I want to post a crawl recap with stops, photos, captions, and prices paid, so that friends can see what actually happened.
5. As a user, I want to add vibe tags like cheap, chaotic, date night, old guard, coding pint, riverside, last train, so that my crawl has personality.
6. As a user, I want a profile with my handle, avatar, bio, crawl count, Pint Drops, saved pubs, and favourite boroughs, so that my pub taste has a home.
7. As a user, I want to follow friends and pub people, so that my feed shows crawls and Pint Drops from people I care about.
8. As a user, I want to like, comment on, and save crawl stories, so that the app has a lightweight social loop.
9. As a user, I want to browse feeds like Friends, Tonight, Cheap Legends, Golden Days, Near Me, and New Pint Drops, so that discovery is social and timely.
10. As a user, I want a quick Log a Pint action on mobile, so that I can capture the price/photo/story while I am actually in the pub.
11. As a user in a pub, I want the app to say "I'm here" and preselect the likely venue, so that logging a pint is not fiddly.
12. As a user, I want to post a single Pint Drop or attach it to a crawl, so that casual and full-night use both work.
13. As a nostalgic Londoner, I want era/timeline prompts, so that I can write about pubs from the 1980s, 1990s, student days, lockdown, or last summer.
14. As a younger user, I want older passed-down stories surfaced in a readable feed, so that the app feels like inheriting pub knowledge.
15. As a user, I want cheap-pint leaderboards and route templates like Under £25 Round or Last Good £4 Pint, so that price is fun, not just functional.
16. As a user, I want shareable image cards for my crawl and Pint Drop, so that PUBMAXXING spreads on Instagram, X, and group chats.
17. As a moderator, I want reports counted by distinct actors, so that one person cannot hide content by reporting twice.
18. As a moderator, I want hidden content media to stop resolving publicly, so that takedowns are real.
19. As a contributor, I want uploaded images to strip metadata, so that my GPS/EXIF data is not accidentally exposed.
20. As a mobile user, I want the map, feed, composer, and profile to fit thumb-first navigation, so that the app works on a night out.
21. As a desktop user, I want the 3-D map to remain the centrepiece, so that planning still feels premium and immersive.
22. As a judge or design partner, I want the demo to show the planner-to-social loop in one flow, so that the product vision is obvious in under a minute.

## Implementation Decisions

### 1. Brand: PUBMAXXING

- Rename public-facing brand text from `PubMaxing` to **PUBMAXXING** across landing, map shell, footer, metadata, OG image, README, demo deck, and docs that are not historical archives.
- Update the default title, Open Graph title, Twitter title, site name, and OG image text.
- Keep internal localStorage keys and package names unchanged unless changing them has no migration cost. Public brand matters more than internal identifiers.
- Suggested public tagline: **"Every pint has a story."**
- Supporting line: **"Cheap pints, chaotic nights, and the crawl stories worth passing down."**
- Tone: nostalgic, social, sharp, and human. Avoid generic SaaS copy. This is a culture product, not a directory.

### 2. Product Positioning

- Reframe the app as: **Letterboxd + Instagram for pints and pub-crawl stories.**
- The map remains the planner and discovery engine.
- Pint Drops become the atomic post.
- Crawl Stories become the main social object.
- The Landlord becomes the grounded narrator and prompt engine for pub memory.
- Profiles and feeds become the retention loop.

### 3. Data Model: Social Layer

Add Supabase-backed tables through migrations. Keep server routes as the write boundary; do not let components write directly to Supabase.

Proposed tables:

- `profiles`
  - `id`, `user_id`, `handle`, `display_name`, `avatar_url`, `bio`, `home_borough`, `created_at`
- `follows`
  - `follower_id`, `following_id`, `created_at`
- `crawl_posts`
  - `id`, `profile_id`, `title`, `caption`, `visibility`, `vibe_tags`, `total_price_gbp`, `distance_km`, `started_at`, `created_at`
- `crawl_post_stops`
  - `id`, `crawl_post_id`, `venue_id`, `position`, `drink`, `price_gbp`, `note`, `pint_drop_id`
- `post_media`
  - `id`, `owner_type`, `owner_id`, `storage_key`, `thumbnail_key`, `width`, `height`, `status`, `created_at`
- `reactions`
  - `profile_id`, `target_type`, `target_id`, `reaction`, `created_at`
- `comments`
  - `id`, `profile_id`, `target_type`, `target_id`, `body`, `status`, `created_at`
- `saved_pubs`
  - `profile_id`, `venue_id`, `note`, `created_at`
- `pint_drop_reports`
  - `drop_id`, `actor_hash` or `profile_id`, `reason`, `created_at`, unique by actor/drop

Do not overbuild private messaging, groups, or event planning yet.

### 4. Crawl Stories

- Add a **Save as Crawl Story** action after a route is built or suggested.
- A crawl story should include:
  - ordered venue stops
  - title
  - caption
  - vibe tags
  - photos
  - prices paid
  - notes per stop
  - visibility setting
  - shareable public URL
- Let users attach existing Pint Drops to crawl stops.
- Add a route recap page at `/crawls/[id]`.
- Add share-card generation for crawl stories using the existing `next/og` pattern.
- Default empty-state copy should invite the user to "post the night" rather than "save route" only.

### 5. Pint Drops Must Become Visible Social Content

Current Pint Drops are technically strong, but on mobile they are buried below map controls, route metrics, and the Add Stops list. That weakens the whole social premise.

- Add a selected-pub mobile bottom sheet with tabs:
  - Pints
  - Story
  - Route
- Make **Log a Pint Drop** a sticky primary action when a venue is selected.
- Move the 40-item Add Stops picker behind an explicit drawer on mobile.
- Add a Pint Drop feed strip on landing and map:
  - photo thumbnail
  - handle
  - price paid
  - note excerpt
  - venue
  - provenance chip
- Keep venue detail for deep reading, but do not make it the only route into Pint Drops.

### 6. Feeds and Discovery

Add a feed surface without disrupting the current map cockpit.

Desktop:

- Keep the 3-column planner as the primary `/map` experience.
- Add a tab or rail mode for:
  - Venue Detail
  - Pint Drops
  - Crawl Stories
  - Friends
- Add a separate `/feed` page if the map shell becomes too dense.

Mobile:

- Add bottom navigation:
  - Map
  - Feed
  - Log
  - Profile
- The **Log** action should be first-class and thumb reachable.
- Feed cards should be visually rich: photo, venue, price stamp, caption, reactions, provenance.

Feed types:

- Friends
- Tonight
- Near Me
- Cheap Legends
- Golden Days
- New Pint Drops
- Heritage Crawls
- Coding Pints

### 7. Profiles

- Start with Supabase Auth using the lightest acceptable flow for demo/public launch.
- Migrate local free-text handles into profile handles where possible.
- Profile page should show:
  - display name and handle
  - avatar
  - bio
  - crawl stories
  - Pint Drops
  - saved pubs
  - favourite boroughs/styles
  - stats: pints logged, crawls posted, cheapest pint found
- Allow public profile URLs.
- Keep anonymous viewing public; require auth for posting, reactions, follows, and comments.

### 8. Pint Drops Upgrade

Current Pint Drops are a good foundation. Upgrade them into social content:

- Surface a Pint Drops feed outside venue detail.
- Add "Attach to crawl" when creating or editing a crawl story.
- Add richer prompts:
  - What did it cost?
  - Who were you with?
  - What happened?
  - Is this an old memory or tonight?
  - Would you come back?
- Add quick tags:
  - cheap
  - chaotic
  - quiet pint
  - old local
  - date night
  - coding pint
  - last train
  - riverside
  - hidden gem
- Keep provenance visible and strict.

### 9. Nostalgia, Art, and History

Build the golden-days feel into product surfaces, not just copy:

- Add curated route templates:
  - Under £25 Round
  - Last Good £4 Pint
  - Dad's Soho
  - Riverside Old Guard
  - Writers and Regulars
  - Coding Pint Crawl
  - First Legal Pint
- Add timeline/era filters for stories:
  - Tonight
  - This year
  - Student days
  - 2000s
  - 1990s
  - 1980s and earlier
- Add editorial story cards on landing and feed: pub art, old signage, routes, heritage facts, community memories.
- Use the existing Landlord and heritage cache to generate prompts, not unsourced facts.

### 10. Mobile Experience

Desktop ships first, but mobile must become native-feeling before broad launch.

Required mobile improvements:

- Bottom navigation with Map / Feed / Log / Profile.
- Real collapsible sheets for map controls and venue detail, or a clean tabbed mobile layout.
- Sticky "Log a Pint" action.
- "I'm here" flow using geolocation to suggest nearest pub.
- Composer optimized for camera-first use.
- Photo previews that are fast, bounded, and safe.
- Route recap viewing that reads well on one hand.
- Touch targets no smaller than 44px.
- No overlapping text/buttons on 375px width.
- Validate with Playwright screenshots for landing, map, venue, composer, feed, and profile.

### 11. Visual Design Direction

- Keep the current guidebook/pub-candle identity, but make it more vibrant and social.
- Do not turn it into a generic social feed. PUBMAXXING should feel like London pub culture.
- Use price stamps, brass route lines, pub-sign typography, photo strips, crawl posters, receipt-style totals, and map cards.
- Social cards should feel like collectible crawl posters: route name, stops, prices, photos, and one memorable quote.
- Avoid gimmicky decoration. Every visual element should support price, place, story, or social proof.
- Add more pub ephemera where useful: receipts, coaster marks, pub-sign labels, timestamped photo strips, and crawl stamps.
- Keep sober styling for sourced historical claims. The chaotic/vibrant energy should live in user/social surfaces, not in provenance or moderation UI.
- Fix reveal/screenshot reliability: landing `.reveal` content should not appear as blank bands in full-page screenshots, slow-JS sessions, crawlers, or demo captures. Prefer visible-by-default progressive enhancement or a short fallback that reveals all sections.
- Make the map theme toggle discoverable on desktop. It currently risks being visually hidden behind high-z-index panels; place it deliberately in nav/chrome or raise it above panels with clear spacing.

### 12. Trust, Safety, and Production Hardening

Before a public social launch:

- Make report hiding actor-scoped:
  - add a report table
  - enforce one report per actor per target
  - count distinct reporters
- Move media off public permanent URLs:
  - private bucket + signed URLs, or quarantine/delete media when hidden
  - moderator-only signed URLs for hidden content
- Strip EXIF/GPS metadata and normalize uploaded images:
  - decode/re-encode server-side
  - cap dimensions
  - generate thumbnails
- Replace shared admin token for production:
  - real moderator auth or Vercel-protected admin
  - store moderator identity on actions
  - add audit trail
- Fix current report UX:
  - after first report, say "Report received. This will be reviewed after one more report."
  - do not tell users the drop is hidden unless the server actually hid it
- Decide fail-open vs fail-closed rate limiting for production:
  - for OpenRouter spend, fail closed is safer
  - for UGC, fail closed when Supabase is configured but limiter RPC fails, unless explicitly accepted
- Add CSP/security headers.
- Add hosted production smoke testing against Vercel + Supabase + OpenRouter.
- Add aggregate or paginated Pint Drop reads before growth exceeds the current public cap.
- Confirm heritage/source rights before indexing or widely distributing sourced heritage facts.

### 13. Handoff Truth and Repo Hygiene

Before another agent starts major feature work, make the repo's handoff story true:

- Treat this PRD plus `teach.md` as the active handoff.
- Update `docs/DEMO_DECK.md` so it points at the current final PRD, not stale superseded PRDs.
- Remove generated tail markers from `README.md` and `teach.md` if present.
- Mark older PRDs as superseded or archive them:
  - `docs/OPUS_REVIEW_PRD.md`
  - `docs/PRD_PINT_DROPS.md`
  - `docs/PRD_PRODUCTION_READINESS_FOR_OPUS.md`
  - stale Fable PRDs where they conflict with the current app
- Refresh or delete `.context/opus-handoff.md`; it currently describes older uncommitted state.
- Decide whether `PubMaxing_Final_Demo.pptx` remains a tracked final artifact. If Markdown is the source of truth, either regenerate the deck or treat the binary as generated output.
- Decide what to do with untracked local files:
  - `skill_disabled.md`
  - `skill_in_pub.md`
  - `skills_used_global.md`
- Remove or rewrite remaining `ponytail:` agent-signature comments while preserving useful engineering comments.
- Update screenshots: current docs only have mobile prototype screenshots. Add desktop/tablet/mobile, light/dark, admin, feed, profile, composer, and crawl story captures after those surfaces exist.

### 14. Existing Work To Preserve

Do not regress:

- 3-D MapLibre map, clustering, route line, landmarks, pitch/orbit, theme rebuilds.
- Crawl URL shareability.
- Pint Drop single write path.
- Provenance separation.
- Demo seed honesty.
- The Landlord's grounded-answer contract.
- Moderation threshold and admin review console.
- Vercel build gate and local verify scripts.
- Responsive map-first layout.

## Testing Decisions

- Keep `npm run verify` and `npm run ci` green.
- Add unit tests for new schema mappers and route handlers.
- Add tests for actor-scoped report counting:
  - same actor cannot increment twice
  - two distinct actors hide at threshold
  - reported visible content exposes safe count only
- Add media tests:
  - uploaded images are normalized
  - EXIF/GPS stripped
  - hidden media URLs are not public
- Add route handler tests for crawl stories:
  - create post
  - create stops
  - attach Pint Drop
  - public read
  - private/draft visibility denied to others
- Add Playwright flows:
  - desktop: build route → save crawl story → view public recap
  - desktop: log Pint Drop → appears in venue and feed
  - desktop: curated crawl loading
  - desktop: build/reverse route persistence
  - desktop: admin review restore/keep-hidden
  - desktop: Landlord fallback
  - desktop: map theme toggle without page errors
  - mobile: open map → Log tab → camera/photo path mocked → submit
  - mobile: feed card → venue → map
  - profile: view user's crawl stories and Pint Drops
- Decide whether E2E is manual smoke or CI-blocking. Current `npm run ci` is verify + build, and Playwright is not in CI. If CI-blocking, add browser install and a separate Playwright job.
- Add visual/mobile QA screenshots:
  - landing desktop/mobile
  - map desktop dark/light
  - map mobile
  - composer mobile
  - feed mobile
  - profile mobile
  - crawl story page

## Out of Scope

- Full event planning, group chats, ticketing, reservations, payments, or pub owner dashboards.
- Walking navigation turn-by-turn.
- Recommendation ML.
- Native iOS/Android apps.
- Private DMs.
- Alcohol delivery or commerce.
- Replacing the existing map planner.
- Scraping private social content.

## Further Notes

- The strongest next product object is **Crawl Story**. It connects everything already built: route, stops, Pint Drops, prices, photos, The Landlord, and sharing.
- The fastest brand win is renaming all public surfaces to **PUBMAXXING** and making the proposition explicit: **Every pint has a story.**
- The current codebase is much further along than the previous PRD assumed. Recent commits already implemented P0 trust hardening, Pint Drops filters/counts, reverse routes, route persistence, map recentering, docs, README, deployment runbook, and social footer links.
- Subagent verification reported `npm run verify`, `npm run build`, and `npm run test:e2e` passing. Current known count: 116 Vitest tests and 3 Playwright smoke tests.
- Existing repo hygiene to handle separately: `next-env.d.ts` is modified in the current worktree and three untracked skill-note files are present. Do not mix those into product work unless intentionally committing them.
