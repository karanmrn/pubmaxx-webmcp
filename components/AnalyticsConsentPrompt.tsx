"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  analyticsConsentDecision,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
} from "@/lib/analytics";
import type { AnalyticsConsentDecision } from "@/lib/analyticsIdentity";
import {
  ANALYTICS_CONSENT_PROMPT_SURFACE,
  claimPromptBudget,
  hasPromptBudgetFor,
  subscribePromptBudget,
} from "@/lib/promptBudget";

type AnalyticsConsentPromptContentProps = {
  onDecision: (granted: boolean) => void;
};

export function AnalyticsConsentPromptContent({
  onDecision,
}: AnalyticsConsentPromptContentProps) {
  return (
    <aside
      className="analyticsConsentPrompt"
      aria-label="Anonymous analytics choice"
    >
      <p>
        PUBMAXXING uses optional analytics to see what people use. Never sold,
        no ads.{" "}
        <Link href="/privacy">Privacy</Link>
      </p>
      <div className="analyticsConsentPromptActions">
        <button type="button" onClick={() => onDecision(true)}>Allow</button>
        <button type="button" onClick={() => onDecision(false)}>No thanks</button>
      </div>
    </aside>
  );
}

export default function AnalyticsConsentPrompt() {
  const [decision, setDecision] = useState<AnalyticsConsentDecision | null | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      const nextDecision = analyticsConsentDecision();
      if (nextDecision !== null) {
        setDecision(nextDecision);
        return;
      }
      const canShow = hasPromptBudgetFor(ANALYTICS_CONSENT_PROMPT_SURFACE);
      const claimed = canShow
        && claimPromptBudget(ANALYTICS_CONSENT_PROMPT_SURFACE);
      setDecision(claimed ? null : "checking");
    };
    void Promise.resolve().then(() => {
      if (!cancelled) refresh();
    });
    const unsubscribeConsent = subscribeAnalyticsConsent(refresh);
    const unsubscribeBudget = subscribePromptBudget(refresh);
    return () => {
      cancelled = true;
      unsubscribeConsent();
      unsubscribeBudget();
    };
  }, []);

  if (decision !== null) return null;

  function decide(granted: boolean) {
    setAnalyticsConsent(granted);
    setDecision(granted ? "granted" : "denied");
  }

  return <AnalyticsConsentPromptContent onDecision={decide} />;
}
