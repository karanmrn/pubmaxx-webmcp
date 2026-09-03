"use client";

import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import {
  genderFromLegacySex,
  londonCalendarDate,
  MAX_GENDER_SELF_DESCRIBED,
  PRIVATE_IDENTITY_GENDER_VALUES,
  type PrivateIdentityGender,
} from "@/lib/privateIdentity";
import { loadPrivateIdentity } from "@/lib/privateIdentityClient";

const GENDER_LABELS: Record<PrivateIdentityGender, string> = {
  woman: "Woman",
  man: "Man",
  non_binary: "Non-binary",
  self_described: "Self-described",
  prefer_not_to_say: "Prefer not to say",
};

type PrivateIdentityEditorFormProps = {
  email: string;
  fullName: string;
  fullNameError: string;
  gender: "" | PrivateIdentityGender;
  genderSelfDescribed: string;
  dateOfBirth: string;
  saving: boolean;
  saveEnabled: boolean;
  message: string;
  onRetryLoad: (() => void) | null;
  onFullNameChange: (value: string) => void;
  onGenderChange: (value: "" | PrivateIdentityGender) => void;
  onGenderSelfDescribedChange: (value: string) => void;
  onDateOfBirthChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function PrivateIdentityEditorForm({
  email,
  fullName,
  fullNameError,
  gender,
  genderSelfDescribed,
  dateOfBirth,
  saving,
  saveEnabled,
  message,
  onRetryLoad,
  onFullNameChange,
  onGenderChange,
  onGenderSelfDescribedChange,
  onDateOfBirthChange,
  onSubmit,
}: PrivateIdentityEditorFormProps): React.JSX.Element {
  // Capture today once so the date ceiling stays stable across re-renders.
  const [dateOfBirthMax] = useState(() => londonCalendarDate(Date.now()));
  return (
    <form onSubmit={onSubmit}>
      <h3>Private account details</h3>
      <label>
        Name
        <input
          value={fullName}
          maxLength={100}
          autoComplete="name"
          aria-invalid={fullNameError ? true : undefined}
          aria-describedby={fullNameError ? "private-name-error" : undefined}
          onChange={(event) => onFullNameChange(event.target.value)}
        />
      </label>
      {fullNameError ? (
        <small id="private-name-error" role="alert">
          {fullNameError}
        </small>
      ) : null}
      {email ? (
        <label>
          Email
          <input value={email} readOnly aria-describedby="private-email-note" />
          <small id="private-email-note">
            Your sign-in address. Sign in with a new address to change it.
          </small>
        </label>
      ) : null}
      <label>
        Date of birth <small>Optional</small>
        <input
          type="date"
          value={dateOfBirth}
          min="1900-01-01"
          max={dateOfBirthMax}
          onChange={(event) => onDateOfBirthChange(event.target.value)}
        />
      </label>
      <label>
        Gender <small>Optional</small>
        <select
          value={gender}
          onChange={(event) =>
            onGenderChange(event.target.value as "" | PrivateIdentityGender)
          }
        >
          <option value="">Not added</option>
          {PRIVATE_IDENTITY_GENDER_VALUES.map((value) => (
            <option value={value} key={value}>
              {GENDER_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {gender === "self_described" ? (
        <label>
          Your words
          <input
            value={genderSelfDescribed}
            maxLength={MAX_GENDER_SELF_DESCRIBED}
            onChange={(event) =>
              onGenderSelfDescribedChange(event.target.value)
            }
          />
        </label>
      ) : null}
      <small>
        Only your handle is public. These details stay private and never show
        on your profile.
      </small>
      <button type="submit" disabled={!saveEnabled || saving}>
        {saving ? "Saving…" : "Save private details"}
      </button>
      {onRetryLoad ? (
        <button type="button" onClick={onRetryLoad}>
          Try again
        </button>
      ) : null}
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

function PrivateIdentityEditorForAccount({
  auth,
  email,
}: {
  auth: AccountAuthSnapshot;
  email: string;
}): React.JSX.Element {
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<"" | PrivateIdentityGender>("");
  const [genderSelfDescribed, setGenderSelfDescribed] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [loaded, setLoaded] = useState({
    gender: "" as "" | PrivateIdentityGender,
    genderSelfDescribed: "",
    dateOfBirth: "",
  });
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [loadRequest, setLoadRequest] = useState(() => ({
    auth,
    attempt: 0,
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [fullNameError, setFullNameError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadPrivateIdentity(
      loadRequest.auth,
      fetch,
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status === "unavailable") {
        setLoadStatus("unavailable");
        setMessage(result.error);
        return;
      }
      setFullName(result.fullName);
      // One Gender field: an account that only ever answered the legacy sex
      // question still shows the gender that answer plainly names. Saving
      // persists it through the gender columns; sex is never rewritten.
      setGender(result.gender || genderFromLegacySex(result.sex));
      setGenderSelfDescribed(result.genderSelfDescribed);
      setDateOfBirth(result.dateOfBirth);
      setLoaded({
        gender: result.gender,
        genderSelfDescribed: result.genderSelfDescribed,
        dateOfBirth: result.dateOfBirth,
      });
      setMessage("");
      setLoadStatus("ready");
    });
    return () => controller.abort();
  }, [loadRequest]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadStatus !== "ready" || saving) return;
    // A name is required to SAVE this form only. Onboarding handle claims and
    // every other flow stay unaffected - the gate lives here, not the API.
    if (!fullName.trim()) {
      setFullNameError("Add your name.");
      return;
    }
    setFullNameError("");
    setSaving(true);
    setMessage("");
    try {
      const response = await accountBoundFetch(
        auth,
        "/api/identity/onboarding",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          // Untouched fields stay out of the payload: an unchanged empty date
          // would read as invalid, and untouched gender keeps saves working
          // for rows that predate the gender columns. Sex is never sent - the
          // editor no longer renders it and the stored value stays untouched.
          body: JSON.stringify({
            fullName: fullName.trim(),
            ...(gender !== loaded.gender ||
            genderSelfDescribed !== loaded.genderSelfDescribed
              ? { gender, genderSelfDescribed }
              : {}),
            ...(dateOfBirth && dateOfBirth !== loaded.dateOfBirth
              ? { dateOfBirth }
              : {}),
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };
      setMessage(
        response.ok
          ? "Private details saved."
          : offlineOrMessage(errorMessageFrom(body, "Private details could not be saved."))
      );
    } catch {
      setMessage(
        offlineOrMessage("Private details could not be saved.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <PrivateIdentityEditorForm
      email={email}
      fullName={fullName}
      fullNameError={fullNameError}
      gender={gender}
      genderSelfDescribed={genderSelfDescribed}
      dateOfBirth={dateOfBirth}
      saving={saving}
      saveEnabled={loadStatus === "ready"}
      message={message}
      onRetryLoad={
        loadStatus === "unavailable"
          ? () => {
              setLoadStatus("loading");
              setMessage("");
              setLoadRequest((current) => ({
                auth,
                attempt: current.attempt + 1,
              }));
            }
          : null
      }
      onFullNameChange={(value) => {
        if (value.trim()) setFullNameError("");
        setFullName(value);
      }}
      onGenderChange={setGender}
      onGenderSelfDescribedChange={setGenderSelfDescribed}
      onDateOfBirthChange={setDateOfBirth}
      onSubmit={(event) => void save(event)}
    />
  );
}

export default function PrivateIdentityEditor(): React.JSX.Element | null {
  const { user, session, identityResolved } = useAuth();
  const auth = captureAccountAuth(user?.id ?? null, session);
  const email = typeof user?.email === "string" ? user.email : "";
  if (!auth || !identityResolved) {
    if (auth) return null;
    return (
      <PrivateIdentityEditorForm
        email=""
        fullName=""
        fullNameError=""
        gender=""
        genderSelfDescribed=""
        dateOfBirth=""
        saving={false}
        saveEnabled={false}
        message="Private details are unavailable. Sign in again."
        onRetryLoad={null}
        onFullNameChange={() => {}}
        onGenderChange={() => {}}
        onGenderSelfDescribedChange={() => {}}
        onDateOfBirthChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
      />
    );
  }
  return (
    <PrivateIdentityEditorForAccount
      key={auth.userId}
      auth={auth}
      email={email}
    />
  );
}
