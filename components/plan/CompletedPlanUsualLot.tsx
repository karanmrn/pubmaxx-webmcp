"use client";

// Crew Night Loop S1 — completed-plan handoff to the next night.
// When a plan is finished and the usual lot is on file, nudge the host
// toward /plan without re-opening the old invite panel.

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { trackEvent } from "@/lib/analytics";
import {
  nextNightCommittedProps,
  readLastCrew,
  subscribeLastCrew,
} from "@/lib/lastCrew";

export default function CompletedPlanUsualLot() {
  const crew = useSyncExternalStore(subscribeLastCrew, readLastCrew, () => null);
  if (!crew || crew.names.length < 2) return null;

  return (
    <section className="lastCrewInvite" aria-label="Plan another night with your lot">
      <p className="lastCrewInvite__lede">
        Same lot again: <strong>{crew.names.join(", ")}</strong>
      </p>
      <Link
        href="/plan"
        className="lastCrewInvite__cta pressable"
        onClick={() => {
          trackEvent("next_night_committed", nextNightCommittedProps("completed_plan", crew));
        }}
      >
        Plan another night with them
      </Link>
    </section>
  );
}
