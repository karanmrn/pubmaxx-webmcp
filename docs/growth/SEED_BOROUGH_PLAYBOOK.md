# Seed borough operator playbook

Goal: before a cohort blast, make each seed patch's first map viewport show
honest people-logged prices. A provisional mark is the minimum. Claim
corroboration only after two independent people log the same pub and category.
Grey first viewports kill trust.

## Seed set (Horizon 0–1)

| Patch | Why | Notes |
|---|---|---|
| Soho (Westminster) | Dense night demand | First viewport for many tourists and locals |
| Camden | Plan chips and Pint Index arrival | Keep campaign copy status-shaped, not gamified |
| Clapham (Lambeth) | Describe-first chip already works keyless | Good second-wave densify |
| Shoreditch (Hackney) | Cheap-pint asks | Do not market as “complete” early |
| Islington | Current curated layer has 77 priced pubs across 88 venues | Exact Plan generation supports `Islington`; this does not claim community corroboration |

Monthly status target for in-product copy: **20 corroborated beer pints per
borough** (`SEED_BOROUGH_MONTHLY_TARGET` in `lib/boroughCoverageStatus.ts`).
That is a coverage floor, not a leaderboard.

## Before the cohort blast

1. Captain + 2–3 early drinkers each log a real pint in the same seed pubs.
2. Prefer different accounts so corroboration can fire (`COMMUNITY_PRICE_CORROBORATION_THRESHOLD`).
3. Confirm provisional marks appear; wait for a second voice before promising pin colour.
4. Open `/map` cold on phone width and check the first viewport is not empty grey.
5. Re-check `/pint-index` seed status strip after durable reads settle.

## Honesty rules

- Never seed fake corroboration or invent figures.
- Demo / curated prices may colour a band; they must not be described as people-logged.
- A failed community-price read may never be worded as “zero prices in this borough.”
- Keep Social live by default while densifying. Use `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` only for an emergency rollback.

## Weekly operator loop

1. Read corroborated coverage for seed boroughs (PostHog + Pint Index status strip).
2. Top up the thinnest borough with real logs, not ads.
3. Only then widen the invite blast.
