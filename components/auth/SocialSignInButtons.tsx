"use client";

import type { SocialAuthProviderAvailability } from "@/lib/authProviderAvailability";

function GoogleMark(): React.JSX.Element {
  return (
    <svg className="authProviderMark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

function AppleMark(): React.JSX.Element {
  return (
    <svg className="authProviderMark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17.05 12.54c-.03-3.08 2.51-4.58 2.62-4.65a5.63 5.63 0 0 0-4.43-2.4c-1.86-.2-3.67 1.12-4.62 1.12-.98 0-2.46-1.1-4.05-1.07a5.9 5.9 0 0 0-4.97 3.03c-2.14 3.7-.55 9.14 1.51 12.14 1.03 1.47 2.23 3.11 3.81 3.05 1.55-.06 2.13-.98 4-.98 1.84 0 2.39.98 4 .94 1.66-.03 2.7-1.47 3.69-2.95a12.1 12.1 0 0 0 1.68-3.42 5.26 5.26 0 0 1-3.24-4.81ZM14.02 3.52A5.35 5.35 0 0 0 15.25 0a5.47 5.47 0 0 0-3.54 1.68 5.08 5.08 0 0 0-1.27 3.38 4.52 4.52 0 0 0 3.58-1.54Z"
      />
    </svg>
  );
}

function ProviderLabel({
  name,
  fullLabels,
}: {
  name: "Google" | "Apple";
  fullLabels: boolean;
}): React.JSX.Element {
  if (fullLabels) return <>Continue with {name}</>;
  return (
    <>
      <span className="authSignInLabelFull" aria-hidden="true">
        Continue with {name}
      </span>
      <span className="authSignInLabelShort" aria-hidden="true">
        {name}
      </span>
    </>
  );
}

export default function SocialSignInButtons({
  availability,
  disabled,
  onGoogle,
  onApple,
  className,
  fullLabels = false,
}: {
  availability: SocialAuthProviderAvailability;
  disabled: boolean;
  onGoogle: () => void | Promise<void>;
  onApple: () => void | Promise<void>;
  className?: string;
  fullLabels?: boolean;
}): React.JSX.Element | null {
  if (!availability.google && !availability.apple) return null;

  const classes = ["authProviders", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {availability.google ? (
        <button
          type="button"
          className="authSignIn"
          onClick={() => void onGoogle()}
          disabled={disabled}
          aria-label="Continue with Google"
        >
          <GoogleMark />
          <ProviderLabel name="Google" fullLabels={fullLabels} />
        </button>
      ) : null}
      {availability.apple ? (
        <button
          type="button"
          className="authSignIn"
          onClick={() => void onApple()}
          disabled={disabled}
          aria-label="Continue with Apple"
        >
          <AppleMark />
          <ProviderLabel name="Apple" fullLabels={fullLabels} />
        </button>
      ) : null}
    </div>
  );
}
