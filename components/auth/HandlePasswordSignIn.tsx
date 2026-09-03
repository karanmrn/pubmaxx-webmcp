"use client";

import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { safeAuthNext } from "@/lib/authRedirect";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { persistSessionForResume } from "@/lib/authSessionResumeClient";
import {
  HANDLE_PASSWORD_GENERIC_ERROR,
  MIN_PASSWORD_LENGTH,
} from "@/lib/passwordPolicy";
import { trackEvent } from "@/lib/analytics";

type HandlePasswordSignInProps = {
  disabled?: boolean;
  /**
   * Where to land once the session is live. This form signs in without
   * navigating, so a page that was handed a `?from=` (a share link's
   * /add/<handle>?auto=1, a nav hand-off) has to say so or the person is left
   * looking at the sign-in page they just used. Null keeps the old behaviour.
   */
  redirectTo?: string | null;
};

/**
 * The one line a failed attempt gets besides the error.
 *
 * It is shown on EVERY failure and never conditionally, because a line that
 * appeared only for an account with no password would answer "does this handle
 * exist" for anybody willing to read it. Said to everybody it leaks nothing,
 * and it is still the true way out for the person it is written for.
 */
const NO_PASSWORD_GUIDANCE =
  "No password yet? Sign in with your email link and create one from your profile.";

/**
 * Land the fresh session on the destination the page was handed, through the
 * one boundary every other auth entry point already uses. `safeAuthNext`
 * re-parses the value as a URL, so a shape the browser would resolve off-site
 * (a tab or newline hidden inside `/\t/evil.example`) comes back as "/" rather
 * than sending somebody who just typed a password to a stranger's page.
 */
export function navigateAfterHandlePasswordSignIn(
  redirectTo: string | null | undefined,
  location: Pick<Location, "origin" | "assign">,
): void {
  if (!redirectTo) return;
  location.assign(safeAuthNext(redirectTo, location.origin));
}

export default function HandlePasswordSignIn({
  disabled = false,
  redirectTo = null,
}: HandlePasswordSignInProps): React.JSX.Element {
  const { configured } = useAuth();
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) return <></>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    setError(null);
    setBusy(true);
    trackEvent("sign_in_initiated", { provider: "handle_password" });

    try {
      const res = await fetch("/api/auth/handle-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, password }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        setError(
          offlineOrMessage(errorMessageFrom(body, HANDLE_PASSWORD_GENERIC_ERROR))
        );
        return;
      }

      const session =
        body.status === "signed_in" &&
        typeof body.session === "object" &&
        body.session
          ? (body.session as { access_token?: unknown; refresh_token?: unknown })
          : null;

      if (
        !session ||
        typeof session.access_token !== "string" ||
        typeof session.refresh_token !== "string"
      ) {
        setError("Sign-in did not finish. Try again.");
        return;
      }

      const supabase = await ensureSupabaseBrowser();
      if (!supabase) {
        setError("Sign-in is not configured on this build.");
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (sessionError) {
        setError("Sign-in did not finish. Try again.");
        return;
      }

      void persistSessionForResume({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });

      // A full assignment rather than a router push: the destination may be a
      // server-rendered surface that has to read the fresh session, and the
      // auth events have already run against this document.
      navigateAfterHandlePasswordSignIn(redirectTo, window.location);
    } catch {
      setError(
        offlineOrMessage("Sign-in did not finish. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="loginPageQuietLink loginPageHandlePasswordToggle"
        data-testid="e2e-login-toggle"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        Sign in with handle and password
      </button>
    );
  }

  return (
    <form
      className="loginPageHandlePassword"
      method="post"
      autoComplete="on"
      onSubmit={onSubmit}
      aria-label="Sign in with handle and password"
    >
      <h2 className="loginPageHandlePasswordTitle">Sign in with handle and password</h2>
      <label className="loginPageHandlePasswordField">
        Handle
        <input
          type="text"
          name="username"
          data-testid="e2e-login-handle"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          pattern="[A-Za-z0-9_]{3,30}"
          required
          disabled={busy || disabled}
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
        />
      </label>
      <label className="loginPageHandlePasswordField">
        Password
        <input
          type="password"
          name="password"
          data-testid="e2e-login-password"
          autoComplete="current-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          disabled={busy || disabled}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="loginPageHandlePasswordActions">
        <button
          type="submit"
          className="loginPagePrimary"
          data-testid="e2e-login-submit"
          disabled={busy || disabled}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          className="loginPageQuietLink"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
            setPassword("");
          }}
        >
          Back to email link
        </button>
      </div>
      {error ? (
        <>
          <p className="authError loginPageError" role="alert">
            {error}
          </p>
          <p className="loginPageHandlePasswordGuidance">{NO_PASSWORD_GUIDANCE}</p>
        </>
      ) : null}
    </form>
  );
}
