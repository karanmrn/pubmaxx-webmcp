// The share-link add surface (/add/<handle>), as a policy rather than a screen.
//
// THE RULE this file exists to keep: an add link is a growth link, so the
// person opening it must end up with an ACCOUNT. Reading the device handle out
// of localStorage was the old bar, and it let a browser that had once carried
// somebody else's handle add a friend under that name. So the surface asks for
// an account first, carries the add-link path through sign-up and sign-in, and
// performs the add itself on the way back.
//
// Everything here is pure: the two doors, the one-shot auto-add predicate and
// every sentence the surface may print. The component (components/social/
// ConfirmFollow.tsx) renders it and the follow route (app/api/profiles/
// [handle]/follow) writes it - neither owns a rule.

import { arrivalDestination, type ArrivalIntent } from "@/lib/arrivalWelcome";
import { displayHandle } from "@/lib/handleDisplay";
import { safeInviteReturnTo } from "@/lib/inviteReturnTo";
import { normalizeHandle } from "@/lib/profiles";

/**
 * The one search parameter the add page reads. `?auto=1` says the person is
 * coming BACK from making an account and asked for the add before they left,
 * so the surface performs it rather than showing the button again.
 */
export const ADD_LINK_AUTO_PARAM = "auto";

/** Read `?auto=`. Only an explicit "1" counts, like every other flag here. */
export function parseAddLinkAuto(raw: string | null | undefined): boolean {
  return raw === "1";
}

/**
 * The path a sign-up or sign-in must come back to. It carries `?auto=1`, which
 * is why `safeInviteReturnTo` admits that ONE parameter: without it the person
 * lands back on the same button they already pressed.
 */
export function addLinkReturnTo(handle: string): string | null {
  const target = normalizeHandle(handle);
  if (!target) return null;
  return safeInviteReturnTo(`/add/${target}?${ADD_LINK_AUTO_PARAM}=1`);
}

/** Where the two doors point. `mode` is the login page's own door parameter. */
function loginHref(mode: "signup" | "signin", returnTo: string): string {
  const params = new URLSearchParams({ mode, from: returnTo });
  return `/login?${params.toString()}`;
}

export type AddLinkDoors = {
  /** Make an account, then land back and add them. */
  createHref: string;
  /** Already has an account. Same landing. */
  signInHref: string;
};

/** Both doors for one target, or null when the handle is not a handle. */
export function addLinkDoors(handle: string): AddLinkDoors | null {
  const returnTo = addLinkReturnTo(handle);
  if (!returnTo) return null;
  return {
    createHref: loginHref("signup", returnTo),
    signInHref: loginHref("signin", returnTo),
  };
}

/**
 * Where a completed sign-in lands, with an add link allowed to survive it.
 *
 * A SIGN-UP always finishes on the claim surface, so `arrivalDestination` drops
 * the page the person came from - correctly, because a brand new account has no
 * handle yet. An add link may not be dropped with it: the claim surface and the
 * onboarding sheet both hand a person back to their `?returnTo=`, so threading
 * it through is what brings a stranger back to the friend they came to add.
 * A `from` that is not an add link changes nothing.
 */
export function addLinkAwareDestination(
  intent: ArrivalIntent,
  from: string | null,
  accountPath: string,
): string {
  const inviteReturnTo = safeInviteReturnTo(from);
  const claimNext = inviteReturnTo
    ? `${accountPath}?returnTo=${encodeURIComponent(inviteReturnTo)}`
    : accountPath;
  return arrivalDestination(intent, from, claimNext);
}

/**
 * Whether the surface should perform the add on this render.
 *
 * ONCE is the whole point, so `attemptedAccountIds` is the guard the component
 * holds in a ref: a re-render, a re-focus or a second effect pass may not write
 * a second time for the same account. Identity is TRI-STATE like everywhere
 * else here - an unresolved session answers nothing, and a viewer with no
 * handle has nothing to add anybody with.
 */
export type AddLinkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DOOR_MARKER_PREFIX = "pubmax:add-link-door:v1:";

/**
 * How long a taken door still counts as this device's own return.
 *
 * The marker lives in localStorage, not sessionStorage, because a magic link
 * opens in a FRESH TAB from the email client: a per-tab marker is absent by the
 * time the person lands back, so the one journey the add link exists for would
 * never auto-add. It is keyed by the TARGET handle, so a door taken to add one
 * friend can never perform an add for somebody else's crafted `?auto=1`, and it
 * is one-shot plus TTL-bounded, so a leftover marker cannot auto-follow
 * tomorrow.
 */
export const ADD_LINK_DOOR_TTL_MS = 30 * 60_000;

function doorMarkerKey(target: string): string | null {
  const handle = normalizeHandle(target);
  return handle ? `${DOOR_MARKER_PREFIX}${handle}` : null;
}

/** Record that this device took a sign-in or create-account door for `target`. */
export function markAddLinkDoorTaken(
  storage: AddLinkStorage | null,
  now: number,
  target: string,
): void {
  const key = doorMarkerKey(target);
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify({ at: now }));
  } catch {
    // Storage blocked: the person can still tap Add on the way back.
  }
}

/**
 * Peek at a live door marker without consuming it. The add effect may run
 * before identity resolves, so the caller clears it only when the add starts.
 */
export function peekAddLinkDoorTaken(
  storage: AddLinkStorage | null,
  now: number,
  target: string,
): boolean {
  const key = doorMarkerKey(target);
  if (!storage || !key) return false;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return false;
  }
  if (!raw) return false;
  let marker: unknown;
  try {
    marker = JSON.parse(raw);
  } catch {
    clearAddLinkDoorTaken(storage, target);
    return false;
  }
  const at = (marker as { at?: unknown } | null)?.at;
  if (typeof at !== "number" || now - at >= ADD_LINK_DOOR_TTL_MS) {
    clearAddLinkDoorTaken(storage, target);
    return false;
  }
  return true;
}

export function clearAddLinkDoorTaken(
  storage: AddLinkStorage | null,
  target: string,
): void {
  const key = doorMarkerKey(target);
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // The TTL bounds an unreadable marker anyway.
  }
}

/** Consume a live door marker. One-shot, so a crafted ?auto=1 cannot reuse it. */
export function consumeAddLinkDoorTaken(
  storage: AddLinkStorage | null,
  now: number,
  target: string,
): boolean {
  const live = peekAddLinkDoorTaken(storage, now, target);
  if (live) clearAddLinkDoorTaken(storage, target);
  return live;
}

export function shouldAutoAdd(input: {
  auto: boolean;
  accountId: string | null;
  identityResolved: boolean;
  viewerHandle: string | null;
  target: string;
  attemptedAccountIds: ReadonlySet<string>;
  /**
   * This device took a door for THIS target. A crafted third-party ?auto=1
   * never has this.
   */
  doorTaken?: boolean;
}): boolean {
  if (
    !input.auto ||
    !input.doorTaken ||
    !input.accountId ||
    input.attemptedAccountIds.has(input.accountId) ||
    !input.identityResolved
  ) {
    return false;
  }
  const viewer = normalizeHandle(input.viewerHandle ?? "");
  const target = normalizeHandle(input.target);
  if (!viewer || !target) return false;
  return viewer !== target;
}

/**
 * What the analytics rail is told. Never a handle, only which door was taken
 * and how the add went. Both sets are in the registry's own closed value list.
 */
export type AddLinkDoorOutcome = "create" | "signin";
export type AddLinkAddOutcome = "added" | "failed" | "unavailable";

export const ADD_LINK_SURFACE = "add-link";

/** Every sentence the add surface may print. */
export const ADD_LINK_COPY = {
  eyebrow: "Your lot",
  /** The line under the friend's name for somebody with no account yet. */
  accountNeeded:
    "PUBMAXX keeps your lot to your own account, so make one and they go straight in.",
  /** The line for a signed-in drinker who has not added them yet. */
  signedIn:
    "A lot is mutual. Add them, and once they add you back their nights, drops and check-ins land in Your lot.",
  /** While the add runs on arrival. */
  adding: "Adding them to your lot.",
  /** The session has not answered yet, so nobody is offered a door. */
  checking: "Checking your session.",
  /**
   * The target is gone. A REFUSAL, not a fault: the server says so in its own
   * envelope and this is the line when it said nothing readable, so the surface
   * never invites a retry that cannot land.
   */
  targetGone: "That account isn't here any more.",
  secondaryCta: "I have an account, sign in",
  handleNeeded: "Choose a handle, and they go into your lot.",
  handleCta: "Choose a handle to add them",
} as const;

function addLinkTargetLabel(handle: string, name?: string | null): string {
  return name?.trim() || displayHandle(handle);
}

/** "Create account and add Karan" - the one primary action for a stranger. */
export function addLinkCreateCta(handle: string, name?: string | null): string {
  return `Create account and add ${addLinkTargetLabel(handle, name)}`;
}

/** The receipt heading. */
export function addLinkReceiptTitle(handle: string, name?: string | null): string {
  return `${addLinkTargetLabel(handle, name)} is in your lot.`;
}

/** The receipt line under it. */
export const ADD_LINK_RECEIPT_BODY =
  "When they add you back, you are each other's lot and their nights show up in Your lot.";

export type AddLinkNextStep = { href: string; label: string };

/**
 * Where a receipt sends somebody next. Three doors on purpose: the map is the
 * product, a pint is the thing they came for, and the friend they just added is
 * the reason they are here. The message door is the person's OWN profile,
 * because that is where the message control lives - opening a conversation is a
 * write (`POST /api/messages`), never a link.
 */
export function addLinkNextSteps(handle: string): AddLinkNextStep[] {
  const target = normalizeHandle(handle);
  return [
    { href: "/map", label: "Open the map" },
    { href: "/near", label: "Find a pint" },
    ...(target
      ? [{ href: `/u/${target}`, label: "Send them a message" }]
      : []),
  ];
}
