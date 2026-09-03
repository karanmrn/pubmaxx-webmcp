# Deep Review — APP / FEATURE corpus (cross-PR interactions)

Date: 2026-07-18
Reviewer: Fable (adversarial deep-reviewer, read-only)
Scope: #295/#299/#300, #296, #297/#304, #301, #306, #307/#314, #309, #311, #312, #313, #318
Method: per-branch diffs vs `origin/main`, pairwise `git merge-tree --write-tree`, gate-logic trace across the merged runtime. Verifies interaction bugs individual PR reviews cannot see.

Severity: **P1** ship-blocker · **P2** must-fix before/at merge · **P3** follow-up · **OK** clean.

---

## 1. Prompt-collision matrix — VERDICT: P1, two stacked prompts on one tap

Four interruptive surfaces exist across the corpus:

| Surface | PR | Where it can fire | Adopts `promptBudget`? |
|---|---|---|---|
| First-run tour | #296 | `/map`, `/map/[city]` only (`isTourEligiblePathname`) | **No** |
| Identity nudge | #312 | first plan create/join, first moment draft (web + native) | **No** |
| Native push prompt | #299 | plan join / activation / collab confirm (native only) | **No** |
| A2HS install | #313 | after proven value (2nd distinct day or completed crawl) | **Yes (only adopter)** |

### 1a. `lib/promptBudget.ts` is a one-sided guard (P1)
`#313` built `lib/promptBudget.ts` as the "one interruptive prompt per session" source of truth (`hasPromptBudgetFor` / `claimPromptBudget`). Grep across every branch:

- `components/pwa/A2HSInstallPrompt.tsx:170` — the **only** production caller of `claimPromptBudget` / `hasPromptBudgetFor`.
- `components/native/NativePushPrompt.tsx` — no reference (confirmed).
- `components/identity/IdentityNudge.tsx` — no reference (confirmed).
- `components/onboarding/FirstRunTour.tsx` — no reference (confirmed).

Because the other three never *claim* the budget, `promptBudgetHolder()` is only ever `"a2hs"` or `null`. So A2HS's `hasPromptBudgetFor("a2hs")` never returns false due to a sibling — the budget guards A2HS **against nobody**, and does nothing to stop identity/push/tour from stacking on each other or on A2HS. A2HS's real deference is `hasSeenTour()` (`A2HSInstallPrompt.tsx:159`), not the budget.

### 1b. Identity + push both arm on the same plan-join tap; the designed ordering is dead code (P1)
`components/plan/PlanCrew.tsx` join handler is edited by **both** #299 and #312 at the identical anchor (after the `trackEvent("crew_committed"…)` success block, `~line 153`):

- #299 inserts `recordPlanHighIntentAction();` (bumps push seq → `NativePushPrompt` shows).
- #312 inserts `recordPlanNudgeTrigger();` (arms `pending="plan"` → `IdentityNudge` shows).

`lib/identityNudge.ts:24-33,164` documents the intended ordering: *"the plan success path records the identity nudge first, then only records the push action if `!isIdentityNudgePending()`."* **That guard was never implemented.** `isIdentityNudgePending()` has zero production callers — grep finds it only in `__tests__/identityNudge.test.ts` and a *comment* at `components/plan/PlanComposer.tsx:528`. #299 predates #312 and cannot reference it; #312 is branched from main and only *adds* its own call, never wrapping #299's line.

Runtime result (native shell, signed-out user, first plan join):
- `IdentityNudge` is mounted globally (`components/auth/AuthProvider.tsx` → `<IdentityNudge/>`).
- `NativePushPrompt` is mounted globally (`app/layout.tsx` → `<NativePushPrompt/>`).
- The join fires `recordPlanNudgeTrigger()` **and** `recordPlanHighIntentAction()`, each calling `notify()` → both `useSyncExternalStore` clients re-read → **both sheets render on the same tap.** Two stacked modal-ish prompts, focus-trap fighting focus-trap.

A2HS is *not* the third prompt on day one (it needs `hasProvenValue` = 2nd day or completed crawl; a freshly-created plan is neither). But on a **returning day**, an armed identity nudge + an A2HS-eligible session stack too, because identity never claims the budget A2HS checks.

### 1c. First-run tour is temporally separate (OK-ish)
The tour only renders on `/map` load, before any plan action, so it doesn't co-render with identity/push on the join tap. It is still un-budgeted, so it's luck, not design, that keeps it apart — see fix.

### Minimal fix design (P1)
Two changes, both small; they compose:

1. **Resolve the #299×#312 `PlanCrew.tsx` conflict WITH the documented ordering** (turns a merge conflict into the fix):
   ```ts
   recordPlanNudgeTrigger();                 // identity wins first
   if (!isIdentityNudgePending()) {          // push defers to a pending identity nudge
     recordPlanHighIntentAction();
   }
   ```
   Apply the same identity-first ordering anywhere both arm — only `PlanCrew` today (#312 also arms in `PlanComposer`/`MomentCapture`, #299 in `MobilePlanActivation`/`PlanCollaborationPanel`; those don't overlap, so no other site needs it).

2. **Make `promptBudget` real** — have `FirstRunTour`, `IdentityNudge`, and `NativePushPrompt` adopt it exactly as A2HS does: `if (!hasPromptBudgetFor(surface)) return;` before showing, `claimPromptBudget(surface)` at the moment of show, keep the claim on dismiss. This is a ~4-line change per component using the module #313 already shipped, and it makes "at most one interruptive prompt per session" a guarantee instead of an aspiration. Step 1 additionally guarantees *which* one wins when two arm on the same tap (budget alone leaves that to mount order).

---

## 2. PubMap / PubMapCanvas convergence — VERDICT: OK (clean compose)

`#306` (dynamic imports) and `#309` (near-me sheet) both edit `components/PubMap.tsx`; `#297`/`#304` both edit `components/PubMapCanvas.tsx`. All pairwise `merge-tree` = **0 conflicts**. Semantic trace:

- **#306 × #309 (PubMap.tsx):** orthogonal. #306 converts off-first-paint panels (`ControlRail`, `RoutePanel`, `VenueInspector`, `MobilePlanActivation`, toolbars, banners, `TonightLane`, `MapConciergeAsk`, `LogIntentFallback`) to `next/dynamic({ssr:false})`. #309 adds its own `NearMeNow` dynamic import + a `nearMeContent` prop and flips `setMapOverlay("none")`→`"near-me"` (`PubMap.tsx:1118`). #306 never touches the near-me overlay, the `nearMeContent` sink, or the venue/location state `NearMeNow` reads. Both add an **identical** `import dynamic from "next/dynamic"` at line 4 — git dedupes identical insertions, so no double-import. **NearMeNow is not among #306's lazy set, and its inputs (`filteredVenues`, `userLocation`, `selectVenue`, `cityId`) live in PubMap's own scope, not in any lazied panel. No breakage.**
- **#297 × #304 (PubMapCanvas.tsx):** compose cleanly. #297 adds the no-frame watchdog (`FIRST_FRAME_TIMEOUT_MS`, `kind:"no-frame"`) + a static fallback venue list & "Browse all pubs" link. #304 adds a controlled disclosure around `mapError.detail` + the orphaned-canvas `container.replaceChildren()` in the catch path. They edit adjacent-but-distinct regions of the same fallback block; the merged fallback correctly shows **both** the #304 disclosure and the #297 venue list. #304's `replaceChildren()` runs only on the next init attempt (constructor-throw path); #297's no-frame path sets `mapError` and returns the fallback (React unmounts the canvas container), so the two error paths don't fight over the same DOM. Retry (#304 also resets `detailOpen`) re-inits and both re-arm. **No semantic conflict.**

No merge-order constraint needed inside the map cluster.

---

## 3. Analytics wiring debt — VERDICT: P2 payload drift (A2HS)

`#301` registers, in `lib/analyticsEvents.ts`, an allow-list where the prop array is the *complete* set of permitted custom props (values not on the list are stripped by the validator):

```
pwa_install_prompt_available: []     // NO props
pwa_install_completed:        []     // NO props
pwa_standalone_launch:        []
invite_created:   ["inviteId"]
invite_redeemed:  ["inviteId"]
activity_pulse:   ["dayBucket"]
```

**Drift:** `#313`'s A2HS component marks its POST-#301 call sites to emit **with a `platform` payload** — `A2HSInstallPrompt.tsx:135,168,195`: `pwa_install_completed ({ platform: 'android' })` and `pwa_install_prompt_available ({ platform })`. #301 registered both with an **empty** prop list, so once wired the `platform` dimension will be silently dropped/rejected by the allow-list. The A2HS lane and the metrics lane disagree on the schema. **Fix: when #301 lands (or in the A2HS wiring follow-up), register `pwa_install_prompt_available: ["platform"]` and `pwa_install_completed: ["platform"]`** (add `platform` to the allow-list, likely also `CUSTOM_PROP_VALIDATORS`). Otherwise the platform split the A2HS analytics comments promise is dead on arrival.

Other markers are consistent: #309/#312 reference no #301-owned events (they use pre-existing `plan_invite_sent`/`plan_invite_opened`, already on main). #301 does emit its own `invite_created` (`PlanCollaborationPanel.tsx:123`), `invite_redeemed` (`PlanCrew.tsx:114`), `activity_pulse` (`DailyActivityPulse.tsx:25`) with matching props — internally consistent. `pwa_standalone_launch` has no emitter in this corpus (A2HS suppresses on standalone rather than emitting); expected to be a layout-level follow-up. P3.

---

## 4. ShareBar (#307 × #314) — VERDICT: P2 hard conflict, resolvable

`merge-tree` = **CONFLICT** in `components/share/ShareBar.tsx` **and** `components/feed/FeedCard.tsx`. Both PRs rewrite the same share-button JSX block:

- #307 adds a `compact?: boolean` prop + `expanded` state + `showChannels = !compact || expanded` fold (channels start folded behind one toggle in the feed card). Channel set unchanged.
- #314 reorders channels (native-share leads when supported, WhatsApp promoted ahead of X) and routes the WhatsApp href through `lib/shareArtifacts.whatsappShareHref`.

They are not logically incompatible — one changes *whether* the strip is folded, the other changes *what's in and the order of* the strip. But because both rewrote the same lines, a human must hand-merge: keep #307's `compact`/`showChannels` gate **wrapping** #314's reordered channel list + `whatsappShareHref`. No behavioral trap once merged; just don't let one side's revert of the channel order or the fold slip through. **Merge-order: land one, rebase the other and re-apply by intent (not by textual `theirs`).**

---

## 5. Security spot-checks — VERDICT: OK

- **Push-token route dual limiter (#295/#300):** `app/api/push-tokens/route.ts` is well-formed. Per-IP durable limit (`push-tokens:<hashIp>`, 10/hr) checked **before** the global backstop (`push-tokens:global`, 300/hr), so a noisy client trips its own budget first; IP is hashed before it becomes a key. #300 is stacked on #295 (`#295` is an ancestor) and does **not** modify the route — no duplicate/divergent definition. One honest tradeoff worth noting (P3, documented in-file, launch-acceptable): the global ceiling is **shared-fate** — an attacker rotating spoofed forwarding IPs can burn the 300/hr global budget with ~300 requests and 429 *legitimate* new-device registrations for the rest of the hour; and on serverless the in-memory global key is per-instance, so the effective cap is `300 × instances`. Acceptable for launch; revisit if push registration becomes load-bearing.
- **Identity nudge (#312):** no auth surface. Pure client `localStorage` gate offering OAuth; the server moment-save path still requires auth (a signed-out capture can only ever be a local draft). No bypass.
- **A2HS (#313):** bounded `localStorage` keys (`pubmax:a2hs:v1`, `pubmax:prompt-budget:v1`), all writes wrapped in try/catch, degrade silently. No storage abuse.
- **Rounds polish (#318):** touches only `app/rounds/[code]/page.tsx`, `round.css`, `RoundStarter.tsx`, one e2e spec — **no `app/api/**` changes, no new mutation/insert/update surface.** Clean.

---

## Merge-order amendments (beyond the map cluster)

The prompt/share/metrics clusters carry conflicts a per-PR review misses. Confirmed via `merge-tree --write-tree`:

| Pair | Conflicting files | Resolution |
|---|---|---|
| **#299 × #312** | `components/plan/PlanCrew.tsx` | Resolve with the §1 ordering guard (identity-first, push-defers) — the conflict *is* the fix site. |
| **#299 × #313** | `app/layout.tsx` | Keep both mounts (`<NativePushPrompt/>` + `<A2HSInstallPrompt/>`). |
| **#299 × #301** | `components/plan/PlanCollaborationPanel.tsx`, `lib/analyticsEvents.ts` | Hand-merge; both add distinct behavior to the same anchors. |
| **#307 × #314** | `components/share/ShareBar.tsx`, `components/feed/FeedCard.tsx` | Rebase-and-reapply by intent (§4). |
| triple: **#299 + #301 + #312** all edit `PlanCrew.tsx` | — | #301's hunk (`~line 110`, `invite_redeemed`) is separate from the #299/#312 hunk (`~line 153`); only #299×#312 textually collide. Land #301 anytime; reconcile #299/#312 together. |

---

## Per-PR verdicts

| PR | Verdict | Note |
|---|---|---|
| #295 Capacitor wrap | OK | push-tokens route sound; base of the stack. |
| #299 native first-run + push prompt | **P1** | half of the un-guarded identity+push 2-stack; ordering guard never wired. |
| #300 push senders | OK | stacked on #295, no route change. |
| #296 first-run tour | P3 | correct in isolation; un-budgeted (adopt `promptBudget` per §1 fix step 2). |
| #297 map watchdog | OK | composes with #304. |
| #304 disclosure + orphan-canvas | OK | composes with #297. |
| #301 metrics funnel | **P2** | `pwa_install_*` registered with empty props; A2HS emits `{platform}` (§3). Also #299/#301 file conflicts. |
| #306 map perf | OK | dynamic imports don't touch near-me/fallback wiring. |
| #307 feed card slim | **P2** | ShareBar conflict with #314 (§4). |
| #309 near-me | OK | composes with #306; no #301 event drift. |
| #311 header consistency | not reviewed in depth (no cross-PR interaction surfaced in corpus). |
| #312 identity nudges | **P1** | other half of the 2-stack; ships the ordering contract but not its implementation. |
| #313 A2HS + promptBudget | **P1/P2** | `promptBudget` is a good mechanism only #313 adopts (§1a); analytics payload drift vs #301 (§3). |
| #314 share artifacts | **P2** | ShareBar/FeedCard conflict with #307 (§4). |
| #318 rounds polish | OK | no new mutation surface. |

## Bottom line
The one **ship-blocker** is the prompt collision: `promptBudget` was built but only one of four surfaces uses it, and the identity-before-push ordering exists only in comments — so a signed-out native user gets **identity nudge + push prompt stacked on their first plan-join tap**. Fix is small and lives exactly at the #299×#312 merge conflict. Everything else is P2 merge hygiene (ShareBar, analytics `platform` prop) or clean.
