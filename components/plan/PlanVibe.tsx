"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { errorMessageFrom } from "@/lib/apiErrorMessage";
import ShareBar from "@/components/share/ShareBar";
import { discardBody } from "@/lib/responseBody";
import { trackEvent } from "@/lib/analytics";
import { planCrewSharePath } from "@/lib/planCrewInviteUrl";
import { parsePlanCapabilitySnapshot, planCapabilityEvent, readPlanCapabilitySnapshot } from "@/lib/planSessionCapability";
import { VIBE_CHIPS, VIBE_SLUGS, type VibeChip, type VibeChipId } from "@/lib/vibeChips";
import { vibeTallyLine, type VibeTally } from "@/lib/vibeTally";

// Plan-page vibe picker + share stamp wiring (docs/VIBE_LAYER_SPEC_2026-07-19
// .md, surface 3; issue #438). The chips are the USER'S voice declaring the
// crew's night; one vote per member on the existing plan-collaboration seam
// (POST /api/plans/[id]/vibe-votes, member capability via the same volatile
// snapshot PlanSummary reads — PlanCrew already restores it on mount). The
// tally line is lib/vibeTally verbatim — this file never re-words that copy.
//
// Who sees what: the host and collaboration-authorized guests get the picker
// (the API enforces the same rule server-side); read-only viewers see the
// tally line only, and a plan with no votes shows them nothing at all.
//
// Fail-soft doctrine: a 503 (migration 0044 not applied yet) or 429 lands as a
// quiet inline status line under the chips. The tally keeps its last saved
// state; nothing ever blocks the page.

/** Cross-component signal: the crew's top vibe changed (slug or null). */
function vibeTopEvent(planId: string): string {
  return `pubmax:plan-vibe-top:${planId}`;
}

function publishVibeTop(planId: string, slug: string | null): void {
  window.dispatchEvent(new CustomEvent<{ slug: string | null }>(vibeTopEvent(planId), { detail: { slug } }));
}

function operationKey(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Accept only a well-shaped tally from the wire; anything else is dropped. */
function cleanTally(value: unknown): VibeTally | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { total?: unknown; counts?: unknown; top?: unknown };
  if (typeof row.total !== "number" || !Array.isArray(row.counts)) return null;
  const counts = row.counts.filter((entry): entry is { vibe: VibeChipId; count: number } =>
    Boolean(entry) && typeof entry === "object"
    && typeof (entry as { vibe?: unknown }).vibe === "string"
    && typeof (entry as { count?: unknown }).count === "number");
  const top = typeof row.top === "string" ? (row.top as VibeChipId) : null;
  return { total: row.total, counts, top };
}

export default function PlanVibe({ planId, initialTally }: { planId: string; initialTally: VibeTally | null }) {
  const tokenEvent = planCapabilityEvent(planId);
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => {
        window.removeEventListener(tokenEvent, onChange);
      };
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const { token: memberToken, collaborationAuthorized, role } = parsePlanCapabilitySnapshot(capabilitySnapshot);
  // Mirrors the API's own admission rule (host or collaboration-authorized
  // member); the server re-checks, this only decides what to render.
  const canVote = Boolean(memberToken && (role === "host" || collaborationAuthorized));

  const [tally, setTally] = useState<VibeTally | null>(initialTally);
  const [myVibe, setMyVibe] = useState<VibeChipId | "">("");
  const [pending, setPending] = useState<VibeChipId | "">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/plans/${planId}/vibe-votes`, { cache: "no-store" });
        if (!response.ok || cancelled) {
          discardBody(response);
          return;
        }
        const body = await response.json() as { ok?: unknown; tally?: unknown };
        const fresh = body?.ok === true ? cleanTally(body.tally) : null;
        if (!fresh || cancelled) return;
        setTally(fresh);
        publishVibeTop(planId, fresh.top ? VIBE_SLUGS[fresh.top] : null);
      } catch {
        // Read failures keep the server-rendered tally; votes are additive.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  async function vote(chip: VibeChip) {
    if (!canVote || pending) return;
    setPending(chip.id);
    setNote("");
    try {
      const response = await fetch(`/api/plans/${planId}/vibe-votes`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}`, "idempotency-key": operationKey() },
        body: JSON.stringify({ vibe: chip.id }),
      });
      const body = await response.json().catch(() => null) as { ok?: unknown; tally?: unknown } | null;
      if (!response.ok) {
        // Quiet inline states, value first: the tally on screen stays the last
        // saved truth. 429 and the 503 pre-migration window both land here.
        setNote(`${errorMessageFrom(body, "That vote did not save.")} The tally keeps the saved votes.`);
        return;
      }
      setMyVibe(chip.id);
      trackEvent("plan_vibe_vote", { vibe: chip.id });
      const tallied = await fetch(`/api/plans/${planId}/vibe-votes`, { cache: "no-store" });
      if (tallied.ok) {
        const talliedBody = await tallied.json() as { ok?: unknown; tally?: unknown };
        const fresh = talliedBody?.ok === true ? cleanTally(talliedBody.tally) : null;
        if (fresh) {
          setTally(fresh);
          publishVibeTop(planId, fresh.top ? VIBE_SLUGS[fresh.top] : null);
        }
      }
    } catch {
      setNote("That vote did not save. The tally keeps the saved votes.");
    } finally {
      setPending("");
    }
  }

  const line = tally ? vibeTallyLine(tally) : null;
  // Read-only viewers with no votes yet: honest nothing, no empty shell.
  if (!canVote && !line) return null;

  return (
    <section className="planVibe" aria-labelledby="plan-vibe-title">
      <p className="planPage__eyebrow">Crew vibe</p>
      <h2 id="plan-vibe-title">What&rsquo;s the vibe?</h2>
      {canVote ? (
        <>
          <p className="planVibe__lede">One vote each. Tap another chip to change yours; the winner stamps the share card.</p>
          <div className="planVibe__row" role="group" aria-label="Vote the night's vibe">
            {VIBE_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="planVibe__chip pressable"
                aria-pressed={myVibe === chip.id}
                data-active={myVibe === chip.id}
                disabled={Boolean(pending)}
                onClick={() => void vote(chip)}
              >
                {pending === chip.id ? "Saving…" : chip.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {line ? <p className="planVibe__tally">{line}</p> : null}
      {note ? <p className="planVibe__note" role="status">{note}</p> : null}
    </section>
  );
}

/**
 * The invite ShareBar, vibe-aware: the share URL carries ?vibe=<top slug> so
 * the plan-card OG stamp is pinned to what the sharer saw. Subscribes to the
 * picker's tally updates so a vote cast on this visit re-stamps the URL before
 * it is shared; with no top vibe the URL stays bare and the card renders base.
 */
export function PlanInviteShareBar({ planId, title, text, initialVibeSlug, inviteToken }: {
  planId: string;
  title: string;
  text: string;
  initialVibeSlug: string | null;
  /** Classic multi-use invite — required so ShareBar guests can join the crew. */
  inviteToken: string | null;
}) {
  const [slug, setSlug] = useState(initialVibeSlug);
  useEffect(() => {
    const onTop = (event: Event) => {
      const detail = (event as CustomEvent<{ slug: string | null }>).detail;
      setSlug(detail?.slug ?? null);
    };
    window.addEventListener(vibeTopEvent(planId), onTop);
    return () => window.removeEventListener(vibeTopEvent(planId), onTop);
  }, [planId]);
  // Without an invite token, omit the bar rather than share a bare plan UUID
  // that can no longer join after invite-only enforcement.
  if (!inviteToken) return null;
  const url = planCrewSharePath(planId, inviteToken, slug);
  return <ShareBar url={url} title={title} text={text} />;
}
