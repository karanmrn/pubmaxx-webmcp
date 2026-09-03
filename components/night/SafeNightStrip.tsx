"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

// Safe Night strip (U21a / U5). A small, calm safety section that sits with
// the get-home flow: Night Mode (plan link) or the venue Getting Home tab
// (pin share, no plan id, no Night Mode). It is not a lecture and not a
// warning wall: quiet, useful lines a Londoner already half-knows, kept one
// tap away and dismissible for the night. NightCalm register: reassuring,
// plain, never fear-mongering, never colours-of-alarm.
//
// Persisted "hide for tonight" lives in sessionStorage (gone next session,
// kept while you browse). Plan mounts key per plan id; the venue Getting Home
// mount uses one shared getting-home scope so one hide covers the map sheet.
// Fully keyboard reachable, 44px targets, 12px+ type, reduced-motion safe.

import { useEffect, useId, useRef, useState } from "react";
import { LifeBuoy, ChevronDown, Share2, Phone } from "lucide-react";

import type { CityId } from "@/lib/cities";
import { isPlanId } from "@/lib/plan";
import { venueMapUrl } from "@/lib/venueMapUrl";

import "./safeNightStrip.css";

export const SAFE_NIGHT_DISMISS_PREFIX = "pubmax:safe-night-dismissed:v1:";
/** Session scope for the plan-less Getting Home mount. */
export const SAFE_NIGHT_GETTING_HOME_SCOPE = "getting-home";
const TFL_JOURNEY_PLANNER = "https://tfl.gov.uk/plan-a-journey/";

export type SafeNightVenueShare = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

export type SafeNightStripProps = {
  /** Night Mode plan share. When set, share uses /plan/:id. */
  planId?: string;
  /** Venue pin share for Getting Home when no plan is active. */
  venue?: SafeNightVenueShare;
  /** Tailors the transport line (TfL link is London-only). */
  cityId?: CityId;
};

export function safeNightDismissKey(scope: string): string {
  return `${SAFE_NIGHT_DISMISS_PREFIX}${scope}`;
}

function hasSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.sessionStorage;
  } catch {
    return false;
  }
}

export function resolveSafeNightDismissScope(
  planId: string | undefined,
): string | null {
  if (planId && isPlanId(planId)) return planId;
  if (!planId) return SAFE_NIGHT_GETTING_HOME_SCOPE;
  return null;
}

export function readSafeNightDismissed(scope: string): boolean {
  if (!hasSession() || !scope) return false;
  try {
    return window.sessionStorage.getItem(safeNightDismissKey(scope)) === "1";
  } catch {
    return false;
  }
}

export function writeSafeNightDismissed(scope: string): void {
  if (!hasSession() || !scope) return;
  try {
    window.sessionStorage.setItem(safeNightDismissKey(scope), "1");
  } catch {
    // ignore
  }
}

export function SafeNightStrip({ planId, venue, cityId }: SafeNightStripProps) {
  const scope = resolveSafeNightDismissScope(planId);
  const bodyId = useId();
  // Night Mode mounts with next/dynamic ssr:false. Getting Home usually mounts
  // on a client tab switch. When sessionStorage is present, read dismiss on
  // first paint so a hide sticks without a flash; true SSR (no window) stays
  // visible and never claims a hide it cannot check.
  const [dismissed, setDismissed] = useState(() =>
    scope ? readSafeNightDismissed(scope) : true,
  );
  const [open, setOpen] = useState(true);
  const [shareNote, setShareNote] = useState("");

  const shareNoteTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (shareNoteTimer.current) window.clearTimeout(shareNoteTimer.current);
    },
    [],
  );

  const flashShareNote = (message: string) => {
    setShareNote(message);
    if (shareNoteTimer.current) window.clearTimeout(shareNoteTimer.current);
    shareNoteTimer.current = window.setTimeout(() => setShareNote(""), 4000);
  };

  const sharePlan = async () => {
    if (typeof window === "undefined" || !planId || !isPlanId(planId)) return;
    const url = `${window.location.origin}/plan/${planId}`;
    const shareData = { title: "My night out", text: "Here's where I am tonight.", url };
    const nav = window.navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    try {
      if (typeof nav.share === "function") {
        await nav.share(shareData);
        return;
      }
    } catch {
      // User cancelled the share sheet, or it failed — fall through to copy.
    }
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await window.navigator.clipboard.writeText(url);
      flashShareNote("Plan link copied. Send it to someone at home.");
    } catch {
      flashShareNote(
        offlineOrMessage("Copy the plan link from your browser bar and send it on.")
      );
    }
  };

  const shareVenue = async () => {
    if (typeof window === "undefined" || !venue) return;
    const url = new URL(venueMapUrl(venue.id), window.location.origin).toString();
    const shareData = {
      title: venue.name,
      text: `I'm at ${venue.name}.`,
      url,
    };
    const nav = window.navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    try {
      if (typeof nav.share === "function") {
        await nav.share(shareData);
        return;
      }
    } catch {
      // User cancelled the share sheet, or it failed — fall through to copy.
    }
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await window.navigator.clipboard.writeText(url);
      flashShareNote("Pin link copied. Send it to someone at home.");
    } catch {
      flashShareNote(
        offlineOrMessage("Copy the pin link and send it to someone at home.")
      );
    }
  };

  if (!scope || dismissed) return null;

  const isPlanShare = Boolean(planId && isPlanId(planId));
  const canShareVenue = Boolean(venue && Number.isFinite(venue.latitude) && Number.isFinite(venue.longitude));
  const showShare = isPlanShare || canShareVenue;
  const londonTransport = cityId === "london" || (!cityId && !isPlanShare);

  return (
    <section className="nightSafe" aria-label="Look after each other">
      <button
        type="button"
        className="nightSafe__head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <span className="nightSafe__title">
          <LifeBuoy size={15} aria-hidden="true" />
          Look after each other
        </span>
        <ChevronDown className="nightSafe__chevron" size={16} aria-hidden="true" data-open={open ? "" : undefined} />
      </button>

      {open ? (
        <div className="nightSafe__body" id={bodyId}>
          <p className="nightSafe__line">
            Keep an eye on your drink. If you feel suddenly off, tell your mates and the bar staff.
          </p>
          <p className="nightSafe__line">
            <a className="nightSafe__tel" href="tel:999">
              <Phone size={13} aria-hidden="true" /> 999
            </a>{" "}
            for emergencies.{" "}
            <a className="nightSafe__tel" href="tel:116123">
              <Phone size={13} aria-hidden="true" /> 116 123
            </a>{" "}
            for Samaritans, any time.
          </p>
          {!isPlanShare ? (
            <p className="nightSafe__line">
              {londonTransport ? (
                <>
                  Live trains and buses for this pin sit above.{" "}
                  <a
                    className="nightSafe__link"
                    href={TFL_JOURNEY_PLANNER}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Plan a journey on TfL
                  </a>
                  .
                </>
              ) : (
                "Getting-home times for this pin sit above."
              )}
            </p>
          ) : null}
          <p className="nightSafe__line">
            {isPlanShare
              ? "Share your live plan link with someone who is not out tonight."
              : "Share this pin with someone who is not out tonight."}
          </p>

          <div className="nightSafe__actions">
            {showShare ? (
              <button
                type="button"
                className="nightSafe__share"
                onClick={() => void (isPlanShare ? sharePlan() : shareVenue())}
              >
                <Share2 size={15} aria-hidden="true" />
                {isPlanShare ? "Share plan link" : "Share this pin"}
              </button>
            ) : null}
            <button
              type="button"
              className="nightSafe__hide"
              onClick={() => {
                writeSafeNightDismissed(scope);
                setDismissed(true);
              }}
            >
              Hide for tonight
            </button>
          </div>
          {shareNote ? (
            <p className="nightSafe__note" role="status">
              {shareNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default SafeNightStrip;
