"use client";

// Confirm-follow sheet (Social Loop v1). The target of a shared "add me" link:
// /add/<handle>. It opens on a friend's card and adds them to your lot. A LOT
// is mutual - the copy says so - so this follows them, and you become each
// other's lot once they add you back.
//
// AN ADD NEEDS AN ACCOUNT. This surface used to take the device's
// `pubmax_handle` as the adder, so a browser that had once carried somebody
// else's handle could add a friend under that name, and a stranger following a
// share link met a claim form rather than a way in. Now a signed-out visitor
// gets ONE primary action - make an account - and the add-link path rides
// through sign-up and sign-in as `?auto=1`, so the add lands by itself on the
// way back. `lib/addLink.ts` owns the doors, the one-shot predicate and the
// copy; this file only renders them.
//
// When the link is the VIEWER's own handle, this becomes the share surface
// instead: copy / share your link so friends at the table can add you.

import Link from "next/link";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import HandleAvatar from "@/components/profile/HandleAvatar";
import { trackEvent } from "@/lib/analytics";
import {
  ADD_LINK_COPY,
  ADD_LINK_RECEIPT_BODY,
  ADD_LINK_SURFACE,
  addLinkCreateCta,
  addLinkDoors,
  addLinkNextSteps,
  addLinkReceiptTitle,
  addLinkReturnTo,
  consumeAddLinkDoorTaken,
  markAddLinkDoorTaken,
  peekAddLinkDoorTaken,
  shouldAutoAdd,
} from "@/lib/addLink";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { socialBoundaryCopy } from "@/lib/socialLaunch";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

// `gone` is a REFUSAL and `error` is a fault: the target is not there any more,
// so the add button leaves with it rather than inviting a retry that cannot land.
type FollowState = "idle" | "working" | "done" | "error" | "gone";
type FollowResult = {
  state: FollowState;
  error: string;
};
type AccountFollowResults = Record<string, FollowResult>;

function setAccountFollowResult(
  setResults: Dispatch<SetStateAction<AccountFollowResults>>,
  accountId: string,
  result: FollowResult,
): void {
  setResults((current) => ({ ...current, [accountId]: result }));
}

/**
 * The one write this surface makes, outside the component so the button and the
 * add-on-arrival share it without a memoized closure between them. The server
 * write is idempotent (lib/followWrite.server.ts); the ONCE guard is the ref in
 * the component.
 */
async function performAdd(
  target: string,
  adder: string,
  accountId: string,
  setResults: Dispatch<SetStateAction<AccountFollowResults>>,
): Promise<void> {
  setAccountFollowResult(setResults, accountId, { state: "working", error: "" });
  try {
    const res = await authedActionFetch(`/api/profiles/${encodeURIComponent(target)}/follow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ follower: adder }),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 404) {
      setAccountFollowResult(setResults, accountId, {
        state: "gone",
        error: errorMessageFrom(data, ADD_LINK_COPY.targetGone),
      });
      trackEvent("add_link_added", { surface: ADD_LINK_SURFACE, outcome: "unavailable" });
      return;
    }
    if (!res.ok) throw new Error(errorMessageFrom(data, "Could not add them."));
    setAccountFollowResult(setResults, accountId, { state: "done", error: "" });
    trackEvent("add_link_added", { surface: ADD_LINK_SURFACE, outcome: "added" });
  } catch (err) {
    setAccountFollowResult(setResults, accountId, {
      state: "error",
      error: err instanceof Error ? err.message : "Network error. Try again.",
    });
    trackEvent("add_link_added", { surface: ADD_LINK_SURFACE, outcome: "failed" });
  }
}

export default function ConfirmFollow({
  targetHandle,
  targetAvatarUrl,
  targetName,
  auto = false,
}: {
  targetHandle: string;
  targetAvatarUrl?: string;
  targetName?: string;
  /** `?auto=1`: the person already chose this add before making an account. */
  auto?: boolean;
}) {
  const target = normalizeHandle(targetHandle);
  const { user, identityResolved } = useAuth();
  const viewerHandle = useViewerHandle();
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const accountId = user?.id ?? null;
  const [followResults, setFollowResults] = useState<AccountFollowResults>({});
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState("");
  const attemptedAccountIds = useRef(new Set<string>());

  const hasAccount = Boolean(accountId);
  const ownedResult = accountId ? followResults[accountId] : null;
  const state = ownedResult?.state ?? "idle";
  const error = ownedResult?.error ?? "";
  const isSelf =
    identityResolved &&
    hasAccount &&
    Boolean(viewerHandle) &&
    normalizeHandle(viewerHandle ?? "") === target;
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/add/${target}` : `/add/${target}`;
  const doors = addLinkDoors(target);
  const inviteReturnTo = addLinkReturnTo(target);
  const claimHref = inviteReturnTo
    ? `/u/you?returnTo=${encodeURIComponent(inviteReturnTo)}`
    : "/u/you";
  const name = (targetName ?? "").trim();

  // One door marker per target, on the device rather than the tab, so the
  // magic-link tab a sign-up finishes in still counts as this journey's return.
  const takeDoor = () =>
    markAddLinkDoorTaken(
      typeof window === "undefined" ? null : window.localStorage,
      Date.now(),
      target,
    );

  const addToLot = (adder: string) => {
    if (!accountId) return Promise.resolve();
    return performAdd(target, adder, accountId, setFollowResults);
  };

  useEffect(() => {
    if (!target) return;
    trackEvent("add_link_viewed", { surface: ADD_LINK_SURFACE });
  }, [target]);

  // The add on arrival. The server write is idempotent (lib/followWrite.server),
  // so a repeat costs nothing; the ref keeps each account from asking twice.
  useEffect(() => {
    const storage = typeof window === "undefined" ? null : window.localStorage;
    const now = Date.now();
    if (
      !socialFriendsLaunchEnabled ||
      !viewerHandle ||
      !accountId ||
      !shouldAutoAdd({
        auto,
        accountId,
        identityResolved,
        viewerHandle,
        target,
        attemptedAccountIds: attemptedAccountIds.current,
        doorTaken: peekAddLinkDoorTaken(storage, now, target),
      })
    ) {
      return;
    }
    consumeAddLinkDoorTaken(storage, now, target);
    attemptedAccountIds.current.add(accountId);
    void performAdd(target, viewerHandle, accountId, setFollowResults);
  }, [accountId, auto, identityResolved, socialFriendsLaunchEnabled, target, viewerHandle]);

  async function share() {
    setShareError("");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Add me on PUBMAXX", url: shareUrl });
        return;
      }
    } catch {
      // Share sheet dismissed / unavailable — fall through to clipboard.
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
      setShareError(
        offlineOrMessage("Could not share your link. Try again.")
      );
    }
  }

  if (!target) {
    return (
      <section className="confirmFollow">
        <p className="confirmFollowError">That link is missing a handle.</p>
        <Link className="confirmFollowGhost" href="/social">
          Back to Social
        </Link>
      </section>
    );
  }

  if (!socialFriendsLaunchEnabled) {
    return (
      <section className="confirmFollow" role="status">
        <p className="confirmFollowEyebrow">Social</p>
        <h1 className="confirmFollowTitle">{socialBoundaryCopy("preview", false)}</h1>
        <Link className="confirmFollowGhost" href="/social">
          Back to Social
        </Link>
      </section>
    );
  }

  const card = (
    <>
      <HandleAvatar
        handle={target}
        avatarUrl={targetAvatarUrl}
        className="confirmFollowAvatar"
        imageClassName="confirmFollowAvatar"
        size={56}
      />
      <p className="confirmFollowEyebrow">{ADD_LINK_COPY.eyebrow}</p>
      <h1 className="confirmFollowTitle">Add {name || displayHandle(target)}?</h1>
      {name ? <p className="confirmFollowMeta">{displayHandle(target)}</p> : null}
    </>
  );

  // The session has not answered yet. Nobody is named and no door is offered:
  // guessing signed-out here is what would flash a sign-up form at somebody who
  // is already signed in.
  if (!identityResolved) {
    return (
      <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`} aria-busy="true">
        {card}
        <p className="confirmFollowBody">{ADD_LINK_COPY.checking}</p>
      </section>
    );
  }

  // Self link → the share surface.
  if (isSelf) {
    return (
      <section className="confirmFollow" aria-label="Share your add link">
        <p className="confirmFollowEyebrow">{ADD_LINK_COPY.eyebrow}</p>
        <h1 className="confirmFollowTitle">Share your link</h1>
        <p className="confirmFollowBody">
          This is your add link. Share it at the table. When a friend opens it and
          adds you, and you add them back, you&rsquo;re each other&rsquo;s lot.
        </p>
        <code className="confirmFollowUrl">{shareUrl}</code>
        <button type="button" className="confirmFollowPrimary" onClick={share}>
          {copied ? "Link copied" : "Share your link"}
        </button>
        {shareError ? <p className="confirmFollowError" role="status">{shareError}</p> : null}
        <Link className="confirmFollowGhost" href="/social">
          Back to Social
        </Link>
      </section>
    );
  }

  if (state === "done") {
    return (
      <section className="confirmFollow" role="status">
        <p className="confirmFollowEyebrow">{ADD_LINK_COPY.eyebrow}</p>
        <h1 className="confirmFollowTitle">{addLinkReceiptTitle(target, name)}</h1>
        <p className="confirmFollowBody">{ADD_LINK_RECEIPT_BODY}</p>
        <ul className="confirmFollowNext">
          {addLinkNextSteps(target).map((step, index) => (
            <li key={step.href}>
              <Link
                className={index === 0 ? "confirmFollowPrimary" : "confirmFollowSecondary"}
                href={step.href}
              >
                {step.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const errorLine =
    (state === "error" || state === "gone") && error ? (
      <p className="confirmFollowError" role="alert">
        {error}
      </p>
    ) : null;

  // No account. ONE primary action, and the sign-in door under it. Both carry
  // this add link, so the add lands by itself on the way back.
  if (!hasAccount && doors) {
    return (
      <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`}>
        {card}
        <p className="confirmFollowBody">{ADD_LINK_COPY.accountNeeded}</p>
        <Link
          className="confirmFollowPrimary"
          href={doors.createHref}
          onClick={() => {
            takeDoor();
            trackEvent("add_link_signup_started", {
              surface: ADD_LINK_SURFACE,
              outcome: "create",
            });
          }}
        >
          {addLinkCreateCta(target, name)}
        </Link>
        <Link
          className="confirmFollowSecondary"
          href={doors.signInHref}
          onClick={() => {
            takeDoor();
            trackEvent("add_link_signup_started", {
              surface: ADD_LINK_SURFACE,
              outcome: "signin",
            });
          }}
        >
          {ADD_LINK_COPY.secondaryCta}
        </Link>
        <Link className="confirmFollowGhost" href="/social">
          Not now
        </Link>
      </section>
    );
  }

  // An account with no handle yet. The claim surface carries the same return.
  if (!viewerHandle) {
    return (
      <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`}>
        {card}
        <p className="confirmFollowBody">{ADD_LINK_COPY.handleNeeded}</p>
        {errorLine}
        <Link
          className="confirmFollowPrimary"
          href={claimHref}
          onClick={takeDoor}
        >
          {ADD_LINK_COPY.handleCta}
        </Link>
        <Link className="confirmFollowGhost" href="/social">
          Not now
        </Link>
      </section>
    );
  }

  return (
    <section className="confirmFollow" aria-label={`Add ${displayHandle(target)}`}>
      {card}
      {state === "gone" ? null : (
        <p className="confirmFollowBody">
          {state === "working" ? ADD_LINK_COPY.adding : ADD_LINK_COPY.signedIn}
        </p>
      )}
      {errorLine}
      {state === "gone" ? null : (
        <button
          type="button"
          className="confirmFollowPrimary"
          disabled={state === "working"}
          onClick={() => void addToLot(viewerHandle)}
        >
          {state === "working" ? "Adding." : `Add ${displayHandle(target)}`}
        </button>
      )}
      <Link className="confirmFollowGhost" href="/social">
        Not now
      </Link>
    </section>
  );
}
