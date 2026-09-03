# Mobile Venue tab touch-scroll plan

**Goal:** Make every Venue section reachable with a real finger at 390px without changing sheet drag behavior.

**Evidence:** Live and branch-current 390px audit shows `Ask` clipped and `Train` fully outside the visible strip in [the before proof](../../proof/mobile-audit-20260815/before-venue-tabs-clipped.png). The strip uses `overflow-x: auto` but declares `touch-action: pan-y`, so horizontal touch gestures cannot scroll it. Existing browser coverage calls `click()` on hidden tabs, which auto-scrolls them and does not reproduce touch input. [The after proof](../../proof/mobile-audit-20260815/after-venue-tabs-swiped.png) shows the final tab after the corrected touch gesture.

**Proof setup:** Both captures use Arnos Arms, Headless Chrome 151, a 390x844 CSS viewport, DPR 1, mobile and touch emulation, light mode, and reduced motion. Before is the live route with tab scroll 3px of 61px. After is the local branch at the 61px end position. Both strips measure 379px content inside a 318px viewport.

## Contract

- Venue tab strip permits horizontal and vertical touch panning.
- Pinch zoom remains available from the strip.
- Sheet drag remains owned by the separate grab zone.
- A 390px touch gesture moves the tab strip and reveals the final tab.
- The trailing fade is present while sections remain off-screen and absent at the end.
- Final tab stays at least 44px square, can be activated, and opens its panel.
- Page does not gain horizontal overflow.

## Steps

1. Extend `e2e/mobile-venue-sheet-tabs.spec.ts` with a real touch swipe from the visible strip, `scrollLeft` proof, final-tab viewport proof, fade-state proof, and touch activation proof. Run the new gesture proof first and confirm RED.
2. Change only the tab strip touch policy in `components/map/venueSheet.css`. Keep grab-zone gesture handling unchanged.
3. Run focused browser proof at 390px, focused unit coverage for the fade predicate, lint, typecheck, and full verification.
4. Review diff for touch conflicts, target size, overflow, generated-file churn, and unrelated changes. Commit only this slice and its selected proof images.
