// Pure optimistic-toggle logic for a single one-tap acknowledgement (the A4
// "Cheers" kudos). NO React, NO DOM — just the arithmetic, so it can be unit
// tested in isolation and reused by any optimistic one-tap affordance.
//
// The model: a card is handed the *authoritative* `count` + `mine` from the
// server (via its parent, which already owns the POST, reconciliation, and
// rollback). When the viewer taps, we want an INSTANT visual flip without
// waiting for that round-trip. So the button keeps a small local "pending"
// override that it applies on top of the incoming props, and clears the moment
// the props catch up to (or diverge from) what it predicted — at which point the
// server's answer is the truth and the optimistic layer gets out of the way.

// The visible state of a one-tap toggle: whether the viewer has it on, and the
// count shown. Always derived, never stored as the source of truth.
export type ToggleView = { mine: boolean; count: number };

// The base (authoritative) state a card is handed by its parent.
export type ToggleBase = { mine: boolean; count: number };

// Apply a single optimistic flip to a base state. Toggling ON bumps the count by
// one; toggling OFF drops it by one but never below zero (a defensive floor: a
// server that reports mine=true with count=0 must not underflow to -1).
export function applyOptimisticFlip(base: ToggleBase): ToggleView {
  if (base.mine) {
    return { mine: false, count: Math.max(0, base.count - 1) };
  }
  return { mine: true, count: base.count + 1 };
}

// Reconcile a pending optimistic prediction against freshly-arrived base props.
//
// `pending` is what we optimistically predicted after the last tap (or null when
// there is no in-flight flip). `base` is the newest authoritative state from the
// parent. Returns the state to DISPLAY plus whether the pending override should
// be cleared:
//   • no pending flip            → show base as-is.
//   • base already matches the    → the server confirmed our prediction; clear
//     prediction                    the pending override and show base.
//   • base disagrees (rollback,   → the server's answer wins; clear the pending
//     or another actor moved the    override and show base (this is how a failed
//     count)                        POST's rollback becomes visible).
//   • base unchanged, still        → keep showing the optimistic prediction until
//     matches the pre-flip base     the round-trip resolves.
//
// The rule collapses to: once base stops equalling the *pre-flip* baseline we
// predicted from, the prediction has been answered — surrender to base.
export function reconcileToggle(
  base: ToggleBase,
  pending: { predicted: ToggleView; baseline: ToggleBase } | null,
): { view: ToggleView; clearPending: boolean } {
  if (!pending) {
    return { view: base, clearPending: false };
  }
  // The parent's props still reflect the exact state we flipped FROM → the
  // round-trip hasn't landed yet; keep showing the optimistic prediction.
  if (base.mine === pending.baseline.mine && base.count === pending.baseline.count) {
    return { view: pending.predicted, clearPending: false };
  }
  // Base moved (confirmed, rolled back, or changed by someone else) → the
  // authoritative state is now the truth; drop the optimistic override.
  return { view: base, clearPending: true };
}

// ── U2: the network half + failure feedback of the one-tap Cheers ──────────
// The POST that backs a reaction toggle, extracted from app/feed/page.tsx so
// the FAILURE path (a 503 from anonymous store gating, a network drop) is
// unit-testable in the node environment — no React/DOM in the loop. The
// outcome vocabulary is exactly what the page's toggleReaction must decide
// between:
//   confirmed    → 2xx; reconcile from the returned authoritative summary.
//   unknown-drop → 404; a demo seed the backend doesn't persist — the caller
//                  keeps the toggle local-only (existing behaviour).
//   failed       → anything else (503 store gating, other 5xx, network error)
//                  — the caller must roll back its optimistic state AND tell
//                  the viewer (see cheersTapFeedback below).
export type ReactionPostOutcome =
  | { kind: "confirmed"; summary: unknown }
  | { kind: "unknown-drop" }
  | { kind: "failed" };

export async function postReactionToggle(
  body: { id: string; actor: string; reaction: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ReactionPostOutcome> {
  try {
    const res = await fetchImpl("/api/pint-drops/reactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 404) return { kind: "unknown-drop" };
    if (!res.ok) return { kind: "failed" };
    const data = (await res.json()) as { summary?: unknown };
    return { kind: "confirmed", summary: data.summary };
  } catch {
    return { kind: "failed" };
  }
}

// What the CheersButton must do once the round-trip resolves. Success needs
// nothing extra — the parent's reconciled props flow down as before. Failure
// must (a) drop the optimistic override so the tick honestly reverts (a
// rollback that lands on the exact pre-flip values is invisible to
// reconcileToggle's prop-diffing by design), and (b) tell the viewer WHY.
// The copy echoes the anonymous-gated empty state on /activity ("Sign in or
// claim a handle") — honest and warm, not an error klaxon.
export const CHEERS_GATE_PROMPT =
  "That cheers didn't save. Sign in or claim a handle, then try again.";

export type CheersTapFeedback = {
  revertOptimistic: boolean;
  prompt: string | null;
};

export function cheersTapFeedback(ok: boolean): CheersTapFeedback {
  return ok
    ? { revertOptimistic: false, prompt: null }
    : { revertOptimistic: true, prompt: CHEERS_GATE_PROMPT };
}
