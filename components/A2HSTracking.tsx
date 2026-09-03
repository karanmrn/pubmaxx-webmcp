"use client";

import { useEffect } from "react";

import { trackEvent } from "@/lib/analytics";
import {
  isBeforeInstallPromptEvent,
  publishA2hsAppInstalled,
  storeA2hsInstallPrompt,
} from "@/lib/a2hsInstallEvent";
import {
  readA2hsState,
  registerInstalled,
  writeA2hsState,
} from "@/lib/a2hsPrompt";

/**
 * Early Add-to-Home-Screen event owner and install funnel tracker. Renders
 * nothing, but mounts in the root bundle before the lazy install surface.
 *
 * - `beforeinstallprompt` (Android/Chrome only — not in the standard DOM
 *   event map, so it's attached/removed with an EventListener cast) fires
 *   when the browser judges the app installable; that eligibility itself is
 *   the top-of-funnel signal.
 * - `appinstalled` fires once the OS-level install actually completes.
 * - iOS Safari never fires either event, so `matchMedia('(display-mode:
 *   standalone)')` at launch is the iOS-compatible proxy: true whenever the
 *   app is already running as an installed PWA.
 *
 * No props on any of these — trackEvent already no-ops without consent.
 */
export default function A2HSTracking() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!isBeforeInstallPromptEvent(event)) return;
      storeA2hsInstallPrompt(event);
      trackEvent("pwa_install_prompt_available");
    };
    const onAppInstalled = () => {
      writeA2hsState(registerInstalled(readA2hsState()));
      publishA2hsAppInstalled();
      trackEvent("pwa_install_completed");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", onAppInstalled);

    try {
      if (window.matchMedia?.("(display-mode: standalone)").matches) {
        trackEvent("pwa_standalone_launch");
      }
    } catch {
      // matchMedia can be unavailable in unusual embeds; best-effort only.
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  return null;
}
