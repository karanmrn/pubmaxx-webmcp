# Prompt orchestration — one interruptive surface per session

Status: contract + adoption guide
Owner: fix/prompt-orchestration (standalone, branched from main)
Source: `docs/DEEP_REVIEW_APP_2026-07-18.md` §1 (P1 ship-blocker)

## Why this exists

Interruptive prompt surfaces mount globally or on `/map`:

| Surface | PR | Branch | Where it can fire |
| --- | --- | --- | --- |
| Analytics consent | analytics-actually-works | `fm/analytics-actually-works` | first visit on every route |
| First-run tour | #296 | `main` (merged) | `/map` load, first visit |
| Identity nudge | #312 | `feat/identity-nudges` | first plan create/join, first moment draft |
| Native push prompt | #299 | `feat/native-first-run` | plan join / activation / collab confirm (native only) |
| A2HS install | #313 | `feat/a2hs-flow` | after proven value (2nd distinct day or completed crawl) |

The review proved two independent defects:

1. **`lib/promptBudget.ts` guarded nobody.** #313 shipped it as the
   "one interruptive prompt per session" source of truth, but only
   `A2HSInstallPrompt.tsx` ever called `claimPromptBudget` /
   `hasPromptBudgetFor`. The other three never claim, so the holder is only
   ever `"a2hs"` or `null` — the budget stops nothing from stacking.
2. **The documented identity-before-push ordering was dead code.**
   `lib/identityNudge.ts` documents "record the identity nudge first, then only
   record the push action if `!isIdentityNudgePending()`", but that guard was
   never wired. On a signed-out native user's first plan-join tap, `PlanCrew`
   fires **both** `recordPlanNudgeTrigger()` (arms identity) **and**
   `recordPlanHighIntentAction()` (arms push) → both sheets render on one tap.

## The contract

1. **At most one interruptive surface per browser-tab session.** Enforced by
   `lib/promptBudget.ts` (sessionStorage-scoped). Every surface MUST:
   - Stand down while the desktop Map location control is available, and while
     the map first-visit arrival card is on screen. Each of those owns the first
     prompt moment, before consent or session-budget priority, and both budget
     checks and claims enforce this shared boundary
     (`locationAllowsInterruptivePrompt`, `lib/promptBudget.ts`). The arrival
     card reports its own visibility through
     `setMapFirstVisitArrivalCardVisible` (`lib/mapFirstVisitArrival.ts`); it
     asks for location itself, so a consent card over it would put two first
     questions on one screen. It is one tap and one time per device, so the
     surface behind it is not starved.
   - **Respect** the budget before it interrupts:
     `if (!hasPromptBudgetFor(SURFACE)) return;` (early-return / gate off it).
   - **Claim** the budget *at the moment it actually shows*, not when merely
     eligible: `if (!claimPromptBudget(SURFACE)) return;` — an eligible-but-hidden
     prompt must never starve a sibling.
   - **Keep** the claim on dismiss. A shown-then-dismissed prompt DID interrupt;
     it must not release. Only release (`releasePromptBudget`) if it claimed but
     then decided not to show (a late async gate flipped).
   - Treat unreadable consent storage as **undecided**. Until a valid decision
     can be read, every non-analytics surface must stand down, analytics capture
     stays off, and `"analytics-consent"` remains eligible. Session-budget
     storage still degrades open after consent is decided: losing
     sessionStorage may permit two prompts, but must not break a prompt flow.

2. **Priority when multiple gates open: `location or map first-visit arrival > analytics consent > identity > push > A2HS`.**
   An undecided analytics choice reserves the prompt budget before lower-priority
   surfaces may claim it. Accepting and declining both keep that session claim,
   so onboarding starts in a later session instead of stacking immediately.
   The budget alone only guarantees *one* wins, decided by mount order — a race.
   Where two surfaces arm on the *same* user action, the arming site MUST encode
   the priority explicitly so the higher-priority surface deterministically wins.
   Today the only such site is `PlanCrew` (identity + push both arm on plan-join);
   see the #299/#312 diff below. A2HS never co-arms on a tap (it needs proven
   value), so it only ever loses the budget race passively — no ordering code
   needed for it.

3. **The tour is map-scoped and claims like the rest.** It renders only on
   `/map` load, before any plan action, so it rarely co-renders with the
   plan-tap surfaces — but it is still budgeted, so a returning-day session that
   is also A2HS/identity/push-eligible sees exactly one prompt. This is
   implemented on `main` by this PR (below).

### Canonical surface ids

Declared in `lib/promptBudget.ts` (`PromptSurface`). Any non-empty string is
accepted at runtime; keep these stable:

- `"first-run-tour"` — #296 tour (this PR)
- `"analytics-consent"` - first-visit analytics choice
- `"identity-nudge"` — #312
- `"native-push"` — #299
- `"web-push"` — installed-PWA daily London brief, after a qualifying plan action
- `"a2hs"` — #313

---

## What this PR does (on `main`)

- Brings `lib/promptBudget.ts` + `__tests__/promptBudget.test.ts` to `main`
  **byte-for-byte identical** to `feat/a2hs-flow` (verified by `git hash-object`),
  so #313 rebases that file to a no-op.
- Makes the first-run tour claim/respect the budget:
  - `lib/firstRunTour.ts` exports `TOUR_PROMPT_SURFACE`, `tourHasPromptBudget()`,
    `claimTourPromptBudget()` (thin, injectable wrappers over `promptBudget`).
  - `components/onboarding/FirstRunTour.tsx` gates `active` on
    `tourHasPromptBudget()` and claims via a `useEffect` when it shows.
- Adds `__tests__/firstRunTour.test.ts` covering the tour's budget adoption
  (respect, claim, sibling arbitration, and consent-priority stand-down).

---

## Per-branch adoption diffs (mechanical — apply on rebase)

Each is the "~4-line change per component" the review specifies. The budget
module is already on `main` after this PR, so these branches just import from
`@/lib/promptBudget`.

### #312 `feat/identity-nudges` — IdentityNudge adopts the budget

`components/identity/IdentityNudge.tsx`. Add the import, respect + claim around
the existing early return (the effect must sit **before** the early return to
satisfy rules-of-hooks):

```diff
-import { useSyncExternalStore } from "react";
+import { useEffect, useSyncExternalStore } from "react";
 ...
+import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";
+
+const IDENTITY_SURFACE = "identity-nudge";
 ...
   const { user, loading, configured, signInWithGoogle, signInWithMicrosoft } = useAuth();

-  // Signed-in state is applied here (live via useAuth) ...
-  if (!trigger || loading || user || !configured) return null;
+  // Signed-in state is applied here (live via useAuth) ...
+  const canShow =
+    Boolean(trigger) && !loading && !user && configured && hasPromptBudgetFor(IDENTITY_SURFACE);
+
+  // Claim the shared one-prompt-per-session budget at the moment it shows.
+  useEffect(() => {
+    if (canShow) claimPromptBudget(IDENTITY_SURFACE);
+  }, [canShow]);
+
+  if (!canShow) return null;
```

### #299 `feat/native-first-run` — NativePushPrompt adopts the budget

`components/native/NativePushPrompt.tsx`. Same shape:

```diff
-import { useSyncExternalStore } from "react";
+import { useEffect, useSyncExternalStore } from "react";
 ...
+import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";
+
+const PUSH_SURFACE = "native-push";
 ...
   const visible = useSyncExternalStore(
     subscribePushPrompt,
     getPushPromptVisibleSnapshot,
     getPushPromptServerSnapshot,
   );

-  if (!visible) return null;
+  const canShow = visible && hasPromptBudgetFor(PUSH_SURFACE);
+
+  // Claim the shared one-prompt-per-session budget at the moment it shows.
+  useEffect(() => {
+    if (canShow) claimPromptBudget(PUSH_SURFACE);
+  }, [canShow]);
+
+  if (!canShow) return null;
```

### #299 × #312 — the `PlanCrew.tsx` merge conflict IS the ordering fix

Both branches edit **the same line** (`PlanCrew.tsx:158`, inside the shared-plan
join success path). #299 inserts `recordPlanHighIntentAction();`; #312 inserts
`recordPlanNudgeTrigger();`. Resolve the conflict by applying the documented
identity-first ordering verbatim (this is the review's exact resolution):

```ts
recordPlanNudgeTrigger();                 // identity wins first
if (!isIdentityNudgePending()) {          // push defers to a pending identity nudge
  recordPlanHighIntentAction();
}
```

Imports required at the top of `components/plan/PlanCrew.tsx` (union of both
branches, plus `isIdentityNudgePending`):

```ts
import { isIdentityNudgePending, recordPlanNudgeTrigger } from "@/lib/identityNudge";
import { recordPlanHighIntentAction } from "@/lib/nativePushPrompt";
```

No other site needs this ordering: #312 also arms in `PlanComposer`/`MomentCapture`
and #299 in `MobilePlanActivation`/`PlanCollaborationPanel`, but those do not
overlap on a single action.

### #313 `feat/a2hs-flow` — no-op rebase for the budget

`A2HSInstallPrompt.tsx` already adopts the budget correctly (surface `"a2hs"`,
claim on show, defers to `hasSeenTour()`). Its `lib/promptBudget.ts` and
`__tests__/promptBudget.test.ts` are now on `main` identical, so on rebase those
two files are already-present duplicates (no conflict, no diff). **A2HS's
adoption diff is empty** — this PR preserved its API exactly so #313 rebases to
a no-op for orchestration purposes.

---

## Verification (this PR, on `main`)

- `tsc --noEmit`: clean.
- `eslint`: clean.
- `vitest run`: 348 files / 3098 tests passing (includes ported
  `promptBudget.test.ts` and new `firstRunTour.test.ts`).
