"use client";

import { FormEvent, useEffect, useId, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import PasswordPolicyHint from "@/components/auth/PasswordPolicyHint";
import {
  AuthActionSessionError,
  authedActionFetch,
} from "@/lib/authedFetch";
import { ensureSupabaseBrowser } from "@/lib/authClient";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_CHANGE_GENERIC_ERROR,
  checkPassword,
} from "@/lib/passwordPolicy";
import { discardBody } from "@/lib/responseBody";

/**
 * Create or change the password on the signed-in account.
 *
 * SIGNED-IN ONLY, and that is the whole security argument: the update is
 * `supabase.auth.updateUser({ password })`, which GoTrue binds to the caller's
 * OWN session. There is deliberately no route of ours in this path. A form that
 * could set a password for a named handle without a session is account
 * takeover, however it is worded.
 *
 * The password is Supabase auth's. It is never sent to our server, never
 * stored in our tables and never logged.
 *
 * `hasPassword` is TRI-STATE (`/api/identity/handle/current`): null means the
 * read could not answer, and then no password surface renders.
 */
export default function SetAccountPassword(): React.JSX.Element | null {
  const { configured, user, identityResolved } = useAuth();
  const [hasHandle, setHasHandle] = useState(false);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [handleLoaded, setHandleLoaded] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();

  useEffect(() => {
    if (!user || !identityResolved) {
      void Promise.resolve().then(() => {
        setHasHandle(false);
        setHasPassword(null);
        setHandleLoaded(false);
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await authedActionFetch("/api/identity/handle/current");
        if (!res.ok) {
          discardBody(res);
          if (!cancelled) {
            setHasHandle(false);
            setHasPassword(null);
            setHandleLoaded(true);
          }
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          handle?: string | null;
          hasPassword?: boolean | null;
        };
        if (!cancelled) {
          setHasHandle(typeof body.handle === "string" && body.handle.length > 0);
          setHasPassword(
            typeof body.hasPassword === "boolean" ? body.hasPassword : null,
          );
          setHandleLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setHasHandle(false);
          setHasPassword(null);
          setHandleLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identityResolved, user]);

  if (!configured || !user || !identityResolved || !handleLoaded) return null;
  if (hasPassword === null) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    setError(null);

    if (!hasHandle) {
      setError("Claim a handle before setting a password.");
      return;
    }
    const check = checkPassword(password);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (hasPassword === true && !currentPassword) {
      setError(PASSWORD_CHANGE_GENERIC_ERROR);
      return;
    }

    setBusy(true);
    try {
      const supabase = await ensureSupabaseBrowser();
      if (!supabase) {
        setError("Sign-in is not configured on this build.");
        return;
      }
      if (hasPassword === true) {
        const verification = await authedActionFetch(
          "/api/auth/change-password/verify",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ currentPassword }),
          },
        );
        if (!verification.ok) {
          discardBody(verification);
          setError(PASSWORD_CHANGE_GENERIC_ERROR);
          return;
        }
        await verification.json().catch(() => null);
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          hasPassword === true
            ? PASSWORD_CHANGE_GENERIC_ERROR
            : "Could not set your password. Try again.",
        );
        return;
      }
      setCurrentPassword("");
      setPassword("");
      setConfirm("");
      setHasPassword(true);
      setMessage("Password saved. You can sign in with your handle next time.");
    } catch (error) {
      setError(
        error instanceof AuthActionSessionError
          ? error.message
          : hasPassword === true
            ? PASSWORD_CHANGE_GENERIC_ERROR
            : "Could not set your password. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Only a read that ANSWERED may name a state. A create-flavoured heading over
  // an account that already has one would read as "yours has gone".
  const heading =
    hasPassword === true ? "Change password" : "Create password";
  const intro =
    hasPassword === true
      ? "Pick a new password for signing in with your handle."
      : "You sign in with an email link. Add a password and you can use your handle instead.";

  const passwordForm = (
    <form
      className={`accountHubPassword${hasPassword === false ? " accountHubPasswordOwed" : ""}`}
      method="post"
      autoComplete="on"
      onSubmit={onSubmit}
    >
      <h3>{heading}</h3>
      <p>{intro}</p>
      {hasPassword === true ? (
        <label>
          Current password
          <input
            type="password"
            name="current-password"
            autoComplete="current-password"
            value={currentPassword}
            disabled={busy}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
      ) : null}
      <label>
        {hasPassword === true ? "New password" : "Password"}
        <input
          type="password"
          name="new-password"
          autoComplete="new-password"
          aria-describedby={hintId}
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <PasswordPolicyHint value={password} id={hintId} />
      <label>
        Confirm password
        <input
          type="password"
          name="new-password-confirmation"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={confirm}
          disabled={busy}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save password"}
      </button>
      {message ? (
        <p className="accountHubMessage" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="accountHubMessage accountHubPasswordError" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );

  return hasPassword === true ? (
    <details className="accountHubPasswordChange">
      <summary>Change password</summary>
      {passwordForm}
    </details>
  ) : (
    passwordForm
  );
}
