"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogIn } from "lucide-react";

import AccountDeviceControls from "@/components/auth/AccountDeviceControls";
import { useAuth, type SignOutScope } from "@/components/auth/AuthProvider";
import { useDeviceAccounts } from "@/components/auth/useDeviceAccounts";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import HandlePasswordSignIn from "@/components/auth/HandlePasswordSignIn";
import type { MagicLinkResult } from "@/lib/passwordlessAuth";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";
import { isClerkProductSessionAvailable } from "@/lib/clerkAvailability";
import { trackEvent } from "@/lib/analytics";
import {
  ARRIVAL_FROM_PARAM,
  ARRIVAL_INTENT_PARAM,
  LOGIN_ADD_ACCOUNT_PARAM,
  rememberChosenIntent,
  type ArrivalIntent,
} from "@/lib/arrivalWelcome";
import type { DeviceAccountRecord } from "@/lib/deviceAccountSessions";
import type { DeviceAccountSwitchOutcome } from "@/lib/deviceAccountSwitch";
import { HANDLE_CLAIM_NEXT } from "@/lib/authRedirect";
import { addLinkAwareDestination } from "@/lib/addLink";
import { loginPageHeadCopy, loginPageShowsSkeleton } from "@/lib/loginPageFraming";
import { authAvatarInitials } from "@/lib/authAvatarInitials";

import "@/app/auth/auth.css";
import "./loginPage.css";

/**
 * The two doors. They share the link machinery and differ in the three things a
 * person actually notices: what the page says, what the email is for, and where
 * they end up. A returning drinker goes back to the page they came from; a new
 * one goes to the surface that finishes their account.
 *
 * The legal lead-in is the fourth thing, and it lives here for the same reason
 * the other three do: it was a single hardcoded sentence, so the door that
 * CREATES an account told the reader they were agreeing to the terms "by
 * signing in", which is not the thing they were about to do.
 */
const DOORS: Record<
  ArrivalIntent,
  {
    tab: string;
    title: string;
    lead: string;
    emailLabel: string;
    emailCta: string;
    legalLead: string;
  }
> = {
  signin: {
    tab: "Sign in",
    title: "Welcome back",
    lead: "Your prices, plans and nights are on your account. Pick up where you left off.",
    emailLabel: "Sign in with your email",
    emailCta: "Email me a sign-in link",
    legalLead: "By signing in you agree to the",
  },
  signup: {
    tab: "New here",
    title: "Let's get you in",
    lead: "Log a pint price, plan a crawl, keep your nights. Takes a handle and a minute.",
    emailLabel: "Create your account with email",
    emailCta: "Email me a sign-up link",
    legalLead: "By creating an account you agree to the",
  },
};

function displayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return (
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    user.email ||
    "Signed in"
  );
}

function avatarUrl(user: {
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return (
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    ""
  );
}

/**
 * The already-signed-in state: who you are here, and three ways onward.
 *
 * This is the account home on a PHONE, because the nav account card is hidden
 * below 640px, so it carries the same device controls that card does: switch to
 * another account signed in here, add one, and leave at either scope.
 */
function SignedInCard({
  user,
  handle,
  busy,
  onSignOut,
  activeUserId,
  deviceAccounts,
  onSwitchAccount,
  addAccountHref,
}: {
  user: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
  handle: string | null;
  busy: boolean;
  onSignOut: (scope: SignOutScope) => void;
  activeUserId: string | null;
  deviceAccounts: readonly DeviceAccountRecord[];
  onSwitchAccount: (userId: string) => Promise<DeviceAccountSwitchOutcome>;
  addAccountHref: string;
}): React.JSX.Element {
  const avatar = avatarUrl(user);
  return (
    <section className="loginPageSignedIn" aria-label="Signed-in account">
      <div className="loginPageIdentity">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote IdP avatar
          <img
            className="authAvatar loginPageAvatar"
            src={avatar}
            alt=""
            width={48}
            height={48}
          />
        ) : (
          <span className="authAvatarFallback loginPageAvatar" aria-hidden="true">
            {authAvatarInitials(displayName(user))}
          </span>
        )}
        <div className="loginPageIdentityText">
          <p className="loginPageWho">{displayName(user)}</p>
          {user.email ? <p className="loginPageEmail">{user.email}</p> : null}
        </div>
      </div>
      <div className="loginPageActions">
        <Link href="/map" className="loginPagePrimary">
          Continue to the map
        </Link>
        <Link href="/u/you" className="loginPageSecondary">
          Your profile
        </Link>
        <AccountDeviceControls
          handle={handle}
          activeUserId={activeUserId}
          deviceAccounts={deviceAccounts}
          onSwitchAccount={onSwitchAccount}
          addAccountHref={addAccountHref}
          onSignOut={onSignOut}
          signOutDisabled={busy}
          signOutClassName="authSignOut loginPageSignOut"
        />
      </div>
    </section>
  );
}

/**
 * The device held a session whose durable resume cookie has expired. One tap
 * re-sends the link to the saved address, so the return is not a cold form.
 */
function WelcomeBackCard({
  maskedEmail,
  status,
  message,
  onResume,
  onUseDifferentAccount,
}: {
  maskedEmail: string | null;
  status: "idle" | "sending" | MagicLinkResult["status"];
  message: string;
  onResume: () => void;
  onUseDifferentAccount: () => void;
}): React.JSX.Element {
  const settled = status === "sending" || status === "sent";
  const continueLabel = maskedEmail
    ? `Continue as ${maskedEmail}`
    : "Email me a sign-in link";
  return (
    <section className="loginPageWelcomeBack" aria-label="Continue signed in">
      <h2 className="loginPageWelcomeBackTitle">Welcome back</h2>
      <p className="loginPageWelcomeBackLead">
        Your session on this device ended.
        {maskedEmail
          ? ` Continue as ${maskedEmail}.`
          : " Continue with your saved sign-in."}
      </p>
      <button
        type="button"
        className="loginPagePrimary loginPageWelcomeBackContinue"
        onClick={onResume}
        disabled={settled}
      >
        {status === "sending"
          ? "Sending…"
          : status === "sent"
            ? "Link sent"
            : continueLabel}
      </button>
      {message ? (
        <p
          className={
            status === "sent" ? "authMagicLinkSuccess" : "authError loginPageError"
          }
          role={status === "sent" ? "status" : "alert"}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
      <button
        type="button"
        className="loginPageQuietLink loginPageWelcomeBackSwitch"
        onClick={onUseDifferentAccount}
      >
        Use a different account
      </button>
    </section>
  );
}

/**
 * What stands where the sign-in card will be while the live session answers.
 * It says nothing about the person, because nothing is known yet: no sentence
 * about checking, no spinner text, just the shape the card is about to take.
 *
 * TWO rules hold the spoken half up, and they pull against each other.
 * `aria-busy` tells assistive technology to withhold updates from everything it
 * wraps, and busy never clears here - the whole subtree unmounts the moment the
 * session answers - so the live region may NOT sit inside it. It is a sibling
 * of the busy shape rather than a child of it. And the line is empty on the
 * first paint and fills after mount, because a live region announces a CHANGE:
 * text already there when the region appeared is never spoken.
 */
function SignInSkeleton(): React.JSX.Element {
  const announcement = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const node = announcement.current;
    if (node) node.textContent = "Loading";
  }, []);

  return (
    <>
      <p ref={announcement} className="loginPageSrOnly" role="status" />
      <div className="loginPageSkeleton" aria-busy="true">
        <div className="loginPageSkeletonDoors" aria-hidden="true">
          <span className="loginPageSkeletonPill" />
          <span className="loginPageSkeletonPill" />
        </div>
        <div className="loginPageSkeletonOptions" aria-hidden="true">
          <span className="loginPageSkeletonBar" />
          <span className="loginPageSkeletonBar" />
          <span className="loginPageSkeletonField" />
          <span className="loginPageSkeletonButton" />
        </div>
      </div>
    </>
  );
}

/** What the page says, which is the first thing a door differs in. */
function PageHead({
  title,
  lead,
}: {
  title: string;
  lead: string;
}): React.JSX.Element {
  return (
    <header className="loginPageHead">
      <p className="loginPageEyebrow">PUBMAXXING</p>
      <h1 className="loginPageTitle">{title}</h1>
      <p className="loginPageLead">{lead}</p>
    </header>
  );
}

/** The two doors as one control. Extracted so the page body stays readable. */
function DoorSwitch({
  intent,
  onChoose,
}: {
  intent: ArrivalIntent;
  onChoose: (next: ArrivalIntent) => void;
}): React.JSX.Element {
  return (
    <div
      className="loginPageDoors"
      role="tablist"
      aria-label="Sign in or create an account"
    >
      {(["signin", "signup"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          className="loginPageDoor"
          aria-selected={intent === option}
          data-selected={intent === option ? "" : undefined}
          onClick={() => onChoose(option)}
        >
          {DOORS[option].tab}
        </button>
      ))}
    </div>
  );
}

/**
 * Full-page sign-in surface. Owns the email-link flow as a first-class page
 * (not only the nav popover). Phone nav Sign in routes here; desktop may still
 * use the compact popover as a fast path.
 *
 * Two named doors share that machinery. They differ in what the page says, what
 * the email is for, and where a completed sign-in lands, because a returning
 * drinker asking to sign in should never have to wonder whether the page is
 * about to make them a second account.
 */
export default function LoginPage({
  initialIntent = "signin",
  from = null,
  addAccount = false,
}: {
  initialIntent?: ArrivalIntent;
  from?: string | null;
  /**
   * A person who already has a session and wants a SECOND account on this
   * device (the account switcher's Add account). The live session is left alone;
   * this page simply offers its form instead of the "you are signed in" card,
   * and the new sign-in becomes the active account through the one auth event.
   */
  addAccount?: boolean;
} = {}): React.JSX.Element {
  const {
    user,
    loading,
    configured,
    clerkIntegrationConfigured,
    socialProviders,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    cancelAuthAttempt,
    signOut,
    switchAccount,
    welcomeBack,
    resumeSignIn,
    handle: accountHandle,
  } = useAuth();
  // ONE live read of the remembered-account lane on this page.
  const deviceAccounts = useDeviceAccounts();
  const [busy, setBusy] = useState<"google" | "apple" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumeStatus, setResumeStatus] = useState<
    "idle" | "sending" | MagicLinkResult["status"]
  >("idle");
  const [resumeMessage, setResumeMessage] = useState("");
  const [useDifferentAccount, setUseDifferentAccount] = useState(false);
  // Seeded from the URL on the server (app/login/page.tsx), so the right door
  // is open on first paint and switching is a local, instant thing.
  const [intent, setIntent] = useState<ArrivalIntent>(initialIntent);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        cancelAuthAttempt();
        setBusy(null);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [cancelAuthAttempt]);

  const door = DOORS[intent];
  /**
   * Where a completed sign-in lands. A SIGN-UP always finishes on the claim
   * surface, so an add link (/add/<handle>?auto=1) has to ride WITH it: the
   * claim surface and the onboarding sheet both hand a person back to their
   * `?returnTo=` when they are done, which is how a stranger who followed a
   * friend's share link ends up back on it with an account.
   */
  const destination = useMemo(
    () => addLinkAwareDestination(intent, from, HANDLE_CLAIM_NEXT),
    [from, intent],
  );
  /**
   * The handle+password form signs in without navigating, so it needs telling
   * where the person was going. Only an explicit `?from=` counts: a bare
   * /login sign-in keeps showing its signed-in card, as it always has.
   */
  const passwordDestination = from ? destination : null;
  const providerDestination = from ? destination : undefined;

  const chooseDoor = useCallback((next: ArrivalIntent) => {
    setIntent(next);
    const url = new URL(window.location.href);
    url.searchParams.set(ARRIVAL_INTENT_PARAM, next);
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  /**
   * One link machinery, two intents. The door is remembered here rather than
   * encoded in the link, so the greeting on the other side can match the door
   * without putting a marketing parameter in anyone's address bar.
   */
  const sendLink = useCallback(
    async (email: string): Promise<MagicLinkResult> => {
      try {
        rememberChosenIntent(window.localStorage, intent, Date.now());
      } catch {
        // A forgotten door still signs the person in.
      }
      return signInWithEmail(email, destination);
    },
    [destination, intent, signInWithEmail],
  );

  const onSignInGoogle = useCallback(async () => {
    trackEvent("sign_in_initiated", { provider: "google" });
    setBusy("google");
    setError(null);
    const { error: signInError } = providerDestination
      ? await signInWithGoogle(providerDestination)
      : await signInWithGoogle();
    if (signInError) {
      setError(signInError);
      setBusy(null);
    }
  }, [providerDestination, signInWithGoogle]);

  const onSignInApple = useCallback(async () => {
    trackEvent("sign_in_initiated", { provider: "apple" });
    setBusy("apple");
    setError(null);
    const { error: signInError } = providerDestination
      ? await signInWithApple(providerDestination)
      : await signInWithApple();
    if (signInError) {
      setError(signInError);
      setBusy(null);
    }
  }, [providerDestination, signInWithApple]);

  const onResume = useCallback(async () => {
    if (resumeStatus === "sending" || resumeStatus === "sent") return;
    trackEvent("sign_in_initiated", { provider: "email_resume" });
    setResumeStatus("sending");
    setResumeMessage("");
    const result = providerDestination
      ? await resumeSignIn(providerDestination)
      : await resumeSignIn();
    setResumeStatus(result.status);
    setResumeMessage(result.message);
  }, [providerDestination, resumeSignIn, resumeStatus]);

  const onSignOut = useCallback(
    async (scope: SignOutScope) => {
      setBusy("out");
      await signOut(scope);
      setBusy(null);
    },
    [signOut],
  );

  /**
   * The way back to this page for a SECOND account. `from` is where the person
   * was before, and this page is never a destination, so a bare /login visit
   * comes back to the signed-in card it started from.
   */
  const addAccountHref = useMemo(() => {
    const params = new URLSearchParams({ [LOGIN_ADD_ACCOUNT_PARAM]: "1" });
    if (from && from.startsWith("/")) params.set(ARRIVAL_FROM_PARAM, from);
    return `/login?${params.toString()}`;
  }, [from]);

  const clerkSessionAvailable = isClerkProductSessionAvailable(
    user,
    clerkIntegrationConfigured,
  );
  const hasAuthSurface = configured || clerkSessionAvailable;
  // Adding an account is the ONE case where a live session does not get the
  // signed-in card: the person came here to bring a second account onto this
  // device, and telling them they are already in would be answering a question
  // they did not ask.
  const adding = addAccount && Boolean(user);
  const showSignedIn = Boolean(user) && !adding;
  const returning = Boolean(welcomeBack) && !useDifferentAccount;
  const head = loginPageHeadCopy({
    sessionKnown: !loading,
    adding,
    signedIn: Boolean(user),
    returning,
    intent,
    door,
  });

  return (
    <main className="loginPage">
      <div className="loginPageInner">
        <PageHead title={head.title} lead={head.lead} />

        {!hasAuthSurface && !loading ? (
          <p className="loginPageNotice" role="status">
            Sign-in is not configured on this build. You can still browse the
            map.
          </p>
        ) : null}

        {loginPageShowsSkeleton({ sessionKnown: !loading, hasAuthSurface }) ? (
          <SignInSkeleton />
        ) : null}

        {!loading && showSignedIn && user ? (
          <SignedInCard
            user={user}
            handle={accountHandle ?? null}
            busy={busy !== null}
            onSignOut={(scope) => void onSignOut(scope)}
            activeUserId={user.id ?? null}
            deviceAccounts={deviceAccounts}
            onSwitchAccount={switchAccount}
            addAccountHref={addAccountHref}
          />
        ) : null}

        {!loading && !showSignedIn && hasAuthSurface && welcomeBack && !useDifferentAccount ? (
          <WelcomeBackCard
            maskedEmail={welcomeBack.maskedEmail}
            status={resumeStatus}
            message={resumeMessage}
            onResume={onResume}
            onUseDifferentAccount={() => setUseDifferentAccount(true)}
          />
        ) : null}

        {!loading && !showSignedIn && hasAuthSurface && (!welcomeBack || useDifferentAccount) ? (
          <section className="loginPageForm" aria-label="Sign-in options">
            <DoorSwitch intent={intent} onChoose={chooseDoor} />
            <div className="authOptions">
              {configured || clerkSessionAvailable ? (
                <SocialSignInButtons
                  availability={socialProviders}
                  disabled={busy !== null}
                  onGoogle={onSignInGoogle}
                  onApple={onSignInApple}
                  fullLabels
                />
              ) : null}
              {configured ? (
                <>
                  <MagicLinkForm
                    key={intent}
                    disabled={busy !== null}
                    hasSocialProviders={
                      socialProviders.google || socialProviders.apple
                    }
                    signInWithEmail={sendLink}
                    cancelAuthAttempt={cancelAuthAttempt}
                    label={door.emailLabel}
                    submitLabel={door.emailCta}
                  />
                  {intent === "signin" ? (
                    <HandlePasswordSignIn
                      disabled={busy !== null}
                      redirectTo={passwordDestination}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
            {error ? (
              <p className="authError loginPageError" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        ) : null}

        <footer className="loginPageFoot">
          <Link href="/map" className="loginPageQuietLink">
            <LogIn size={14} aria-hidden="true" />
            Browse without signing in
          </Link>
          <p className="loginPageLegal">
            {door.legalLead}{" "}
            <Link href="/terms">terms</Link> and{" "}
            <Link href="/privacy">privacy notice</Link>.
          </p>
        </footer>
      </div>
    </main>
  );
}
