// The nav account menu is an identity card, not a settings list. A truncated
// email with one Sign out button beside it told a person nothing about who
// PUBMAXX thinks they are, and offered nowhere to go.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import AccountMenu from "@/components/auth/AccountMenu";
import SignInButton from "@/components/auth/SignInButton";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => authState.current }));
vi.mock("@/components/auth/ClerkAccountControls", () => ({
  default: () => "Clerk account controls",
}));

afterEach(() => {
  authState.current = {};
});

const session = {
  loading: false,
  configured: true,
  supabaseAuthState: "signed-out",
  clerkIntegrationConfigured: false,
  socialProviders: { google: false, apple: false },
  signInWithGoogle: async () => ({}),
  signInWithApple: async () => ({}),
  signInWithEmail: async () => ({}),
  cancelAuthAttempt: () => {},
  signOut: async () => {},
};

function menuMarkup(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(AccountMenu, {
      id: "account-menu",
      name: "Night Owl",
      handle: "night_person",
      email: "someone.with.a.long.address@example.com",
      onSignOut: () => {},
      ...overrides,
    }),
  );
}

describe("account card", () => {
  it("leads with the person, not their login", () => {
    const html = menuMarkup();

    expect(html).toContain("Night Owl");
    expect(html).toContain("@night_person");
    // The email is still reachable, but last and quiet.
    expect(html).toContain("someone.with.a.long.address@example.com");
    expect(html.indexOf("Night Owl")).toBeLessThan(html.indexOf("someone.with.a.long"));
    expect(html.indexOf("authAccountEmail")).toBeGreaterThan(html.indexOf("Your profile"));
  });

  it("wears the owned avatar, and initials when there is none", () => {
    expect(menuMarkup({ avatarUrl: "/avatars/night_person.jpg" })).toContain(
      "/avatars/night_person.jpg",
    );

    const fallback = menuMarkup();
    expect(fallback).not.toContain("<img");
    expect(fallback).toContain(">N</span>");
  });

  it("offers the three places a person goes, plus the way out", () => {
    const html = menuMarkup();

    expect(html).toContain('href="/u/night_person"');
    expect(html).toContain('href="/u/night_person#wanted"');
    expect(html).toContain('href="/u/night_person?edit=1"');
    expect(html).toContain("Your profile");
    expect(html).toContain("Your Wanteds");
    expect(html).toContain("Edit profile");
    expect(html).toContain("Sign out");
  });

  it("sends an unclaimed account to the surface that claims a handle", () => {
    const html = menuMarkup({ handle: null });

    expect(html).toContain("Claim your @handle");
    expect(html).toContain('href="/u/you"');
    expect(html).toContain('href="/u/you?edit=1"');
  });

  it("prints no email line when the session has no address", () => {
    const html = menuMarkup({ email: undefined });

    expect(html).not.toContain("authAccountEmail");
    expect(html).toContain("Sign out");
  });
});

describe("nav account control", () => {
  it("offers the account disclosure when signed in", () => {
    authState.current = {
      ...session,
      user: { email: "someone@example.com", user_metadata: { full_name: "Night Owl" } },
      handle: "night_person",
    };
    const html = renderToStaticMarkup(createElement(SignInButton, { compact: true }));

    expect(html).toContain("Account");
    expect(html).toContain("Account options for Night Owl");
    // The card only mounts on a tap, so a closed nav leaks no address.
    expect(html).not.toContain("someone@example.com");
  });

  it("offers sign-in and no account pages when signed out", () => {
    authState.current = { ...session, user: null, handle: null };
    const html = renderToStaticMarkup(createElement(SignInButton, { compact: true }));

    expect(html).toContain("Sign in");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Your profile");
  });

  it("asks for the owned avatar only once someone opens the menu", async () => {
    // SiteNav renders on every page. None of them owe a profile request for a
    // card nobody looked at.
    //
    // The held card is keyed on its HANDLE rather than on "have we asked yet",
    // because an account switch replaces the account under an open menu: keyed
    // on the flag alone, the previous account's face and display name stayed
    // above the new account's @handle.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "components/auth/SignInButton.tsx"),
      "utf8",
    );
    expect(source).toContain(
      "if (!menuOpen || card?.handle === accountHandle || !accountHandle) return;",
    );
    expect(source).toContain("card?.handle === accountHandle ? card : null");
  });
});
