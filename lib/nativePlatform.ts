// Native-shell detection seam. The Capacitor iOS wrap loads pubmaxxing.com in
// a WKWebView and injects a `window.Capacitor` bridge before any page script
// runs; on the plain web (and during SSR) that global is absent. This module is
// the ONLY place that global is probed — every native-vs-web branch goes
// through isNativeApp() so the rest of the codebase never touches Capacitor
// directly (see also lib/nativeCamera.ts / lib/nativePush.ts for plugin seams).

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function bridge(): CapacitorBridge | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return (window as { Capacitor?: CapacitorBridge }).Capacitor;
  } catch {
    return undefined;
  }
}

/** True only inside the Capacitor native shell. SSR-safe (false on the server). */
export function isNativeApp(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

/** "ios" | "android" inside the shell, null on the web / server. */
export function nativePlatform(): "ios" | "android" | null {
  if (!isNativeApp()) return null;
  const platform = bridge()?.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : null;
}
