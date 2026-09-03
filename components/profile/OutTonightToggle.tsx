"use client";

// The You page's "out tonight" toggle. One flip: on or off, with an optional
// area (never a coordinate) - a plain "we're out" check-in (lib/checkIn.ts)
// with no note, visibility 'friends'. Reads GET /api/check-ins?viewer=<handle>
// to show the current state, and writes POST/DELETE /api/check-ins to flip
// it - always through the check-in stack on the server (lib/socialFeed.ts for
// reads), never a direct table read. Visible only to mutual follows; there is
// no public or nearby view of this anywhere in the app. Turning off ends
// every check-in the handle currently has - the same "we're out" state the
// /we-are-out page reads and writes.

import { useEffect, useState } from "react";

import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { trackEvent } from "@/lib/analytics";
import { getNightArea, tryGetNightArea, NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import OutTonightPlanCta from "@/components/profile/OutTonightPlanCta";
import "./outTonightBeacon.css";
import { authedActionFetch } from "@/lib/authedFetch";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

type Props = {
  /** The signed-in owner's handle (already known - this only renders on your own profile). */
  handle: string;
};

type State =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "on"; areaSlug: NightAreaSlug | null }
  | { kind: "error" };

const AREA_OPTIONS = NIGHT_AREA_SLUGS.map((slug) => ({ slug, name: getNightArea(slug).name }));

type CheckInDto = { handle?: string; areaSlug?: string | null };

export default function OutTonightToggle({ handle }: Props) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [areaChoice, setAreaChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState("");

  useEffect(() => {
    if (!socialFriendsLaunchEnabled || !handle) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/check-ins?viewer=${encodeURIComponent(handle)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          discardBody(res);
          throw new Error(`check-ins ${res.status}`);
        }
        const body = (await res.json()) as { checkIns?: CheckInDto[] };
        const mine = normalizeHandle(handle);
        const active = (body.checkIns ?? []).find((c) => normalizeHandle(c.handle ?? "") === mine);
        if (active) {
          setState({ kind: "on", areaSlug: (active.areaSlug as NightAreaSlug) ?? null });
        } else {
          setState({ kind: "off" });
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, [handle, socialFriendsLaunchEnabled]);

  async function turnOn() {
    setBusy(true);
    setWriteError("");
    try {
      const res = await authedActionFetch("/api/check-ins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, areaSlug: areaChoice || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        checkIn?: { areaSlug?: string | null };
      };
      if (!res.ok) throw new Error(errorMessageFrom(body, "That didn't send. Give it another go."));
      trackEvent("out_tonight_beacon_on");
      setState({ kind: "on", areaSlug: (body.checkIn?.areaSlug as NightAreaSlug) ?? null });
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "That didn't send. Give it another go.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setWriteError("");
    try {
      const res = await authedActionFetch("/api/check-ins", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(errorMessageFrom(body, "That didn't send. Give it another go."));
      trackEvent("out_tonight_beacon_off");
      setState({ kind: "off" });
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "That didn't send. Give it another go.");
    } finally {
      setBusy(false);
    }
  }

  if (!socialFriendsLaunchEnabled) return null;

  if (state.kind === "loading") {
    return (
      <section className="beaconCard" aria-labelledby="beacon-title" aria-busy="true">
        <p className="beaconKicker" id="beacon-title">Out tonight</p>
        <p className="beaconMuted">Checking whether you&rsquo;re out tonight&hellip;</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="beaconCard" aria-labelledby="beacon-title">
        <p className="beaconKicker" id="beacon-title">Out tonight</p>
        <p className="beaconMuted">Couldn&rsquo;t load your out tonight status right now.</p>
      </section>
    );
  }

  if (state.kind === "on") {
    const areaName = tryGetNightArea(state.areaSlug)?.name ?? null;
    return (
      <section className="beaconCard" aria-labelledby="beacon-title">
        <p className="beaconKicker" id="beacon-title">Out tonight</p>
        <p className="beaconOnLine">
          {areaName ? `You’re out tonight in ${areaName}.` : "You’re out tonight."}
        </p>
        <p className="beaconPrivacy">
          Only your crew can see this. It switches off on its own in twelve hours.
        </p>
        <OutTonightPlanCta variant="self" />
        {writeError ? (
          <p className="beaconError" role="alert">{writeError}</p>
        ) : null}
        <button type="button" className="beaconButton beaconButtonOff" disabled={busy} onClick={turnOff}>
          {busy ? "Turning off…" : "Turn off"}
        </button>
      </section>
    );
  }

  return (
    <section className="beaconCard" aria-labelledby="beacon-title">
      <p className="beaconKicker" id="beacon-title">Out tonight</p>
      <label className="beaconField">
        <span className="beaconLabel">
          Area <span className="beaconOptional">(optional)</span>
        </span>
        <select
          className="beaconSelect"
          value={areaChoice}
          onChange={(e) => setAreaChoice(e.target.value)}
        >
          <option value="">No area named</option>
          {AREA_OPTIONS.map((area) => (
            <option key={area.slug} value={area.slug}>{area.name}</option>
          ))}
        </select>
      </label>
      <p className="beaconPrivacy">
        Only your crew can see this. No exact location. It switches off on its own in twelve hours.
      </p>
      {writeError ? (
        <p className="beaconError" role="alert">{writeError}</p>
      ) : null}
      <button type="button" className="beaconButton" disabled={busy} onClick={turnOn}>
        {busy ? "Turning on…" : "Turn on out tonight"}
      </button>
    </section>
  );
}
