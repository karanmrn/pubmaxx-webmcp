# Slice 7: weather and events context

## Contract

Crew Page shows current or stale sourced weather and ready, partial, or
unavailable sourced events. Provider failure never reads as honest empty. AI
creates neither card.

## Seam

`SocialCrewContextDTO` contains independent weather and event states.

```ts
type CrewWeather =
  | { status: "current" | "stale"; observation: NightAreaWeatherObservation }
  | { status: "unavailable" };
type CrewEvents =
  | { status: "ready" | "partial"; rows: StopEventChip[] }
  | { status: "unavailable"; rows: [] };
```

Reuse weather snapshot and `stopEventChips` owners. Use What's-On provider
logic, not analytics `/api/events`.

## RED cases

- `now < expiresAt` is current. Equality is stale.
- Missing or invalid snapshot is unavailable.
- Successful zero events is ready and honest empty.
- One provider failure with surviving rows is partial.
- Total dependency failure is unavailable and route returns `503`.
- Cards keep publisher, source URL, observation, and publication time.

## Playable checkpoint

Switch deterministic fixtures among current, stale, ready-empty, partial, and
unavailable without changing Crew authority.

## Verification

Run source, freshness, route, and copy tests. No location or AI authorship may
enter context DTOs.
