# V1 invite scoreboard

Operator scoreboard for the soft-launch London cohort. Social is live by
default when `PUBMAX_SOCIAL_FRIENDS_LAUNCH` is unset; `=0` is a full emergency
rollback to static preview. Product stance lives in
[`docs/plans/PLG_STRATEGY.md`](../plans/PLG_STRATEGY.md); the operator checklist
is [`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md) §6 and
[`docs/growth/HORIZON0_OPS_CHECKLIST.md`](HORIZON0_OPS_CHECKLIST.md).

## Cohort

| Item | Target |
|---|---|
| Who | 15–40 London drinkers you already WhatsApp nights with |
| What | Map + plan invite + price logging |
| Seed boroughs | 1–2 (e.g. Soho + Camden) with corroborated people-logged prices before the blast |
| Ads | None for week 1 |

## Per-night metric (Crew Night S1)

Plans with **at least two committed humans** on the crew roster. No new event:
reuse `crew_committed` and filter `participants >= 2`. Full formula and
rationale: [`docs/METRICS_FUNNEL.md`](../METRICS_FUNNEL.md) §0. The loop north
star is `next_night_committed`; its emitter and privacy contract live there.

```
crew_nights_with_two_or_more = count(crew_committed WHERE participants >= 2)
```

Do not substitute `invite_rsvp_submitted` — RSVP is intent on the public invite
page, not a confirmed join. Track Social only for an explicit, consented
product question; do not use it as a vanity launch metric during rollback.

## Weekly PostHog reads

Consent-gated events only ([`docs/METRICS_FUNNEL.md`](../METRICS_FUNNEL.md)).
Project: `https://eu.posthog.com/project/219466`.

| Metric | How to read it |
|---|---|
| **Crew nights (per-night metric)** | `crew_committed` where `participants >= 2`; rate over `plan_saved` |
| Invite share after `plan_saved` | `plan_invite_sent` + `plan_invite_link_copied` |
| Invite k-factor (public page) | `invite_rsvp_submitted` / `invite_page_viewed`; also `invite_map_opened` / `invite_page_viewed` |
| Classic invite redeem (if used) | `invite_redeemed` / `invite_created` |
| Price conversion (signed-in) | `price_submitted` / `price_submit_viewed` |
| Landing CTA mix | `landing_cta_clicked` by `target` (`map` / `near` / `plan`) |
| Meaningful plan actions | `plan_saved`, crew joins, invite share; also `meaningful_core_action` |
| Return pulse | `activity_pulse` |
| Seed borough coverage | Pint Index seed strip + corroborated beer counts (playbook) |
| Social DAU | Track only for an explicit, consented product question; unavailable during `=0` rollback |

## Week-1 pass bar

- At least one plan reaches `crew_committed` with `participants >= 2`
- ≥10 distinct humans opened the map
- ≥5 RSVPs or price logs
- Invite share on most successful locked plans
- Seed boroughs not empty grey on first open
- No paid ads
- Social is live by default; `=0` must show static preview only

## Physical posters

Optional only after the digital cohort works. Spec:
[`docs/growth/POSTER_SPEC.md`](POSTER_SPEC.md) into `/near?utm=…`.
