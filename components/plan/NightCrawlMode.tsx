"use client";

// Night-crawl mode (U7) — the mid-crawl "we're out, where next" surface. Option A
// (card-stack glance screen) as the skeleton, with Option B's giant arrive slab
// grafted in as the one dominant target. See docs/design-explorations/night-crawl.
//
// Entry: this mounts on the plan page. While THIS plan's night is on (its active
// window, per lib/activePlan), on a phone it becomes the default surface —
// a full-screen OLED-dark card stack over the plan page. Off-window, on desktop,
// or after the viewer taps "View full plan", it collapses to a small inline entry
// banner instead. No new route: the plan page shell hosts it.
//
// Actions: We-are-here / Skip post through the existing /api/plans/[id]/actions
// endpoint with a persistent idempotency key (lib/planMutationKey). The tap flips
// the stack optimistically (the done row marks, the cursor advances) and the
// outcome reconciles honestly - a confirmed write adopts the canonical plan;
// offline failures keep the advance only when the client outbox queued them.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { CrewMemberDTO, CrewPresenceStatus } from "@/lib/crew";
import type { PlanState } from "@/lib/plan";
import {
  clampStopIndex,
  isPlanActiveNow,
  readActivePlan,
  setActivePlanStopIndex,
  subscribeActivePlan,
} from "@/lib/activePlan";
import {
  advanceNightCrawl,
  classifyActionOutcome,
  isFinalStop,
  nightCrawlActionNote,
  nightCrawlActionPayload,
  nightCrawlGlance,
  nightCrawlHandoffTarget,
  nightCrawlHero,
  nightCrawlIdempotencyScope,
  nightCrawlNextStop,
  nightCrawlStack,
  reconcileNightCrawlAction,
  type NightCrawlActionType,
} from "@/lib/nightCrawl";
import { NIGHT_CRAWL_ENGAGE_EVENT } from "@/lib/nightCrawlEngage";
import {
  requestNightModeEndingFromPlan,
  requestNightModeEndingHandoff,
} from "@/lib/nightModeHandoff";
import { clearPersistentPlanMutationKey, persistentPlanMutationKey } from "@/lib/planMutationKey";
import {
  applyActivePlanFlushRollback,
  enqueueNightCrawlAction,
  flushPlanMutationOutbox,
  hasPendingPlanMutation,
  listPlanMutationOutbox,
  removePlanMutationOutboxEntry,
  subscribePlanMutationOutbox,
  type PlanMutationFlushResult,
} from "@/lib/planMutationOutbox";
import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
import "./nightCrawl.css";

const TFL_JOURNEY_PLANNER = "https://tfl.gov.uk/plan-a-journey/";

// Global presence → hero "who is where" chip. Only statuses that read as a real
// position get a chip; a plain "in" is dropped so the row stays a glance.
const CREW_CHIP: Partial<Record<CrewPresenceStatus, { label: string; tone: "here" | "ahead" | "late" }>> = {
  here: { label: "here", tone: "here" },
  on_the_way: { label: "on the way", tone: "ahead" },
  running_late: { label: "lagging", tone: "late" },
  start_without_me: { label: "catching up", tone: "late" },
};

type NoteTone = "offline" | "rejected" | "forbidden" | "pending" | "guidance";

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export default function NightCrawlMode({ planId, initialState }: { planId: string; initialState: PlanState }) {
  const collapseKey = `pubmax:night-crawl-collapsed:${planId}`;
  const [plan, setPlan] = useState<PlanState>(initialState);
  const [optimistic, setOptimistic] = useState<Record<number, NightCrawlActionType>>({});
  const [busy, setBusy] = useState<NightCrawlActionType | null>(null);
  const [note, setNote] = useState<{ text: string; tone: NoteTone } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [activeNow, setActiveNow] = useState(false);
  const [open, setOpen] = useState(false);

  // Cursor: the user-advanced "which stop are we at" pointer for THIS plan.
  const cursor = useSyncExternalStore(
    subscribeActivePlan,
    () => {
      const ref = readActivePlan();
      return ref && ref.id === planId ? ref.stopIndex : 0;
    },
    () => 0,
  );

  // Member token (memory-only capability) — needed to post an arrive/skip.
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      const event = planCapabilityEvent(planId);
      window.addEventListener(event, onChange);
      return () => window.removeEventListener(event, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const { token: memberToken } = parsePlanCapabilitySnapshot(capabilitySnapshot);

  useEffect(() => {
    if (!memberToken) void restorePlanCapability(planId).catch(() => undefined);
  }, [memberToken, planId]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Is this plan's night on right now? Recomputed on pointer changes and on a
  // slow tick so the surface retires when the window closes (edges are hours).
  useEffect(() => {
    const recompute = () => {
      const ref = readActivePlan();
      setActiveNow(Boolean(ref && ref.id === planId && isPlanActiveNow(ref, Date.now())));
    };
    recompute();
    const unsub = subscribeActivePlan(recompute);
    const timer = window.setInterval(recompute, 60_000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [planId]);

  // Default surface on mobile while the night is on, unless collapsed this
  // session. Desktop / off-window falls to the inline entry banner.
  useEffect(() => {
    const sync = () => {
      let collapsed = false;
      try {
        collapsed = sessionStorage.getItem(collapseKey) === "1";
      } catch {
        collapsed = false;
      }
      setOpen(activeNow && isMobile && !collapsed);
    };
    sync();
  }, [activeNow, isMobile, collapseKey]);

  // First "here" from PlanCrew (or other engage cues) opens Night Crawl.
  useEffect(() => {
    const onEngage = (event: Event) => {
      const detail = (event as CustomEvent<{ planId?: string }>).detail;
      if (detail?.planId && detail.planId !== planId) return;
      try {
        sessionStorage.removeItem(collapseKey);
      } catch {
        // ignore
      }
      setOpen(true);
    };
    window.addEventListener(NIGHT_CRAWL_ENGAGE_EVENT, onEngage);
    return () => window.removeEventListener(NIGHT_CRAWL_ENGAGE_EVENT, onEngage);
  }, [planId, collapseKey]);

  const showSurface = activeNow && open;

  const engage = useCallback(() => {
    try {
      sessionStorage.removeItem(collapseKey);
    } catch {
      // storage-restricted: the surface still opens for this render
    }
    setOpen(true);
  }, [collapseKey]);

  const collapse = useCallback(() => {
    try {
      sessionStorage.setItem(collapseKey, "1");
    } catch {
      // storage-restricted: it re-opens next mount, acceptable
    }
    setOpen(false);
  }, [collapseKey]);

  const handOffConfirmedStop = useCallback(
    (confirmedPlan: PlanState | undefined, stopPosition: number) => {
      if (!confirmedPlan) return;
      const target = nightCrawlHandoffTarget({
        stops: confirmedPlan.stops,
        actions: confirmedPlan.actions,
        stopPosition,
        outcome: "confirmed",
      });
      if (target === "arrival_required") {
        setNote({
          text: "Check in at one stop before finishing the night.",
          tone: "guidance",
        });
      } else if (target === "ending") {
        // Night Crawl owns Stop actions. The existing Tonight card owns ending
        // choice, completion, and recap, so open that owner after Stop 1..N.
        collapse();
        requestNightModeEndingHandoff(planId);
      }
    },
    [collapse, planId],
  );

  const applyFlushResult = useCallback(
    (result: PlanMutationFlushResult) => {
      if (result.planId !== planId) return;
      if (result.outcome === "confirmed") {
        if (result.plan) setPlan(result.plan);
        setOptimistic((previous) => {
          const next = { ...previous };
          delete next[result.stopPosition];
          return next;
        });
        setNote(null);
        handOffConfirmedStop(result.plan, result.stopPosition);
        return;
      }
      if (result.outcome === "offline") return;
      applyActivePlanFlushRollback(result);
      setOptimistic((previous) => {
        const next = { ...previous };
        delete next[result.stopPosition];
        return next;
      });
      const tone = result.outcome === "conflict" ? "rejected" : result.outcome;
      setNote({
        text: nightCrawlActionNote(result.type, result.venueName, tone),
        tone,
      });
      removePlanMutationOutboxEntry(result.entryId);
    },
    [handOffConfirmedStop, planId],
  );

  // Restore pending hold marks after reload so the advanced cursor stays honest.
  // setState fires from an async callback, never the effect body, so
  // react-hooks/set-state-in-effect stays clean (same rule as AuthProvider).
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const pending = listPlanMutationOutbox(planId).filter((row) => row.status === "pending");
      if (pending.length === 0) return;
      const restored: Record<number, NightCrawlActionType> = {};
      for (const entry of pending) {
        restored[entry.body.stopPosition] = entry.body.type;
      }
      setOptimistic((previous) => ({ ...previous, ...restored }));
      setNote({
        text: "Held on this phone. We will try again when you have signal.",
        tone: "pending",
      });
    });
    return () => {
      active = false;
    };
  }, [planId]);

  // Replay held arrive/skip mutations when signal returns or the surface opens.
  useEffect(() => {
    const flush = () => {
      void flushPlanMutationOutbox({ planId }).then((results) => {
        for (const result of results) applyFlushResult(result);
      });
    };
    flush();
    window.addEventListener("online", flush);
    const unsub = subscribePlanMutationOutbox(flush);
    return () => {
      window.removeEventListener("online", flush);
      unsub();
    };
  }, [planId, showSurface, applyFlushResult]);

  // Refresh the active Plan even while the Crawl overlay is closed. A final
  // action may have confirmed through the site-wide outbox on another route;
  // its canonical action log must still reopen the existing ending owner.
  useEffect(() => {
    if (!activeNow) return;
    let active = true;
    fetch(`/api/plans/${planId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: PlanState | null) => {
        if (active && body && Array.isArray(body.stops)) {
          setPlan(body);
          requestNightModeEndingFromPlan(body);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeNow, planId]);

  const stops = plan.stops;
  const stack = useMemo(
    () => nightCrawlStack(stops, cursor, plan.actions, optimistic),
    [stops, cursor, plan.actions, optimistic],
  );
  const hero = nightCrawlHero(stops, cursor);
  const nextStop = nightCrawlNextStop(stops, cursor);
  const finalStop = isFinalStop(stops, cursor);
  const heroPosition = clampStopIndex(cursor, Math.max(stops.length, 1));
  const glance = nightCrawlGlance({
    currentName: hero?.venueName ?? null,
    nextName: nextStop?.venueName ?? null,
    stopIndex: heroPosition,
    stopCount: stops.length,
  });
  const crewChips = plan.crew
    .map((member: CrewMemberDTO) => ({ member, chip: CREW_CHIP[member.status] }))
    .filter((entry): entry is { member: CrewMemberDTO; chip: NonNullable<(typeof CREW_CHIP)[CrewPresenceStatus]> } => Boolean(entry.chip))
    .slice(0, 5);

  const runAction = useCallback(
    async (type: NightCrawlActionType) => {
      if (busy || !hero) return;
      const stopPosition = hero.position;
      const heroName = hero.venueName;
      const previousCursor = cursor;
      setBusy(type);
      setNote(null);
      // Optimistic: the done row marks and the cursor advances on the same frame.
      const optimisticState = { ...optimistic, [stopPosition]: type };
      const optimisticCursor = advanceNightCrawl(cursor, stops.length);
      setOptimistic(optimisticState);
      setActivePlanStopIndex(optimisticCursor);

      const reconcile = (
        outcome: ReturnType<typeof classifyActionOutcome>,
        queued = false,
      ) => {
        const settled = reconcileNightCrawlAction({
          outcome,
          type,
          venueName: heroName,
          stopPosition,
          previousCursor,
          optimisticCursor,
          optimistic: optimisticState,
          queued,
        });
        setOptimistic(settled.optimistic);
        setActivePlanStopIndex(settled.cursor);
        setNote(settled.note);
      };

      let token = memberToken;
      if (!token) {
        await restorePlanCapability(planId).catch(() => undefined);
        token = parsePlanCapabilitySnapshot(readPlanCapabilitySnapshot(planId)).token;
      }
      if (!token) {
        reconcile("forbidden");
        setBusy(null);
        return;
      }

      const scope = nightCrawlIdempotencyScope(planId, type, stopPosition);
      const payload = nightCrawlActionPayload(type, hero);
      const key = await persistentPlanMutationKey(scope, payload);
      // Fingerprint aligns with the idempotency key scope: same tap, same key.
      const print = `${scope}:${JSON.stringify(payload)}`;

      // Persist intent before the network attempt so reload can replay.
      let queued = false;
      try {
        await enqueueNightCrawlAction({
          planId,
          type,
          stop: hero,
          idempotencyKey: key,
          fingerprint: print,
          previousCursor,
          optimisticCursor,
        });
        queued = true;
      } catch {
        queued = false;
      }

      const flushResults = await flushPlanMutationOutbox({ planId });
      const mine = flushResults.find((row) => row.entryId === scope);
      if (mine?.outcome === "confirmed") {
        clearPersistentPlanMutationKey(scope, key);
        if (mine.plan) setPlan(mine.plan);
        reconcile("confirmed");
        handOffConfirmedStop(mine.plan, stopPosition);
        setBusy(null);
        return;
      }
      if (mine?.outcome === "forbidden" || mine?.outcome === "rejected" || mine?.outcome === "conflict") {
        clearPersistentPlanMutationKey(scope, key);
        reconcile(mine.outcome === "conflict" ? "rejected" : mine.outcome);
        setBusy(null);
        return;
      }

      // Offline or still pending in the outbox.
      const stillQueued = queued && hasPendingPlanMutation(planId, scope);
      reconcile("offline", stillQueued);
      setBusy(null);
    },
    [busy, hero, cursor, stops, memberToken, planId, optimistic, handOffConfirmedStop],
  );

  if (!activeNow) return null;

  if (!showSurface) {
    return (
      <div className="nightCrawl__enter" role="region" aria-label="Night mode">
        <div className="nightCrawl__enterText">
          <p className="nightCrawl__enterKicker">It&rsquo;s on tonight</p>
          <p className="nightCrawl__enterLede">Big buttons, one thumb. Track the crawl and check in as you go.</p>
        </div>
        <button type="button" className="nightCrawl__enterBtn" onClick={engage}>
          Night mode
        </button>
      </div>
    );
  }

  const doneMeta: Record<"arrived" | "skipped" | "none", string> = {
    arrived: "Checked in",
    skipped: "Skipped",
    none: "Behind you",
  };

  return (
    <section className="nightCrawl" aria-label="Night mode" role="dialog" aria-modal="false">
      <div className="nightCrawl__head">
        <div className="nightCrawl__headText">
          <p className="nightCrawl__kicker">{plan.plan.title}</p>
          <p className="nightCrawl__count">
            {stops.length > 0 ? `Stop ${heroPosition + 1} of ${stops.length}` : "No stops yet"}
          </p>
          {stops.length > 0 ? (
            <div className="nightCrawl__progress" aria-hidden="true">
              {stack.map((view) => (
                <span
                  key={`pip-${view.stop.venueId}-${view.index}`}
                  className="nightCrawl__pip"
                  data-state={view.slot === "done" ? "done" : view.slot === "current" ? "now" : "todo"}
                />
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="nightCrawl__exit" onClick={collapse}>
          View full plan
        </button>
      </div>

      <div className="nightCrawl__stack">
        {stack.map((view) => {
          if (view.slot === "done") {
            const disposition = view.disposition ?? "none";
            const mark = disposition === "arrived" ? "✓" : disposition === "skipped" ? "→" : String(view.index + 1);
            return (
              <div key={`done-${view.stop.venueId}`} className="nightCrawl__done" data-disposition={disposition}>
                <span className="nightCrawl__mark" aria-hidden="true">{mark}</span>
                <div className="nightCrawl__doneBody">
                  <div className="nightCrawl__doneName">{view.stop.venueName}</div>
                  <div className="nightCrawl__doneMeta">{doneMeta[disposition]}</div>
                </div>
                <span className="nightCrawl__idx">{String(view.index + 1).padStart(2, "0")}</span>
              </div>
            );
          }

          if (view.slot === "current") {
            return (
              <div key={`hero-${view.stop.venueId}`} className="nightCrawl__hero">
                <div className="nightCrawl__glance" aria-label="Tonight at a glance">
                  <p className="nightCrawl__glanceNow">{glance.currentLine}</p>
                  {glance.nextLine ? <p className="nightCrawl__glanceNext">{glance.nextLine}</p> : null}
                  <a className="nightCrawl__glanceHome" href={TFL_JOURNEY_PLANNER} target="_blank" rel="noreferrer">
                    {glance.homeLine}
                  </a>
                </div>
                <p className="nightCrawl__eyebrow">{finalStop ? "Last stop · head here" : "Next up · head here"}</p>
                <h2 className="nightCrawl__heroName">{view.stop.venueName}</h2>

                {crewChips.length > 0 ? (
                  <div className="nightCrawl__crew">
                    <p className="nightCrawl__crewLabel">Who is where</p>
                    <div className="nightCrawl__crewRow">
                      {crewChips.map(({ member, chip }) => (
                        <span key={member.id} className="nightCrawl__who" data-tone={chip.tone}>
                          <span className="nightCrawl__ava" aria-hidden="true">{initial(member.name)}</span>
                          {member.name} <span className="nightCrawl__whoState">{chip.label}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="nightCrawl__spacer" />

                <div className="nightCrawl__actions">
                  <button
                    type="button"
                    className="nightCrawl__arrive"
                    onClick={() => void runAction("arrived")}
                    disabled={busy !== null}
                  >
                    We are here
                    <small>{finalStop ? "check in the last stop" : `check in stop ${heroPosition + 1}`}</small>
                  </button>
                  <button
                    type="button"
                    className="nightCrawl__skip"
                    onClick={() => void runAction("skipped")}
                    disabled={busy !== null}
                  >
                    Skip it
                    <small>{finalStop ? "wrap the crawl" : "jump to the next"}</small>
                  </button>
                </div>

                {note ? (
                  <p className="nightCrawl__note" data-tone={note.tone} role="status" aria-live="polite">
                    {note.text}
                  </p>
                ) : null}
              </div>
            );
          }

          return (
            <div key={`up-${view.stop.venueId}`} className="nightCrawl__upcoming">
              <span className="nightCrawl__mark" aria-hidden="true">{view.index + 1}</span>
              <div className="nightCrawl__upcomingName">{view.stop.venueName}</div>
            </div>
          );
        })}

        {stops.length === 0 ? (
          <p className="nightCrawl__final">This plan has no stops yet. Open the full plan to build the route.</p>
        ) : null}
      </div>

      <a className="nightCrawl__escape" href={TFL_JOURNEY_PLANNER} target="_blank" rel="noreferrer">
        <span aria-hidden="true">&#9166;</span> Get me home
        <small>last train + cab</small>
      </a>
    </section>
  );
}
