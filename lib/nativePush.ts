// Native push-notification seam. Inside the Capacitor shell this asks for
// permission, registers with APNs, and POSTs the device token to
// /api/push-tokens (lib/pushTokenStore.ts). On the web / server every entry
// point is a no-op — callers can invoke registerNativePush() unconditionally.
// Like the other native seams, the plugin is imported dynamically so nothing
// Capacitor-shaped ever lands in the web bundle.

import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";
import { navigateNativeBrowser } from "@/lib/nativeNavigation";

const APP_ORIGIN = "https://pubmaxxing.com";
const REGISTRATION_TIMEOUT_MS = 15_000;
const PUSH_PATHS = ["/tonight"] as const;
const PUSH_PATH_PREFIXES = ["/plan/"] as const;

type NativePushNotification = {
  data?: Record<string, unknown>;
};

/** Both native shells use the same registration seam. Capacitor returns APNs
 * tokens on iOS and FCM registration tokens on Android. */
export function nativePushRegistrationSupported(): boolean {
  const platform = nativePlatform();
  return platform === "ios" || platform === "android";
}

/** Convert a server-owned notification target to a safe internal app path. */
export function nativePushNavigationPath(
  notification: NativePushNotification,
): string | null {
  const rawPath = notification.data?.url;
  if (typeof rawPath !== "string" || !rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(rawPath, APP_ORIGIN);
    if (url.origin !== APP_ORIGIN) return null;
    const allowed =
      PUSH_PATHS.some((path) => url.pathname === path) ||
      PUSH_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    if (!allowed) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

async function postToken(token: string): Promise<boolean> {
  const platform = nativePlatform();
  if (!platform) return false;
  try {
    const response = await fetch("/api/push-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, platform }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Request permission and register for push inside the native shell.
 * Resolves true when Capacitor supplies a device token and the API accepts it,
 * false when skipped or registration cannot be persisted.
 */
async function registerNativePushWithPermissionRequest(
  requestPermission: boolean,
): Promise<boolean> {
  if (!isNativeApp() || !nativePushRegistrationSupported()) return false;
  const listenerRemovers: Array<() => Promise<void>> = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let permission = await PushNotifications.checkPermissions();
    if (
      requestPermission &&
      (permission.receive === "prompt" || permission.receive === "prompt-with-rationale")
    ) {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== "granted") return false;

    let settled = false;
    let settleRegistration: (registered: boolean) => void = () => {};
    const registrationOutcome = new Promise<boolean>((resolve) => {
      settleRegistration = (registered) => {
        if (settled) return;
        settled = true;
        resolve(registered);
      };
    });

    const registrationListener = await PushNotifications.addListener("registration", (token) => {
      if (!token.value) {
        settleRegistration(false);
        return;
      }
      void postToken(token.value).then(settleRegistration);
    });
    listenerRemovers.push(() => registrationListener.remove());

    const errorListener = await PushNotifications.addListener("registrationError", () => {
      settleRegistration(false);
    });
    listenerRemovers.push(() => errorListener.remove());

    timeout = setTimeout(() => settleRegistration(false), REGISTRATION_TIMEOUT_MS);
    void PushNotifications.register().catch(() => settleRegistration(false));
    return await registrationOutcome;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
    await Promise.allSettled(listenerRemovers.map((remove) => remove()));
  }
}

/** Contextual first-time opt-in. This is the only path allowed to request the
 * operating-system notification permission. */
export function registerNativePush(): Promise<boolean> {
  return registerNativePushWithPermissionRequest(true);
}

/** Refresh an already-enabled device registration at native shell boot. This
 * recovers rotated APNs and FCM tokens without showing a permission dialog. */
export function refreshNativePushRegistration(): Promise<boolean> {
  return registerNativePushWithPermissionRequest(false);
}

/**
 * Route native notification taps. This listener attaches at shell boot, not
 * when permission is requested, so cold and warm taps work in later sessions.
 */
export async function activateNativePushNavigation(
  navigate: (path: string) => void = navigateNativeBrowser,
): Promise<() => void> {
  if (!isNativeApp()) return () => {};

  let removeListener: (() => Promise<void>) | undefined;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const listener = await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      ({ notification }) => {
        const path = nativePushNavigationPath(notification);
        if (path) navigate(path);
      },
    );
    removeListener = () => listener.remove();
    return () => {
      void removeListener?.();
      removeListener = undefined;
    };
  } catch {
    void removeListener?.();
    return () => {};
  }
}
