# cursorreview.md

> Post-merge code review of GitHub main after #783–#798 (pulled 2026-08-07).
> Companion to PR https://github.com/Singularityszn/pubmax/pull/800 on branch `cursor/post-merge-review-e73e`.
> Audience: a follow-up agent reviewing both the findings and the fixes.

---

## 0. How to use this doc

1. Read **§1 Scope** and **§2 Verdict**.
2. Walk **§3 Findings** (severity-ordered). Fixed items point at the patch; open follow-ups are still live.
3. Diff the PR against `main` while reading **§4 What changed** (file map + intent).
4. Re-run **§5 Verification** commands.
5. Challenge the fixes with **§6 Review checklist for the next agent**.

Do not treat this file as a product plan. Implementation plan for landing UX is `cursorplan.md` on a different branch (`cursor/landing-ux-plan-e73e` / PR #787) and is out of scope here.

---

## 1. Scope reviewed

### Merged on main (then fast-forwarded)

| PR | Title | Risk class |
|---|---|---|
| #798 | Host invite link + RSVP moderation | High (authz / cookies) |
| #797 | Freshness episodic budgets (class-c) | Medium (docs/data) |
| #796 | Freshness burndown docs | Low |
| #795 | Public invite page, handle-free RSVP | High (public write surface) |
| #794 | Migration env sync / extensions schema | Medium (ops) |
| #793 | validate-data decomposition | Medium (build gate) |
| #792 | Derived migration apply list | Low |
| #791 | Phone city-banner omission docs | Low |
| #790 | Map URL params table | Low |
| #789 | No-alcohol-first crawl + `na-friendly` signal | High (product wiring) |
| #788 | ADR 0010 community price trust | Low (docs) |
| #786 | `analyticsSurface` move | Low |
| #785 | Ledger / share cleanup | Low |
| #784 | validate-data degrade on missing optional artifacts | Medium |
| #783 | Handle claims stop inheriting pre-claim contributions | High (identity SQL) |

### Deep focus

- `app/invite/[token]/**`, `app/api/invite/[token]/**`, `components/plan/PlanInviteRsvp.tsx`, `PlanHostInviteLink.tsx`
- `lib/planInvite*.ts`, `lib/planStore.ts` invite seams, migration `0081`
- `components/PubMap.tsx` + `lib/venues.ts` `noAlcoholFirst`
- `lib/communityVenueSignals.ts` + migration `0080`
- migration `0079` handle-claim inheritance
- `/privacy` vs new data practice (workspace rule)

Skim only: freshness registry episodic budgets, validate-data refactor, migration apply-list script.

---

## 2. Verdict

The invite + host-moderation wave ships a real product surface, but **four high-severity defects** made host moderation and alcohol-free-first crawls fail in the common path. Those are fixed on this branch.

Identity migration `#783` looks correct in SQL shape but remains under-proven (regex pins only). Freshness / validate-data changes look structurally sound; one validate-data early-return risk remains open.

**Ship stance for PR #800:** ready for review/merge of the hardening fixes. Follow-ups in §3.3 should not block unless captain wants invite rotate/revoke before soft launch of public RSVP.

---

## 3. Findings

### 3.1 Fixed on this branch (must understand before approving)

#### F1 — Host Remove broken after hard `/invite/[token]` open
- **Severity:** High (authz / UX lie)
- **Evidence:** `restorePlanCapability` stores `PLAN_HTTP_ONLY_SESSION`. Cookie is `Path=/api/plans/${planId}`. Old DELETE was `/api/invite/[token]/rsvp`. `planMemberCapability` ignores the sentinel and never sees the cookie on that path → UI shows Remove → 403.
- **Fix:** New `DELETE app/api/plans/[id]/invite-rsvp/route.ts`. Client calls that URL. Cookie Path matches. Bearer still works for same-tab create flows.
- **Tests:** cookie auth case + host/guest/missing token in `__tests__/planInviteRsvpModerationRoute.test.ts`.

#### F2 — Reaction `mine` never hydrated
- **Severity:** High (behavioral)
- **Evidence:** Invite page SSR comment said client would fetch with device id; island never did. No GET on reactions route. Reload → `aria-pressed=false` while count > 0 → next click untoggles.
- **Fix:** `GET /api/invite/[token]/reactions?submitterId=` + mount `useEffect` hydrate in `PlanInviteRsvp.tsx`.
- **Tests:** toggle then GET asserts `mine` contains `cheers`.

#### F3 — Public invite writes skipped classic-plan gate
- **Severity:** High (orphan writes)
- **Evidence:** Page uses `planStateResult` (`social_owner_account_id IS NULL`). POST routes only `resolvePlanIdByInviteToken`. Crew-bound / converted plan: page 404, writes still succeed.
- **Fix:** `lib/planInviteResolve.ts` → `resolveClassicInvitePlan` used by RSVP POST and reactions GET/POST.
- **Tests:** unknown token 404; Crew-bound case still worth adding (memory store may need a social-owner fixture — see checklist).

#### F4 — `noAlcoholFirst` never loaded NA price index
- **Severity:** High (silent product miss)
- **Evidence:** `loadNoAlcoholIndex` only on experience lens `"no-alcohol"`. Crawl style / `?style=noAlcoholFirst` did not call it. `scoreVenue(..., noAlcoholFirst, emptyMap)` collapses to pint cheapness.
- **Fix:** `useEffect` in `PubMap.tsx` when `filters.crawlStyle === "noAlcoholFirst"`.
- **Tests:** `__tests__/noAlcoholFirstIndexLoad.test.ts` source pin.

#### F5 — Privacy notice lagged the data practice
- **Severity:** Medium (workspace rule)
- **Fix:** `/privacy` paragraph for Plan public invite RSVP/reactions (display name, hashed device id, link visibility, host remove, delete-with-plan).
- **Tests:** `__tests__/legalPages.test.ts` disclosure pin.

#### F6 — RSVP rate limit trivial to rotate
- **Severity:** Medium (abuse)
- **Fix:** Reject empty `submitterId`; add per-invite-token `isLimited` budget alongside per-device.
- **Remaining:** guest list still unbounded (open F10).

#### F7 — Simplify: duplicated `REACTION_META`
- **Fix:** `REACTION_META` owned by `lib/reactions.ts`; FeedCard + PlanInviteRsvp import it.

#### F8 — Write-surface inventory drift
- **Fix:** Certification inventory swaps `DELETE app/api/invite/[token]/rsvp` → `DELETE app/api/plans/[id]/invite-rsvp`; route-89 prose updated.

---

### 3.2 Reviewed, no code change (accepted / deferred)

| ID | Severity | Note |
|---|---|---|
| F9 | Medium | Invite token cannot rotate/revoke; leak lasts plan lifetime. Product follow-up. |
| F10 | Medium | `summarize` returns every RSVP row; flood inflates SSR + guest list. Cap/paginate later. |
| F11 | Medium | `#783` proof is migration-text regex only; no executable Postgres attribution scenario. |
| F12 | Medium | `0080` rollback recreates tighter CHECK without quarantining `na-friendly` rows. Captain apply-order risk. |
| F13 | Medium | App ships `na-friendly` vocabulary before migration apply — reverse order fails durable writes. |
| F14 | Medium | `#784` `validateVenueDetails` can early-return entire content validation when heritage seed dir missing. |
| F15 | Medium | Even with NA index loaded, secondary rank among NA pubs still uses pint `cheapestPrice`. |
| F16 | Low | Reaction toggle read-then-write race (unique helps). |
| F17 | Low | “Hosted by” uses `crew[0]` not explicit host role. |
| F18 | Low | Broader `usePlanCapability` extract deferred (PlanInviteRsvp / PlanHostInviteLink still duplicate subscribe/restore). |
| F19 | Low | Memory reaction summarize scans all rows (keyless only). |

---

### 3.3 Intentionally not “fixed” by inventing product

- No fake social proof, no invite token UX beyond security/authz repair.
- No palette / landing work (see `cursorplan.md`).
- No AuthProvider / RLS wave / community corroboration threshold changes.

---

## 4. What changed (file map)

Branch: `cursor/post-merge-review-e73e`  
Commit: `b7e71880` (+ this `cursorreview.md` commit)

| Path | Intent |
|---|---|
| `lib/planInviteResolve.ts` | **New.** Classic-plan invite resolve (token → `planStateResult`). |
| `app/api/plans/[id]/invite-rsvp/route.ts` | **New.** Host-only DELETE; cookie Path works. |
| `app/api/invite/[token]/rsvp/route.ts` | POST only; classic resolve; submitter + token rate limits. |
| `app/api/invite/[token]/reactions/route.ts` | GET hydrate + POST; classic resolve; require submitterId. |
| `components/plan/PlanInviteRsvp.tsx` | Call plans DELETE; hydrate reactions; import shared meta. |
| `components/feed/FeedCard.tsx` | Import `REACTION_META` from `lib/reactions.ts`. |
| `lib/reactions.ts` | Export shared `REACTION_META`. |
| `components/PubMap.tsx` | Load NA index when crawl style is `noAlcoholFirst`. |
| `app/privacy/page.tsx` | Disclose Plan public invite RSVP practice. |
| `docs/WRITE_SURFACE_CERTIFICATION.md` | Inventory + route-89 prose. |
| `__tests__/planInviteRsvpModerationRoute.test.ts` | Cookie host, hydrate, missing submitter, unknown token. |
| `__tests__/noAlcoholFirstIndexLoad.test.ts` | **New.** PubMap wiring pin. |
| `__tests__/legalPages.test.ts` | Privacy disclosure pin. |
| `cursorreview.md` | **This file.** |

---

## 5. Verification already run

```bash
npx vitest run \
  __tests__/planInviteRsvpModerationRoute.test.ts \
  __tests__/legalPages.test.ts \
  __tests__/writeSurfaceCertification.test.ts \
  __tests__/noAlcoholFirstIndexLoad.test.ts \
  __tests__/communityVenueSignals.test.ts \
  __tests__/emDashLaw.test.ts
# → 5+ files / all green at authoring time
```

Suggested re-check for the next agent:

```bash
git fetch origin && git checkout cursor/post-merge-review-e73e && git pull
npx vitest run __tests__/planInviteRsvpModerationRoute.test.ts __tests__/writeSurfaceCertification.test.ts __tests__/noAlcoholFirstIndexLoad.test.ts __tests__/legalPages.test.ts
# Optional: e2e/plan-invite.spec.ts after freeing Playwright port / using PW_NEXT_DIST_DIR
```

Manual probes that caught the originals:

1. Create plan → open invite URL in a **fresh tab** as host → RSVP as guest in another profile → host Remove must 200 (cookie path).
2. React on invite → hard reload → chip must stay `aria-pressed=true`; second click turns off.
3. Map → crawl style “Alcohol-free first” → network shows `/api/price-submit?lens=no-alcohol` without needing the no-alcohol experience lens first.

---

## 6. Review checklist for the next agent

### Must challenge

- [ ] Does `DELETE /api/plans/[id]/invite-rsvp` still reject guests and missing capability?
- [ ] With only the HttpOnly cookie (body `memberToken` omitted / sentinel), does Remove succeed after hard navigation?
- [ ] Does `resolveClassicInvitePlan` 404 when `planStateResult` returns no classic plan (Crew-bound)? Add a memory fixture test if missing.
- [ ] Reaction GET cannot be used to enumerate other devices’ `mine` without their `submitterId` (id is client-chosen; confirm no cross-device leakage beyond counts).
- [ ] Privacy copy matches code: hashed device id, no raw id, host can remove, rows die with plan.
- [ ] Write-surface inventory length still 112 and lists the new DELETE path only once.
- [ ] `noAlcoholFirst` load is idempotent (`noAlcoholIndexLoaded` guard) and does not fight the experience-lens path.

### Voice / fences

- [ ] No em dashes / exclamation marks in new privacy or UI copy (`emDashLaw`).
- [ ] No invented freshness claims beside invite or crawl copy.

### Simplify residual (optional follow-up PR)

- [ ] Extract `usePlanCapability(planId)` for PlanInviteRsvp + PlanHostInviteLink (+ later PlanCrew).
- [ ] Share reaction summarize fold with `reactionsStore` if touched again.
- [ ] Cap public guest list in `summarizeRsvpRows`.

### Do not regress

- Handle-free RSVP (no account / no `pubmax_handle` on this path).
- Cookie Path remains `/api/plans/${planId}` — do not widen to `/api/invite`.
- Classic vs Crew-bound plan split (`social_owner_account_id`).
- Community NA price authority still goes through `trustedNoAlcoholLensPrices` / corroboration; crawl style must not invent amenity-only trust.

---

## 7. Open questions for the next agent

1. Should Crew-bound token POST 404 be pinned with an explicit memory-store social-owner fixture in Vitest before merge?
2. Is a max guest-list cap (e.g. 200) required before soft-launching public invites, or is per-token rate limit enough for v1?
3. Should host Remove also refresh the summary from the server after DELETE (today it optimistically edits local state)?
4. For `#783`, is a `npm run test:rls`-style or SQL fixture proof in scope soon, or accept shape pins until captain applies?

---

## 8. Out of scope of this review branch

- Landing acquisition / CTA hierarchy (`cursorplan.md`, PR #787)
- Applying Supabase migrations (captain)
- Invite token rotate UI
- Planner `scoreVenueForPlan` NA amenity heuristic (known separate gap from #789)
- Palette / design-taste landing wave

---

## 9. Author notes

- Review method: parallel deep reads of invite + identity/signals + simplify scan; defects confirmed against `planMemberCapability` cookie Path, `restorePlanCapability` sentinel, PubMap load wiring, and privacy fence.
- Prefer minimal, contract-aligned fixes over new modal/product surface.
- If you disagree with a fix, say which finding ID (F1–F19) and whether the disagreement is security, product, or taste.
