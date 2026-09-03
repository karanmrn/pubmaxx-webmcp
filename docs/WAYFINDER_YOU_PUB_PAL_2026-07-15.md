---
title: Wayfinder map - You, Pub Pal, and social identity
labels:
  - wayfinder:map
  - ready-for-agent
destination: A fast mobile social profile where every Pubmaxxer owns an identity, a Pub Pal, and the memories of their nights
---

# Wayfinder: You, Pub Pal, and social identity

## Destination

A first-time visitor reaches useful map value immediately. A returning Pubmaxxer opens You and recognises a personal social home: identity, Pal, Moments, Passport, saved places, and privacy controls. Nothing important is hidden behind spectacle, and no character blocks the practical planning flow.

## Current position

- Account-backed handles, claim, rename, aliases, and canonical resolution are implemented.
- X, Instagram, and TikTok connection surfaces are implemented.
- Pint Passport, timeline, saved pubs, Night Memories, and Pub Pal onboarding exist.
- The profile hierarchy and Pal/mobile overlay defects are being repaired in the current branch.
- The active Vercel production build predates this repair; GitHub authentication is currently blocking branch publication.

## Routes

### Route A - Identity-first mobile profile

**Deliverable:** You reads like a social profile before it reads like settings.

- [x] Move identity above account controls.
- [x] Add Moments, Passport, Saved, and Settings navigation.
- [x] Expose Pub Pal from the owner profile.
- [x] Prevent the generic tour from covering You.
- [ ] Replace the empty timeline with a unified media grid and clear first-post action.
- [ ] Add share-profile and visibility controls.

### Route B - Handle activation

**Deliverable:** every signed-in Pubmaxxer can safely own a memorable public handle.

- [x] Authenticated claim and rename endpoints.
- [x] Availability, cooldown, alias, and canonical-resolution policy.
- [x] Local route handoff after a successful claim.
- [ ] Add live debounced availability feedback before submit.
- [ ] Add reserved-word guidance and recovery UX.
- [ ] Instrument claim started, succeeded, rejected, and canonical-profile viewed.

### Route C - Pub Pal in the social home

**Deliverable:** Pub Pal feels owned and useful, never like a blocking mascot.

- [x] Link Pal from landing and You.
- [x] Separate Pal onboarding from the generic app tour.
- [x] Remove competing mobile Back actions and clear the bottom tabs.
- [ ] Use the chosen Pal portrait as the You avatar after creation.
- [ ] Add compact summon controls to Map, Plan, and Tonight.
- [ ] Ship typed planning proposals and visible mutation confirmations.

### Route D - Durable memory and posting

**Deliverable:** a partially written Moment survives refresh and tab changes.

- [ ] Define a versioned `MomentDraft` contract and per-account draft key.
- [ ] Persist text and metadata locally on change; keep media blobs out of localStorage.
- [ ] Restore, discard, and conflict-resolve drafts explicitly.
- [ ] Sync approved posts to the existing social domain through server routes.
- [ ] Keep private Night Memories separate from published Moments.

### Route E - Performance and retention proof

**Deliverable:** You and Pal feel instant and improve activation without dark patterns.

- [ ] Prefetch profile and Pal shells from the bottom navigation.
- [ ] Cache public profile DTOs with explicit revalidation; keep owned/private responses `no-store`.
- [ ] Measure navigation P95, draft restoration, handle activation, first Moment, first saved pub, and week-four return.
- [ ] Set budgets: route transition P95 under 300ms when warm, INP under 200ms, CLS under 0.1.
- [ ] Verify reduced motion, reduced transparency, contrast, screen-reader order, and 44px targets.

## Decision gates

1. Do not add a sixth bottom tab; Pal remains part of You unless observed usage proves otherwise.
2. Do not cache authenticated profile controls or private memories in shared caches.
3. Do not publish drafts automatically after recovery.
4. Do not let connected social accounts become identity authorities; the PUBMAXX account and handle remain canonical.
5. Do not let Pal mutate plans, posts, invites, memories, or privacy settings without a visible confirmation.

## Recommended execution order

1. Finish and certify the current profile/Pal/landing repair.
2. Add handle availability UX and canonical signed-in resolution.
3. Add durable Moment drafts and the unified media grid.
4. Bind the chosen Pal portrait to You and add compact summon controls.
5. Add share/visibility controls and retention instrumentation.
6. Tune cache policy from measured route and API latency rather than caching every page.
