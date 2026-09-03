"use client";

import { useCallback, useId, useState } from "react";
import { Mail } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import type { MagicLinkResult } from "@/lib/passwordlessAuth";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function MagicLinkForm({
  disabled,
  hasSocialProviders,
  signInWithEmail,
  cancelAuthAttempt,
  label,
  submitLabel,
}: {
  disabled: boolean;
  hasSocialProviders: boolean;
  signInWithEmail: (email: string) => Promise<MagicLinkResult>;
  cancelAuthAttempt: () => void;
  /** Overrides the field label so a sign-up door does not read as a sign-in. */
  label?: string;
  /** Overrides the idle button label for the same reason. */
  submitLabel?: string;
}): React.JSX.Element {
  const inputId = useId();
  const messageId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | MagicLinkResult["status"]>("idle");
  const [message, setMessage] = useState("");
  const valid = looksLikeEmail(email);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!valid || disabled || status === "sending" || status === "sent") return;
      trackEvent("sign_in_initiated", { provider: "email" });
      setStatus("sending");
      setMessage("");
      const result = await signInWithEmail(email);
      setStatus(result.status);
      setMessage(result.message);
    },
    [disabled, email, signInWithEmail, status, valid],
  );

  const cancel = useCallback(() => {
    cancelAuthAttempt();
    setStatus("idle");
    setMessage("");
    setEmail("");
  }, [cancelAuthAttempt]);

  return (
    <form className="authMagicLink" onSubmit={submit} noValidate>
      <label className="authMagicLinkLabel" htmlFor={inputId}>
        {label ?? (hasSocialProviders ? "Or continue with email" : "Continue with email")}
      </label>
      <div className="authMagicLinkRow">
        <input
          id={inputId}
          className="authMagicLinkInput"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          disabled={disabled || status === "sending" || status === "sent"}
          aria-invalid={status === "error"}
          aria-describedby={message ? messageId : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status === "error" || status === "rate_limited") {
              setStatus("idle");
              setMessage("");
            }
          }}
        />
        <button
          type="submit"
          className="authSignIn authMagicLinkButton"
          disabled={!valid || disabled || status === "sending" || status === "sent"}
        >
          <Mail size={18} aria-hidden="true" />
          {status === "sending"
            ? "Sending…"
            : status === "sent"
              ? "Link sent"
              : submitLabel ?? "Email me a link"}
        </button>
        {status === "sent" ? (
          <button
            type="button"
            className="authMagicLinkCancel"
            onClick={cancel}
          >
            Cancel sign-in
          </button>
        ) : null}
      </div>
      {message ? (
        <p
          id={messageId}
          className={status === "sent" ? "authMagicLinkSuccess" : "authError"}
          role={status === "sent" ? "status" : "alert"}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
