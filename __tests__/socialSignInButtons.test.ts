import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SignInButton from "@/components/auth/SignInButton";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/ClerkAccountControls", () => ({
  default: () => "Clerk account controls",
}));

afterEach(() => {
  authState.current = {};
  vi.unstubAllEnvs();
});

const noop = async () => {};

function renderProviders(
  availability: { google: boolean; apple: boolean },
): string {
  return renderToStaticMarkup(
    createElement(SocialSignInButtons, {
      availability,
      disabled: false,
      onGoogle: noop,
      onApple: noop,
    }),
  );
}

describe("social sign-in provider rendering", () => {
  it("renders no clickable provider when every live provider is disabled", () => {
    const html = renderProviders({ google: false, apple: false });

    expect(html).toBe("");
  });

  it("renders Google only when live settings enable Google", () => {
    const html = renderProviders({ google: true, apple: false });

    expect(html).toContain('aria-label="Continue with Google"');
    expect(html).not.toContain("Continue with Apple");
  });

  it("renders Apple only when live settings enable Apple", () => {
    const html = renderProviders({ google: false, apple: true });

    expect(html).toContain('aria-label="Continue with Apple"');
    expect(html).not.toContain("Continue with Google");
  });
});

describe("email sign-in heading", () => {
  function renderEmail(hasSocialProviders: boolean): string {
    return renderToStaticMarkup(
      createElement(MagicLinkForm, {
        disabled: false,
        hasSocialProviders,
        signInWithEmail: vi.fn(),
        cancelAuthAttempt: vi.fn(),
      }),
    );
  }

  it("reads as the complete primary path when no social provider is available", () => {
    expect(renderEmail(false)).toContain("Continue with email");
    expect(renderEmail(false)).not.toContain("Or continue with email");
  });

  it("reads as the alternative path when a social provider is available", () => {
    expect(renderEmail(true)).toContain("Or continue with email");
  });
});

describe("signed-out sign-in surface", () => {
  function renderSignIn(
    socialProviders: { google: boolean; apple: boolean },
  ): string {
    authState.current = {
      user: null,
      loading: false,
      configured: true,
      supabaseAuthState: "signed-out",
      socialProviders,
      signInWithGoogle: vi.fn(),
      signInWithApple: vi.fn(),
      signInWithEmail: vi.fn(),
      cancelAuthAttempt: vi.fn(),
      signOut: vi.fn(),
    };
    return renderToStaticMarkup(createElement(SignInButton));
  }

  it("renders complete email sign-in and no social dead ends when all are disabled", () => {
    const html = renderSignIn({ google: false, apple: false });

    expect(html).toContain("Continue with email");
    expect(html).toContain("Email me a link");
    expect(html).not.toContain("Continue with Google");
    expect(html).not.toContain("Continue with Apple");
  });

  it("adds an enabled provider without replacing email sign-in", () => {
    const html = renderSignIn({ google: true, apple: false });

    expect(html).toContain('aria-label="Continue with Google"');
    expect(html).toContain("Or continue with email");
    expect(html).toContain("Email me a link");
    expect(html).not.toContain("Continue with Apple");
  });

  it("hides Clerk login when no product Supabase session exists", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk");
    authState.current = {
      user: null,
      loading: false,
      configured: false,
      clerkIntegrationConfigured: false,
      socialProviders: { google: true, apple: false },
      signInWithGoogle: vi.fn(),
      signInWithApple: vi.fn(),
      signInWithEmail: vi.fn(),
      cancelAuthAttempt: vi.fn(),
      signOut: vi.fn(),
    };

    const html = renderToStaticMarkup(createElement(SignInButton));

    expect(html).toBe(
      '<span hidden="" data-auth-configured="false" data-auth-resolved="false" data-auth-empty="true"></span>',
    );
    expect(html).not.toContain('aria-label="Continue with Google"');
    expect(html).not.toContain("Continue with Apple");
    expect(html).not.toContain("Continue with email");
    expect(html).not.toContain("Clerk account controls");
  });
});

describe("signed-in account surface", () => {
  it("hides Clerk controls when a publishable key exists without the server key", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk");
    authState.current = {
      user: {
        id: "account-a",
        email: "reader@example.com",
        user_metadata: {},
      },
      loading: false,
      configured: true,
      clerkIntegrationConfigured: false,
      socialProviders: { google: false, apple: false },
      signInWithGoogle: vi.fn(),
      signInWithApple: vi.fn(),
      signInWithEmail: vi.fn(),
      cancelAuthAttempt: vi.fn(),
      signOut: vi.fn(),
    };

    const html = renderToStaticMarkup(createElement(SignInButton));

    expect(html).toContain("reader@example.com");
    expect(html).not.toContain("Clerk account controls");
  });

  it("makes Clerk secondary controls reachable only after the server confirms both keys", () => {
    authState.current = {
      user: {
        id: "account-a",
        email: "reader@example.com",
        user_metadata: {},
      },
      loading: false,
      configured: true,
      clerkIntegrationConfigured: true,
      socialProviders: { google: false, apple: false },
      signInWithGoogle: vi.fn(),
      signInWithApple: vi.fn(),
      signInWithEmail: vi.fn(),
      cancelAuthAttempt: vi.fn(),
      signOut: vi.fn(),
    };

    const html = renderToStaticMarkup(createElement(SignInButton));

    expect(html).toContain("Clerk account controls");
  });
});
