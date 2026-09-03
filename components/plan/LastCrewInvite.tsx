"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

// Sort My Night P1 — persistent crew re-invite MVP.
// Surfaces the usual lot remembered from the last plan and shares a
// WhatsApp-first message that names them + the current plan link.
// The shared URL must carry #invite= (classic token) so mates can join.

import { useState, useSyncExternalStore } from "react";

import { trackEvent } from "@/lib/analytics";
import {
  buildLastCrewShareText,
  nextNightCommittedProps,
  readLastCrew,
  subscribeLastCrew,
} from "@/lib/lastCrew";
import { planCrewSharePath } from "@/lib/planCrewInviteUrl";
import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
import { shareNightObject } from "@/lib/shareSheet";

type LastCrewInviteProps = {
  planId: string;
  planTitle: string;
};

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

export default function LastCrewInvite({
  planId,
  planTitle,
}: LastCrewInviteProps) {
  const crew = useSyncExternalStore(subscribeLastCrew, readLastCrew, () => null);
  const [status, setStatus] = useState("");
  const tokenEvent = planCapabilityEvent(planId);
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => window.removeEventListener(tokenEvent, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const { token: memberToken } = parsePlanCapabilitySnapshot(capabilitySnapshot);

  if (!crew || crew.names.length < 2) return null;
  // Don't nudge re-invite for the same plan that produced the roster.
  if (crew.sourcePlanId && crew.sourcePlanId === planId) return null;

  const rosterNames = crew.names;

  async function handleInvite() {
    if (!crew) return;
    if (!memberToken) {
      try {
        await restorePlanCapability(planId);
      } catch {
        setStatus("Sign back in on this plan before inviting the usual lot.");
        return;
      }
    }
    const projection = await fetch(`/api/plans/${planId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null) as { inviteToken?: string | null } | null;
    const inviteToken = typeof projection?.inviteToken === "string" ? projection.inviteToken : null;
    if (!inviteToken) {
      setStatus("Invite link not ready yet. Try again in a moment.");
      return;
    }
    const relativeUrl = planCrewSharePath(planId, inviteToken);
    const absoluteUrl = toAbsoluteUrl(relativeUrl);
    const message = buildLastCrewShareText({
      names: rosterNames,
      planUrl: absoluteUrl,
      title: planTitle,
    });
    const outcome = await shareNightObject({
      title: planTitle,
      text: message,
      url: absoluteUrl,
    });
    if (outcome === "shared" || outcome === "whatsapp") {
      trackEvent("plan_invite_sent", { channel: outcome === "whatsapp" ? "whatsapp" : "native" });
      trackEvent("next_night_committed", nextNightCommittedProps("crew-reinvite", crew));
      setStatus("Invite ready for the usual lot.");
    } else if (outcome === "failed") {
      try {
        await navigator.clipboard.writeText(message);
        trackEvent("plan_invite_sent", { channel: "copy" });
        trackEvent("next_night_committed", nextNightCommittedProps("crew-reinvite", crew));
        setStatus("Invite copied. Paste it to the usual lot.");
      } catch {
        setStatus(
          offlineOrMessage("Could not copy invite. Try again.")
        );
      }
    }
  }

  return (
    <section className="lastCrewInvite" aria-label="Invite the usual lot">
      <p className="lastCrewInvite__lede">
        Usual lot: <strong>{crew.names.join(", ")}</strong>
      </p>
      <button
        type="button"
        className="lastCrewInvite__cta pressable"
        onClick={() => void handleInvite()}
      >
        Invite the usual lot
      </button>
      {status ? (
        <p className="lastCrewInvite__status" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
