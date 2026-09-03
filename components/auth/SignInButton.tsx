"use client";

// Google, Apple, and passwordless email sign-in, plus signed-in account controls.
// sign-out control.
//
// ──────────────────────────────────────────────────────────────────────────
// OWNER MANUAL STEPS (required for either button to actually log anyone in):
//
// Full checklist: docs/DEPLOYMENT.md, "Browser sign-in".
// IdP redirect URI is always https://<project-ref>.supabase.co/auth/v1/callback.
// Canonical callback and Supabase URL allowlist are owned by that checklist.
//
// Provider buttons appear only after the configured identity provider says
// that provider is enabled. The selected provider is checked again on click,
// so stale capability state cannot strand someone on a raw provider error.
// ──────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { LogIn } from "lucide-react";

import { useAuth, type SignOutScope } from "@/components/auth/AuthProvider";
import AccountMenu from "@/components/auth/AccountMenu";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import { providerHasAnswered } from "@/lib/authProviderRevision";
import {
  loadPublicProfileCard,
  type PublicProfileCard,
} from "@/components/auth/publicProfileCard";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";
import { useDeviceAccounts } from "@/components/auth/useDeviceAccounts";
import { isClerkProductSessionAvailable } from "@/lib/clerkAvailability";
import { trackEvent } from "@/lib/analytics";
import { handleOnly } from "@/lib/handleDisplay";
import { authAvatarInitials } from "@/lib/authAvatarInitials";
import {
  ARRIVAL_FROM_PARAM,
  LOGIN_ADD_ACCOUNT_PARAM,
} from "@/lib/arrivalWelcome";
import {
  AUTH_MENU_FOCUSABLE_SELECTOR,
  authMenuFocusBoundary,
} from "@/lib/authFocus";

const ClerkAccountControls = dynamic(
  () => import("@/components/auth/ClerkAccountControls"),
  {
    loading: () => (
      <div className="clerkAccount clerkAccountLoading" hidden aria-hidden="true">
        Clerk account controls
      </div>
    ),
  },
);

/** Phone band: full-page /login instead of the nav popover. */
const PHONE_LOGIN_MEDIA = "(max-width: 640px)";

function subscribeClientHydration(): () => void {
  return () => {};
}

function readClientHydration(): boolean {
  return true;
}

function readServerHydration(): boolean {
  return false;
}

/**
 * Hand the page they are standing on to /login, so signing in returns them to
 * it instead of parking them on the account surface. Read at click time, not at
 * render, so the link is right on whichever page the nav happens to be on.
 */
function loginHref(pathname: string | null): string {
  if (!pathname || !pathname.startsWith("/")) return "/login";
  const params = new URLSearchParams({ [ARRIVAL_FROM_PARAM]: pathname });
  return `/login?${params.toString()}`;
}

/**
 * The same page, told that the arriving person already has a session and wants a
 * second account. Without the flag /login answers the signed-in card, so the
 * switcher's Add account would land somewhere with no form on it.
 */
function addAccountLoginHref(pathname: string | null): string {
  const params = new URLSearchParams({ [LOGIN_ADD_ACCOUNT_PARAM]: "1" });
  if (pathname && pathname.startsWith("/")) {
    params.set(ARRIVAL_FROM_PARAM, pathname);
  }
  return `/login?${params.toString()}`;
}

/** Best-effort initials for the avatar fallback when the IdP gives us no photo. */
/**
 * What the nav may call this person, from the three sources that know: the
 * public profile they authored, the identity provider that signed them in, and
 * the handle they claimed. The email is the last resort for the trigger's
 * accessible name and never the card's name.
 */
function accountIdentity(
  metadata: Record<string, unknown>,
  email: string | undefined,
  handle: string | null,
  card: { displayName?: string; avatarUrl?: string } | null,
): { navName: string; cardName: string; avatar: string } {
  const providerName =
    (typeof metadata.full_name === "string" && metadata.full_name)
    || (typeof metadata.name === "string" && metadata.name)
    || "";
  const providerAvatar =
    (typeof metadata.avatar_url === "string" && metadata.avatar_url)
    || (typeof metadata.picture === "string" && metadata.picture)
    || "";
  return {
    navName: providerName || email || "Signed in",
    cardName: card?.displayName || providerName || (handle ? handleOnly(handle) : "Your account"),
    avatar: card?.avatarUrl || providerAvatar,
  };
}

export default function SignInButton({
  compact = false,
}: {
  /**
   * Nav-host mode (SiteNav + landing top bar). The two full "Continue with …"
   * provider buttons only fit alongside a full link row on very wide screens —
   * below that they crowded the nav links into unreadable fragments (1440px)
   * or overflowed the bar at 390px. Compact hosts render a single "Sign in"
   * disclosure that opens the labelled provider buttons in a small popover;
   * the inline pair returns only where it genuinely fits (auth.css ≥1680px).
   * Standalone hosts (signed-out empty states) keep the full pair as before.
   */
  compact?: boolean;
}): React.JSX.Element | null {
  const {
    user,
    configured,
    handle: accountHandle,
    clerkIntegrationConfigured,
    socialProviders,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    cancelAuthAttempt,
    signOut,
    supabaseAuthState,
    switchAccount,
  } = useAuth();
  const clientHydrated = useSyncExternalStore(
    subscribeClientHydration,
    readClientHydration,
    readServerHydration,
  );
  // ONE live read of the remembered-account lane on the page. The card derives
  // its list and its sign-out scope from this, so neither can drift.
  const deviceAccounts = useDeviceAccounts();
  const pathname = usePathname();
  const signInHref = loginHref(pathname);
  const addAccountHref = addAccountLoginHref(pathname);
  const [busy, setBusy] = useState<"google" | "apple" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneLogin, setPhoneLogin] = useState(false);
  // The card plus the handle it is about, so a switch cannot leave the previous
  // account's face above the new account's @handle.
  const [card, setCard] = useState<(PublicProfileCard & { handle: string }) | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const menuId = useId();

  // Phone viewports own a full /login page. Desktop keeps the compact popover.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(PHONE_LOGIN_MEDIA);
    const apply = () => setPhoneLogin(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // A successful provider start normally navigates away before its promise
  // settles, leaving `busy` set. If Back restores this page from the BFCache,
  // React state is restored too, so explicitly re-enable the provider buttons.
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

  // Light-dismiss for the compact popover: outside pointer-down or Escape.
  // Listeners only exist while the menu is open, so this costs nothing when
  // closed and never runs for the non-compact (standalone) variant. Tab/
  // Shift+Tab are trapped between the two provider buttons while the popover
  // is open, so keyboard focus can't silently escape into the nav links
  // behind it (issue #215).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (event.key === "Tab") {
        const focusables = menuRef.current?.querySelectorAll<HTMLElement>(
          AUTH_MENU_FOCUSABLE_SELECTOR,
        );
        if (!focusables || focusables.length === 0) return;
        const target = authMenuFocusBoundary(
          Array.from(focusables),
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
          event.shiftKey,
        );
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Initial focus: move into the popover (first provider button) the moment
  // it opens, so keyboard/AT users land somewhere useful instead of on an
  // invisible menu (issue #215).
  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector<HTMLElement>(AUTH_MENU_FOCUSABLE_SELECTOR);
    first?.focus();
  }, [menuOpen]);

  // Return focus to the trigger whenever the popover closes — but only if
  // nothing else already claimed focus (e.g. the user clicked a nav link to
  // dismiss it, which focuses that link and should keep it). Without this,
  // Escape/outside-dismiss while focus was on a provider button leaves focus
  // stranded on <body> once the menu unmounts (issue #215).
  useEffect(() => {
    if (wasOpenRef.current && !menuOpen) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        triggerRef.current?.focus();
      }
    }
    wasOpenRef.current = menuOpen;
  }, [menuOpen]);

  // The owned avatar and public display name come from the same public profile
  // read the profile page uses, and only once the menu is actually opened.
  // The nav renders on every page, and none of them owe a request for a card
  // nobody looked at.
  //
  // The held card carries the HANDLE it is about, because a switch replaces the
  // account under an open menu: a card keyed on "have we asked yet" kept the
  // previous account's face and display name above the new account's @handle.
  useEffect(() => {
    if (!menuOpen || card?.handle === accountHandle || !accountHandle) return;
    const handle = accountHandle;
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadPublicProfileCard(handle, controller.signal);
      if (controller.signal.aborted || !loaded) return;
      setCard({ handle, ...loaded });
    })();
    return () => controller.abort();
  }, [accountHandle, card, menuOpen]);

  const onSignInGoogle = useCallback(async () => {
    trackEvent("sign_in_initiated", { provider: "google" });
    setBusy("google");
    setError(null);
    const { error: signInError } = await signInWithGoogle();
    // On success the browser redirects to Google, so we usually never get here;
    // if signInWithOAuth returned an error instead, surface it and re-enable.
    if (signInError) {
      setError(signInError);
      setBusy(null);
    }
  }, [signInWithGoogle]);

  const onSignInApple = useCallback(async () => {
    trackEvent("sign_in_initiated", { provider: "apple" });
    setBusy("apple");
    setError(null);
    const { error: signInError } = await signInWithApple();
    if (signInError) {
      setError(signInError);
      setBusy(null);
    }
  }, [signInWithApple]);

  const onSignOut = useCallback(
    async (scope: SignOutScope = "account") => {
      setBusy("out");
      await signOut(scope);
      setBusy(null);
    },
    [signOut],
  );

  // Clerk does not mint the Supabase session that owns PUBMAXX identity. Its
  // secondary controls stay behind an established product session until that
  // provider bridge exists end to end.
  const clerkSessionAvailable = isClerkProductSessionAvailable(
    user,
    clerkIntegrationConfigured,
  );
  if (!configured && !clerkSessionAvailable) {
    return (
      <span
        hidden
        data-auth-configured="false"
        data-auth-resolved={clientHydrated ? "true" : "false"}
        data-auth-empty="true"
      />
    );
  }

  // A user in context is signed-in even while the rest of bootstrap finishes,
  // so a hard reload of a cached document can paint Account as soon as the
  // session is known.
  if (user) {
    const { navName: name, cardName, avatar } = accountIdentity(
      (user.user_metadata ?? {}) as Record<string, unknown>,
      user.email,
      accountHandle,
      card?.handle === accountHandle ? card : null,
    );
    const avatarControl = avatar ? (
      // eslint-disable-next-line @next/next/no-img-element -- remote IdP avatar; no next/image loader configured for it
      <img className="authAvatar" src={avatar} alt="" width={28} height={28} />
    ) : (
      <span className="authAvatarFallback" aria-hidden="true">
        {authAvatarInitials(name)}
      </span>
    );

    if (compact) {
      // The card names the person, not their login. A claimed handle is the
      // identity PUBMAXX knows them by, so it leads; the email is account
      // plumbing and sits quietly at the foot. Without a claimed handle the
      // links point at /u/you, which is the claim surface itself.
      return (
        <div
          className="authUser authUserNav"
          ref={rootRef}
          data-auth-configured="true"
          data-auth-resolved={clientHydrated ? "true" : "false"}
        >
          <div className="authCompact">
            <button
              type="button"
              ref={triggerRef}
              className="authCompactTrigger"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-haspopup="true"
              aria-label={`Account options for ${name}`}
            >
              {avatarControl}
              <span className="authCompactLabel" aria-hidden="true">
                Account
              </span>
            </button>
            {menuOpen ? (
              <AccountMenu
                id={menuId}
                menuRef={menuRef}
                name={cardName}
                handle={accountHandle}
                {...(user.email ? { email: user.email } : {})}
                {...(avatar ? { avatarUrl: avatar } : {})}
                signOutDisabled={busy !== null}
                onSignOut={(scope) => void onSignOut(scope)}
                onNavigate={() => setMenuOpen(false)}
                activeUserId={user.id}
                deviceAccounts={deviceAccounts}
                onSwitchAccount={switchAccount}
                addAccountHref={addAccountHref}
                extraControls={clerkSessionAvailable ? <ClerkAccountControls /> : null}
              />
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div
        className="authUser"
        data-auth-configured="true"
        data-auth-resolved={clientHydrated ? "true" : "false"}
      >
        {avatarControl}
        <span className="authName">{name}</span>
        <button
          type="button"
          className="authSignOut"
          onClick={() => void onSignOut("account")}
          disabled={busy !== null}
        >
          Sign out
        </button>
        {clerkSessionAvailable ? <ClerkAccountControls /> : null}
      </div>
    );
  }

  // ONLY a settled signed-out answer may paint a sign-in invitation.
  //
  // This guarded `supabaseAuthState === "unresolved"` alone, which let the
  // OTHER not-told state through. `unavailable` is set when the auth client
  // cannot load (AuthProvider: "say nothing about the viewer and stop the
  // ceiling from saying it for us"), and the likeliest cause is a stale
  // document, which is exactly what `/` is: it is CDN-cached and prerendered,
  // so a long-lived session resolves entirely in the browser. A drinker signed
  // in weeks ago therefore met "Sign in" in the header while the You tab, which
  // goes through the seam, knew the account perfectly well.
  //
  // `useViewerSession` is that seam and is already tri-state, so the header now
  // reads the same authority as every door #1302 fixed. Reaching here means the
  // signed-in branch above did not return, so the phase is unresolved or
  // signed-out, and only the latter may speak.
  if (!providerHasAnswered(supabaseAuthState) && !clerkSessionAvailable) {
    return (
      <span
        hidden
        data-auth-configured="true"
        data-auth-resolved="false"
        data-auth-empty="true"
      />
    );
  }

  const hasSocialProviders = socialProviders.google || socialProviders.apple;
  // Magic links belong to Supabase. Social buttons belong to whichever
  // configured identity provider owns the capability read.
  const socialOptions = (fullLabels = false) =>
    configured || clerkSessionAvailable ? (
      <SocialSignInButtons
        availability={socialProviders}
        disabled={busy !== null}
        onGoogle={onSignInGoogle}
        onApple={onSignInApple}
        fullLabels={fullLabels}
      />
    ) : null;
  const supabaseOptions = configured ? (
    <>
      {socialOptions()}
      <MagicLinkForm
        disabled={busy !== null}
        hasSocialProviders={hasSocialProviders}
        signInWithEmail={signInWithEmail}
        cancelAuthAttempt={cancelAuthAttempt}
      />
    </>
  ) : (
    socialOptions()
  );
  const options = (
    <div className="authOptions">
      {supabaseOptions}
    </div>
  );

  if (!compact) {
    return (
      <div
        className="authUser"
        data-auth-configured="true"
        data-auth-resolved={clientHydrated ? "true" : "false"}
      >
        {options}
        {error ? (
          <span className="authError" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  // Compact nav host: phone goes to the dedicated /login page; desktop keeps
  // the disclosure so the nav links never get crowded or clipped.
  if (phoneLogin) {
    return (
      <div
        className="authUser authUserNav"
        data-auth-configured="true"
        data-auth-resolved={clientHydrated ? "true" : "false"}
      >
        <div className="authCompact">
          <Link
            href={signInHref}
            className="authCompactTrigger"
            aria-label="Sign in"
          >
            <LogIn size={16} strokeWidth={2} aria-hidden="true" />
            <span className="authCompactLabel" aria-hidden="true">
              Sign in
            </span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="authUser authUserNav"
      ref={rootRef}
      data-auth-configured="true"
      data-auth-resolved={clientHydrated ? "true" : "false"}
    >
      <div className="authCompact">
        <button
          type="button"
          ref={triggerRef}
          className="authCompactTrigger"
          onClick={() => {
            // Desktop fast path: popover. Also expose the full page as a link
            // inside the menu for anyone who wants the dedicated surface.
            setMenuOpen((open) => !open);
          }}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-haspopup="true"
          aria-label="Sign in"
        >
          <LogIn size={16} strokeWidth={2} aria-hidden="true" />
          {/* Visually hidden on the densest tablet band (auth.css ≤900px);
              the aria-label above keeps the accessible name either way. */}
          <span className="authCompactLabel" aria-hidden="true">
            Sign in
          </span>
        </button>
        {menuOpen ? (
          <div className="authMenu" id={menuId} aria-label="Sign in options" ref={menuRef}>
            {configured || clerkSessionAvailable ? (
              <>
                {socialOptions(true)}
                {configured ? (
                  <MagicLinkForm
                    disabled={busy !== null}
                    hasSocialProviders={hasSocialProviders}
                    signInWithEmail={signInWithEmail}
                    cancelAuthAttempt={cancelAuthAttempt}
                  />
                ) : null}
                <Link
                  href={signInHref}
                  className="authMagicLinkCancel"
                  onClick={() => setMenuOpen(false)}
                >
                  Open full sign-in page
                </Link>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <span className="authError" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
