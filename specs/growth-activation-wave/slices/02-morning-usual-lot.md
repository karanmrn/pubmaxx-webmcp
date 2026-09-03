# Slice 02: Morning usual-lot loop

## Contract

When a one-time morning recap card and a saved crew of at least two people are
both available, the card offers a direct next-night Plan action. It sends only
the existing closed `next_night_committed` analytics properties.

## API Seam

- `MorningReentryCard` reads `subscribeLastCrew` and `readLastCrew` through
  `useSyncExternalStore`.
- `readLastCrew` caches the parsed value for an unchanged storage string, as
  React external-store snapshots require stable identity.
- Existing `nextNightCommittedProps("completed_plan", crew)` owns telemetry.
- Link target stays `/plan`. No roster names enter URLs or analytics.

## Verification

- Add a mounted component test that pins the shared last-crew seam, closed
  event, private payload, and `/plan` destination.
- Keep `__tests__/morningReentry.test.ts`, `__tests__/lastCrew.test.ts`, and
  `__tests__/analyticsEvents.test.ts` green.
- On the integrated build, inspect the card at 390px in light and dark mode.
  Run screenshot critique before release. Compare against the existing card so
  added action does not cause horizontal overflow or cover primary navigation.
