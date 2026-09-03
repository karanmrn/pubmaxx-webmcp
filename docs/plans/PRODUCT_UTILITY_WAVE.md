# Product Utility Wave — sheet and journey usefulness

> Status: **SHIPPING** (2026-08-07). Distinct from outings/coffee/taste stacks (#817–#856) and night-OS (#829/#832).
> Base: `main` (post #816 invite-ready + #846 post-claim profile).
> Does **not** own Social launch state, WhatsApp CTAs, UK national map (#840), or taste CSS. Current Social rollout lives in [`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md).

---

## Goal

Ship **usefulness already half-built in the tree** that casual drinkers never see: community signals, visit peeks, FSA hygiene, Safe Night on the get-home path, quiet pint on `/tonight`, and honest landing links while Social stays closed.

Physics: observations stay observations; degraded never reads as empty; no invented biography or seeded prices.

## Why this wave (not more outings)

Open PRs already own coffee taxonomy, Spoons prefer/filter, lens analytics, borough ops, and taste composition. This wave picks **unread product seams** on `main`.

## Ranked jobs

### U1 — Community venue signals on Overview
**Branch:** `cursor/venue-signals-overview-dd0b`  
**Job:** Mount a read-first `VenueCommunitySignals` (or peek) on Overview so character / access / eating show without opening price submit. Composer stays on the submit path. Trust copy: observation, not fact.  
**Done when:** vitest pins Overview presence; degraded ≠ empty.

### U2 — Landing memory / Social honesty
**Branch:** `cursor/landing-memory-honesty-dd0b`  
**Job:** During the explicit `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` emergency rollback, Memory beat CTAs must not promise live Social. Point to `/plan`, private recap, or your memories.
**Done when:** landing honesty tests pin the gated links.

### U3 — FSA hygiene above the Disclosure fold
**Branch:** `cursor/hygiene-sheet-discover-dd0b`  
**Job:** Move or duplicate `VenueHygiene` so food-safety rating is visible without “Details and practical info,” especially when the pub serves food. Unmatched still renders nothing.  
**Done when:** Overview tests pin above-fold hygiene for food venues.

### U4 — Visit report peek on Overview
**Branch:** `cursor/visit-report-overview-peek-dd0b`  
**Job:** Newest 1–2 visit accounts (or honest empty/degraded) on Overview; full composer stays on Story. Visit-date authority unchanged.  
**Done when:** visit report tests + Overview pin.

### U5 — Safe Night on Getting Home tab
**Branch:** `cursor/safe-night-getting-home-dd0b`  
**Job:** Venue Getting Home shows calm share-location / TfL / emergency lines without requiring a Night Mode plan id. Dismissible; VOICE calm register.  
**Done when:** unit/e2e for Getting Home safe strip.

### U6 — Quiet pint on `/tonight`
**Branch:** `cursor/tonight-quiet-pint-dd0b`  
**Job:** Compose `buildQuietPint` on `/tonight` the way `/today` already does; soft-fail when the quiet window does not apply.  
**Done when:** tonight page tests pin the module.

### U7 — Poster QR → `/near` (stretch)
**Branch:** `cursor/poster-near-landing-dd0b`  
**Job:** `/?src=poster` (UTM preserved) lands on `/near` or map-near with one honest orientation line. Spec already in `docs/growth/POSTER_SPEC.md`.  
**Done when:** redirect/analytics test; no Social surface.

## Opened PRs

| Item | PR |
|---|---|
| Plan | [#861](https://github.com/Singularityszn/pubmax/pull/861) |
| U1 signals on Overview | [#863](https://github.com/Singularityszn/pubmax/pull/863) |
| U2 landing Social honesty | [#865](https://github.com/Singularityszn/pubmax/pull/865) |
| U3 FSA hygiene above fold | [#862](https://github.com/Singularityszn/pubmax/pull/862) |
| U4 visit report peek | [#864](https://github.com/Singularityszn/pubmax/pull/864) |
| U5 Safe Night Getting Home | [#867](https://github.com/Singularityszn/pubmax/pull/867) |
| U6 quiet pint on /tonight | [#869](https://github.com/Singularityszn/pubmax/pull/869) |
| U7 poster → /near | [#868](https://github.com/Singularityszn/pubmax/pull/868) |

## Anti-goals

- No Social launch-state change in this wave
- No lot / presence densification (PLG Wave 3 wait)
- No coffee taxonomy / taste CSS rework
- No Wetherspoons Order & Pay reverse

## Execution rules

1. One concern per PR; base `main` unless a dependency forces otherwise.
2. VOICE.md; British; no em dashes; no `!`.
3. Commit + push + draft PR before claiming done.
4. Prefer mounting existing components over inventing parallel ones.
