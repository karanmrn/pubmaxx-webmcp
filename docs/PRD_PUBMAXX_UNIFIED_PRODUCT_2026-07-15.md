# PUBMAXX Unified Product Contract

**Status:** Authoritative implementation appendix to [`MASTER_PRD.md`](./MASTER_PRD.md)
**Date:** 2026-07-15
**Scope:** Brand, mobile navigation, identity, connected accounts, Night Memories, Pub Pal, and activation telemetry

This appendix refines the still-valid map, planning, price, provenance,
moderation, and safety decisions absorbed into `MASTER_PRD.md`. Where this
historical text conflicts with the master contract, `MASTER_PRD.md` wins.

## Product promise

PUBMAXX helps adults turn affordable time out into moments worth remembering: find a place that fits now, coordinate the night, capture what happened, and make the next night easier.

- The product is **PUBMAXX**, always with two Xs.
- A member of the community is a **PUBMAXXER**.
- The companion is **Pub Pal**, never Pet Pal or The Landlord.
- The product celebrates friendship, discovery, culture, and memories. It never rewards alcohol quantity or frames intoxication as achievement.

## The core loop

Discover on the live map or Tonight lane → choose a route or venue → invite a crew → capture private Night Moments → contributors approve publication → share a Night Story → save a next-night intention → return.

Every main surface must move a person into this loop. Decorative humanoid cyberpunk characters are excluded. Futurism comes from responsive maps, spatial layers, translucent materials, clear motion, and the user-owned Pub Pal.

## Mobile information architecture

The five primary jobs are identical on mobile and desktop:

1. **Map** — live price-aware discovery, routes, travel modes, and distance.
2. **Tonight** — time-appropriate events, moods, and nearby opportunities.
3. **Moment** — create a price-backed Pint Drop or another private Night Moment.
4. **Stories** — relive approved shared nights and discover community stories.
5. **You** — identity, saved places, Pub Pal, memories, privacy, and settings.

Contextual map controls expose **Prices**, **Ask your Pub Pal**, and **Layers**. These are map actions, not competing global destinations.

## Identity and connected accounts

- Every authenticated account owns an immutable internal profile ID.
- A public `@handle` is unique, normalized, rate-limited, and renameable only through a cooldown policy.
- Old handles resolve through aliases so shared profile links remain durable.
- X and TikTok connections use provider-authorized flows when configured.
- Instagram professional accounts may use an authorized provider flow; personal accounts are represented only as explicit, unverified links unless a compliant provider path exists.
- Provider tokens and secrets stay server-side. Public profile responses expose only approved display metadata.

## Night Moment, Memory, and Story

- A **Night Moment** is the smallest capture: a verified Pint Drop, photo, event, note, venue, or route milestone.
- A **Night Memory** is private by default and owned by its creator.
- A **Night Story** is a publishable collection with one host and explicit contributors.
- Adding another person's Moment creates a proposal. Publication requires that contributor's affirmative consent.
- Removing consent removes that contributor's material from future public renders without deleting their private original.
- Consequential Pal or voice actions return a typed proposal first and require visible confirmation.

## Pub Pal

Pub Pal is an optional, account-owned companion layered on the same factual map, price, route, moderation, and safety engines as the non-character UI. It may help plan, explain, search, and recap. It cannot silently publish, invite, alter plans, persist memories, or change privacy settings.

People can mute, hide, interrupt, customize, or delete their Pal. Voice is push-to-talk or typed, degrades to text, and never exposes provider credentials in the browser.

## Performance and resilience

- Warm primary navigation transitions should feel immediate; target interaction response below 100 ms and p95 route readiness below 1.5 s on a representative mobile connection.
- Cache versioned, non-personal venue and map data. Revalidate mutable prices and Tonight data with visible freshness.
- Keep private drafts in scoped browser storage so refreshes and tab switches recover work. Do not cache secrets, voice transcripts, precise location history, or unapproved memories.
- The server remains the authorization boundary for database writes. The existing Convex pilot may expand behind typed server functions and dual-read verification; Supabase remains authoritative until measured parity and a reversible migration gate are met.

## Activation and retention measurement

The privacy-safe funnel is:

`discovery_viewed` → `plan_created` → `plan_invite_sent` → `crew_committed` → `night_moment_saved` → `night_story_published` → `next_night_committed`

Events use a closed allowlist of coarse properties. Handles, names, free text, email addresses, precise coordinates, message content, and voice content are forbidden in analytics.

## Release acceptance

- Light and dark modes at 390, 430, 1280, and 1440 pixels.
- No horizontal overflow; 44 px minimum interactive targets; visible focus; reduced-motion, reduced-transparency, and increased-contrast support.
- Map, Tonight, Moment, Stories, and You remain discoverable in both navigation modes.
- Draft recovery survives refresh and tab changes.
- Identity ownership, handle aliases, contributor consent, proposal confirmation, and analytics sanitization have focused tests.
- Lint, typecheck, unit tests, isolated production build, and focused mobile browser checks pass before push or deployment.
