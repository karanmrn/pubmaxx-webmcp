"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  CHEAP_PINT_PING_PROMPT_SURFACE,
  getCheapPintPingPromptServerSnapshot,
  getCheapPintPingPromptVisibleSnapshot,
  markCheapPintPingDismissed,
  markCheapPintPingEnabled,
  subscribeCheapPintPingPrompt,
  syncCheapPintPingPromptFromServer,
} from "@/lib/cheapPintPingPrompt";
import { registerWebPush } from "@/lib/webPush";
import "@/components/native/nativePushPrompt.css";

export default function CheapPintPingPrompt(): React.JSX.Element | null {
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const visible = useSyncExternalStore(
    subscribeCheapPintPingPrompt,
    getCheapPintPingPromptVisibleSnapshot,
    getCheapPintPingPromptServerSnapshot,
  );
  const canShow = visible && hasPromptBudgetFor(CHEAP_PINT_PING_PROMPT_SURFACE);

  useEffect(() => {
    if (canShow) claimPromptBudget(CHEAP_PINT_PING_PROMPT_SURFACE);
  }, [canShow]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void authedActionFetch("/api/cheap-pint-ping", { signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) return;
        syncCheapPintPingPromptFromServer({
          canPrompt: body.canPrompt === true,
          declined: body.declined === true,
          enabled: body.enabled === true,
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [user]);

  if (!canShow) return null;

  async function handleEnable() {
    if (pending) return;
    setPending(true);
    setError("");
    const token = await registerWebPush();
    if (!token) {
      setError(
        offlineOrMessage("Could not enable alerts. Try again.")
      );
      setPending(false);
      return;
    }
    const response = await authedActionFetch("/api/cheap-pint-ping", {
      method: "POST",
      body: JSON.stringify({ action: "opt-in", token }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      setError(errorMessageFrom(body, "Could not save that choice. Try again."));
      setPending(false);
      return;
    }
    markCheapPintPingEnabled();
    setPending(false);
  }

  async function handleDecline() {
    if (pending) return;
    setPending(true);
    setError("");
    const response = await authedActionFetch("/api/cheap-pint-ping", {
      method: "POST",
      body: JSON.stringify({ action: "decline" }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      setError(errorMessageFrom(body, "Could not save that choice. Try again."));
      setPending(false);
      return;
    }
    markCheapPintPingDismissed();
    setPending(false);
  }

  return (
    <div className="nativePushPrompt">
      <div
        className="nativePushPrompt__card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="cheap-pint-ping-title"
        aria-describedby="cheap-pint-ping-body"
      >
        <p id="cheap-pint-ping-title" className="nativePushPrompt__title">
          Weekday cheap-pint ping?
        </p>
        <p id="cheap-pint-ping-body" className="nativePushPrompt__body">
          One push at 5pm on a weekday with a listed cheap pint near where your night starts. Ask once. No follow-ups.
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
            onClick={() => void handleDecline()}
            disabled={pending}
          >
            No thanks
          </button>
          <button
            type="button"
            className="nativePushPrompt__enable pressable"
            onClick={() => void handleEnable()}
            disabled={pending}
          >
            {pending ? "Saving..." : "Yes, ping me"}
          </button>
        </div>
      </div>
    </div>
  );
}
