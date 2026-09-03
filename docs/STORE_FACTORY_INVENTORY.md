# Store factory inventory and pilot

Companion to issue #727 ("Spec: reduce store/review bloat without hiding
policy"). This is the inventory the issue asks for, plus a report on the
one-store pilot migration onto the narrow factory it proposes.

## Deviation from the issue's evidence

The issue's evidence section estimates "roughly 25 store modules, only two
with the simplest conformant shape." That has aged. As of this pilot:

- There are 45 `lib/*Store.ts` modules, not ~25.
- 33 of them already call the shared `selectStore<T>(memory, supabase)`
  helper in `lib/storeBackend.ts` as their single backend-selection seam, not
  "only two." `selectStore` already IS the narrow, domain-free factory the
  issue proposes building; the gap it leaves is that each store still
  hand-writes the same one-line wrapper function around it.
- The globalThis-anchored memory-state pattern (module state kept on
  `globalThis` so it survives dev-server hot reload) is used by only 6 of the
  45 stores: `analyticsReceiptStore`, `planCollaborationStore`,
  `planGroupPrefsStore`, `planInviteRsvpStore`, `planStore`,
  `weatherRecommendationStore`. It is not "the" dual-backend pattern; it is
  orthogonal to backend selection. Four of those six
  (`planCollaborationStore`, `planGroupPrefsStore`, `planInviteRsvpStore`,
  `weatherRecommendationStore`) already route through `selectStore`, so
  globalThis-anchoring and factory-eligibility are independent axes.
- `communityPriceStore` was named in this task's brief as an example of the
  globalThis pattern. It is not: it keeps its memory state in a plain
  module-level `Map`, not `globalThis`, and already uses `selectStore` +
  `createFailSoftGuard`. It is excluded from this pilot for a different
  reason: it is the most policy-heavy store in the codebase (moderation,
  corroboration counting, round-source ownership, ~2,000 lines).
- This task migrates exactly ONE store onto the factory, not the issue's
  proposed two, per this task's own scope.
- The CI review-scope guard the issue lists as a fourth goal is out of scope
  for this task.

## Classification

Categories:

- **factory-ready** — single `selectStore` (or now `createDualBackendStore`)
  seam, one memory implementation, one Supabase implementation, no domain
  policy beyond CRUD and fail-soft reads. The factory's target shape.
- **factory-eligible, policy-heavy** — same single-seam shape, but the store
  carries real domain policy (moderation, trust scoring, authorization,
  multi-step write rules) beyond the backend choice itself. Adopting the
  one-line factory wrapper would be equally safe, but the store is a worse
  pilot pick: a defect there is expensive, and the factory change is not what
  most needs proving on a file that big.
- **legacy-exception** — the store does not use the shared seam at all; it
  checks `isSupabaseConfigured()` (or calls `requireSupabaseAdmin()`)
  inline, multiple times, scattered across its own operations. Needs its own
  refactor to a single seam before the factory helps it. Out of scope here.
- **not dual-backend** — the store does not follow the
  memory-or-Supabase-by-env shape at all (file-backed, static+live merge,
  Supabase-only). Out of scope for this factory by definition.

| Store | Lines | Category | Notes |
|---|---|---|---|
| walkRouteStore | 126 | factory-ready (migrated) | Pilot. TTL leg cache. |
| weatherSnapshotStore | 183 | factory-ready | Same shape as walkRouteStore; cron-written weather cache. |
| areaDemandStore | 172 | factory-ready | Same shape family (comment on walkRouteStore names it as a sibling). |
| checkInStore | 185 | factory-ready | |
| feedFreshnessStore | 131 | factory-ready | |
| followStore | 279 | factory-ready | |
| nightProfileStore | 159 | factory-ready | |
| notificationsStore | 390 | factory-ready | |
| pendingPlanRecapStore | 188 | factory-ready | |
| planCollaborationStore | 852 | factory-ready | globalThis-anchored memory state; still a single `selectStore` seam. |
| planGroupPrefsStore | 252 | factory-ready | globalThis-anchored memory state; single seam. |
| planInviteRsvpStore | 281 | factory-ready | globalThis-anchored memory state; single seam (2 selectStore call sites). |
| presenceStore | 272 | factory-ready | |
| privateIdentityStore | 293 | factory-ready | |
| pushTokenStore | 144 | factory-ready | |
| reactionsStore | 196 | factory-ready | |
| socialConnectionStore | 169 | factory-ready | |
| priceConfirmStore | 300 | factory-ready | |
| profileStore | 501 | factory-ready | |
| ratingsStore | 288 | factory-ready | |
| operatorProposalsStore | 251 | factory-ready | |
| commentsStore | 418 | factory-eligible, policy-heavy | Moderation/report flow. |
| communityPriceStore | 2065 | factory-eligible, policy-heavy | Moderation, corroboration, round-source ownership. See deviation note. |
| emailSubscribersStore | 341 | factory-eligible, policy-heavy | |
| identityHandleStore | 466 | factory-eligible, policy-heavy | |
| messagesStore | 483 | factory-eligible, policy-heavy | |
| referralStore | 619 | factory-eligible, policy-heavy | |
| roundsStore | 885 | factory-eligible, policy-heavy | |
| socialInteractionStore | 1285 | factory-eligible, policy-heavy | |
| socialPostStore | 928 | factory-eligible, policy-heavy | |
| venueOperatorsStore | 333 | factory-eligible, policy-heavy | |
| visitReportsStore | 596 | factory-eligible, policy-heavy | |
| weatherRecommendationStore | 469 | factory-eligible, policy-heavy | globalThis-anchored memory state; single seam. |
| analyticsReceiptStore | 87 | legacy-exception | globalThis-anchored memory state; inline `isSupabaseConfigured()`, not `selectStore`. |
| planStore | 954 | legacy-exception | globalThis-anchored memory state; 11 inline `isSupabaseConfigured()` call sites, not one seam. |
| crawlStoryStore | 644 | legacy-exception | 6 inline `isSupabaseConfigured()` call sites. |
| nightMemoryStore | 1202 | legacy-exception | 25 inline `isSupabaseConfigured()` call sites - the most scattered store in the codebase. |
| pubPalStore | 221 | legacy-exception | 8 inline `isSupabaseConfigured()` call sites. |
| contributorLeaderboardStore | 81 | legacy-exception | 1 inline `isSupabaseConfigured()` call; not on the shared seam. |
| pintDropsStore | 945 | legacy-exception | 1 inline `isSupabaseConfigured()` call, otherwise not on the shared seam. |
| importNotesStore | 206 | not dual-backend | JSON-file store under `.data/`, memory fallback only when the filesystem is unavailable. No Supabase path. |
| whatsOnStore | 294 | not dual-backend | Static bundle + injectable live-fetch merge. No Supabase path. |
| socialCrewStore | 591 | not dual-backend | Supabase-only (RPC calls); no memory backend. |
| socialPostConsentStore | 260 | not dual-backend | Supabase-only (RPC calls); no memory backend. |
| savedPubsStore | 680 | unclassified - needs its own look | The file reads as binary to `grep`/`file` in this worktree (pre-existing, unrelated to this task); its dual-backend shape could not be confirmed by the same method as the other 44 and needs a direct read outside this pilot's scope. |

That accounts for all 45 `lib/*Store.ts` modules.

## Exception list

Stores intentionally left off the factory, with reason:

- **legacy-exception** (`analyticsReceiptStore`, `planStore`, `crawlStoryStore`,
  `nightMemoryStore`, `pubPalStore`, `contributorLeaderboardStore`,
  `pintDropsStore`) - each checks Supabase configuration inline, more than
  once, instead of through one seam. The factory wraps `selectStore`; these
  stores do not call it yet, so there is nothing for the factory to wrap
  without a separate refactor of the store itself first. Owner: whoever picks
  up issue #727's next wave.
- **not dual-backend** (`importNotesStore`, `whatsOnStore`, `socialCrewStore`,
  `socialPostConsentStore`) - these do not choose between a memory and a
  Supabase implementation by environment; the factory's premise does not
  apply. Owner: n/a, out of scope by design.
- **savedPubsStore** - could not be inspected with the same tooling as the
  other 44 stores in this worktree (reads as a binary file to `grep`/`file`).
  Needs a direct read before anyone classifies it. Owner: whoever picks up
  issue #727's next wave.
- **factory-eligible, policy-heavy** stores (`commentsStore`,
  `communityPriceStore`, `emailSubscribersStore`, `identityHandleStore`,
  `messagesStore`, `referralStore`, `roundsStore`, `socialInteractionStore`,
  `socialPostStore`, `venueOperatorsStore`, `visitReportsStore`,
  `weatherRecommendationStore`) - technically as adoptable as the pilot
  store (same one-line seam), but not migrated in this pass because this
  task's scope is one pilot store, chosen for lowest risk. Adopting the
  factory here is a mechanical follow-up, not a design question.

## The factory

`lib/storeBackend.ts` already had `selectStore<T>(memory, supabase)` -
the narrow backend-selection seam the issue asks for. This task adds one
function on top of it:

```ts
export function createDualBackendStore<T>(memory: T, supabase: T): () => T {
  return () => selectStore(memory, supabase);
}
```

It curries `selectStore` into the zero-argument getter every dual-backend
store already hand-writes as its final few lines:

```ts
export function xStore(): XStore {
  return selectStore(memoryXStore, supabaseXStore);
}
```

becomes:

```ts
export const xStore = createDualBackendStore(memoryXStore, supabaseXStore);
```

Matching the issue's non-goals for the factory: it does not catch errors,
infer table names, generate queries, or decide authorization. It replaces
one boilerplate line per store and decides nothing `selectStore` did not
already decide.

## Pilot: walkRouteStore

Picked `lib/walkRouteStore.ts` for the pilot:

- It is a plain TTL cache for routed walk-leg geometry - the smallest
  factory-ready store (126 lines before the pilot change).
- Its seam was a direct, unmodified `selectStore(memoryWalkRouteStore,
  supabaseWalkRouteStore)` wrapper - the exact boilerplate the factory
  removes, with no extra policy in the way.
- Its existing test file, `__tests__/walkRouteStore.test.ts`, tests
  `memoryWalkRouteStore` and `supabaseWalkRouteStore` directly and never
  imports the `walkRouteStore()` selector itself, so the migration changes
  zero test surface - the tests stayed untouched and green, which is the
  proof of zero behavior change.
- It is called as a plain function at its two call sites
  (`app/api/walk-route/route.ts`, `lib/walkRouteLegs.ts`), so converting it
  from a `function` declaration to a `const` arrow-returning factory result
  changes nothing at either call site.

The change: `lib/walkRouteStore.ts` now exports
`export const walkRouteStore = createDualBackendStore(memoryWalkRouteStore, supabaseWalkRouteStore);`
instead of hand-writing the wrapper function. `lib/storeBackend.ts` gained
`createDualBackendStore`, with a new unit test in
`__tests__/storeBackend.test.ts` proving it curries `selectStore` correctly
under both configured and unconfigured Supabase env states.
