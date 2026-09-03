# Crew Night Loop (Social Wave S1)

> Status: **S1 COMPLETE** - every box in §6 has shipped (PRs referenced there). Wave S2+ stays parked until S1 retention reads.
>
> Owns the **invite-first Social layer** that sits on the Night OS trust spine. Social is live by default; set `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` only for emergency rollback. Does **not** reopen WhatsApp CTA structure from `#816` (`PlanInviteNextStep`).
>
> Drafted 2026-08-08 from first-principles outings, Harris Poll Gen Z Weekend Report (July 2026), UK soft-socialising research, and shipped seams (plan invite, out-tonight check-in, last crew, soft occasion chips).

---

## 0. North star

> Make the next soft, affordable, low-pressure IRL plan with your lot so obvious that staying in is the harder choice.

**Per-night metric:** share of nights where a plan reaches **≥2 committed humans** (`crew_committed` with `participants >= 2`). Not scroll DAU on `/social`.

**Loop north star:** `next_night_committed`. The loop below only counts when it closes: a finished night turns into the next one. `crew_committed >= 2` measures one night, and this measures the loop.

Three usual-lot reinvite surfaces emit it, and they are the whole list: `components/plan/LastCrewInvite.tsx` (source `crew-reinvite`), `components/plan/CompletedPlanUsualLot.tsx` and `components/night/MorningReentryCard.tsx` (both source `completed_plan`). Every one of them builds its props through the single seam `nextNightCommittedProps` (`lib/lastCrew.ts`), so what the event may carry cannot drift between surfaces: a closed `source` plus coarse `windowDays`, and never a name, a venue id or a coordinate. The rail itself is consent-gated (`lib/analyticsEvents.ts`), where `source` is additionally held to a closed value set, so a free-text source is dropped rather than recorded. `__tests__/analyticsEvents.test.ts` pins the prop shape, all three emitters, and this section.

**Loop:**

```text
Truth (map) → Soft plan (occasion + cost) → Invite (1 link) →
Out-tonight / crew presence → Show up → Safe home → Memory → Invite again
```

---

## 1. First principles (what this wave is not)

| Do | Do not |
|---|---|
| Crew of 3–8, invite-only / mutual | Public stranger heat-map |
| Alcohol-optional soft occasions first | Nightlife-only Social |
| Honest £ spend on the invite | Invented budgets |
| Friends-gated check-ins | Area-public densification without sign-off |
| Chronological / consent memory later | Algorithmic For You / dating adjacency |
| Keep Social live by default | Open `/social` feed theatre |

Social engagement must never move pin colour, cheapest buckets, or the Pint Index.

---

## 2. Research spine (why S1 looks like this)

Harris Poll Gen Z Weekend Report (July 2026): 51% weekend loneliness; 68% say going out hurts the wallet; 62% avoid plans to dodge regret; 73% want social settings where alcohol is not the main focus; 62% wish online friendships became IRL plans.

UK trade press (2026): pubs under outlet pressure; Gen Z still gathers via soft formats (run clubs, coffee, structured hangs). Competitors own invites (Partiful) or stranger FOMO maps (Moves/Toki) — neither owns honest UK pub outing truth.

**Wedge:** Partiful-grade invite + friends-only “who’s out”, sitting on PUBMAXX price/occasion truth.

---

## 3. Execution slices (separate PRs)

Ordered for parallel work; later slices must not block earlier merges.

| # | Branch | PR job | Key seams | Avoid |
|---|---|---|---|---|
| 0 | `cursor/crew-night-loop-plan-dd0b` | This plan + README index | `docs/plans/` | No product code |
| 1 | `cursor/crew-northstar-metric-dd0b` | Scoreboard + funnel docs for `crew_committed` `participants >= 2`; pin tests | `docs/METRICS_FUNNEL.md`, `docs/growth/V1_INVITE_SCOREBOARD.md` (create if missing), analytics tests | No UI / WhatsApp CTA |
| 2 | `cursor/invite-spend-band-dd0b` | Honest £X–Y pp on invite share text, `/invite/[token]` copy, OG when stop prices complete; omit when incomplete | `lib/shareArtifacts.ts`, `planPresentation.ts`, invite page + OG | Do not redesign `PlanInviteNextStep` |
| 3 | `cursor/soft-occasion-defaults-dd0b` | Soft defaults: describe-first / Tonight → plan handoff / landing Why → `/plan` for AF, coffee, chill | `PlanDescribeFirst`, Tonight vibe chips, landing links | No ShareBar; no launch-flag change; no taste CSS churn |
| 4 | `cursor/crew-tonight-board-dd0b` | Friends-only “who’s out” board over `visibleCheckInsForViewer`; keep `/we-are-out` honest under live or rollback state | check-in feed, You/lot surface, `WeAreOutClient` | No area-public densify |
| 5 | `cursor/usual-lot-reinvite-loop-dd0b` | Completed-plan → usual-lot nudge; emit `next_night_committed` with closed `source` (`crew-reinvite` / `completed_plan`) | `LastCrewInvite`, `lastCrew.ts`, analytics emission | No Social crew snapshot RPC; no new server roster table |

---

## 4. Wave S2+ (parked until S1 retention)

- Crew-to-crew / friend-of-friend soft discovery
- Recurring formats (Sunday quiet Spoons, Thursday AF)
- Full Verified Social Night Loop feed (needs named moderators per `docs/social/SOCIAL_BETA_CONTRACT.md`)
- Safe-home pride pass (builds on Getting Home strip already shipped)

---

## 5. Voice and honesty

Follow `docs/VOICE.md`. No em dashes, no exclamation marks, British spelling. Jokes stay off spend figures, dates, and legal copy. Landing and `/we-are-out` must describe live Social by default and preview during explicit rollback.

---

## 6. Definition of done for S1

- [x] Plan doc on `main` (PR #918)
- [x] Per-night and loop metrics documented and test-pinned (`crew_committed` pin PR #919; `next_night_committed` loop north star documented and pinned in `__tests__/analyticsEvents.test.ts`)
- [x] Invite artifact can show an honest spend band (or silence) (PR #924: `planInviteSpendBandFromListedPrices`, invite page, OG card; silent when any stop price is missing)
- [x] Soft occasion path visible without changing Social launch state (PR #921: `SOFT_PLAN_OCCASION_IDS` in `lib/planOccasion.ts`)
- [x] Friends-only crew tonight surface + We-are-out honesty (PR #922; hardened for live-default Social by PR #1247)
- [x] Usual-lot reinvite emits `next_night_committed` (PR #923: `LastCrewInvite`, `CompletedPlanUsualLot` and `MorningReentryCard`, all three through `nextNightCommittedProps` with closed sources in `lib/lastCrew.ts`)
- [x] `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` rollback remains documented in `.env.example` and soft-launch runbooks (PR #1247)
