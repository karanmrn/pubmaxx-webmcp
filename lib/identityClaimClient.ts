// Client-safe helpers for Wave L3 "Claim your night". Split from
// `@/lib/identityClaim` so that browser bundles (e.g. AuthProvider) do not pull
// in the server-only stores (pintDropsStore/profileStore/etc.), which in turn
// import `sharp` and other Node built-ins that Next's client compiler refuses.

import { normalizeHandle } from "@/lib/profiles";

const HANDLE_KEY = "pubmax_handle";

/** Client-only: read the device-local handle from localStorage (empty when absent). */
export function readDeviceHandle(): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
  } catch {
    return "";
  }
}
