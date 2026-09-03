// The signed-in account is the only identity authority on a device.
//
// WHY THIS EXISTS: a drinker signed out of one account and created a second one
// in the same browser. Nothing cleared the first account's device-cached
// artifacts, so `pubmax_handle` outlived the session that earned it and every
// surface that reads it - the You tab, the profile route, the follow actor -
// kept answering with the previous person's handle. The account was right and
// the app was wrong about who it belonged to, which is worse than a missing
// answer: the reader has no way to tell there is anything to disbelieve.
//
// THE RULE: a device artifact may claim to be the signed-in account only while
// the stamped owner IS that account. Any other user id - a second account, a
// device that predates this stamp, a browser whose stamp was evicted - is not
// proof of ownership, so the whole set is dropped in ONE pass and the server
// read re-establishes the truth. Dropping is cheap and self-healing:
// `resolveCanonicalIdentity` rewrites the handle on the next tick.
//
// WHAT IS NOT HERE: a device-only artifact that never claimed account backing.
// A signed-out drinker's self-asserted handle and a Night Profile saved on this
// device are theirs; this module only ever runs for a signed-in session, and
// the Night Profile is dropped only when it was MIRRORED from an account.

import {
  NIGHT_PROFILE_DEVICE_KEY,
  readDeviceNightProfileProvenance,
} from "@/lib/nightProfileDeviceProvenance";

/** Which account the device-cached identity artifacts below belong to. */
export const DEVICE_ACCOUNT_OWNER_KEY = "pubmax_account_owner";

/** Same-tab notice that the device identity set changed under a reader. */
export const DEVICE_IDENTITY_CHANGED_EVENT = "pubmax:device-identity-changed";

/**
 * Every localStorage artifact that speaks for the signed-in account. A key
 * belongs here when reading it could make the app name, route, or act as a
 * person - not merely when it is a preference the account happens to hold.
 */
export const DEVICE_IDENTITY_LOCAL_KEYS = [
  // The handle every composer, actor and profile route signs with.
  "pubmax_handle",
  // Pre-Wave-I comment-only handle; still migrated into the key above on read.
  "pubmax:comment:handle",
  // A self-asserted Round handle, which the diary attributes spend to.
  "pubmax_round_anonymous_identity_v1",
  // An armed account nudge belongs to the person who armed it.
  "pubmax:identityNudge:pending:v1",
  "pubmax:identityNudge:pendingAt:v1",
  "pubmax:identityNudge:dismissedAt:v1",
  // Badge event opt-ins are chosen on the owner's own profile.
  "pubmax-badge-event-opt-ins",
] as const;

/** The sessionStorage half of the same set. */
export const DEVICE_IDENTITY_SESSION_KEYS = [
  // Who a referral asked the arriving account to follow back.
  "pubmax:referral-follow-handle",
  // The one-shot arrival greeting names a person.
  "pubmax:arrival-welcome:v1",
] as const;

type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function readKey(storage: WritableStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function removeKey(storage: WritableStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Blocked storage cannot hold a stale identity either.
  }
}

function writeKey(
  storage: WritableStorage | null,
  key: string,
  value: string,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Account ownership is durable even when browser storage is blocked.
  }
}

/**
 * Drop every device artifact that claims to be an account, in one pass. The
 * owner stamp is left to the caller: a sign-out removes it, an account change
 * replaces it, and doing that inside this function would hide which happened.
 */
export function clearDeviceAccountArtifacts(
  local: WritableStorage | null,
  session: WritableStorage | null = null,
): void {
  for (const key of DEVICE_IDENTITY_LOCAL_KEYS) removeKey(local, key);
  for (const key of DEVICE_IDENTITY_SESSION_KEYS) removeKey(session, key);
  // A Night Profile mirrored off an account is that account's answer wearing a
  // device label. One typed on this device belongs to the device and stays.
  if (readDeviceNightProfileProvenance(local) === "account") {
    removeKey(local, NIGHT_PROFILE_DEVICE_KEY);
  }
}

/**
 * Bind this device's cached identity to `userId`, clearing everything the
 * previous owner left when the two differ. Returns true when a clear happened,
 * so the caller can tell readers to re-read.
 *
 * An ABSENT stamp counts as a different owner: a handle nobody vouched for may
 * not act as this account. That costs one canonical read on the first sign-in
 * after this ships and is right every time after.
 */
export function bindDeviceAccountOwner(
  userId: string,
  local: WritableStorage | null,
  session: WritableStorage | null = null,
): boolean {
  if (!userId) return false;
  if (readKey(local, DEVICE_ACCOUNT_OWNER_KEY) === userId) return false;
  clearDeviceAccountArtifacts(local, session);
  writeKey(local, DEVICE_ACCOUNT_OWNER_KEY, userId);
  return true;
}

/** Sign-out: the set goes, and so does the claim that anyone owns it. */
export function releaseDeviceAccountOwner(
  local: WritableStorage | null,
  session: WritableStorage | null = null,
): void {
  clearDeviceAccountArtifacts(local, session);
  removeKey(local, DEVICE_ACCOUNT_OWNER_KEY);
}

/** The account this device's cached identity was last stamped for. */
export function deviceAccountOwner(local: WritableStorage | null): string | null {
  const owner = readKey(local, DEVICE_ACCOUNT_OWNER_KEY);
  return owner ? owner : null;
}

/** Announce a device-identity change to same-tab readers. */
export function emitDeviceIdentityChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
  } catch {
    // Older engines without an Event constructor still keep the storage write.
  }
}

/** Subscribe to same-tab writes plus the cross-tab `storage` event. */
export function subscribeDeviceIdentity(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(DEVICE_IDENTITY_CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(DEVICE_IDENTITY_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
