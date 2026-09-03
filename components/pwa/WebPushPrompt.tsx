"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { useEffect, useState, useSyncExternalStore } from "react";

import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";
import { registerWebPush } from "@/lib/webPush";
import {
  getWebPushPromptServerSnapshot,
  getWebPushPromptVisibleSnapshot,
  markWebPushPromptDismissed,
  markWebPushPromptEnabled,
  subscribeWebPushPrompt,
} from "@/lib/webPushPrompt";
import "@/components/native/nativePushPrompt.css";

const WEB_PUSH_SURFACE = "web-push";

export default function WebPushPrompt(): React.JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const visible = useSyncExternalStore(
    subscribeWebPushPrompt,
    getWebPushPromptVisibleSnapshot,
    getWebPushPromptServerSnapshot,
  );
  const canShow = visible && hasPromptBudgetFor(WEB_PUSH_SURFACE);

  useEffect(() => {
    if (canShow) claimPromptBudget(WEB_PUSH_SURFACE);
  }, [canShow]);

  if (!canShow) return null;

  async function handleEnable() {
    if (pending) return;
    setPending(true);
    setError("");
    const registered = await registerWebPush();
    if (registered) {
      markWebPushPromptEnabled();
    } else {
      setError(
        offlineOrMessage("Could not enable alerts. Try again.")
      );
    }
    setPending(false);
  }

  return (
    <div className="nativePushPrompt">
      <div
        className="nativePushPrompt__card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="web-push-prompt-title"
        aria-describedby="web-push-prompt-body"
      >
        <p id="web-push-prompt-title" className="nativePushPrompt__title">
          Get the London brief
        </p>
        <p id="web-push-prompt-body" className="nativePushPrompt__body">
          Weather verdict and one sourced pick for tonight. No crew or personal alerts yet.
        </p>
        {error ? (
          <p className="nativePushPrompt__error" role="status">
            {error}
          </p>
        ) : null}
        <div className="nativePushPrompt__actions">
          <button
            type="button"
            className="nativePushPrompt__later pressable"
            onClick={markWebPushPromptDismissed}
            disabled={pending}
          >
            Later
          </button>
          <button
            type="button"
            className="nativePushPrompt__enable pressable"
            onClick={() => void handleEnable()}
            disabled={pending}
          >
            {pending ? "Enabling..." : "Enable"}
          </button>
        </div>
      </div>
    </div>
  );
}
