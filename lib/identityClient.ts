import type { Session } from "@supabase/supabase-js";

import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountBoundRequest,
} from "@/lib/accountBoundFetch";
import { HANDLE_CLAIM_NEXT } from "@/lib/authRedirect";
import {
  deviceAccountOwner,
  emitDeviceIdentityChanged,
} from "@/lib/deviceAccountIdentity";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { clearClaimedRoundAnonymousHandle } from "@/lib/roundRequest";

export const IDENTITY_HANDLE_CHANGED_EVENT = "pubmaxx:identity-handle-changed";

export type IdentityHandleChangedDetail = Readonly<{
  ownerId: string;
  handle: string;
}>;

export type CanonicalIdentityResolution =
  | Readonly<{ ok: false }>
  | Readonly<{
      ok: true;
      identity: IdentityHandleChangedDetail | null;
    }>;

export function identityHandleForOwner(
  detail: unknown,
  ownerId: string | null,
): string | null {
  if (!ownerId || !detail || typeof detail !== "object") return null;
  const candidate = detail as { ownerId?: unknown; handle?: unknown };
  return candidate.ownerId === ownerId && typeof candidate.handle === "string"
    ? candidate.handle
    : null;
}

export function emitIdentityHandleChanged(
  detail: IdentityHandleChangedDetail,
): void {
  if (typeof window === "undefined") return;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {}
  clearClaimedRoundAnonymousHandle(detail.handle, storage);
  window.dispatchEvent(
    new CustomEvent(IDENTITY_HANDLE_CHANGED_EVENT, { detail }),
  );
}

// App-wide device-handle convention shared with the composers and /u/you.
export const DEVICE_HANDLE_KEY = "pubmax_handle";

/**
 * Write the server-owned handle onto this device. Fresh browsers after sign-in
 * have no local handle yet; without this write the claim form and local
 * composers act as if the account were handle-less.
 *
 * The write announces itself: readers that mounted before the canonical answer
 * landed (the You tab, the composers) subscribe to the cross-tab `storage`
 * event, which a same-tab write never fires. Without the notice the tab bar
 * kept the handle it read at mount, which is how a stale answer survived a
 * whole session and only a full page load ever corrected it.
 */
export function syncDeviceHandle(
  storage: Pick<Storage, "setItem"> | null | undefined,
  handle: string,
): void {
  const normalised = normalizeHandle(handle);
  if (!storage || !normalised) return;
  try {
    storage.setItem(DEVICE_HANDLE_KEY, normalised);
  } catch {
    // Account ownership is durable even when browser storage is blocked.
    return;
  }
  emitDeviceIdentityChanged();
}

/** Read the device-local handle, or "" when absent or unreadable. */
export function readStoredDeviceHandle(
  storage: Pick<Storage, "getItem"> | null | undefined,
): string {
  if (!storage) return "";
  try {
    return normalizeHandle(storage.getItem(DEVICE_HANDLE_KEY) ?? "");
  } catch {
    return "";
  }
}

export async function resolveCanonicalIdentity(
  expectedUserId: string,
  session: Pick<Session, "access_token" | "user"> | null,
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem"> | null,
  request: AccountBoundRequest = fetch,
): Promise<CanonicalIdentityResolution> {
  const auth = captureAccountAuth(expectedUserId, session);
  if (!auth) return { ok: false };
  const response = await accountBoundFetch(
    auth,
    "/api/identity/handle/current",
    {},
    request,
  );
  if (!response.ok) {
    discardBody(response);
    return { ok: false };
  }
  const body = await response.json().catch(() => null) as {
    handle?: unknown;
  } | null;
  const handle =
    typeof body?.handle === "string" ? normalizeHandle(body.handle) : "";
  if (!handle) return { ok: true, identity: null };
  clearClaimedRoundAnonymousHandle(handle, storage);
  syncDeviceHandle(storage, handle);
  return {
    ok: true,
    identity: { ownerId: auth.userId, handle },
  };
}

/**
 * Post-callback routing. Creating the account comes first and choosing a
 * handle is the step after, and /u/you is the only surface carrying the claim
 * form, so a freshly established session with no claimed handle routes there.
 * Returns the destination path, or null to stay put. Never bounces the user on
 * doubt: a return target (an add link or Plan) owns the destination, a device
 * handle THIS ACCOUNT owns means /u/you would just redirect back out, and a
 * failed or unreadable server answer is not evidence the account has no handle.
 * When the server already owns a handle, sync it onto this device before
 * staying put.
 *
 * The device-handle shortcut is gated on the owner stamp because an unstamped
 * or foreign handle is the previous account's: taking it as proof suppressed
 * the canonical read AND the claim step, so a second account browsed the whole
 * app under the first one's name and was never offered a handle of its own.
 */
export async function handleClaimRouteAfterSignIn(
  session: Pick<Session, "access_token" | "user"> | null,
  landedUrl: string,
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem"> | null,
  request: AccountBoundRequest = fetch,
): Promise<string | null> {
  const userId = session?.user?.id;
  if (!userId) return null;
  try {
    const landed = new URL(landedUrl, "https://pubmax.invalid");
    if (landed.hash) return null;
    if (landed.pathname === HANDLE_CLAIM_NEXT) return null;
  } catch {
    return null;
  }
  try {
    if (
      storage &&
      deviceAccountOwner(storage) === userId &&
      readStoredDeviceHandle(storage)
    ) {
      return null;
    }
  } catch {
    // Unreadable storage answers nothing; the server read below decides.
  }
  const resolution = await resolveCanonicalIdentity(
    userId,
    session,
    storage,
    request,
  ).catch(() => null);
  if (!resolution?.ok || resolution.identity) return null;
  return HANDLE_CLAIM_NEXT;
}
