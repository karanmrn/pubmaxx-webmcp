# Desktop drawer history handoff

Status: next-lane input, intentionally not fixed in `nomistakes-land-two-fixes`.

## Ownership conflict

Desktop drawer mutual exclusion is synchronous in `claimMapDrawer`, called by
`openPlanning` and `selectVenue` in `components/PubMap.tsx`: opening the planner
clears venue selection, while opening a venue closes the planner. Loaded-route
activation calls those same direct owners through `showLoadedRoute`; it has no
pending selection or reconcile-after-transition effect. Browser history remains
split between two independent owners.

- `useMapSelectionHistory` owns the venue selection sentinel. Its `back`
  transition calls `window.history.back()`, then its `popstate` listener
  reconciles the result.
- `useSurfaceStack` separately calls `window.history.back()` for surface Back.
  Its own `popstate` listener derives trail depth from the entry that wins the
  traversal.
- `useMapSurfaceTrail` follows the visible surface and deliberately opens a
  venue without pushing a second history entry.

These owners can each issue or interpret a traversal without knowing whether the other owner has a pending move. Local pop holds and settlement callbacks cannot make two independently queued history deltas atomic.

## Review findings

### `early-back-overtakes-history-release`

Review location: the removed asynchronous selection-history coordination.

> Criterion "press Back at earliest possible moment before completion ... correct surface still wins" remains broken when Map has a real predecessor. `releaseSelection` queues one Back and the user queues another; each is an independent history delta, while `holdThroughNextHistoryPop` absorbs only the first pop. The second can leave Map or pop the newly written planner entry. Current regression never establishes a predecessor, so this path can pass accidentally. Serialize user Back at the selection-history owner and cover a prior-page arrival. See [HTML history traversal](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-back).

### `settled-planner-back-loses-venue`

Review location: the removed reconcile-after-transition drawer coordination.

> Criterion "Back always resolves against settled state" also fails after a root venue-to-planner handoff settles. The venue sentinel is popped while the removed reconciliation preserves `[venue]` in the surface stack; planner then pushes depth 2 over a clean depth-0 entry. Planner's rendered Back restores venue state and starts another asynchronous Back, but selection history pushes a venue sentinel before that pop and then dismisses venue when the pop lands on a non-sentinel entry. Reconcile retained parent depth at the shared selection/surface-history boundary, or deliberately make planner root and remove the impossible Back affordance.

## Why current regressions do not cover this

The removed early-Back regression navigated directly to `/map`, so it did not establish a real predecessor before queuing two Back operations. It could pass even when the second traversal would leave the Map in a real journey.

The retained `1440px planner hands ownership to venue and Back restores composed
state` regression proves ordinary planner-to-venue ownership and composed-state
restoration. It does not start from a root venue, queue selection-history
release, or issue concurrent browser Back.

The retained `1440px Plan tonight takes ownership from an open venue` regression
proves only synchronous venue-to-planner ownership: one drawer owns the first
React commit after Plan tonight. It does not wait for or coordinate any
browser-history traversal.

The `1440px loaded route opens its first venue without a deferred planner
handoff` regression proves only that loading a route reaches the venue as one
synchronous ownership batch, without a transient planner-open mutation. The
previous loaded-route Back-restoration assertion was removed because it
depended on the deferred planner-to-venue trail negotiation that this branch
deliberately descoped. The replacement never presses Back, never establishes a
predecessor, and cannot detect either concurrent history race quoted above.

## Requirements for a correct next-lane design

- One boundary must own both venue selection sentinels and surface depth entries.
- Drawer transitions, Back, Forward, Home, and URL selection changes must enter one serialized transition model.
- A pending traversal must block or incorporate another Back without fixed delays, animation timings, `setTimeout`, or one-pop guesses.
- Visible surface, selected venue, surface trail, URL, and stamped history depth must agree before a transition reports settlement.
- Restored planner entries must retain exact loaded-route and half-composed input state.
- Tests must start from a real predecessor, exercise immediate concurrent Back, cover settled planner Back, and assert semantic state rather than elapsed time.
- Existing phone behavior, direct synchronous desktop mutual exclusion, and Home behavior must remain unchanged.

This branch intentionally ships only direct synchronous drawer ownership. Loaded-route planner restoration and concurrent Back coordination are deferred to the single-owner history design described here.
