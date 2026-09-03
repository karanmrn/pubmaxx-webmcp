"use client";

// The warm second after a sign-in lands. One line, no decisions, no chrome to
// dismiss before the page is usable. Mounted once at the app root beside
// AccountOnboarding (components/auth/AuthProvider.tsx).
//
// It is deliberately NOT a dialog. It has no backdrop, no aria-modal, no focus
// trap and no blocking layer, because the failure this replaces was exactly
// that: a root-mounted modal that covered every tab until React state cleared
// it. This is a polite live region that names the person and then leaves.
//
// It shows only for an account that already owns a handle. An account still
// choosing one meets the claim step instead, so the two never stack.

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import FoundersDiscordLink from "@/components/founding/FoundersDiscordLink";
import { useFoundingMembership } from "@/components/founding/useFoundingMembership";
import {
  ARRIVAL_WELCOME_HANDLE_WAIT_MS,
  ARRIVAL_WELCOME_VISIBLE_MS,
  arrivalWelcomeLine,
  clearArrival,
  peekArrival,
  type ArrivalIntent,
} from "@/lib/arrivalWelcome";
import {
  FOUNDERS_WELCOME_VISIBLE_MS,
  foundersWelcomeShown,
  markFoundersWelcomeShown,
} from "@/lib/foundingMembers";

import "./arrivalWelcome.css";

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// The founders marker outlives the tab: "once ever" is not "once per tab".
function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ArrivalWelcomeLine({
  line,
  leaving,
  onDismiss,
  door,
}: {
  line: string;
  leaving: boolean;
  onDismiss: () => void;
  /** The founders' door, shown once ever and only to a founding member. */
  door?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="arrivalWelcome"
      data-leaving={leaving ? "" : undefined}
      data-founding={door ? "" : undefined}
    >
      <p className="arrivalWelcomeLine" role="status" aria-live="polite">
        {line}
      </p>
      {door ? <div className="arrivalWelcomeDoor">{door}</div> : null}
      <button
        type="button"
        className="arrivalWelcomeDismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export default function ArrivalWelcome(): React.JSX.Element | null {
  const { user, handle } = useAuth();
  const membership = useFoundingMembership();
  const [intent, setIntent] = useState<ArrivalIntent | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [door, setDoor] = useState(false);
  const shown = useRef(false);
  const doorShown = useRef(false);

  // Check the one-shot marker once the handle lookup answers. Reading it is
  // cheap and side-effect free; the marker is only consumed once the line can
  // actually be written, or once the wait is spent.
  //
  // The check runs from a timer rather than the effect body because
  // react-hooks/set-state-in-effect is an error in this codebase: a synchronous
  // setState here would cascade a second render on every auth change.
  useEffect(() => {
    if (shown.current || !user) return;
    const check = window.setTimeout(() => {
      const storage = tabStorage();
      if (!peekArrival(storage, Date.now())) return;
      if (!handle) return;
      shown.current = true;
      const pending = peekArrival(storage, Date.now());
      clearArrival(storage);
      if (pending) setIntent(pending);
    }, 0);
    const giveUp = window.setTimeout(() => {
      if (!shown.current) clearArrival(tabStorage());
    }, ARRIVAL_WELCOME_HANDLE_WAIT_MS);
    return () => {
      window.clearTimeout(check);
      window.clearTimeout(giveUp);
    };
  }, [handle, user]);

  // The founders' door, opened once ever. It waits for the LIVE session to say
  // this account holds a number, so a device cache can never open it for the
  // wrong person, and the marker it writes carries the number itself: a second
  // founding account signing in on this browser still meets its own welcome.
  //
  // A person who is not a founding member reaches none of this. There is no
  // else branch here on purpose.
  useEffect(() => {
    if (!intent || doorShown.current || membership.state !== "member") return;
    const number = membership.number;
    const open = window.setTimeout(() => {
      const storage = deviceStorage();
      if (foundersWelcomeShown(storage, number)) return;
      doorShown.current = true;
      markFoundersWelcomeShown(storage, number);
      setDoor(true);
    }, 0);
    return () => window.clearTimeout(open);
  }, [intent, membership]);

  const dismiss = useCallback(() => {
    setLeaving(true);
  }, []);

  // Retire on its own. The exit is shorter than the entrance: the system is
  // responding, not deciding. A greeting carrying the founders' door stays
  // longer, because it now holds something the person may want to tap, and a
  // link that leaves before it can be read is worse than no link.
  useEffect(() => {
    if (!intent || leaving) return;
    const timer = window.setTimeout(
      () => setLeaving(true),
      door ? FOUNDERS_WELCOME_VISIBLE_MS : ARRIVAL_WELCOME_VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [door, intent, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => {
      setIntent(null);
      setLeaving(false);
      setDoor(false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!intent || !handle) return null;
  const line = arrivalWelcomeLine(intent, handle);
  if (!line) return null;

  return (
    <ArrivalWelcomeLine
      line={line}
      leaving={leaving}
      onDismiss={dismiss}
      door={door ? <FoundersDiscordLink onOpen={dismiss} /> : undefined}
    />
  );
}
