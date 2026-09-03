# Store backend inventory

Companion to issue #727, "Spec: reduce store/review bloat without hiding
policy". This file is the review artefact for every `lib/*Store.ts` module.
The inventory is descriptive, not a runtime registry.

## Current snapshot

- The repository has 52 `lib/*Store.ts` modules.
- 32 modules call `selectStore` directly.
- 7 modules use `createDualBackendStore`.
- 6 modules keep memory state on `globalThis` so it survives a development
  server reload. That state pattern is separate from backend selection.
- The remaining modules use an explicit backend, a file or static data path,
  or an inline legacy selector.

`lib/storeBackend.ts` owns the narrow backend seam. `createDualBackendStore`
only curries `selectStore(memory, supabase)` into a zero-argument getter. It
does not catch errors, infer table names, create queries, or decide
authorization. Fail-soft guards, schema-miss warnings, identity rules,
moderation, and cache policy stay in each store.

## Classification

- **factory-ready** - memory and Supabase implementations use one shared
  selector. The store may still have domain validation, but backend selection
  is a single seam.
- **factory-eligible, policy-heavy** - one shared selector exists, but the
  store owns moderation, trust, identity, media, authorization, or multi-step
  write policy. Keep that policy visible before a factory migration.
- **legacy-exception** - backend checks remain inline or are spread across
  operations. Refactor the selector first.
- **not dual-backend** - the store is file-backed, static plus live, or
  Supabase-only. The memory-or-Supabase factory does not apply.

## Canonical inventory

Every row below maps to one current `lib/*Store.ts` file. The test
`__tests__/storeBackendInventory.test.ts` compares these names with the
directory, so a new store or a removed store cannot leave this document
silently stale.

| Store | Classification | Notes |
|---|---|---|
| adultSelfAssertionStore | factory-ready | Account assertion read and record; adult policy lives in `socialLaunch`. |
| analyticsReceiptStore | legacy-exception | Inline Supabase configuration checks; needs one selector seam. |
| areaDemandStore | factory-ready | Demand signal with shared backend selection. |
| checkInStore | factory-ready | Check-in rows with shared backend selection. |
| commentsStore | factory-eligible, policy-heavy | Comment moderation and report flow. |
| communityPriceStore | factory-eligible, policy-heavy | Moderation, corroboration, venue signals, and Round source ownership. |
| contributorLeaderboardStore | legacy-exception | Inline Supabase configuration check; durable aggregate read. |
| crawlStoryStore | legacy-exception | Multiple inline Supabase configuration checks. |
| feedFreshnessStore | factory-ready | Pilot store; durable or memory freshness stamp. |
| followStore | factory-ready | Directed follow graph with shared backend selection. |
| harvestOverlayStore | factory-ready | Fold-written UK harvest overlays; one shared selector, with a `requireDurable` guard for the non-dry fold CLI. |
| identityHandleStore | factory-eligible, policy-heavy | Handle ownership, rename, reservation, and tombstone policy. |
| importNotesStore | not dual-backend | JSON-file store with memory fallback when the filesystem is unavailable. |
| messagesStore | factory-eligible, policy-heavy | Conversation identity, membership, and message policy. |
| nightMemoryStore | legacy-exception | Multiple inline Supabase configuration checks around private memory policy. |
| nightProfileStore | factory-ready | Night Profile preference rows with shared backend selection. |
| notificationsStore | factory-ready | Notification rows with shared backend selection. |
| occupancyStore | factory-eligible, policy-heavy | Time window, retake, reporting, and moderation policy. |
| operatorProposalsStore | factory-ready | Operator proposal state has one backend selector. |
| pendingPlanRecapStore | factory-ready | Small pending-plan recap store. |
| pintDropsStore | legacy-exception | Inline Supabase configuration branch around Pint Drop and Storage work. |
| planCollaborationStore | factory-ready | Shared selector with `globalThis` memory state. |
| planGroupPrefsStore | factory-ready | Shared selector with `globalThis` memory state. |
| planInviteRsvpStore | factory-ready | Shared selector with `globalThis` memory state. |
| planStore | legacy-exception | Multiple inline Supabase configuration checks and plan policy. |
| presenceStore | factory-ready | Presence rows with shared backend selection. |
| priceConfirmStore | factory-ready | Price confirmation rows with shared backend selection. |
| priceTrustEventStore | factory-eligible, policy-heavy | Append-only trust events, reversals, and account credits. |
| privateIdentityStore | factory-ready | Private account identity rows with owner policy at its boundary. |
| profileCoverPhotoStore | factory-eligible, policy-heavy | Cover rotation, media generations, and moderation policy. |
| profileStore | factory-ready | Public profile projection and account-owned profile rows. |
| pubPalStore | legacy-exception | Multiple inline Supabase configuration checks around private Pub Pal state. |
| pushTokenStore | factory-ready | Device push registration rows. |
| ratingsStore | factory-ready | Drink and venue rating rows with shared backend selection; public reads expose summaries, not venue leaderboards. |
| reactionsStore | factory-ready | Pint Drop reactions with shared backend selection. |
| referralStore | factory-eligible, policy-heavy | Referral identity, milestone, and proof-expiry policy. |
| roundsStore | factory-eligible, policy-heavy | Round membership, spend-line provenance, and promotion policy. |
| savedPubsStore | legacy-exception | Inline Supabase configuration branch plus profile bootstrap; needs its own selector refactor. |
| socialConnectionStore | factory-ready | Connected provider rows with one backend selector. |
| socialCrewStore | not dual-backend | Supabase-only RPC store. |
| socialInteractionStore | factory-eligible, policy-heavy | Social relationship, block, and interaction policy. |
| socialPostConsentStore | not dual-backend | Supabase-only RPC store. |
| socialPostStore | factory-eligible, policy-heavy | Moderation, visibility, consent, and relationship policy. |
| stepOutNudgeStore | factory-ready | Nudge preference and send-stamp rows with shared backend selection. |
| venueOperatorsStore | factory-eligible, policy-heavy | Venue claim ownership and operator moderation policy. |
| venuePhotoStore | factory-eligible, policy-heavy | Photo cap, author projection, reports, and moderation policy. |
| visitReportsStore | factory-eligible, policy-heavy | Dated Visit Reports, flags, and moderator lanes. |
| walkRouteStore | factory-ready | Routed-leg cache; TTL calculation stays in the store. |
| wantedStore | factory-ready | Owner-scoped Wanted rows with shared backend selection. |
| weatherRecommendationStore | factory-eligible, policy-heavy | Authored Recommendation policy with `globalThis` memory state. |
| weatherSnapshotStore | factory-ready | Cron weather snapshot cache. |
| whatsOnListingStore | factory-ready | Cron What's-On listing rows and per-kind generation watermarks. |
| whatsOnStore | not dual-backend | Static bundle plus injectable live-fetch merge. |

## Exception list

The following stores intentionally stay outside the factory-ready path:

- **legacy-exception:** `analyticsReceiptStore`, `contributorLeaderboardStore`,
  `crawlStoryStore`, `nightMemoryStore`, `pintDropsStore`, `planStore`,
  `pubPalStore`, and `savedPubsStore`. Each needs a separate selector
  refactor before a factory wrapper can preserve its behavior. Owner: the
  next issue #727 store wave.
- **not dual-backend:** `importNotesStore`, `socialCrewStore`,
  `socialPostConsentStore`, and `whatsOnStore`. Their storage premise is not
  memory-or-Supabase. Owner: not applicable for this factory.
- **policy-heavy:** `commentsStore`, `communityPriceStore`,
  `identityHandleStore`, `messagesStore`, `occupancyStore`,
  `priceTrustEventStore`, `profileCoverPhotoStore`, `referralStore`,
  `roundsStore`, `socialInteractionStore`, `socialPostStore`,
  `venueOperatorsStore`, `venuePhotoStore`, `visitReportsStore`, and
  `weatherRecommendationStore`. Their explicit policy is the reason to defer
  migration, not a claim that the selector is impossible to simplify later.

## Inline backend references

Every production file with an inline `selectStore` or `isSupabaseConfigured` branch is listed here. This includes non-store modules such as `lib/messageAuth.ts`. The test compares this list with repository search results.

<!-- inline-backend-references:start -->
```json
{
  "inlineBackendReferences": [
    "app/add/[handle]/page.tsx",
    "app/api/ask/route.ts",
    "app/api/auth/handle-password/route.ts",
    "app/api/check-ins/route.ts",
    "app/api/concierge/route.ts",
    "app/api/cron/cheap-pint-ping/route.ts",
    "app/api/cron/step-out-nudge/route.ts",
    "app/api/founding-members/route.ts",
    "app/api/identity/handle/claim/route.ts",
    "app/api/identity/handle/rename/route.ts",
    "app/api/me/night-profile/route.ts",
    "app/api/me/pending-plan-recaps/route.ts",
    "app/api/pint-drops/route.ts",
    "app/api/profiles/[handle]/follow/route.ts",
    "app/api/profiles/[handle]/route.ts",
    "app/api/profiles/directory/route.ts",
    "app/api/profiles/search/route.ts",
    "app/api/pub-pal/llm/route.ts",
    "app/api/pub-pal/voice-token/route.ts",
    "app/api/saved-pubs/list-follows/route.ts",
    "app/api/starter-packs/[slug]/follow/route.ts",
    "app/api/starter-packs/route.ts",
    "app/bar-tab/[id]/opengraph-image.tsx",
    "app/bar-tab/[id]/page.tsx",
    "app/ledger/[id]/page.tsx",
    "lib/analyticsReceiptStore.ts",
    "lib/areaDemandStore.ts",
    "lib/checkInStore.ts",
    "lib/commentsStore.ts",
    "lib/communityPriceStore.ts",
    "lib/contributorLeaderboardStore.ts",
    "lib/crawlStoryStore.ts",
    "lib/creatorListDiscoveryRoute.server.ts",
    "lib/crewFriendEdges.ts",
    "lib/emailProvider.ts",
    "lib/followStore.ts",
    "lib/followWrite.server.ts",
    "lib/freshnessStoreOverlay.ts",
    "lib/handlePasswordSignIn.ts",
    "lib/harvestOverlayStore.ts",
    "lib/heritage.ts",
    "lib/identityHandleStore.ts",
    "lib/mapSearchEvents.server.ts",
    "lib/messageAuth.ts",
    "lib/messagePhotoMedia.server.ts",
    "lib/messagesStore.ts",
    "lib/nightMemoryStore.ts",
    "lib/nightMomentMedia.ts",
    "lib/nightProfileStore.ts",
    "lib/notificationsStore.ts",
    "lib/operatorProposalsStore.ts",
    "lib/pendingPlanRecapStore.ts",
    "lib/pintDropLookup.ts",
    "lib/pintDrops.ts",
    "lib/pintDropsStore.ts",
    "lib/planCollaborationStore.ts",
    "lib/planCrewIdentity.ts",
    "lib/planGroupPrefsStore.ts",
    "lib/planInviteRsvpStore.ts",
    "lib/planStore.ts",
    "lib/presenceStore.ts",
    "lib/priceConfirmStore.ts",
    "lib/privateIdentityStore.ts",
    "lib/profileCoverPhotoRoute.server.ts",
    "lib/profileCoverPhotoStore.ts",
    "lib/profileImageMedia.server.ts",
    "lib/profileImageRoute.server.ts",
    "lib/profileImageServe.server.ts",
    "lib/profileStore.ts",
    "lib/pubPalStore.ts",
    "lib/pushTokenStore.ts",
    "lib/ratingsStore.ts",
    "lib/reactionsStore.ts",
    "lib/referralStore.ts",
    "lib/roundPriceBudget.ts",
    "lib/roundsStore.ts",
    "lib/savedPubsStore.ts",
    "lib/serverEnv.ts",
    "lib/socialConnectionStore.ts",
    "lib/socialInteractionStore.ts",
    "lib/socialOAuth.ts",
    "lib/socialPostCreateRequest.server.ts",
    "lib/socialPostMedia.server.ts",
    "lib/socialPostStore.ts",
    "lib/stepOutNudgeSelect.server.ts",
    "lib/storeBackend.ts",
    "lib/supabase.ts",
    "lib/trustedSigningKey.server.ts",
    "lib/uploadedImage.server.ts",
    "lib/venueOperatorsStore.ts",
    "lib/venuePhotoMedia.server.ts",
    "lib/venuePhotoServe.server.ts",
    "lib/venuePhotoStore.ts",
    "lib/visitReportsStore.ts",
    "lib/wantedPromotion.server.ts",
    "lib/weatherRecommendationStore.ts",
    "lib/weatherSnapshotStore.ts",
    "lib/whatsOnListingStore.ts",
    "scripts/push/sendDailyBrief.mjs",
    "scripts/push/sendStepOutNudge.mjs"
  ]
}
```
<!-- inline-backend-references:end -->

## Existing pilot

`feedFreshnessStore` was the first low-risk pilot. Its callers use the same
zero-argument selector before and after the factory wrapper, and its memory
and Supabase implementations keep their existing fail-soft behavior.

The current branch also has `createDualBackendStore` in
`adultSelfAssertionStore`, `feedFreshnessStore`, `occupancyStore`,
`priceTrustEventStore`, `stepOutNudgeStore`, `walkRouteStore`, and
`wantedStore`. This inventory records that current state; it does not require
other stores to migrate.

## Review-scope guard

`scripts/check_review_scope.mjs` reports changed source, migration, generated,
evidence, test, configuration, documentation, skill-pack, and other paths.
It warns when a review crosses more than two runtime domains or more
than 150 files. It fails only when generated or skill-pack paths are present.
Migration files remain in their own category and do not add a runtime domain.
CI passes the pull request base and head SHAs to the script, so the report
matches the reviewed diff rather than the checkout's default range.
