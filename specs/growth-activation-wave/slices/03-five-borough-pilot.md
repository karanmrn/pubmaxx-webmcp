# Slice 03: Five-borough pilot

## Contract

Seed-borough coverage status contains five London boroughs. Fifth is Islington,
selected because the current curated layer has 77 priced pubs across 88 venues
and exact Plan generation already supports the Islington Night Area.

## API Seam

- Extend only `SEED_BOROUGH_CAMPAIGN` in `lib/boroughCoverageStatus.ts` with
  `{ slug: "islington", name: "Islington", mapQuery: "Islington" }`.
- Update the operator playbook. Do not add a borough page or price row.

## Verification

- `__tests__/boroughCoverageStatus.test.ts` pins five entries, unique slugs,
  and Islington map destination.
- Keep degraded and partial-read honesty tests green.

No visual screenshot is needed because existing renderer consumes one more
row without a new layout or component.
