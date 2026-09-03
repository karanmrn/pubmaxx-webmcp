# ADR 0006: Pub Pal is a user-owned digital companion

## Status

Accepted

## Context

ADR 0004 limited Pub Pal to an optional presentation layer so character work could not weaken planning quality. The product direction now requires account-owned customization, voice, confirmed memory, and cosmetic progression. Treating those capabilities as presentation-only would hide durable ownership and privacy responsibilities.

## Decision

Pub Pal is an account-owned digital companion with a curated species, appearance, voice, structured personality, explicit visibility controls, confirmed structured memory, and nightlife-mastery progression.

The shared planning engine remains authoritative. A Pal may explain, search, and propose actions, but it cannot silently change recommendations, persist memory, publish content, invite people, or mutate Plans. Consequential actions require a visible confirmation. Generated prose, raw audio, and transcripts are never source-of-truth memory.

Progression unlocks only cosmetics, animation, home objects, reactions, and city lore. It never rewards alcohol quantity or changes planning quality. Core PubMax remains usable without creating a Pal, and every Pal-assisted action has a non-character equivalent.

## Consequences

- Pal creation requires an authenticated account and an 18+ attestation without storing a full birth date.
- Users control creative identity and privacy, but cannot disable factuality, moderation, legal, or safety constraints.
- Voice credentials stay server-side; provider audio and transcript retention is disabled where available.
- Futuristic brand expression lives in the interface, map, motion, and Pub Pal. Humanoid Night Signals are not part of the production experience.
