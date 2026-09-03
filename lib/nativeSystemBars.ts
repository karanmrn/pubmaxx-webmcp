// Native system-bar seam. Capacitor 8 bundles SystemBars in @capacitor/core;
// import it only after the canonical native-platform guard so plain web/SSR
// callers never execute a native plugin path.

import { isNativeApp } from "@/lib/nativePlatform";

export type NativeTheme = "light" | "dark";

/**
 * Keep status/navigation-bar content legible against the active app theme.
 * Resolves false off-native or when a platform plugin call is unavailable.
 */
export async function syncNativeSystemBars(theme: NativeTheme): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { SystemBars, SystemBarsStyle } = await import("@capacitor/core");
    await SystemBars.setStyle({
      style: theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    });
    await SystemBars.show();
    return true;
  } catch {
    return false;
  }
}
