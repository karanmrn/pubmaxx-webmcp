// The landing document is prerendered and CDN-cached, so it cannot name the
// viewer in HTML. The header still has to read the live session after hydrate:
// a signed-in Pubmaxxer must not see "Sign in", and "Sign in" must not appear
// while the session has not answered. Other app pages hide the whole auth
// control on a phone (siteNav.css), which is why /out can look signed-in
// while this bar still shows the signed-out pill.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import SignInButton from "@/components/auth/SignInButton";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
  usePathname: () => "/",
}));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => "PUBMAXXING" }));
vi.mock("@/components/city/CityChooser", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/landing/ThamesHero", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";

afterEach(() => {
  authState.current = {};
});

const session = {
  loading: false,
  configured: true,
  providerAuthState: "signed-out",
  supabaseAuthState: "signed-out",
  clerkIntegrationConfigured: false,
  socialProviders: { google: false, apple: false },
  signInWithGoogle: async () => ({}),
  signInWithApple: async () => ({}),
  signInWithEmail: async () => ({}),
  cancelAuthAttempt: () => {},
  signOut: async () => {},
  switchAccount: async () => ({ status: "unavailable" }),
};

function compactHeader(overrides: Record<string, unknown> = {}): string {
  authState.current = { ...session, ...overrides };
  return renderToStaticMarkup(createElement(SignInButton, { compact: true }));
}

function landingNav(overrides: Record<string, unknown> = {}): string {
  authState.current = { ...session, ...overrides };
  const html = renderToStaticMarkup(createElement(LandingPage));
  const nav = html.match(/<header class="lpNav"[\s\S]*?<\/header>/)?.[0];
  expect(nav, "landing header present").toBeTruthy();
  return nav ?? "";
}

describe("header waits for the live session", () => {
  it("does not offer Sign in while the session has not answered", () => {
    // loading false is not proof of sign-out: durable resume may still restore
    // an account. The compact header used to paint Sign in in that window, so a
    // hard reload of the cached landing document named nobody as a stranger.
    const html = compactHeader({
      user: null,
      handle: null,
      loading: false,
      supabaseAuthState: "unresolved",
    });

    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Account");
  });

  it("does not offer Sign in when the auth client could not load", () => {
    // The captain's report, 2026-09-02: signed in weeks ago, never signed out,
    // and the landing header still said Sign in while the You tab named the
    // account. `unavailable` is the OTHER not-told state, set when the auth
    // client cannot load, and the likeliest cause is a stale document, which
    // `/` always is: it is CDN-cached and prerendered, so a long-lived session
    // resolves entirely in the browser.
    //
    // The test above covered `unresolved` only, which is why #1239's rule was
    // already in place and the bug shipped anyway. Both not-told states now go
    // through providerHasAnswered, so neither can be half-learned again.
    const html = compactHeader({
      user: null,
      handle: null,
      loading: false,
      supabaseAuthState: "unavailable",
    });

    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Account");
  });

  it("still offers Sign in once the session has answered nobody", () => {
    const html = compactHeader({
      user: null,
      handle: null,
      loading: false,
      providerAuthState: "signed-out",
    });

    expect(html).toContain("Sign in");
    expect(html).not.toContain("Account");
  });

  it("uses Supabase readiness after it settles signed-out", () => {
    const html = compactHeader({
      user: null,
      handle: null,
      loading: true,
      supabaseAuthState: "signed-out",
    });

    expect(html).toContain("Sign in");
    expect(html).not.toContain("Account");
  });

  it("still offers Sign in while optional Clerk is unresolved", () => {
    const html = compactHeader({
      user: null,
      handle: null,
      loading: false,
      configured: true,
      clerkIntegrationConfigured: true,
      supabaseAuthState: "signed-out",
      providerAuthState: "unresolved",
    });

    expect(html).toContain("Sign in");
    expect(html).not.toContain("Account");
  });
});

describe("landing header auth state", () => {
  it("shows the signed-in control on the landing bar", () => {
    const nav = landingNav({
      user: {
        email: "someone@example.com",
        user_metadata: { full_name: "Night Owl" },
      },
      handle: "night_person",
      providerAuthState: "authenticated",
    });

    expect(nav).toContain("Account");
    expect(nav).not.toContain("Sign in");
  });

  it("shows Sign in on the landing bar when signed out", () => {
    const nav = landingNav({
      user: null,
      handle: null,
      providerAuthState: "signed-out",
    });

    expect(nav).toContain("Sign in");
    expect(nav).not.toContain("Account");
  });
});
