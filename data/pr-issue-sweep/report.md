# PR sweep report

Date: 2026-08-24
Reviewer: firstmate crewmate on `fm/pr-issue-sweep`
Base: `origin/main` at `155a6b6060dae23756245c1613f092d90401c5b3` (`feat(events): refresh What's-On feeds through Vercel cron (#1194)`)
Reviewed PRs: #1196, #1191, #1189, #1188.
Out of scope (inbox 001.msg): issues, plus PRs #1179, #1180, #1190.

Laws used: `fablenextsteps.md` (no invented prices or facts; two independent reports for price authority; Social gated behind `PUBMAX_SOCIAL_FRIENDS_LAUNCH`; north star is Planned Nights), `docs/VOICE.md`, `AGENTS.md`.

Machine: `NODE_OPTIONS=--max-old-space-size=2048`, Vitest `--maxWorkers=1`. Local rebase only. No push to PR branches. No merge.

| PR | Head | Author | Rebase onto main | Verdict |
|---|---|---|---|---|
| #1196 | `f44345f3` | app/blacksmith-sh | clean (already on main) | ESCALATE |
| #1191 | `67288386` | karanmrn | git-clean; logical 0119 collision | ESCALATE |
| #1189 | `3b76cf5e` | karanmrn | clean | ESCALATE |
| #1188 | `ce745630` | karanmrn | clean (8 commits) | MERGE |

---

## #1196 Blacksmith runners

**Verdict: ESCALATE - vendor and spend; AGENTS.md forbids Blacksmith (#747); YAML is runner labels only, but production secrets would execute on third-party VMs.**

### Diff

Seven workflows. Fifteen `runs-on: ubuntu-latest` lines become `runs-on: blacksmith-4vcpu-ubuntu-2404`. No new steps, no new actions, no permission widening, no secret echo, no extra checkout.

Files:

- `.github/workflows/ci.yml` (8 jobs)
- `.github/workflows/drink-price-refresh.yml`
- `.github/workflows/e2e.yml` (2 jobs)
- `.github/workflows/events-refresh.yml`
- `.github/workflows/rls-session.yml`
- `.github/workflows/weather-refresh.yml`
- `.github/workflows/weekly-digest.yml`

That is every workflow in `.github/workflows/` on main.

### Policy

`AGENTS.md` says PR CI runs on stock `ubuntu-latest` and "Do not repoint `runs-on` to Blacksmith (#747 rejected)." The header comment in `ci.yml` still says the captain rejected that migration. The job labels now contradict that comment.

Issue #1181 tracks GitHub Actions billing. This PR is a vendor change, not a code fix for that outage.

Karan review comment "Great" is not merge authority.

### Secret-exfiltration review

The YAML itself does not exfiltrate. Risk is runner trust: Blacksmith-hosted VMs receive `GITHUB_TOKEN` and every `secrets.*` those jobs already inject.

| Workflow | Secrets on the Blacksmith VM | When it runs |
|---|---|---|
| ci.yml | default `GITHUB_TOKEN` (`permissions: contents: read`) | every PR and push to main |
| e2e.yml | default `GITHUB_TOKEN` | PR law-pins; full suite on schedule or dispatch |
| rls-session.yml | default `GITHUB_TOKEN`; pulls PostgREST release over HTTPS | PR and push |
| drink-price-refresh.yml | `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` | scheduled / dispatch |
| events-refresh.yml | `GITHUB_TOKEN`, `TICKETMASTER_API_KEY`, `SKIDDLE_API_KEY` | scheduled / dispatch |
| weather-refresh.yml | `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` | scheduled / dispatch |
| weekly-digest.yml | `RESEND_API_KEY`, `EMAIL_FROM`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `workflow_dispatch` only (cron is commented) |

Highest trust cost: `SUPABASE_SERVICE_ROLE_KEY` on weekly-digest. A dispatch after merge hands the service role to Blacksmith. Ticketmaster and Skiddle keys follow events-refresh.

The Blacksmith GitHub App already opened this PR. Merge would also let that vendor intercept cache actions (stated in the PR body). The diff does not add Blacksmith cache actions by name.

### Residual CI risk

`rls-session.yml` needs a `postgres:16` service, `sudo apt-get install postgresql-16`, and a hashed PostgREST tarball. Stock GitHub `ubuntu-latest` is the proven host (#747). Blacksmith Ubuntu 24.04 is unproven here.

### What captain must decide

1. Keep #747. Close #1196. Stay on `ubuntu-latest`.
2. Reverse #747. Accept Blacksmith as the CI vendor, including secret and spend exposure. Then update `AGENTS.md` and the `ci.yml` header in the same commit.

Do not merge this PR as a silent CI unblock for #1181.

---

## #1191 Wanteds to public lists

**Verdict: ESCALATE - stacked on #1189; migration 0119 collides with landed Whats-On 0119; Wanted privacy law vs public lists; promote UI over-eligible.**

Head `67288386` on top of #1189 `3b76cf5e`. Local rebase onto current main is git-clean. That is the trap: two different files both named 0119 land together.

### What it does

Owner confirms an open, curated, resolved Wanted and copies it onto a built-in public saved list. Private notes and source URLs stay on the Wanted. `POST /api/wanted` gains `action: "promote"`. Durable columns `promoted_list_type` / `promoted_at`. Supabase path is `promote_wanted_to_saved_list` (security definer, `search_path = ''`, execute for `service_role` only). Inserts `saved_pubs.note` as null.

### Tests run

```shell
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run --maxWorkers=1 \
  __tests__/wanted.test.ts \
  __tests__/wantedPromotion.test.ts \
  __tests__/wantedStore.test.ts \
  __tests__/wantedRoute.test.ts
```

28 passed. `__tests__/unreadResponseBody.test.ts` still fails because this branch contains #1189 (`CreatorListsLane.tsx:221`).

### Severe: migration number

Main already has `supabase/migrations/20260824120000_0119_whats_on_listings.sql` plus rollback (from #1194).

This PR adds `supabase/migrations/20260824100000_0119_wanted_public_list_promotion.sql` and **no rollback**.

After rebase both files exist. Captain apply would run wanted 0119 at 10:00 then Whats-On 0119 at 12:00. The number 0119 would name two different contracts. Rename this migration to 0120 and ship `supabase/migrations/rollback/20260824100000_0120_wanted_public_list_promotion_rollback.sql` (or a later timestamp) before any merge.

### Important: promote UI over-eligible

`isWantedPromotable` (`lib/wanted.ts`) requires open + curated + venue id + not already promoted.

The route also requires `resolveVenue` + `isPubVenueKind`. A curated bar, food, or cafe Wanted shows `WantedPromotionControl` and then 409 `WANTED_NOT_PROMOTABLE`. Bugbot found this. Tests pin the weak predicate, so they stay green.

Put `isPubVenueKind` (or a venue-kind field on the Wanted DTO) into `isWantedPromotable` so the UI and the route agree.

### Important: memory path is not atomic

`promoteInMemory` records promotion, then `ensureSaved`. A failed save after `recordPromotion` leaves the Wanted marked promoted with no public row. The RPC path is one function. Keyless / in-memory only, but it is the path `npm run dev` uses.

### Product direction (law)

`AGENTS.md`: a Wanted is a private place you mean to try. Wave A is solo, owner-only reads, source URL never fetched.

This PR makes an explicit owner tap that publishes the venue id and list name. Notes and source URLs do not copy. That is careful. It is still a new public write from a private list. `fablenextsteps.md` north star is Planned Nights, not public Wanted promotion.

Captain authored the PR, so this may be an intended Wave B. Still escalate: do not merge as a silent law change, and do not merge on top of a colliding 0119 or a red unread-body fence.

### Hold until

1. #1189 unread-body (and retry) is fixed, or this branch is unstacked and does not carry `CreatorListsLane`.
2. Migration is 0120 (or later) with rollback.
3. `isWantedPromotable` matches the pub-kind gate.
4. Captain records that a Wanted may join a public list on an explicit tap.
5. `promoteInMemory` is atomic with `ensureSaved` (or rolls back `recordPromotion` on save failure). The keyless `npm run dev` path is blocking, not a follow-up.

---

## #1189 Creator place list discovery

**Verdict: ESCALATE - unread-body house fence is red; retry can pin unavailable; fail-soft list reads can look like an empty city.**

Head `3b76cf5e`. Rebase onto current main: clean.

### What it does

Account-free Creator lists lane on Social Discover (`/social?tab=discover`). `GET /api/creator-lists` is public, per-IP limited, `jsonNoStore`. Pages claimed profiles, groups public saved venues, strips notes from the wire DTO. Map handoff uses `encodeCrawl` over venue ids (no prices). Plan handoff uses `PLAN_QUERY_PARAM`. Follow uses existing `POST /api/saved-pubs/list-follows` with `authedActionFetch`, `resolveMessageHandle`, and `gateHandleAction`.

Discover tab already skips the Social access boundary. Creator lists ride that same public Discover surface. `PUBMAX_SOCIAL_FRIENDS_LAUNCH` still gates Posts. Notes never appear on `CreatorListDiscoveryItem`. Tombstoned profiles are filtered.

### Tests run

```shell
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run --maxWorkers=1 \
  __tests__/creatorListDiscovery.test.ts \
  __tests__/creatorListDiscoveryRoute.test.ts \
  __tests__/creatorListsLane.test.ts \
  __tests__/unreadResponseBody.test.ts \
  __tests__/savedListDetail.test.ts
```

Creator-list files: 13 passed. `__tests__/unreadResponseBody.test.ts`: 1 failed.

Offenders:

```text
components/social/CreatorListsLane.tsx:221
```

Shape:

```tsx
if (!response.ok) {
  setStatus("unavailable");
  return;
}
```

That is the exact hang the fence exists for (`lib/responseBody.ts` / AGENTS.md: a response you decide not to read is a request that never finishes). Merge would go red on this pin the moment CI can run unit tests.

### Important: retry race

Success path checks `controller.signal.aborted`. The `!response.ok` path and the non-abort catch do not. Try again can abort a request that already has headers. The old `load()` then writes `unavailable` over a later ready result. CodeRabbit logged this.

### Important: empty vs could-not-look

`savedPubsStore.listSaved` never throws. A failed owner read returns `[]`. `discoverCreatorLists` still answers `status: "ready"`. A store outage after profiles list can print "No creators have shared a list yet." The route's `isStoreAvailable` only checks configuration, not a live read. Same honesty rule as price surfaces: a failed read is not an empty market.

### Nits (do not hide the fence)

- Malformed `after` cursor is dropped, so the client restarts at page one. Crafted query only; `nextCursor` is a claimed handle.
- Unavailable "Try again" renders even when `onRetry` is absent. Default lane always passes `onRetry`.

### Required before MERGE

1. `discardBody(response)` on every non-ok exit in `CreatorListsLane` (and abort-guard every setter after the first await). Prove with `__tests__/unreadResponseBody.test.ts`.
2. Do not classify a failed `listSaved` as ready-empty. Degrade the lane or skip that owner with a named unavailable count.

I did not push the discardBody patch. Isolation limits push to `fm/pr-issue-sweep`. The patch is a few lines; apply it on `codex/creator-place-lists-v1` before any merge train.

---

## #1188 Codebase health pass

**Verdict: MERGE - dead-code and loader unification; local rebase clean; 18 focused tests passed; Cursor Bugbot approved.**

Head `ce745630`. Eight commits rebase onto current main with no conflict.

### What it does

- Removes unused exports: `listNightStories`, `updateNightStoryDraft`, `declineStoryContribution`, `mintPlanMemberToken`, `CATEGORY_COLORS_LEGACY`, `MESSAGE_PHOTO_REPORTED_LINE`, `PalSpecies` alias, unused `PROFILE_IMAGE_MAX_*` re-exports, orphan `components/discovery/tonightNearbyLane.css`.
- Extracts `fetchPublicJson` / `hasPublicJsonRows` to `lib/publicJsonLoader.ts` (uses `discardBody` on non-ok). Three loaders share it. Failed or invalid reads clear the module cache so the next call retries. Not an in-request retry. Tests cover that.
- Extracts `initials()` to `lib/authAvatarInitials.ts`.
- Moves referral inviter recovery from `app/api/referrals/claim-attribution/route.ts` into `ReferralStore.getInviterForInvitee` (memory + Supabase, same `referral_edges` query, same schema-miss fallback).

Dead-code check on current main: `mintPlanMemberToken` has one definition and no callers. Night-story wrappers are unused; the `*Result` functions remain on the routes. `PalSpecies` is only an alias of `PubPalSpecies`.

### Tests run (on PR head)

```shell
NODE_OPTIONS=--max-old-space-size=2048 npx vitest run --maxWorkers=1 \
  __tests__/publicJsonLoaderRetry.test.ts \
  __tests__/mobileWebPolish.test.ts \
  __tests__/emDashLaw.test.ts
```

18 passed. Follow-up `ab99fd1c` / `ce745630` already clear failed-read caches. CodeRabbit's cache finding is addressed.

### Notes for merge

GitHub checks are red in ~2s with no logs. That is #1181 on every PR, not a fault in this diff. Rebase on merge; I did not push the local rebase.

No product-surface change. No invented prices. No Social launch flag change.

---

## Issues

Out of scope (inbox 001.msg). Sibling scout owns 1181-1187 and the older 252-727 set.

---

## Verdicts (status file copies)

```text
pr-verdict: #1196 ESCALATE - Blacksmith vendor/spend; AGENTS.md forbids it (#747); YAML is labels-only but service-role and API keys would run on third-party VMs
pr-verdict: #1191 ESCALATE - 0119 collides with landed Whats-On 0119; Wanted privacy law; UI over-eligible vs isPubVenueKind; stacked on red #1189 fence
pr-verdict: #1189 ESCALATE - unreadResponseBody red at CreatorListsLane.tsx:221; retry can pin unavailable; fail-soft empty can read as no lists
pr-verdict: #1188 MERGE - health pass; rebase clean; 18 focused tests passed; failed-read retry already in
```

Do not merge anything from this report except #1188, and only after #1181 (or an equivalent) lets CI speak.
