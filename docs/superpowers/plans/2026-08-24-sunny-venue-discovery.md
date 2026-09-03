# Sunny Venue Discovery Implementation Plan

> **For agentic workers:** Use test-driven development. Never turn weather into a terrace-sun claim.

**Goal:** Help a user find a good outdoor pint now while preserving a clear authority boundary between weather, community evidence, and physical shade modelling.

**Architecture:** Phase 1 extends current keyless Open-Meteo Night Area weather with solar and cloud fields. It produces `forecast_favourable`, not direct-sun truth. Direct terrace sunlight is a later model with separate evidence and validation.

## Public interface

```ts
type SunAuthority = "forecast" | "modelled" | "observed" | "unknown";

type KnownVenueSunState = {
  authority: Exclude<SunAuthority, "unknown">;
  state: "favourable" | "unfavourable";
  observedAt: string;
  validUntil: string;
  explanationCode?: "daylight_clear" | "cloudy" | "rain" | "night" | "wind";
};

type UnknownVenueSunState = {
  authority: "unknown";
  state: "unknown";
  observedAt?: string;
  validUntil?: string;
  explanationCode?: "no_data";
};

type VenueSunState = KnownVenueSunState | UnknownVenueSunState;
```

A known state without both timestamps is invalid. Unknown authority may never carry `favourable` or `unfavourable`. Stale or missing authority inputs produce `unknown`.

## Task 1: Honest Night Area `Sun now`

**Files:**
- Modify: `lib/weatherProvider.ts`
- Modify: `lib/weatherSnapshotStore.ts`
- Modify: `lib/weatherFreshness.server.ts`
- Modify: `app/api/cron/refresh-weather/route.ts`
- Create: `lib/sunForecast.ts`
- Create: `__tests__/sunForecast.test.ts`
- Modify: weather provider and migration tests.

- [ ] Write failing literal-fixture tests for daylight and low cloud, night, rain, high wind, stale input, and missing fields.
- [ ] Request sunrise, sunset, cloud cover, precipitation, and shortwave radiation from Open-Meteo.
- [ ] Return unknown when any authority-bearing input is stale or absent.
- [ ] Add a fixture that forces the existing stale-cache fallback in `lib/weatherFreshness.server.ts` and proves the result is `unknown`, not a stale favourable forecast.

## Task 2: Map and Now lens

**Files:**
- Create: `components/discovery/SunNowCard.tsx`
- Modify: `components/map/ControlRail.tsx`
- Modify: Map filter state and URL decoder.
- Create: `__tests__/sunNowCard.test.tsx`
- Modify: Map URL and filter tests.

- [ ] Show area-level forecast only. Label it `Sun forecast favourable`.
- [ ] Combine with existing beer-garden evidence to recommend outdoor candidates, but do not say sunlight reaches a terrace.
- [ ] Add source time and Open-Meteo attribution.

## Task 3: Direct-sun research gate

- [ ] Define terrace or outdoor-seating geometry and orientation authority.
- [ ] Evaluate building footprint, height, terrain, and tree coverage.
- [ ] Validate shadow predictions against at least 100 timestamped London observations across seasons.
- [ ] Define precision and coverage metrics and numeric thresholds. Permit `modelled` only after measured results pass those thresholds. Keep `unknown` until they do. Documented targets alone are not enough.
- [ ] Restrict `modelled` to London until every other supported geography and relevant terrain class has the same measured validation.
- [ ] Evaluate Google Solar API only after billing, coverage, attribution, caching, and licence review.
