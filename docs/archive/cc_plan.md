# PUBMAXXING Social Memory Layer PRD

## Problem Statement

PUBMAXXING now has the right public direction: the brand rename is live, the landing page sells the old golden days of pubs, Pint Drops have stronger prompts, and Crawl Stories can be shared. The next gap is that these surfaces are still mostly demo-grade objects rather than a durable social product.

The product should feel like Letterboxd plus Instagram for pints, pub crawls, cheap nights, stories, art, history, and chaotic social memory. Users should be able to log the pint they are having, explain why the pub matters, follow friends, save pubs and crawls, and browse a feed that makes local nights feel alive. The app should also work well on mobile because most real logging will happen in pubs, streets, queues, and crowded tables.

This PRD defines the next build package for Opus/Fable: make PUBMAXXING feel like a real social app while preserving the demo momentum.

## Current Baseline

Already shipped or substantially implemented:

- Public brand surfaces say PUBMAXXING.
- Landing narrative now focuses on cheap pints, chaotic nights, stories, and pub culture.
- Landing includes a live Pint Drops strip.
- The hero reveal issue was fixed.
- Crawl Stories now have a shareable object, recap page, share card API, and save action.
- Pint Drops now include richer prompts, vibe tags, and a sticky "Log a Pint Drop" action.
- Earlier P0 work improved map stability, security posture, demo docs, crawl builder, and Supabase-backed persistence.

Remaining product gap:

- No true social identity layer.
- No follows, feed, comments, likes/reactions, or saved pub collections as first-class data.
- Crawl Stories are not yet a full persisted social artifact.
- Mobile UX is still closer to responsive desktop than a camera/log/feed-first social app.
- Moderation/reporting needs actor-scoped records and stronger abuse controls before public production use.
- Documentation and demo assets still contain stale names and superseded plans.

## Solution

Build the PUBMAXXING Social Memory Layer: profiles, follows, feeds, saved pubs, persisted crawl stories, social reactions, mobile-first logging, and hardened reporting. The result should let a user open the app, see what friends and nearby people are drinking, log a pint with a story, save pubs for later, share a crawl, and discover routes through cheap pints, history, and nightlife culture.

The first implementation should be demo-safe but production-shaped: real schema, real route structure, clean mobile surfaces, and testable flows. It does not need full native app parity, payments, or complex pub-owner tooling yet.

## User Stories

1. As a new user, I can create or claim a profile with a handle, display name, avatar, home city, and short bio so that my Pint Drops and crawls belong to me.

2. As a user, I can view a public profile at `/u/[handle]` with recent Pint Drops, saved pubs, crawl stories, badges, and basic stats.

3. As a user, I can follow another person and see their Pint Drops and crawl stories in my feed.

4. As a user, I can open `/feed` and see a social stream of Pint Drops, Crawl Stories, cheap pint finds, and nearby pub activity.

5. As a user, I can switch feed filters such as Tonight, Friends, Near Me, Cheap Legends, Crawls, and Golden Days.

6. As a user in a pub, I can log a Pint Drop quickly on mobile with venue, price, rating, vibe tags, optional note, optional photo, and "who I am with".

7. As a user, I can react to a Pint Drop with lightweight pub-native reactions such as Cheers, Bargain, Chaos, Proper, and Legendary.

8. As a user, I can comment on a Pint Drop or Crawl Story so the story can continue after the night.

9. As a user, I can save a pub to lists such as Want to Visit, Cheap Pint, Date Night, Coding Pint, Historic, and Crawl Stop.

10. As a user, I can create a Crawl Story from a route, add notes and photos per stop, and publish it as a durable page.

11. As a user, I can share a Crawl Story card or Pint Drop card to friends and social platforms.

12. As a user, I can browse pub pages that show live Pint Drops, historical context, popular tags, average price, saved count, and crawls that include the pub.

13. As a demo visitor, I can understand the product without signing in, but social actions that require identity should ask me to sign in or use demo mode.

14. As a moderator/admin, I can see reported Pint Drops, photos, comments, and profiles with actor-scoped report history.

15. As a maintainer, I can run focused smoke tests that prove the map, feed, logging, crawl story, profile, and mobile navigation flows still work.

## Implementation Decisions

### 1. Identity And Profiles

Add a real social identity foundation on top of the existing Supabase setup.

Required schema:

- `profiles`
  - `id uuid primary key references auth.users(id)`
  - `handle text unique not null`
  - `display_name text not null`
  - `avatar_url text`
  - `home_city text`
  - `bio text`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

- `follows`
  - `follower_id uuid references profiles(id)`
  - `followee_id uuid references profiles(id)`
  - `created_at timestamptz default now()`
  - unique composite key on `(follower_id, followee_id)`

Implementation notes:

- Keep anonymous/demo data readable.
- Require authenticated identity for follow, comment, reaction, save, and publish actions.
- Add a profile bootstrap helper that creates a profile after first sign-in.
- Use RLS policies from the start.
- Add `/u/[handle]` and a minimal edit profile flow.

### 2. Feed System

Add a first-class `/feed` route and a mobile feed tab.

Feed item types:

- Pint Drop
- Crawl Story
- Saved pub
- Cheap pint find
- Badge or milestone
- Editorial/history card

Required implementation:

- Create a feed query layer that normalizes heterogeneous items into one DTO.
- Support filters: `tonight`, `friends`, `nearby`, `cheap`, `crawls`, `golden-days`.
- Use cursor pagination, not offset pagination.
- Empty states should feel social and local, not SaaS-generic.
- Feed cards should be compact, image-friendly, and easy to scan in a pub.

### 3. Pint Drops V2

Keep the shipped vibe tags and sticky composer, but make Pint Drops social and durable.

Required changes:

- Add `profile_id` to Pint Drops where possible.
- Add optional `photo_url`, `visibility`, and `source` fields if not already present.
- Add reactions via `pint_drop_reactions`.
- Add comments via `pint_drop_comments`.
- Add saves/bookmarks via `saved_pubs` or `saved_items`.
- Replace report count-only behavior with actor-scoped report rows.

Moderation schema:

- `pint_drop_reports`
  - `id uuid primary key`
  - `pint_drop_id uuid not null`
  - `reporter_id uuid references profiles(id)`
  - `reason text not null`
  - `details text`
  - `created_at timestamptz default now()`
  - unique key on `(pint_drop_id, reporter_id)` when reporter is present

Rules:

- A user can report a piece of content once.
- Report counts are derived from report rows.
- Do not expose private moderation fields in public DTOs.
- Keep demo mode available, but make production paths actor-aware.

### 4. Crawl Stories V2

Turn the current shareable Crawl Story into a persisted social object.

Required schema:

- `crawl_stories`
  - `id uuid primary key`
  - `author_id uuid references profiles(id)`
  - `title text not null`
  - `slug text unique`
  - `summary text`
  - `visibility text check in ('draft', 'public', 'unlisted')`
  - `cover_image_url text`
  - `started_at timestamptz`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

- `crawl_story_stops`
  - `id uuid primary key`
  - `crawl_story_id uuid references crawl_stories(id)`
  - `venue_id text not null`
  - `position int not null`
  - `note text`
  - `pint_drop_id uuid`
  - `arrived_at timestamptz`

Required routes:

- `/crawls`
- `/crawls/new`
- `/crawls/[slug]`
- `/u/[handle]/crawls`

Required UX:

- Let users create a story from an existing route.
- Let users attach Pint Drops to crawl stops.
- Generate a share card for each crawl.
- Show route stats: stops, distance, average pint price, total estimated pint cost, best moment, chaos rating.

### 5. Saved Pubs And Lists

Add saved pub collections as a core behavior.

Required schema:

- `saved_pubs`
  - `profile_id uuid references profiles(id)`
  - `venue_id text not null`
  - `list_type text not null`
  - `note text`
  - `created_at timestamptz default now()`
  - unique key on `(profile_id, venue_id, list_type)`

Default list types:

- Want to Visit
- Cheap Pint
- Coding Pint
- Historic
- Date Night
- Crawl Stop
- Local Legend

Surface saved pubs on:

- Profile page
- Venue page
- Feed cards
- Crawl builder

### 6. Mobile-First Navigation

The app should feel intentionally mobile, not just responsive.

Required mobile nav:

- Map
- Feed
- Log
- Crawls
- Profile

Required mobile UX changes:

- Add a bottom tab bar on small screens.
- Move venue details into a bottom sheet with tabs: Pints, Story, Crawls, Details.
- Add a camera/log-first Pint Drop composer.
- Add thumb-friendly save, react, share, and report actions.
- Keep the map usable with one hand.
- Ensure text never overlaps controls on small screens.

Desktop should keep the richer map/sidebar layout.

### 7. Visual And Brand Direction

Make PUBMAXXING feel vibrant, cultured, nostalgic, and clean. Avoid generic SaaS dashboards.

Design language:

- Pub ephemera: receipts, coasters, blackboards, beer mats, old gig flyers, photo strips, stamps, crawl maps.
- Social cards should feel collectible and shareable.
- Use restrained texture and real content, not heavy decorative gradients.
- Keep dense product surfaces clean and scannable.
- Add more real pub/crawl imagery where possible.

Key copy direction:

- "There is a story behind every pint."
- "There is a story behind every crawl."
- "Bring back cheap pints and chaotic nights."
- "Log the pint. Save the pub. Tell the story."

### 8. Editorial And Discovery Layers

Add content layers that make PUBMAXXING more than a map.

Candidate features:

- Cheap pint leaderboard by area.
- "Golden Days" routes: historic pubs, old music venues, classic student routes, market streets, riverside nights.
- "Coding Pint" routes: quiet tables, sockets, Wi-Fi, late afternoon work pints.
- "Then vs Now" pub stories with historic notes.
- "Tonight's Crawl" route suggestions.
- "Local Legends" badges for repeatedly saved or highly reacted pubs.

Use factual data where available. If Landlord-style generated copy is used, ground it in existing venue facts and label it clearly.

### 9. Trust, Safety, And Media Hardening

Before production, improve media and moderation.

Required:

- Do not expose raw storage paths for private or quarantined media.
- Strip EXIF from uploaded images or document that the provider does it.
- Validate MIME type and magic bytes for all uploads.
- Add max dimensions and compression for uploaded images.
- Store report rows with actor identity and reason.
- Add admin review views for reports.
- Add rate limits to log, comment, reaction, report, and upload endpoints.

### 10. Docs And Demo Hygiene

Clean up stale handoff artifacts so the next agent does not chase old work.

Required:

- Update `README.md` and `teach.md` to remove stray closing markers such as `</content>` and `</invoke>`.
- Update docs that still say PubMaxing on public-facing surfaces unless the old spelling is explicitly historical.
- Mark older PRDs as superseded when their work has landed.
- Add a short `docs/ACTIVE_PLAN.md` linking to this PRD and the current demo checklist.
- Refresh `docs/DEMO_DECK.md` with the PUBMAXXING narrative and current screenshots.
- Update screenshot docs to include desktop landing, desktop map, mobile map, feed, crawl story, and profile once implemented.
- Decide whether untracked skill-note files belong in the repo or should remain local.
- Remove internal placeholder comments such as `ponytail:` from production-facing files unless intentionally kept.

## Execution Order

### Phase 1 - Social Foundations

- Add profiles, follows, saved pubs, reactions, comments, report rows.
- Add RLS policies and server helpers.
- Add `/u/[handle]`.
- Add authenticated action guards.

### Phase 2 - Feed And Mobile Shell

- Add `/feed`.
- Add bottom mobile navigation.
- Add mobile-first Pint Drop composer.
- Add feed cards and filters.
- Add profile/feed links from map and landing surfaces.

### Phase 3 - Crawl Stories V2

- Persist Crawl Stories.
- Add create/edit/publish flow.
- Attach Pint Drops to stops.
- Add crawl story comments/reactions/shares.

### Phase 4 - Brand, Discovery, And Docs

- Add editorial discovery cards and cheap pint leaderboards.
- Refresh demo deck and screenshots.
- Clean stale docs and public naming.
- Add visual polish for social cards and mobile flows.

### Phase 5 - Production Hardening

- Rate limits.
- Media hardening.
- Admin moderation queue.
- Expanded E2E coverage.
- Vercel deployment checklist.

## Testing Decisions

Add or expand Playwright coverage for:

- Landing page opens and links into Map, Feed, Crawls, and Profile.
- Mobile bottom nav switches between Map, Feed, Log, Crawls, and Profile.
- User can log a Pint Drop from mobile composer.
- Feed shows a newly created Pint Drop.
- User can save a pub and see it on profile.
- User can create a Crawl Story from a route and open the public share page.
- User can react to and comment on a Pint Drop.
- Report flow creates one report per actor and does not leak moderation internals.
- Admin/moderation view can see report history.
- Landlord/AI copy still works only from approved venue context.

Add unit or integration tests for:

- Feed DTO normalization.
- Cursor pagination.
- Reaction/comment/report uniqueness.
- Saved pub list uniqueness.
- Crawl Story slug generation.
- RLS policy expectations where practical.

Manual QA checklist:

- iPhone-sized viewport.
- Android-sized viewport.
- Desktop map viewport.
- Slow network.
- Logged-out demo user.
- Logged-in user.
- Empty state city with little/no data.
- Large crawl with many stops.

## Out Of Scope

Do not build these in this package unless explicitly re-scoped:

- Native iOS or Android app.
- Payments or pub subscriptions.
- Pub-owner business dashboard.
- Full event ticketing.
- Real-time chat.
- Complex recommendation ML.
- Multi-city launch operations.
- Production deployment secrets collection.

## Further Notes

The older GLM PRD contains many items that are now stale because Opus already shipped the brand, landing, crawl share, and Pint Drop improvements. Use this file as the current forward plan.

The highest-leverage next move is not another static landing polish pass. It is the social data model plus mobile feed/log/profile loop. That loop is what makes PUBMAXXING feel like a real product instead of a map demo.

Recommended demo tagline:

> There is a story behind every pint.

Supporting line:

> PUBMAXXING brings back cheap pints, chaotic nights, and the pub stories worth remembering.
