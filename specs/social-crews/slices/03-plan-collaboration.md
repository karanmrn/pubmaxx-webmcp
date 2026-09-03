# Slice 3: focused Plan collaboration

## Contract

Active authorised members can add constraints, propose one complete route,
record one focused vote, and let owner or cohost decide. Social wrappers reuse
Plan validation and revision rules without minting or exposing Plan tokens.

## Seam

`SocialCrewCollaborationStore` maps stable Crew membership to the bound Plan
member inside atomic RPCs. It produces existing `PlanConstraint`,
`PlanRouteProposal`, and `PlanVote` DTO shapes.

Every active or retained Social membership owns exactly one immutable bound
Plan member. Reactivation reuses it. Removal and leave disable Social wrappers
through membership state but retain Plan-member provenance. Social wrappers
never mint or reveal the unreachable legacy token hash.

## RED cases

- Removed or blocked member cannot constrain, propose, vote, or decide.
- Accepted proposal must match expected route revision.
- One vote per active member. Revote replaces.
- Same-key replay is stable. Changed payload conflicts.
- Owner transfer changes decision authority immediately.
- No wrapper accepts a Plan member token.

## Playable checkpoint

Members propose a three-stop route, record votes, and owner accepts it from the
Crew Plan section.

## Verification

Run existing Plan collaboration tests plus Social wrapper route and PostgreSQL
race tests. Keep `PlanState` and route revision as single owners.
