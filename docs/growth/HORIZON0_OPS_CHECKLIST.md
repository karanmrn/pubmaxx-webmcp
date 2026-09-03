# Horizon 0 ops checklist

Soft-launch London night OS. Captain-owned promote and cohort invite; agents
ship the product and keep this checklist current. Strategy:
[`docs/plans/PLG_STRATEGY.md`](../plans/PLG_STRATEGY.md). Scoreboard:
[`docs/growth/V1_INVITE_SCOREBOARD.md`](V1_INVITE_SCOREBOARD.md). Runbook §6:
[`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md).

## Smoke (re-verified 2026-08-07)

```sh
curl --fail --silent --show-error --location https://pubmaxxing.com/map \
  | grep -F '<title>Map · PUBMAXXING</title>'
curl --fail --silent --show-error --location https://pubmaxxing.com/social \
  | grep -F '<title>Social · PUBMAXXING</title>'
# On a rollback deployment, replace the Social marker with:
# <title>Social preview · PUBMAXXING</title>
```

Captain still owns merge of #747, `vercel promote`, and the human WhatsApp cohort. Agents keep product + this checklist current.

## Do not do in this wave

- Keep `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset for live Social; set it to `0` only for a full emergency rollback.
- Rebuild referral feature grants in any form (a milestone is a mark of honour: [`docs/REFERRALS.md`](../REFERRALS.md))
- Charge a drinker for anything, or gate the annual Year in Pints wrap
- Add Stripe Checkout
- Market non-London city packs for optics
- Claim “we beat Stripe” in any copy

## Merge and promote

1. DONE (2026-08-07): V1 invite-ready product work merged ([#816](https://github.com/Singularityszn/pubmax/pull/816)).
2. Merge CI runner fix ([#747](https://github.com/Singularityszn/pubmax/pull/747)) so quality gates are real.
3. Confirm migrations through `0084_crew_snapshot_wetherspoons_flag` are live (runbook §1.3; applied 2026-08-08).
4. Promote the production deployment (`vercel promote <url>`).
5. Smoke:

```sh
curl --fail --silent --show-error --location https://pubmaxxing.com/map \
  | grep -F '<title>Map · PUBMAXXING</title>'
curl --fail --silent --show-error --location https://pubmaxxing.com/social \
  | grep -F '<title>Social · PUBMAXXING</title>'
# A rollback deployment must return <title>Social preview · PUBMAXXING</title>.
```

## Cohort invite (15–40 drinkers)

1. Seed corroborated people-logged pints in 1–2 boroughs first (Soho / Camden).
   Playbook: [`SEED_BOROUGH_PLAYBOOK.md`](SEED_BOROUGH_PLAYBOOK.md).
2. WhatsApp a real upcoming night: map link + plan invite + one-line ask.
3. Do not run ads in week 1.
4. Fill the weekly scoreboard from PostHog (project `219466`).

## Week-1 pass bar

- ≥10 distinct map opens
- ≥5 RSVPs or price logs
- Invite share on most successful locked plans
- Seed boroughs not empty grey on first open
- Social remains live by default and returns to static preview only with `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0`.
