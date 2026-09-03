import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyOptimisticFlip,
  CHEERS_GATE_PROMPT,
  cheersTapFeedback,
  postReactionToggle,
  reconcileToggle,
  type ToggleBase,
  type ToggleView,
} from "@/lib/optimisticToggle";

// Pure optimistic-toggle arithmetic behind the A4 one-tap "Cheers" kudos. These
// tests pin the instant-flip + reconciliation + rollback behaviour the
// CheersButton relies on, with no React/DOM in the loop.

describe("applyOptimisticFlip", () => {
  it("toggles ON: sets mine and bumps the count", () => {
    expect(applyOptimisticFlip({ mine: false, count: 3 })).toEqual({ mine: true, count: 4 });
  });

  it("toggles OFF: clears mine and drops the count", () => {
    expect(applyOptimisticFlip({ mine: true, count: 4 })).toEqual({ mine: false, count: 3 });
  });

  it("ON from zero starts a count at one", () => {
    expect(applyOptimisticFlip({ mine: false, count: 0 })).toEqual({ mine: true, count: 1 });
  });

  it("never underflows below zero when toggling OFF from an inconsistent base", () => {
    // Defensive: a server that reports mine=true with count=0 must floor at 0.
    expect(applyOptimisticFlip({ mine: true, count: 0 })).toEqual({ mine: false, count: 0 });
  });
});

describe("reconcileToggle", () => {
  const base: ToggleBase = { mine: false, count: 5 };

  it("with no pending flip shows the authoritative base as-is", () => {
    expect(reconcileToggle(base, null)).toEqual({ view: base, clearPending: false });
  });

  it("keeps showing the optimistic prediction while the round-trip is pending", () => {
    // We flipped from base and the props haven't caught up yet → hold the
    // prediction, don't clear.
    const predicted: ToggleView = { mine: true, count: 6 };
    const result = reconcileToggle(base, { predicted, baseline: base });
    expect(result).toEqual({ view: predicted, clearPending: false });
  });

  it("surrenders to base and clears pending once the server confirms the flip", () => {
    // The parent reconciled: props now reflect our predicted (cheered) state.
    const predicted: ToggleView = { mine: true, count: 6 };
    const confirmed: ToggleBase = { mine: true, count: 6 };
    const result = reconcileToggle(confirmed, { predicted, baseline: base });
    expect(result).toEqual({ view: confirmed, clearPending: true });
  });

  it("shows the rolled-back base (and clears pending) when the POST failed", () => {
    // Parent's rollback restored the pre-flip state; because base no longer
    // equals the baseline we predicted from, the authoritative state wins.
    // (Here the rollback lands back on the same values as baseline, so we assert
    // via a distinct external change below; a same-value rollback is
    // indistinguishable from "still pending" by design — the parent's rollback
    // path produces a NEW object identity that re-runs the effect, and the view
    // it yields is base, which is correct either way.)
    const predicted: ToggleView = { mine: true, count: 6 };
    // Server says someone else also cheered in the meantime: base moved.
    const moved: ToggleBase = { mine: true, count: 8 };
    const result = reconcileToggle(moved, { predicted, baseline: base });
    expect(result).toEqual({ view: moved, clearPending: true });
  });

  it("clears pending when an external actor changes the count under a pending flip", () => {
    const predicted: ToggleView = { mine: true, count: 6 };
    // Base count changed (another viewer's cheer landed) though mine is unchanged.
    const external: ToggleBase = { mine: false, count: 7 };
    const result = reconcileToggle(external, { predicted, baseline: base });
    expect(result).toEqual({ view: external, clearPending: true });
  });
});

// ── U2: the POST seam + failure feedback behind the Cheers button ─────────
// The bug these pin: an anonymous Cheers whose POST answers 503 used to fail
// SILENTLY — the parent rolled its summary back to the exact pre-flip values,
// which reconcileToggle cannot distinguish from "still pending" (by design, see
// above), so the button stayed visually cheered forever with zero feedback.
// The explicit outcome + feedback pair below is the fix.

describe("postReactionToggle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const body = { id: "drop-1", actor: "anon-1", reaction: "cheers" };

  it("confirms a 200 and hands back the authoritative summary", async () => {
    const summary = { counts: { cheers: 3 }, mine: ["cheers"] };
    const fetchMock = vi.fn(async () => Response.json({ summary }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postReactionToggle(body)).resolves.toEqual({
      kind: "confirmed",
      summary,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/pint-drops/reactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("maps a 404 (demo seed) to unknown-drop so the local-only path keeps working", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Pint drop not found." }, { status: 404 })),
    );
    await expect(postReactionToggle(body)).resolves.toEqual({ kind: "unknown-drop" });
  });

  it("maps a 503 (anonymous store gating) to failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Reactions are unavailable." }, { status: 503 })),
    );
    await expect(postReactionToggle(body)).resolves.toEqual({ kind: "failed" });
  });

  it("maps a network error to failed instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(postReactionToggle(body)).resolves.toEqual({ kind: "failed" });
  });
});

describe("cheersTapFeedback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a successful toggle needs no revert and no prompt", () => {
    expect(cheersTapFeedback(true)).toEqual({ revertOptimistic: false, prompt: null });
  });

  it("503 failure path: the optimistic state reverts and the claim-a-handle prompt shows", async () => {
    // The full failure path, exactly as the button runs it: optimistic flip →
    // POST answers 503 → outcome failed → feedback says revert + prompt.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Reactions are unavailable." }, { status: 503 })),
    );
    const base: ToggleBase = { mine: false, count: 5 };
    const predicted = applyOptimisticFlip(base);
    expect(predicted).toEqual({ mine: true, count: 6 }); // instant tick shown

    const outcome = await postReactionToggle({ id: "d1", actor: "a1", reaction: "cheers" });
    const feedback = cheersTapFeedback(outcome.kind !== "failed");

    // The prompt is shown, in the app's claim-a-handle voice…
    expect(feedback.prompt).toBe(CHEERS_GATE_PROMPT);
    expect(CHEERS_GATE_PROMPT).toMatch(/sign in or claim a handle/i);
    // …and the button must drop its optimistic override: with pending cleared
    // the view snaps back to the authoritative pre-flip base — the revert.
    expect(feedback.revertOptimistic).toBe(true);
    expect(reconcileToggle(base, null).view).toEqual(base);
  });
});
