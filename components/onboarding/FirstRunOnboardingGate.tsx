"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import FirstRunOnboarding from "@/components/onboarding/FirstRunOnboarding";
import { SHELL_START_PATH } from "@/lib/entryDecision";
import { consumeNativeFirstRunHandoff } from "@/lib/nativeFirstRun";
import { isNativeApp } from "@/lib/nativePlatform";

type ReviewedArea = {
  name: string;
  transportAnchor: string;
};

type EligibilityDecision = {
  allowed: boolean;
  fallback: "/" | typeof SHELL_START_PATH;
};

/**
 * Fail-closed route boundary for /onboarding. The stateful onboarding UI is
 * mounted only after consuming the one-time handoff issued at the native root;
 * direct web links return home and ineligible native visits return to Tonight.
 */
export default function FirstRunOnboardingGate({
  reviewedAreas,
}: {
  reviewedAreas: ReviewedArea[];
}) {
  const router = useRouter();
  const decision = useRef<EligibilityDecision | null>(null);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (!decision.current) {
      const isNative = isNativeApp();
      decision.current = {
        allowed: consumeNativeFirstRunHandoff(isNative),
        fallback: isNative ? SHELL_START_PATH : "/",
      };
    }

    if (!decision.current.allowed) {
      router.replace(decision.current.fallback);
      return;
    }

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setEligible(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!eligible) {
    return <main id="main" className="firstRunOnboarding firstRunOnboardingGate" aria-busy="true" />;
  }

  return <FirstRunOnboarding reviewedAreas={reviewedAreas} />;
}
