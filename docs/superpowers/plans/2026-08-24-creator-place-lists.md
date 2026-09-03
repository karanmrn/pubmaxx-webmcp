# Creator Place Lists Implementation Plan

> **For agentic workers:** Use test-driven development for each behavior. Keep each pull request independently deployable.

**Goal:** Let a person find a creator, follow a public venue list, open all its venues on the Map, and start a plan without social-provider keys.

**Architecture:** Reuse claimed Profiles as creators, existing Follows for creator following, `saved_pubs` and `saved_lists` for public place lists, `saved_list_follows` for list following, and Wanted source URLs for user-submitted provenance. Do not add a creator identity table. Discovery reads only claimed public profiles and non-empty public lists.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, Supabase, Vitest, Playwright.

**Product evidence:** Lets Discover proves demand for creator maps and source-linked place saves. PUBMAXX must require deterministic Venue Dataset matching or explicit user confirmation before a source link becomes a public place.

## Product contract

- A Creator is a claimed PUBMAXX Profile with at least one non-empty public list.
- A Creator List contains Venue Dataset IDs only in v1. Restaurants and other places stay out until their place authority is defined.
- Source URLs are provenance only. PUBMAXX does not fetch Instagram, TikTok, Letterboxd, or X pages.
- Public list reads are account-free. Follow, save, promote, and plan actions require existing identity rules.
- List popularity does not alter pub rank.

### Task 1: Public creator-list discovery

**Files:**
- Create: `lib/creatorPlaceLists.server.ts`
- Create: `app/api/creator-lists/route.ts`
- Create: `__tests__/creatorPlaceLists.test.ts`
- Create: `__tests__/creatorListsRoute.test.ts`

**Interfaces:**
- Consumes: public claimed Profiles, saved list rows, list-follow counts, Venue Dataset resolution.
- Produces: `{ status, lists, nextCursor }`, where each list carries owner handle, title, venue count, preview venues, list URL, Map URL, and Plan URL.
- Follower count stays on list detail in v1. Add it to discovery only after a batched count read exists. Do not add one store read per card.

- [x] Write failing discovery and route tests that exclude empty lists, page by claimed owner, preserve neutral ordering, and never expose notes or private identity columns.
- [x] Confirm RED before implementation.
- [x] Implement one account-free, no-store read seam with deterministic handle cursor ordering. Do not rank by follower count in v1.
- [x] Run focused tests and ESLint.
- [ ] Run full typecheck on a machine with enough Node heap. Local 2 GB heap exhausted without diagnostics on the 8 GB development Mac.

### Task 2: Creator lists in Social discovery

**Files:**
- Create: `components/social/CreatorListsLane.tsx`
- Modify: `app/social/SocialPageClient.tsx`
- Modify: `app/social/social.css`
- Create: `__tests__/creatorListsLane.test.tsx`

**Interfaces:**
- Consumes: `GET /api/creator-lists`.
- Produces: account-free Creator Lists lane under `/social?tab=discover` with creator, list title, venue preview, Follow list, View on Map, and Plan actions.

- [x] Write failing rendered-behavior tests for ready, empty, and unavailable states, plus malformed-response refusal.
- [x] Implement lazy loading only when Discover tab is selected.
- [x] Track `creator_list_viewed` and `creator_list_map_opened` with no identifying properties.
- [x] Add direct Follow list and Plan night actions.
- [x] Track follow and Plan events without identifying properties.
- [ ] Verify at 390x844 and 1440x900 in both themes.

### Task 3: Multi-venue Map handoff

**Files:**
- Create: `lib/creatorListMap.ts`
- Modify: `components/profile/SavedListDetail.tsx`
- Modify: `app/u/[handle]/profile.css`
- Modify: `__tests__/savedListDetail.test.ts`
- Create: `__tests__/creatorListMap.test.ts`

**Interfaces:**
- Consumes: ordered list of Venue Dataset IDs.
- Produces: canonical `/map?mode=build&pubs=<ids>&sel=<first>` URL using current crawl URL contract.

- [x] Write failing tests for dedupe, stable order, safe URL encoding, one venue, and empty list.
- [x] Add one `View list on Map` action to public list detail. Empty lists get no dead action.
- [ ] Confirm Back restores list page and Map opens all supplied venue IDs.

### Task 4: Promote a resolved Wanted

**Files:**
- Modify: `app/api/wanted/route.ts`
- Modify: `components/wanted/WantedList.tsx`
- Create: `components/wanted/WantedPromotionControl.tsx`
- Modify: `lib/savedPubsStore.ts`
- Modify: `lib/wantedStore.ts`
- Create: `supabase/migrations/20260827110000_0121_wanted_public_list_promotion.sql`
- Create: `__tests__/wantedPromotion.test.ts`
- Modify: `__tests__/wantedRoute.test.ts`

**Interfaces:**
- Consumes: owner-resolved Wanted, selected list name, and atomic saved-pub ensure seam.
- Produces: one idempotent promotion that saves venue to public list and records promotion state without fetching source URL.

- [x] Write failing authorization, idempotency, pending-Wanted refusal, and source-preservation tests.
- [x] Implement explicit owner confirmation. Never auto-publish a pasted link.
- [x] Add `Add to a public list` only for resolved open curated pub Wanteds.
- [x] Verify retry and concurrent promotion do not duplicate list rows.
- [x] Record the selected list and promotion time on Wanted so reloads do not offer the write again.

### Task 5: Browser journey and release gate

- [ ] Signed-out: open creator list, open Map, inspect venues.
- [ ] Signed-in: follow creator, follow list, promote Wanted, start Plan.
- [ ] Test 320, 390, 430, 1280x720, and 1440x900.
- [ ] Confirm creator source links use `noopener noreferrer`, original attribution, and no embedded provider media.
- [ ] Deploy only after current release checklist is complete.
