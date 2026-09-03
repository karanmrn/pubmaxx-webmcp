# Desktop rail and banner layout plan

> Historical planning record. Current contracts live in source and regression
> coverage; this file does not duplicate dimensions, scenarios, or validation
> counts.

Planner rail width and drawer geometry are owned by
[`app/globals.css`](../../../app/globals.css). Toolbar lane bounds live in
[`components/map/mapToolbar.css`](../../../components/map/mapToolbar.css), while
[`MapToolbar.tsx`](../../../components/map/MapToolbar.tsx) follows the rendered
drawer width during spring transitions. Concurrent ambient-banner placement is
owned by
[`components/map/mapBannerStaging.css`](../../../components/map/mapBannerStaging.css).

[`PubMap.tsx`](../../../components/PubMap.tsx) owns synchronous selection between
planner and venue drawers. Surface history does not arbitrate that decision.
Rendered desktop coverage lives in
[`e2e/desktop-map-chrome-fit.spec.ts`](../../../e2e/desktop-map-chrome-fit.spec.ts).
The intentionally separate concurrent-Back problem and its single-history-owner
requirement remain in the
[`history-race handoff`](../../../data/nomistakes-land-two-fixes/history-race-handoff.md).
