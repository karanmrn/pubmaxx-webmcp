# PRD: Memory Timeline, Trusted DMs & UX Feel (Wave I)

Date: 2026-07-09

## Problem Statement

Waves F–H and security Phases 1–4 are on `main` (#59/#61/#63/#65/#67/#69). The
product already has Stories feed, 1:1 DMs, reactions, follows, and passport —
but it still feels like bolted-on demo social rather than “X for pub memories”:

- Profile memory is a photo grid, not the same Spill timeline as `/feed`.
- Demo feed lanes (`Near Me`, `Crawls`) look real but do not filter.
- Messaging clients still send self-asserted handles without JWT; linked owners
  can get 403, unlinked handles remain impersonatable.
- Non-map pages stack glass chrome, dead CSS, and text-only loading states.

Parallel open work must not be rebuilt or owned here:

- [#68](https://github.com/karanmrn/pubmax/pull/68) — review-bot confidence (CONFLICTING)
- [#64](https://github.com/karanmrn/pubmax/pull/64) / [#66](https://github.com/karanmrn/pubmax/pull/66) — superseded drafts
- [#70](https://github.com/karanmrn/pubmax/pull/70) — review follow-ups draft

## Solution

Ship **Wave I** from `origin/main` as one balanced slice (options 1→2→3→4):

| ID | Deliverable |
| --- | --- |
| I1 | Memory Timeline — profile FeedCard timeline, unify handles, demote demo lanes, feed CTA/share polish |
| I2 | Trusted DMs — `authedFetch`, JWT on messages/activity, AuthProvider link, require linked actor |
| I3 | UX declutter — dead CSS, tab clearance, texture tokens, prefetch/skeletons, light DOM VT |
| I4 | Verify + draft PR packaging I1–I3 |

## Built And Should Not Be Rebuilt

- #51–#62, #63 Layers declutter, #65 Wave H, #67 security Phases 1–4, #69 message gate status.
- `/feed` + `FeedCard` + `lib/forYou.ts` + `gateHandleAction` / `resolveMessageHandle`.
- `messagesStore`, ShareBar, PintPassport, crawl share (H1), Drop picker trust (H2).

## This Wave Ships (acceptance)

### I1 — Memory Timeline
- Profile exposes a **Timeline** view that reuses `normalizePintDrop` + `FeedCard`.
- Signed-in feed prefers auth handle; comment handle key unifies with `pubmax_handle`.
- Demo lanes `nearby` / `crawls` hidden or demoted until real signals exist.
- Mobile feed drops redundant Drop CTA (tab bar owns Drop).
- OG domain typo fixed on `/p/[id]` opengraph image.

### I2 — Trusted DMs
- Clients attach Bearer via `authedFetch` for messages, activity, notification bell.
- Sign-in syncs `pubmax_handle` and links `profiles.user_id` with one PATCH.
- Messages API requires linked actor; UI shows “Sign in to message”.
- Notifications resolve handle via `resolveMessageHandle`.

### I3 — UX declutter + speed
- Remove dead `.feedNav` / unused profile topbar CSS; fix profile tab clearance.
- Texture: ink-stamp prices, less glass on non-map pages, display font tokens.
- Prefetch activity/messages on intent; add `/feed` to Speculation Rules; skeletons
  for discover/profile loading; optional DOM-only `viewTransitionName` on feed photo.

## Out Of Scope

Layers/Outer London rebuild; security phase rewrite; group chat; encrypted DMs;
ML For You; area busyness; Round crew map presence; Legacy T remount; growing
`PubMap` / `PubMapCanvas`.
