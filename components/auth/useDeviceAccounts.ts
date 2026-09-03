"use client";

// The one live reader of the remembered-account lane.
//
// ONE owner for the same reason `useViewerHandle` has one: a second copy of a
// storage read is a second answer, and two of them on one page would disagree
// the moment either wrote. The switcher list and the sign-out scope are both
// this list, read once per menu.
//
// A same-tab `localStorage` write raises no `storage` event, which is why the
// lane publishes its own notice (lib/deviceAccountSessions.ts) and this hook
// subscribes to both.

import { useMemo, useSyncExternalStore } from "react";

import {
  deviceAccountsSnapshot,
  parseDeviceAccounts,
  subscribeDeviceAccountSessions,
  type DeviceAccountRecord,
} from "@/lib/deviceAccountSessions";

function browserLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function snapshot(): string {
  if (typeof window === "undefined") return "";
  return deviceAccountsSnapshot(browserLocalStorage());
}

function serverSnapshot(): string {
  return "";
}

/** Every account signed in on this device, most recently active first. */
export function useDeviceAccounts(): DeviceAccountRecord[] {
  const raw = useSyncExternalStore(
    subscribeDeviceAccountSessions,
    snapshot,
    serverSnapshot,
  );
  return useMemo(() => parseDeviceAccounts(raw || null), [raw]);
}
