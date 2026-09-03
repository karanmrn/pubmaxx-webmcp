"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { useAuth } from "@/components/auth/AuthProvider";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import {
  checkAccountHandleAvailability,
  loadAccountOnboardingStatusWithRetry,
} from "@/lib/accountOnboardingClient";
import { parseFoundingMemberNumber } from "@/lib/foundingMembers";
import {
  emitIdentityHandleChanged,
  syncDeviceHandle,
} from "@/lib/identityClient";
import { cleanDateOfBirth } from "@/lib/privateIdentity";
import { normalizeHandle } from "@/lib/profiles";
import { assessPubmaxxHandle } from "@/lib/pubmaxxIdentity";
import { useReconnectRecovery } from "@/lib/useReconnectRecovery";
import { accountClaimReturnToFromUrl } from "@/lib/accountClaimReturnTo";
import { useFocusTrap } from "@/lib/useFocusTrap";

import "./accountOnboarding.css";

type Availability =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "reserved"
  | "invalid";

type AccountOnboardingFormProps = {
  dialogRef?: RefObject<HTMLElement | null>;
  handle: string;
  dateOfBirth: string;
  fullName: string;
  availability: Availability;
  busy: boolean;
  error: string | null;
  onHandleChange: (value: string) => void;
  onDateOfBirthChange: (value: string) => void;
  onFullNameChange: (value: string) => void;
  onSubmit: () => void;
};

export function canSubmitCheckedHandle(
  handle: string,
  checkedHandle: string | null,
  availability: Availability,
): boolean {
  return availability === "available" && handle === checkedHandle;
}

function availabilityCopy(availability: Availability): string | null {
  if (availability === "checking") return "Checking availability…";
  if (availability === "available") return "Handle available.";
  if (availability === "taken") return "That handle is already taken.";
  if (availability === "reserved") return "That handle is not available.";
  if (availability === "invalid") {
    return "Use 3–30 letters, numbers, or underscores.";
  }
  return null;
}

/**
 * The first-timer welcome. Two beats and one action.
 *
 * Beat one is why they are here: a line of the place itself, not a form
 * heading. Beat two is the only thing the account genuinely cannot start
 * without. Nothing optional beyond a name, no second button offering to skip
 * what was never demanded, and no private details that profile editing already
 * owns (components/identity/PrivateIdentityEditor.tsx). A returning account
 * never reaches this surface at all.
 */
export function AccountOnboardingForm({
  dialogRef,
  handle,
  dateOfBirth,
  fullName,
  availability,
  busy,
  error,
  onHandleChange,
  onDateOfBirthChange,
  onFullNameChange,
  onSubmit,
}: AccountOnboardingFormProps): React.JSX.Element {
  const status = availabilityCopy(availability);
  const canSubmit =
    availability === "available" &&
    handle.trim().length > 0 &&
    cleanDateOfBirth(dateOfBirth) !== null &&
    !busy;
  return (
    <div className="accountOnboardingBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="accountOnboarding"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="account-onboarding-title"
        aria-describedby="account-onboarding-lead account-onboarding-privacy"
      >
        <header className="accountOnboardingHead">
          <p className="accountOnboardingEyebrow">Welcome to PUBMAXX</p>
          <h2 id="account-onboarding-title">Let&apos;s get you in</h2>
          <p id="account-onboarding-lead">
            Pick the name people see.{" "}
            {"Your public handle appears on every contribution you make."}
          </p>
        </header>

        <div className="accountOnboardingStep">
          <label className="accountOnboardingField accountOnboardingHandle">
            <span>Your handle</span>
            <span className="accountOnboardingInputWrap">
              <i aria-hidden="true">@</i>
              <input
                value={handle}
                onChange={(event) => onHandleChange(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={31}
                aria-describedby="account-onboarding-handle-status"
              />
            </span>
          </label>
          <p
            id="account-onboarding-handle-status"
            className={`accountOnboardingStatus is-${availability}`}
            role={availability === "taken" || availability === "reserved" ? "alert" : "status"}
          >
            {status ?? "Letters, numbers and underscores."}
          </p>

          <div className="accountOnboardingPair">
            <label className="accountOnboardingField">
              <span>
                Name <small>Optional</small>
              </span>
              <input
                value={fullName}
                onChange={(event) => onFullNameChange(event.target.value)}
                autoComplete="name"
                maxLength={100}
              />
            </label>
            <label className="accountOnboardingField">
              <span>Date of birth</span>
              <input
                type="date"
                value={dateOfBirth}
                autoComplete="bday"
                required
                onChange={(event) => onDateOfBirthChange(event.target.value)}
              />
            </label>
          </div>
        </div>

        <p id="account-onboarding-privacy" className="accountOnboardingPrivacy">
          Only your handle is public. Date of birth and name stay private. We
          use them to check your age and for product analytics and social
          features.
        </p>
        {error ? (
          <p className="accountOnboardingError" role="alert">
            {error}
          </p>
        ) : null}
        <div className="accountOnboardingActions">
          <button
            type="button"
            className="accountOnboardingPrimary"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {busy ? "Claiming…" : availability === "checking" ? "Checking…" : "Claim handle"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AccountOnboardingLoadError({
  error,
  onRetry,
  offline = false,
}: {
  error: string;
  onRetry: () => void;
  offline?: boolean;
}): React.JSX.Element {
  return (
    <section
      className="accountOnboardingLoadError"
      aria-labelledby="account-onboarding-error-title"
    >
      <header className="accountOnboardingHead">
        <p className="accountOnboardingEyebrow">Your PUBMAXX identity</p>
        <h2 id="account-onboarding-error-title">Account setup paused</h2>
        <p className="accountOnboardingError" role="alert">
          {offline ? "You look offline. We will retry when you are back." : error}
        </p>
      </header>
      <button
        type="button"
        className="accountOnboardingPrimary accountOnboardingRetry"
        onClick={onRetry}
      >
        Try again
      </button>
    </section>
  );
}

function suggestedHandle(): string {
  try {
    const stored = window.localStorage.getItem("pubmax_handle") ?? "";
    const assessment = assessPubmaxxHandle(stored);
    return assessment.ok ? assessment.handle : "";
  } catch {
    return "";
  }
}

function AccountOnboardingForUser({
  auth,
  identityResolved,
}: {
  auth: AccountAuthSnapshot;
  identityResolved: boolean;
}): React.JSX.Element | null {
  const [status, setStatus] = useState<
    "loading" | "needed" | "complete" | "unavailable"
  >("loading");
  const [statusError, setStatusError] = useState(
    "Account setup is unavailable right now.",
  );
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [handle, setHandle] = useState(suggestedHandle);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [fullName, setFullName] = useState("");
  const [availability, setAvailability] =
    useState<Availability>("idle");
  const [checkedHandle, setCheckedHandle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const dialogRef = useRef<HTMLElement>(null);

  const retryStatus = useCallback(() => {
    setStatus("loading");
    setStatusAttempt((current) => current + 1);
  }, []);

  const finish = useCallback(() => {
    setStatus("complete");
    const currentUrl =
      typeof window !== "undefined" && typeof window.location?.href === "string"
        ? window.location.href
        : "";
    const returnTo = accountClaimReturnToFromUrl(currentUrl);
    if (returnTo && typeof window.location?.assign === "function") {
      window.location.assign(returnTo);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!identityResolved) return;
    let activeLoad = true;
    const controller = new AbortController();
    void loadAccountOnboardingStatusWithRetry(
      (input, init) => accountBoundFetch(auth, input, init),
      controller.signal,
    ).then(
      (result) => {
        if (!activeLoad) return;
        if (result.status === "interrupted") return;
        if (result.status === "unavailable") {
          // Fetch failed: never fall through to the claim form.
          setStatusError(result.error);
          setStatus("unavailable");
          return;
        }
        const serverHandle =
          typeof result.handle === "string"
            ? normalizeHandle(result.handle)
            : "";
        if (serverHandle) {
          try {
            syncDeviceHandle(window.localStorage, serverHandle);
          } catch {
            // Storage blocked: account ownership is still server-truth.
          }
          emitIdentityHandleChanged({
            ownerId: auth.userId,
            handle: serverHandle,
          });
          // An account that already owns a handle is owed NOTHING on arrival.
          // It used to be met by a blocking owned-identity dialog whenever the
          // read came back incomplete, which any handle claimed through POST
          // /api/identity/handle/claim always does: that route stores no date
          // of birth, so `complete` is false for the life of the account.
          // Mounted at the app root, the dialog then covered every tab, and
          // only React state ever dismissed it. Renaming lives in profile
          // editing; a missing private detail is asked for there too. Arrival
          // stays quiet either way. __tests__/accountOnboarding.test.ts pins it.
          finish();
          return;
        }
        if (result.status === "complete") {
          finish();
          return;
        }
        const suggestion = suggestedHandle();
        setHandle(suggestion);
        setCheckedHandle(null);
        setAvailability(suggestion ? "checking" : "idle");
        setStatus("needed");
      },
    );
    return () => {
      activeLoad = false;
      controller.abort();
    };
  }, [auth, finish, identityResolved, statusAttempt]);

  useReconnectRecovery(status === "unavailable", retryStatus);

  const onboardingVisible = status === "needed";
  useFocusTrap(onboardingVisible, dialogRef, "strict-modal");
  useEffect(() => {
    if (!onboardingVisible) return;
    dialogRef.current?.focus({ preventScroll: true });
  }, [onboardingVisible]);

  useEffect(() => {
    if (availability !== "checking") return;
    const assessment = assessPubmaxxHandle(handle);
    if (!assessment.ok) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void checkAccountHandleAvailability(
        assessment.handle,
        fetch,
        controller.signal,
      ).then((result) => {
        if (!active) return;
        if (result.status === "available") {
          setCheckedHandle(assessment.handle);
          setAvailability("available");
          return;
        }
        if (result.status === "taken") {
          setCheckedHandle(null);
          setAvailability("taken");
          return;
        }
        setCheckedHandle(null);
        setAvailability("idle");
        if (!controller.signal.aborted) setError(result.error);
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [availability, handle]);

  const changeHandle = useCallback((value: string) => {
    const presented = value.trim().replace(/^@/, "").toLowerCase();
    setHandle(presented);
    setCheckedHandle(null);
    setError(null);
    const assessment = assessPubmaxxHandle(presented);
    setAvailability(
      assessment.ok
        ? "checking"
        : assessment.reason === "reserved"
          ? "reserved"
          : presented
            ? "invalid"
            : "idle",
    );
  }, []);

  const submit = useCallback(
    async () => {
      if (
        !canSubmitCheckedHandle(handle, checkedHandle, availability) ||
        !cleanDateOfBirth(dateOfBirth) ||
        busy
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const response = await accountBoundFetch(
          auth,
          "/api/identity/onboarding",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              handle,
              dateOfBirth,
              ...(fullName.trim() ? { fullName } : {}),
            }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          handle?: unknown;
          code?: unknown;
          error?: unknown;
          foundingMemberNumber?: unknown;
        };
        if (!active.current) return;
        if (!response.ok) {
          if (body.code === "already_has_handle") {
            // Server already owns a handle: never stay on the claim form, and
            // never answer with a rename field either. Adopt the handle the
            // server names and let the person get on with their night.
            const existing =
              typeof body.error === "string"
                ? body.error.match(/@([A-Za-z0-9_]+)/)?.[1]
                : null;
            if (existing) {
              const owned = normalizeHandle(existing);
              try {
                syncDeviceHandle(window.localStorage, owned);
              } catch {}
              emitIdentityHandleChanged({
                ownerId: auth.userId,
                handle: owned,
              });
              setError(null);
              finish();
              return;
            }
          }
          if (body.code === "taken") setAvailability("taken");
          if (body.code === "reserved") setAvailability("reserved");
          setCheckedHandle(null);
          setError(
            offlineOrMessage(errorMessageFrom(body, "Could not claim that handle."))
          );
          return;
        }
        const claimed =
          typeof body.handle === "string" ? body.handle : handle;
        try {
          syncDeviceHandle(window.localStorage, claimed);
        } catch {
          // Account ownership is durable even when browser storage is blocked.
        }
        emitIdentityHandleChanged({ ownerId: auth.userId, handle: claimed });
        trackEvent("account_claimed", { source: "auth" });
        // This claim landed inside the first hundred. The event carries no
        // props: the number is unique to one account, so sending it would put
        // an account identifier in a payload that carries none.
        if (parseFoundingMemberNumber(body.foundingMemberNumber) !== null) {
          trackEvent("founding_grant");
        }
        finish();
      } catch {
        if (active.current) {
          setError(
            offlineOrMessage("Could not claim that handle. Try again.")
          );
        }
      } finally {
        if (active.current) setBusy(false);
      }
    },
    [
      auth,
      availability,
      busy,
      checkedHandle,
      dateOfBirth,
      finish,
      fullName,
      handle,
    ],
  );

  if (status === "loading" || status === "complete") return null;
  if (status === "unavailable") {
    return (
      <AccountOnboardingLoadError
        error={statusError}
        offline={typeof window !== "undefined" && window.navigator?.onLine === false}
        onRetry={retryStatus}
      />
    );
  }
  return (
    <AccountOnboardingForm
      dialogRef={dialogRef}
      handle={handle}
      dateOfBirth={dateOfBirth}
      fullName={fullName}
      availability={availability}
      busy={busy}
      error={error}
      onHandleChange={changeHandle}
      onDateOfBirthChange={setDateOfBirth}
      onFullNameChange={setFullName}
      onSubmit={() => void submit()}
    />
  );
}

export default function AccountOnboarding(): React.JSX.Element | null {
  const { user, loading, session, identityResolved } = useAuth();
  const sessionAccessToken = session?.access_token ?? null;
  const sessionUserId = session?.user.id ?? null;
  const auth = useMemo(
    () => {
      if (!sessionAccessToken || !sessionUserId) return null;
      return captureAccountAuth(user?.id ?? null, {
        access_token: sessionAccessToken,
        user: { id: sessionUserId },
      });
    },
    [sessionAccessToken, sessionUserId, user?.id],
  );
  if (loading || !user || !auth || typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <AccountOnboardingForUser
      key={user.id}
      auth={auth}
      identityResolved={identityResolved}
    />,
    document.body,
  );
}
