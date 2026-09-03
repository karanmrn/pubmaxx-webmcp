# PRD: Social Night OS vision (next social waves)

> Status: DRAFT for captain review (2026-08-08). Product vision + sequenced
> waves after `SOCIAL_LAUNCH_PRD.md`. Not an execution ticket for shipping
> faces or the friends gate; those stay in the Social Launch PRD.
> Executor after approval: Cursor, one PR per work package unless a package
> notes a split.
> Sibling PRDs: `SOCIAL_LAUNCH_PRD.md` (WP1-WP7, in flight),
> `PUBPAL_CONNECTIONS_PRD.md`, `UI_UX_FIX_PRD.md`.
> Laws: root `CLAUDE.md` + `docs/VOICE.md`. The guardrails at the bottom are
> law, not advice.
> Stack truth: Supabase (identity + durable stores), PostHog (consent-gated
> analytics), optional Clerk (not a PUBMAXX User ID), Vercel deploy. No new
> identity authority in this vision.

## Why we build

PUBMAXX exists to put real people in real places together. Instagram, TikTok,
and the save-later habit glue people to screens and then lose the place.
Strava proved that a map plus friends plus a light kudo can turn a solitary
act into a social habit. Airbnb Wishlists proved that a private pin becomes
a plan when the crew can see it. Snapchat and Locket proved that ephemeral,
friends-only media keeps nights honest when public feeds make people perform.

This PRD is the product thesis for the social layer after the friends-only
launch: **Strava for nights**, with a place memory layer (wishlist +
imported inspiration) and friends-only ephemeral presence, never a Twitter
for pubs and never an Instagram clone.

The founder test for every package: does this help someone get out, meet
people, remember a real night, and come back for the next one?

## Research synthesis (what we steal, what we refuse)

Research window: mid-2026 Product Hunt / App Store nightlife and
"reel-to-map" wave, plus the classic mechanics below. Competitor names are
evidence, not partnerships.

### Strava (activity → social habit)

| Mechanic | What it does | PUBMAXX translation |
| --- | --- | --- |
| Activity as post | Finishing a run IS the post | Completing a Plan / Visit Report / Round IS the social unit |
| Kudos | One-tap acknowledgement, low composition cost | One-tap on a Memory / Visit / Drop (already named in `MASTER_PRD` Wave 3) |
| Segments | Local, place-bound competition | Venue / area "regulars" and cheapest-pint segments among friends, never alcohol-volume scores |
| Clubs | Group context without public broadcast | Crews and Soft Plans (already shipping) as the club layer |
| Local Legend | Frequency over speed | "Most nights here with mutuals" style presence, not streak theatre |

Steal: activity-first feed, frictionless kudos, place-bound leaderboards among
friends. Refuse: public stranger rankings that reward drinking volume, and any
streak that invents urgency.

### Airbnb Wishlists (private pin → shared plan)

Wishlists are private by default, shareable by choice, and they collapse into
a booking when ready. PUBMAXX already has saved venues and Plan intake; the
gap is a first-class **Wanted** list that can absorb inspiration from outside
the app and hand a stop into Tonight / Soft Plan / Crew without retyping.

Steal: private collections, collaborative lists, "this pin becomes Tuesday".
Refuse: public "influencer itinerary" feeds as the default social surface.

### Revolut / fintech Spaces (shared intent, not debt)

Revolut Spaces and shared pots succeed because they name a goal and keep
money as a tool. PUBMAXX Rounds already record spend, never debt
(`CLAUDE.md` Round law). The social translation is a **crew pot for the
night** only as optional accounting inside the Round diary, never IOUs,
never settlement as a product promise.

Steal: named shared intent ("Camden birthday pot"). Refuse: balances,
shares owed, or debt totals on any social surface.

### Instagram / TikTok / X (attention machines we do not copy)

What works for them: vertical media, Close Friends lists, Stories as
ephemeral context, Share Sheet as the real distribution API. What fails for
a night OS: For You stranger feeds, performance posting, infinite scroll as
the product, and "sync my Saves" fantasies.

**Hard API fact (law for this PRD):** Meta's Instagram Graph API does not
expose a user's private Saves or collections. Personal Basic Display is
dead; Graph is Business/Creator scoped; `saved_count` is a metric on media
you already own, not a list of places the drinker bookmarked. Apps that
claim "import your Instagram Saves" either paste/share a link (honest) or
scrape (forbidden here). TikTok and YouTube share the same honest path:
user shares a URL into PUBMAXX.

### Snapchat / BeReal / Locket (ephemeral friends presence)

Post-BeReal reality (2025-2026): users retreated from public authenticity
theatre into private photo apps (Locket widgets, Close Friends, Snaps).
Ephemeral media works when the audience is small, the TTL is honest, and
the camera is optional rather than nagged.

Steal: friends-only Tonight snaps with a hard TTL, low-friction reactions,
group chat as the coordination spine (Messages already exist). Refuse:
forced daily prompts, celebrity broadcast slots, and any "everyone must
post now" mechanic.

### Product Hunt / App Store "reel → map" wave (2025-2026)

Named products in the same problem space: TripTok, Plotline, Places, Reelstrip,
SwipeSights, plus nightlife-adjacent Peak. Common pattern: **paste or Share
Sheet a Reel/TikTok → extract place → pin on a map → optionally plan**.
Group variants add swipe voting (SwipeSights) or collaborative collections
(Plotline).

London nightlife planners (Pinned, I'm In, NightPlan) own plans + crew RSVP;
they do not own priced pubs, Visit Reports, or a friends-only social loop
with provenance. Our wedge is the priced map + honest community prices +
Plan/Crew + friends social, with reel-import as an on-ramp, not the product.

## Product thesis (one sentence)

**PUBMAXX social is the private operating system for a night out: taste and
wanted places on a map, friends who show up, ephemeral presence during the
night, and durable stories after, all on the priced London (then UK) map.**

### Three layers (do not collapse them)

1. **Wanted (pre-night)** - places and drinks you mean to try; includes
   pasted Reels/TikToks resolved to venues; private by default; shareable
   into a Crew or Soft Plan.
2. **Tonight (during)** - friends-only presence: Soft Plans, RSVPs, pint
   drops, optional ephemeral snaps with TTL; never a public live feed.
3. **Story (after)** - Visit Reports, Memories, deliberate Night Stories,
   recap share pages; durable when the person chooses; private by default.

Social Launch (`SOCIAL_LAUNCH_PRD.md`) ships the trust floor: Supabase
identity, 18+, mutual friends, owned moderated avatars. This vision sits
on top of that floor. Do not open Wanted import, snaps, or public Stories
before Social Launch verification and captain approval.

## Personality and taste (the "who is this drinker" graph)

People should not fill out a personality quiz. Personality is derived from
what they already do in the product, then shown as an editable Night Profile
taste card.

### Inputs we already have (compose, do not invent)

| Signal | Owner today | Personality use |
| --- | --- | --- |
| Drink categories logged | `lib/drinks.ts`, community prices, Rounds | Favourite pours; no-alcohol honesty |
| Visit Reports (crowd, noise, seating, wait) | `lib/visitReports.ts` | Preferred room feel |
| Community venue signals | `lib/communityVenueSignals.ts` | Character / access preferences as soft priors |
| Saved venues / Plans / Soft Plans | existing save + plan stores | Area gravity and occasion shape |
| Persona lens on the map | map persona controls | Explicit override, never silent |

### Outputs (Night Profile taste card)

- **Pour personality** - closed vocabulary derived from submitted categories
  (e.g. bitter-led, soft-drink first, cocktail curious). Copy names drinkers'
  judgement, never medical or addiction framing.
- **Room personality** - from Visit Report observations (quiet corner vs
  packed floor).
- **Wanted stack** - top unresolved Wanted places, including reel-sourced
  ones, as the next-night prompt.
- **Story highlights** - only Memories / Visit Reports the person marked
  shareable with mutuals.

Alcohol quantity never creates progress, badges, or leaderboards
(`MASTER_PRD` retention law). Frequency of nights with friends may; volume
of units may not.

## Feature waves (after Social Launch)

Builder sizing: S/M/L. Sequencing assumes Social Launch WP1-WP7 are at least
launch-verified. Captain may re-order after live evidence.

### Wave A - Wanted places + Reel/TikTok paste import (L)

**Goal:** a drinker pastes or Shares an Instagram / TikTok / YouTube URL;
PUBMAXX resolves a venue candidate (or asks them to confirm on the map);
the place lands on their Wanted list with the source link, a short note,
and optional drink interest; they can push it into a Soft Plan or Crew
wishlist.

**Honest import path (law):**

1. Share Sheet / paste URL only. No Meta OAuth "read my Saves". No scraping
   logged-in Instagram sessions. No password capture.
2. Resolve: oEmbed / public metadata where licensed + our venue index match
   (name, area, OSM hints). Ambiguous matches open a map picker; never guess
   a priced pin onto the wrong pub.
3. Store: `source_url`, `source_platform`, `resolved_venue_id` (nullable until
   confirmed), `note`, `wanted_by` actor, visibility (`private` |
   `mutuals` | `crew:<id>`).
4. UK base pubs may be Wanted as marks only (same `CommunityPriceMapReach`
   honesty as the base layer: mark, never invent a pint price).

**Files likely to grow (indicative, not a lock):** new
`lib/wantedPlaces.ts` + store; `/api/wanted`; Share-target / paste UI on
You and Plan intake; resolver module with provider capability matrix
(`SocialProviderCapability` in `MASTER_PRD`); PostHog events for paste →
resolve → confirm → plan.

**Tests:** URL allowlist; refuse non-http(s); refuse credential phishing
shapes; ambiguous match never auto-confirms; Wanted never writes
`cheapestPrice`; privacy defaults private.

**Demo gate:** paste a public Reel about a known London pub → confirm pin →
see it on Wanted → add to Soft Plan stop list.

### Wave B - Drink & room personality card (M)

**Goal:** You page shows a taste card derived from the person's own
observations, with explicit edit/hide. Friends (mutuals) see only what the
owner marked visible.

**Build on:** Visit Reports, community price categories, Round drink lines
(provenance-aware: `round` vs `demo`), map persona.

**Anti-goals:** Big Five quizzes; inferred sexuality/politics/health;
"alcohol score"; auto-posting the card to a feed.

### Wave C - Friends-only Tonight snaps (ephemeral) (L)

**Goal:** during an active Soft Plan or while checked into a Tonight context,
mutuals can send a photo/short video that expires (suggested default 24h,
hard max 48h). Reactions are kudos-class (one tap). No public Story grid.
No Discover tab of strangers' snaps.

**Reuse:** social post media pipeline + EXIF strip + omni-moderation
fail-closed from Social Launch WP2/WP4; mutual friends from WP6; report/hide
lane from WP4.

**Anti-goals:** screenshots-as-a-feature promises we cannot keep on the web;
BeReal-style mandatory daily posts; Snap Map stranger heatmap.

### Wave D - Night Stories and real talk (M)

**Goal:** after the night, a person turns Visit Reports + optional snaps
into a Night Story: a short narrative (voice-governed length) pinned to
venues and the crew, visibility mutuals or private. This is where "real
stories about fun things" live: durable, consented, editable before publish.

**Reuse:** Moment/Memory vocabulary already in `MASTER_PRD`; Visit Report
panel; crawl/recap share pages from Wave 3 of the master plan.

**Voice:** jokes stay out of figure/date/source lines (`docs/VOICE.md`).
Stories may be warm; provenance lines stay plain.

### Wave E - Strava-class kudos + friend segments (M)

**Goal:** one-tap kudos on Memories, Visit Reports, completed Plans, and
Wanted fulfilments. Friend-only "segments": e.g. most mutual nights at a
venue in 90 days, or cheapest corroborated pint among the crew's logged
categories. Pint Index stays a city product; friend segments stay inside
the mutual graph.

**Refuse:** global drinker leaderboards; unit-count challenges; anything
that treats alcohol volume as mastery.

### Wave F - Collaborative Wanted + swipe-to-agree (M)

**Goal:** Plotline/SwipeSights pattern for a Crew: members add Wanted
places (including pasted Reels); the crew swipes or votes; winners drop
into Soft Plan stops. Decision friction drops without a stranger algorithm.

### Wave G - Provider capability matrix (S→L, staged)

**Goal:** implement `SocialProviderCapability` honestly: public profile link,
native share fallback, paste import (Wave A), later consented publishing
only where the provider allows and the person confirms each post. Server
derives availability from complete credentials; client never guesses OAuth
exists (`MASTER_PRD` §9).

## Mapping to the release journey

`discover → plan → invite → arrive → capture → complete → recap → share/save → return`

| Step | Vision attachment |
| --- | --- |
| discover | Wanted + reel paste + persona lens |
| plan / invite | Collaborative Wanted → Soft Plan / Crew |
| arrive | Tonight snaps + presence |
| capture / complete | Visit Report + Round lines feed personality |
| recap / share | Night Story + kudos |
| return | Wanted stack + taste card prompts next night |

## What we already ship that this rides on

Do not rebuild these; compose them.

- Friends-only Social Launch (identity, avatars, mutuals, moderation).
- Soft Plans / occasions / Crew Night Loop.
- Visit Reports (dated accounts, not venue ratings).
- Community prices + venue signals (observations, corroboration).
- Rounds (spend diary, provenance-gated promotion).
- Messages, follows → mutuals, pint drops (friends visibility).
- Map lenses, saved venues, Plan intake persistence.
- Pub Pal (separate PRD; may later propose Wanted items with confirmation).

## Anti-goals (explicit)

1. Not Twitter / Instagram / TikTok for pubs. No stranger For You feed.
2. No silent Meta/TikTok save sync. Paste and Share Sheet only until a
   provider ships a real Saves API (none today).
3. No scraping, no password capture, no browser automation of social logins.
4. No alcohol-volume gamification, streaks-as-guilt, or unit leaderboards.
5. No merging UK base pubs into `venues_slim*` or inventing prices on Wanted
   base marks.
6. No changing `PUBMAX_SOCIAL_FRIENDS_LAUNCH` from this PRD; launch state stays
   with Social Launch WP5 and the captain.
7. No debt, IOUs, or settlement products dressed as social.
8. No Cards-as-hero redesign of marketing pages in this workstream; social
   surfaces follow existing product chrome.

## Guardrails (law)

1. **Privacy / egress:** EXIF stripped before storage; moderation sees
   short-lived media URLs, never handle/account ids beside the image.
2. **Moderation fail-closed:** same posture as Social Launch for every new
   media type (snaps, story stills).
3. **Friends definition:** mutuals only for personal media and taste cards
   marked mutuals-visible (D3 of Social Launch).
4. **Honesty:** legal pages and in-product copy describe paste-import and
   self-asserted 18+, never a Saves sync or Yoti promise the code does not
   keep.
5. **Analytics:** PostHog events are consent-gated; no fingerprinting
   workarounds for "who pasted which Reel".
6. **Voice:** `docs/VOICE.md` binds every user-visible string in these waves.

## Sequencing relative to Social Launch

```
Social Launch WP2/WP4/WP6 (media + mutuals) ──┐
Social Launch WP1 (gate) ─────────────────────┼─► launch verification (WP5)
Social Launch WP3/WP7 (render + graph) ───────┘
                                               │
                                               ▼
                         Wave A Wanted + paste import
                         Wave B personality card
                         Wave C Tonight snaps
                         Wave D Night Stories
                         Wave E kudos + friend segments
                         Wave F collaborative Wanted
                         Wave G provider matrix (staged)
```

Cursor may spike Wave A resolvers behind a dead UI flag after WP2 media
patterns exist, but no user-reachable Wanted import ships before captain
approval of this PRD.

## Open questions for the captain (not for executors to invent)

1. Default Tonight snap TTL: 24h vs end-of-calendar-day Europe/London?
2. Should Wanted reel imports be allowed to resolve to UK base pubs in v1,
   or curated index only?
3. Is collaborative Wanted (Wave F) in the first invite-ready cut, or after
   solo Wanted proves paste→plan conversion in PostHog?
4. Native share-target (PWA / iOS) in Wave A v1, or paste-only first?

## Success metrics (PostHog, consent-gated)

- Paste → confirm venue → Wanted save rate.
- Wanted → Soft Plan / Plan stop conversion within 14 days.
- Mutual kudos per completed Plan.
- Tonight snap senders per active Soft Plan (friends-only).
- Night Story publish rate after Visit Report (not vanity DAU).
- Zero SEV moderation misses on new media types; report→hide median time.

## Deploy / ops notes

- Migrations SQL-only; firstmate applies.
- New flags register in `lib/trustedHandoffFlags.server.ts` with ownerLane,
  removalCondition, offBehavior.
- OpenAI moderation key remains captain-owned from Social Launch WP2.
- No new OAuth app review until Wave G explicitly needs it; paste works
  without Meta app review.
