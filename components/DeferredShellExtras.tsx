"use client";

// Lazy shell extras (perf lane). Everything here renders NOTHING on first
// paint (each is gated on client-side state: an active plan, a first-run
// flag, a prompt budget, a saved Pub Pal), so none of it belongs in the
// critical first-load bundle of every route. next/dynamic with ssr:false
// moves each component and its import graph (NightModeCard alone pulls the
// plan/TfL/recap stack) into lazily fetched chunks. Mounting a dynamic component
// starts its fetch immediately, so this host waits through the current route's
// useful-state window before it mounts those components.
//
// Plan mutation replay mounts immediately because it is startup infrastructure,
// not optional presentation. Native presentation extras release immediately.

import nextDynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Console-only easter egg. Imported directly rather than lazily: it is a few
// lines that render null, so its own chunk would cost more than it saves.
import CellarNotice from "@/components/CellarNotice";
import { isNativeApp } from "@/lib/nativePlatform";

const DEFERRED_SHELL_FALLBACK_MS = 30_000;
const E2E_DEFER_SHELL_RELEASE_KEY = "pubmax:e2e-defer-shell:v1";

const NightModeCard = nextDynamic(() => import("@/components/night/NightModeCard"), {
  ssr: false,
});
const MorningReentryCard = nextDynamic(() => import("@/components/night/MorningReentryCard"), {
  ssr: false,
});
const PubPalSummon = nextDynamic(() => import("@/components/pubpal/PubPalSummon"), {
  ssr: false,
});
const FirstRunTour = nextDynamic(() => import("@/components/onboarding/FirstRunTour"), {
  ssr: false,
});
const A2HSInstallPrompt = nextDynamic(() => import("@/components/pwa/A2HSInstallPrompt"), {
  ssr: false,
});
const NativePushPrompt = nextDynamic(() => import("@/components/native/NativePushPrompt"), {
  ssr: false,
});
const WebPushPrompt = nextDynamic(() => import("@/components/pwa/WebPushPrompt"), {
  ssr: false,
});
const CheapPintPingPrompt = nextDynamic(
  () => import("@/components/pwa/CheapPintPingPrompt"),
  { ssr: false },
);
const NativeSystemBars = nextDynamic(() => import("@/components/native/NativeSystemBars"), {
  ssr: false,
});
const NativeDeepLinks = nextDynamic(() => import("@/components/native/NativeDeepLinks"), {
  ssr: false,
});
const PlanMutationOutboxHost = nextDynamic(
  () => import("@/components/plan/PlanMutationOutboxHost"),
  { ssr: false },
);

export default function DeferredShellExtras() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const release = () => setReady(true);
    if (isNativeApp()) {
      const nativeRelease = window.setTimeout(release, 0);
      return () => window.clearTimeout(nativeRelease);
    }
    try {
      if (window.localStorage.getItem(E2E_DEFER_SHELL_RELEASE_KEY) === "now") {
        release();
        return;
      }
    } catch (storageError) {
      void storageError;
    }

    const fallback = window.setTimeout(release, DEFERRED_SHELL_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, []);

  const outbox = <PlanMutationOutboxHost />;

  if (!ready) {
    return (
      <>
        {outbox}
        <CellarNotice />
      </>
    );
  }

  return (
    <>
      {outbox}
      <NightModeCard />
      <MorningReentryCard />
      <PubPalSummon />
      <FirstRunTour />
      <A2HSInstallPrompt />
      <NativePushPrompt />
      <WebPushPrompt />
      <CheapPintPingPrompt />
      <NativeSystemBars />
      <NativeDeepLinks />
      <CellarNotice />
    </>
  );
}
