---
title: PUBMAXX You and Pub Pal social profile
labels:
  - ready-for-agent
  - difficulty:high
status: implementation-started
---

# PUBMAXX You and Pub Pal social profile

## Problem

The account-owned handle, social connections, Night Memories, Pint Passport, saved pubs, timeline, and Pub Pal already exist, but the mobile You route presents settings before identity. A new Pubmaxxer therefore sees account machinery instead of an instantly recognisable social profile. The generic first-run tour can also cover this route, while the Pal onboarding uses a second sticky action bar too close to the persistent tab bar.

## Product outcome

Make **You** the account-and-Pub-Pal home with the immediate clarity of an Instagram or TikTok profile without copying either product. A person should understand their avatar, name, `@handle`, public proof, memories, Pal, and next action in one glance. Account controls remain available but sit below the social content.

The route remains `/u/you` until an owned handle resolves, then becomes `/u/{handle}`. Pub Pal remains `/pal` and is represented from You through a prominent **Meet your Pub Pal** action. The mobile navigation stays at five items; Pal is part of You rather than a competing sixth destination.

## Highest-value journey seam

At a 390px viewport, test this continuous journey:

1. Open the landing page.
2. See equal-size **Open the map**, **How it works**, and **Meet your Pub Pal** actions.
3. Open Pub Pal without the generic first-run tour appearing.
4. Start Pal onboarding and confirm its action bar clears the mobile tabs.
5. Open You and see identity before account settings, with no overlay or horizontal overflow.
6. Claim an available handle and resolve to `/u/{handle}`.

Existing identity route tests remain the authority for handle claiming, rename cooldown, aliases, ownership, and resolution.

## Functional requirements

- The anonymous You state explains the value of an owned identity and links directly to handle claim and Pub Pal.
- An owned profile shows avatar, display name, `@handle`, bio, compact social proof, **Edit profile**, and **Meet your Pub Pal** above the fold.
- A four-part profile switcher exposes Moments, Passport, Saved, and Settings.
- Handle claim and rename continue through authenticated server endpoints. The browser never becomes the source of truth for ownership.
- X, Instagram, and TikTok connection controls remain in Settings.
- The generic first-run map tour never appears on `/pal` or `/u/*`.
- Pal onboarding has one mobile progression action, with Back owned by the top bar.
- The landing hero exposes the three distinct intents and makes all three controls equal in size.
- Both light and dark themes use shared semantic tokens and preserve visible focus and 44px targets.

## Non-goals

- Replacing the timeline or recommendation engine.
- Adding a sixth mobile navigation item.
- Voice cloning, arbitrary Pal species, or autonomous consequential actions.
- Copying Instagram or TikTok branding, icons, or visual trade dress.

## Acceptance

- No first-run dialog overlaps You or Pal.
- No Pal onboarding action intersects the bottom tab bar at 390x844 or 430x932.
- No horizontal overflow on landing, You, owned profile, or Pal onboarding.
- The three landing hero actions have equal computed width at desktop and full width on mobile.
- A signed-in person can claim a unique handle, rename within policy, and reach the canonical profile URL.
- The profile’s settings remain keyboard-reachable and appear after public-facing content.
- Focused identity tests, typecheck, lint, the mobile journey, and production build pass.

## Follow-on work

- Replace placeholder profile art with the selected Pub Pal portrait.
- Add a media grid that unifies approved Night Memories, Pint Drops, and event posts.
- Add drafts that survive navigation and refresh, using versioned local persistence before server sync.
- Add share-profile and QR/deep-link actions.
- Add private/friends/public visibility controls per post and profile field.
- Add activation and retention events without storing conversation or private draft content.
