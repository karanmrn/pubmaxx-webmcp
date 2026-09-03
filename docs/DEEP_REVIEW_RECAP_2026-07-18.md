# Deep Review — Recap Set (PR #333 / #334 / #335)

**Date:** 2026-07-18 · **Reviewer branch:** `review/deep-recap` (from `origin/main` @ `621d9103`)
**Scope:** adversarial privacy + correctness review of the product's first user-generated PUBLIC page.

- **#334** `feat/night-arc-seams` — the recap is never stranded (re-entry seed + honest "coming" state).
- **#335** `feat/recap-page` — private crew recap page + approval-gated public recap page + store accessor.
- **#333** `feat/recap-card` — the OG image card for the public recap (RICH / FALLBACK privacy gate).

**Method (mechanically honest):** all three branches fetched; the three were merged onto `origin/main`
in a scratch tree (#334 → #335 → #333), the one real conflict resolved by hand, and the composed tree
was typechecked (`tsc --noEmit`, **0 errors**) and unit-tested (`recapView` + `recapCard` + `activePlan`
suites, **61/61 pass**). Consumer grep run across the merged tree. The reviewer branch itself is
main + this doc only; the merge was verification, not a deliverable.

---

## Verdict

| PR | Verdict | Blocking? |
|----|---------|-----------|
| **#333** recap-card | **APPROVE** | No |
| **#334** night-arc-seams | **APPROVE** | No |
| **#335** recap-page | **APPROVE with 1 tracked fix (R2, signed-URL TTL)** | No — but land the TTL fix before real public traffic |
| **Composition** | **APPROVE — with one MANDATORY merge step** | The "zero file overlap" claim is **FALSE**: #334×#335 conflict in `NightModeCard.tsx` (see R1). Resolvable, resolution given below. |

The core privacy architecture is **sound**. Publication is double-consent-gated (propose + confirm both
re-check `hasPublicationConsent`), the public read path funnels through a single choke point
(`getPublishedRecapSource`), no auth/memory identifiers appear in any public DTO, and the guardian line
is derived — not fabricated. The findings below are hardening and one merge-mechanics correction, not
architectural breaks.

---

## Findings (severity-ranked, file:line)

### R1 — HIGH (merge mechanics): #334 and #335 both edit `NightModeCard.tsx` — guaranteed conflict. "Zero file overlap" is false.
`components/night/NightModeCard.tsx` — overlapping hunk in `NightModeSheet`, the `{recap ? …}` block.

- **#334** (`origin/feat/night-arc-seams`, +49) restructures that block: `nightCard__recapActions` div →
  `nightCard__recapInvite` wrapper (adds a lede `<p>` + nested actions), and adds the `recapSeeding` "Pulling
  your private recap together…" branch.
- **#335** (`origin/feat/recap-page`, +4) inserts a `<Link href={/plan/${id}/recap}>See the full recap</Link>`
  **inside that same actions div**, anchored on the exact `resolvePendingPlanRecap(recap, "discarded")` line #334 also moves.

`git merge` (proven: #334 then #335) produces `CONFLICT (content) in components/night/NightModeCard.tsx`.
Both `Link` and `BookOpen` are already imported on `main`, so **no import work** is needed — the conflict is
purely structural. **Resolution (verified: typechecks + tests green):** keep #334's `recapInvite` wrapper, drop
#335's `<Link>` inside the nested `nightCard__recapActions` div (after the Discard button):

```tsx
{recap ? (
  <div className="nightCard__recapInvite">
    <p className="nightCard__recapLede">That&rsquo;s the night. Keep it as a private Memory — the route and any words you add, nothing posted.</p>
    <div className="nightCard__recapActions">
      <button type="button" className="nightCard__endingLink" onClick={() => setRecapOpen((open) => !open)} aria-expanded={recapOpen}>
        <BookOpen size={16} aria-hidden="true" /> {recapOpen ? "Hide recap" : "Review private recap"}
      </button>
      <button type="button" className="nightCard__quietButton" onClick={() => { resolvePendingPlanRecap(recap, "discarded"); setRecap(null); setRecapOpen(false); }}>
        <Trash2 size={15} aria-hidden="true" /> Discard local recap
      </button>
      {/* #335 */}
      <Link className="nightCard__endingLink" href={`/plan/${id}/recap`}>
        <BookOpen size={16} aria-hidden="true" /> See the full recap
      </Link>
    </div>
  </div>
) : recapSeeding ? (
  <p className="nightCard__endingStatus" role="status">Pulling your private recap together…</p>
) : null}
```

**Action:** #335 MUST land after #334, taking this hand-merge. This is the only textual conflict in the set.

### R2 — MEDIUM (privacy, leak window): approved-photo signed URL outlives consent withdrawal by up to 1 hour.
`lib/nightMomentMedia.ts:31` — `createSignedUrl(key, 60 * 60)` (3600 s).
`app/recap/[storyId]/page.tsx:96-101` embeds that signed URL server-side per request.

The public page is dynamically rendered (no `revalidate`/CDN cache), so a **new** visitor after a crew member
withdraws consent sees nothing — `getPublishedRecapSource` drops the moment from `publishedMomentIds` on the
next read (verified: `setMomentPublicationConsent` → `publishedMomentIds.filter(...)` in-memory, and
`night_story_moments` row delete on Supabase; `getStoryRaw` re-derives the allowlist from that link table).
**But** any signed URL already delivered to a viewer's browser stays fetchable for the full hour regardless of
withdrawal — Supabase Storage signed URLs cannot be revoked before expiry. So the post-withdrawal leak window
for an already-loaded photo is **up to 3600 s**, longer than any cache TTL in the set.
**Recommendation:** for the public recap surface specifically, sign with a short TTL (e.g. 120–300 s) — the page
re-renders and re-signs per request anyway, so short TTLs cost nothing and shrink the window ~12–30×. Track before
real public traffic; not a launch blocker for a link-shared beta.

### R3 — LOW (privacy, staleness): RICH OG card can serve a revoked recap's title+date for up to ~11 min.
`lib/recapCard.ts:186-189` — `rich: "public, s-maxage=60, stale-while-revalidate=600"`.

After a host unpublishes / flips to private, the OG route flips to FALLBACK on revalidation, but a CDN may serve
the stale RICH card for up to 60 s fresh + 600 s stale-while-revalidate (~11 min). The leaked payload is only the
**night title + date** (stats are a stub → null; crew is empty; no photos ever on the OG). **The TTL split is
correctly oriented** — the privacy-sensitive RICH variant gets the *short* TTL and the generic FALLBACK gets the
long one, so there is no cache-poisoning path that promotes hidden data. Accept as-is; documented tradeoff.

### R4 — LOW (consistency, not a new leak): the "private" `/plan/[id]/recap` page has no actor/auth check.
`app/plan/[id]/recap/page.tsx:97-101` — renders route/pints/notes/ending/guardian from `planStore().get(id)` +
`planCompletionResult(id)` for anyone who knows the plan id. **This matches the existing `/plan/[id]` page on
`main`** (also `planStore().get(id)` with no actor gate — plan surfaces are a URL-as-capability model; write
actions are memberToken-gated). Plan ids are v4 UUIDs (`isPlanId`, `lib/plan.ts:149`), so not enumerable. So the
recap page inherits the *same* exposure class as the plan page it hangs off — no new leak, but worth stating
explicitly: the "private recap" is private only in the shared-link sense, exactly like the plan itself.

### R5 — INFO (dedupe debt, self-declared): local copies of #314's share helpers.
`components/plan/RecapShareButton.tsx:44` (`whatsappHref`) and `lib/recapView.ts:buildRecapShareText` both
carry local copies of helpers that #314 (`feat/whatsapp-share-artifacts`) owns in `lib/shareArtifacts.ts`. Both
are annotated REBASE-BY-INTENT by the authors. **No textual conflict** (recap set touches none of #314's files),
just a fold-together follow-up whenever #314 and the recap set are both merged. No action for this review.

---

## Privacy attack-surface results (the core job)

**(a) Can an unpublished/private story leak any night detail?** — **No.**
- **Page path** (`app/recap/[storyId]/page.tsx`): `getPublishedRecapSource` returns `null` unless
  `status === "published" && visibility !== "private"`; the page calls `notFound()` on null. Moments are further
  filtered to the `publishedMomentIds` allowlist. `composeRecapFromPublishedStory` re-asserts the same gate and
  returns null otherwise. Three independent gates, all fail-closed.
- **OG path** (`app/recap/[storyId]/opengraph-image.tsx`): uses `getNightStory(storyId, null)`; with a null actor
  this returns a `PublicNightStory` **only** for published+non-private, else null → `selectRecapCardData` →
  FALLBACK (brand-generic, no title/venue/date/stat/person). Crawlers always get an image, never a 404, never
  leaked detail. `loadCardData` wraps everything in try/catch → FALLBACK on any throw.
- **Cache poisoning on revocation:** see R3 — bounded to title+date for ~11 min, correctly using the short TTL.

**(b) Does any caller bypass `getPublishedRecapSource`?** — **No.** Full merged-tree grep of
`getPublishedRecapSource` / `getStoryRaw` / `getNightStory` consumers:
- `getPublishedRecapSource` → only `app/recap/[storyId]/page.tsx` (the single public choke point).
- `getNightStory(_, null)` → only the OG route (equivalent published+non-private gate, and it reads **no moments**).
- `getNightStory(id, callerUserId)` and `getNightStoryWorkspaceResult(actor, id)` → authenticated API routes.
- `getStoryRaw` is module-private (never imported elsewhere). No unauthenticated path reads raw moments.

**(c) Consent withdrawal reflected within TTLs?** — **Yes, with the R2 signed-URL caveat.** Withdrawal removes
the moment id from `publishedMomentIds` (in-memory filter; Supabase `night_story_moments` row delete re-derived by
`getStoryRaw`). Dynamic page → next visitor sees the removal immediately. Residual window = the 3600 s signed
photo URL already handed out (R2). Publication itself re-checks consent at *confirm* time
(`confirmNightStoryPublication` → `proposeEligibility`), so a withdrawal between propose and confirm wins.

**(d) Are memory/account ids server-only in the public DTO?** — **Yes.** `PublicNightStory` and `safeNightStory`
both omit `memoryId`, `hostEditorId`, `ownerId`. The exposed DTO carries only id/title/summary/status/visibility/
legacyCrawlStoryId/publishedMomentIds/publishedAt/timestamps. Raw `NightMoment[]` (which does carry `ownerId`/
`memoryId`) never reaches the client — the page is a Server Component that renders only the composed `RecapView`;
`RecapView.photos[].mediaObjectKey` is used server-side to sign a URL and is never emitted to the client (only the
signed URL + caption + moment id, an opaque UUID React key, cross the boundary).

**(e) Crew names on the card — consent-cleared only?** — **Yes, and currently a no-op.**
`recapCardStats.server.ts` is a **stub returning `null`** until #335 wires it, so `crew` is always `[]` on the OG
card today (title+date only). The documented wire-up (`consentClearedCrew(src)`) sources crew from the consent join
only; `lib/recapCard.ts` additionally clamps names to 24 chars and caps at 4 as defense-in-depth. No crew leak is
live in this set; the follow-up wiring must keep the consent-only source.

**Guardian honesty (correctness item 3):** verified. `guardianView` (`lib/recapView.ts`) only fires on a
`get_home` ending and returns null unless `lastTrainBadge` returns a badge. `lib/lastTrainBadge.ts` returns null
unless there is a genuine live TfL decision (`live_data_unavailable` excluded) plus parseable `dropCreatedAt` +
`leaveByIso`, and it never claims a train was boarded — only the timestamp relationship ("Home before the last
train" / "Out past the last train"). The public recap sets `guardian: null` entirely, so this line never reaches a
public surface. No fabricated saves.

---

## Cross-branch composition

- **Internal:** only one conflict — R1, `NightModeCard.tsx` (#334×#335). #333 merges clean on top of #334+#335.
  Merge order within the set is forced: **#334 → #335 (hand-merge) → #333**.
- **Against the open queue (no file overlap → no textual conflict):**
  - **#314** `feat/whatsapp-share-artifacts` — disjoint files; only the R5 dedupe debt.
  - **#307** `taste/feed-card-slim` — disjoint (feed/share files); recap touches neither.
  - **#328** `design/token-system-v2` — disjoint (`globals.css`/`theme.css`/`PriceBadge.module.css`); recap CSS
    *consumes* `price-plaque` / `type-*` classes that #328 governs. Same design intent (#328 is literally the brass
    price-plaque work), so aligned, not colliding. Co-touch review note only.
  - **#301** `feat/metrics-funnel` — co-touches `lib/analyticsEvents.ts` (#335 appends `recap_shared`,
    `recap_share_gate_opened`). **Verified clean** via `git merge-tree` (different hunks; append-only union). Land
    order-independent; review note only.

---

## Merge-order slot — amendment to `docs/MERGE_ORDER_2026-07-18.md` (#316 v2)

The recap set post-dates the matrix (which stops at #322). Insert as a new **Cycle-9 recap cluster** after the
current step 30 (#300), landing as a self-contained trailer. Draft amendment lines:

**(a) Conflict matrix — add row:**

| Pair | Conflicting files | Nature |
|------|-------------------|--------|
| **#334 ↔ #335** | `components/night/NightModeCard.tsx` | Overlapping hunk in `NightModeSheet`'s `{recap ? …}` block: #334 restructures to `recapInvite`, #335 inserts the "See the full recap" `<Link>` on the same lines. Hand-merge (keep #334 wrapper + #335 Link inside nested actions). No new imports. |

**(b) Recommended total order — append:**

| # | PR | Branch | Tier / why here |
|---|----|--------|-----------------|
| 31 | #334 | feat/night-arc-seams | Recap cluster base. Night-mode seam; independent of the data chain and the #299/#314 clusters. Clean vs all queued PRs. |
| 32 | #335 | feat/recap-page | ⚠️ Rebase — conflict vs #334 in `NightModeCard.tsx`. Hand-merge per R1. Adds the public recap page + `getPublishedRecapSource`. Must land after #334. |
| 33 | #333 | feat/recap-card | Recap cluster top. OG card; merges clean on #334+#335. Land last so `recapCardStats.server.ts` wire-up (stub→real) sits on the merged store + composer. |

**(c) Rebase note — add:**
- **#335** — after **#334** lands, re-merge main; expect one conflict in `components/night/NightModeCard.tsx`. Keep
  #334's `nightCard__recapInvite` wrapper + `recapSeeding` branch; re-apply #335's `<Link href={/plan/${id}/recap}>`
  **inside** the nested `nightCard__recapActions` div. `Link`/`BookOpen` already imported — no import edit.

**(d) Checklist — append:**
- [ ] 31. Merge **#334** (feat/night-arc-seams)
- [ ] 32. ⚠️ **#335** (feat/recap-page) — re-merge main → resolve `NightModeCard.tsx` (R1) → CI green → merge
- [ ] 33. Merge **#333** (feat/recap-card); then land the `recapCardStats` wire-up follow-up. Track R2 (signed-URL TTL) before public traffic.

**Net new manual stops added to the queue: 1** (the #335 hand-merge). No new data re-runs, no derived-artifact regen.

---

## Correctness spot-run log

```
tsc --noEmit -p tsconfig.json (merged #334+#335+#333 tree) → 0 errors
vitest run __tests__/recapView.test.ts __tests__/recapCard.test.ts → 2 files, 38 passed
vitest run __tests__/activePlan.test.ts → 1 file, 23 passed
git merge-tree #301 × #335 (lib/analyticsEvents.ts) → clean (no CONFLICT)
```
