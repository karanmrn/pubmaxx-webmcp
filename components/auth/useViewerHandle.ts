"use client";

// Who a surface may call the person in front of it.
//
// ONE owner, because there is one rule and it was got wrong twice: the You tab
// and the Today greeting each read the device handle straight from storage, so
// after a second account signed in on the same browser both went on naming the
// FIRST account - the tab bar for the life of the tab, the greeting until a
// reload. A copy of this rule is a copy of that defect.
//
// The rule: a signed-in account is named only by its own canonical handle. Until
// the live session has answered, nobody is named at all - the device cache is
// exactly where the previous account's handle lives. A settled signed-OUT
// viewer keeps the device handle, which is genuinely theirs.

import { useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { subscribeDeviceIdentity } from "@/lib/deviceAccountIdentity";
import { readDeviceHandle } from "@/lib/identityClaimClient";

function serverSnapshot(): string {
  return "";
}

/** The viewer's handle, or null when it is unknown or they have none. */
export function useViewerHandle(): string | null {
  // The device handle is re-read on the app's own change notice as well as the
  // cross-tab `storage` event, which a same-tab write never fires.
  const deviceHandle = useSyncExternalStore(
    subscribeDeviceIdentity,
    readDeviceHandle,
    serverSnapshot,
  );
  const { user, identityResolved, handle: accountHandle } = useAuth();
  if (!identityResolved) return null;
  if (user) return accountHandle || null;
  return deviceHandle || null;
}
