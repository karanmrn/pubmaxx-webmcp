"use client";

import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

import type { AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import type { ProviderAuthState } from "@/lib/authProviderRevision";
import {
  NO_SOCIAL_AUTH_PROVIDERS,
  type SocialAuthProviderAvailability,
} from "@/lib/authProviderAvailability";
import type { DeviceAccountSwitchOutcome } from "@/lib/deviceAccountSwitch";
import type { ResumeHint } from "@/lib/authSessionResumeClient";
import type { MagicLinkResult } from "@/lib/passwordlessAuth";

/** How far a sign-out reaches: this account, or every account on this device. */
export type SignOutScope = "account" | "device";

export type AuthContextValue = {
  /** Current session, or null when signed out / not yet loaded. */
  session: Session | null;
  /** Convenience: session?.user, or null. */
  user: User | null;
  /** True until the first getSession() resolves — lets UI avoid a flash. */
  loading: boolean;
  /** True when the public Supabase env is present (sign-in can be attempted). */
  configured: boolean;
  /** True only when server saw both valid Clerk keys. Contains no secret data. */
  clerkIntegrationConfigured: boolean;
  /** Social providers enabled by the current Supabase Auth settings read. */
  socialProviders: SocialAuthProviderAvailability;
  /** Start the Google OAuth redirect. No-op (returns an error) when unconfigured. */
  signInWithGoogle: (next?: string) => Promise<{ error: string | null }>;
  /** Start the Apple OAuth redirect. No-op when unconfigured. */
  signInWithApple: (next?: string) => Promise<{ error: string | null }>;
  /** Send a passwordless email link with normalized, non-enumerating feedback. */
  signInWithEmail: (email: string, next?: string) => Promise<MagicLinkResult>;
  /** User cancelled an abandoned provider or magic-link attempt. */
  cancelAuthAttempt: () => void;
  /**
   * Clear the local session. "account" (the default) signs out the active
   * account alone and hands the device to the next account still signed in on
   * it; "device" signs out every remembered account and empties the lane.
   */
  signOut: (scope?: SignOutScope) => Promise<void>;
  /**
   * Make another account remembered on this device the active one. The swap
   * itself is `setSession` plus the ordinary auth event, so identity binds in
   * exactly one place (lib/deviceAccountSwitch.ts).
   */
  switchAccount: (userId: string) => Promise<DeviceAccountSwitchOutcome>;
  /**
   * Signed-out device that held a session whose durable resume cookie has
   * expired: the masked account email for the welcome-back path, else null.
   */
  welcomeBack: ResumeHint | null;
  /** One-tap re-auth: email a sign-in link to the saved address. */
  resumeSignIn: (next?: string) => Promise<MagicLinkResult>;
  /** Account-owned public handle, or null before onboarding or when signed out. */
  handle: string | null;
  /**
   * True once the live session's canonical identity has actually been read.
   * While false, `handle` being null means UNKNOWN, not "no handle": a surface
   * that names or routes the viewer must stay neutral rather than reach for a
   * device cache, which is where the previous account's handle lives.
   */
  identityResolved: boolean;
  /** Opaque account boundary shared by Supabase and Clerk-backed Social auth. */
  accountRevision: number;
  /** Provider-neutral auth readiness. No provider identity leaves this seam. */
  providerAuthState: ProviderAuthState;
  /** Supabase session readiness, used by Supabase sign-in controls. */
  supabaseAuthState: ProviderAuthState;
  rejectedContributionAuth: AccountAuthSnapshot | null;
  contributionAuth: AccountAuthSnapshot | null;
  invalidateContributionAuth: (auth: AccountAuthSnapshot) => void;
  getCurrentUserId: () => string | null;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

const SIGNED_OUT_AUTH: AuthContextValue = {
  session: null,
  user: null,
  loading: false,
  configured: false,
  clerkIntegrationConfigured: false,
  socialProviders: NO_SOCIAL_AUTH_PROVIDERS,
  signInWithGoogle: async () => ({ error: "Sign-in is not configured." }),
  signInWithApple: async () => ({ error: "Sign-in is not configured." }),
  signInWithEmail: async () => ({ status: "error", message: "Sign-in is not configured." }),
  cancelAuthAttempt: () => {},
  signOut: async () => {},
  switchAccount: async () => ({ status: "unavailable" }),
  welcomeBack: null,
  resumeSignIn: async () => ({
    status: "error",
    message: "Sign-in is not configured.",
  }),
  handle: null,
  identityResolved: false,
  accountRevision: 0,
  providerAuthState: "signed-out",
  supabaseAuthState: "signed-out",
  rejectedContributionAuth: null,
  contributionAuth: null,
  invalidateContributionAuth: () => {},
  getCurrentUserId: () => null,
};

/** Read the auth context. Returns a safe signed-out shape outside a provider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  return SIGNED_OUT_AUTH;
}
