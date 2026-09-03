"use client";

import { useEffect } from "react";

import { activateNativeDeepLinks } from "@/lib/nativeDeepLinks";
import {
  activateNativePushNavigation,
  refreshNativePushRegistration,
} from "@/lib/nativePush";
import { hasEnabledNativePush } from "@/lib/nativePushPrompt";

/** Renderless native app-link, notification-tap, and push-refresh lifecycle. */
export default function NativeDeepLinks(): null {
  useEffect(() => {
    let disposed = false;
    const deactivators: Array<() => void> = [];

    for (const activate of [activateNativeDeepLinks, activateNativePushNavigation]) {
      void activate().then((cleanup) => {
        if (disposed) cleanup();
        else deactivators.push(cleanup);
      });
    }
    if (hasEnabledNativePush()) void refreshNativePushRegistration();

    return () => {
      disposed = true;
      for (const deactivate of deactivators) deactivate();
    };
  }, []);

  return null;
}
