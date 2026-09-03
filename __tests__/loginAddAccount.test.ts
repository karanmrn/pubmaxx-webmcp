// Adding a SECOND account to a device that already has one.
//
// /login answers a live session with the "you are signed in" card, which is
// right for everybody except the person who came from the switcher's Add
// account: telling them they are already in answers a question they did not ask,
// and leaves them no form. `?add=1` is the one flag that changes that.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGIN_ADD_ACCOUNT_PARAM, parseAddAccount } from "@/lib/arrivalWelcome";

const authState = vi.hoisted(() => ({
  current: { user: null } as Record<string, unknown>,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    loading: false,
    configured: true,
    clerkIntegrationConfigured: false,
    socialProviders: { google: true, apple: false },
    signInWithGoogle: vi.fn(async () => ({ error: null })),
    signInWithApple: vi.fn(async () => ({ error: null })),
    signInWithEmail: vi.fn(async () => ({ status: "sent", message: "link sent" })),
    cancelAuthAttempt: vi.fn(),
    signOut: vi.fn(async () => undefined),
    welcomeBack: null,
    resumeSignIn: vi.fn(),
    ...authState.current,
  }),
}));

vi.mock("@/components/auth/MagicLinkForm", () => ({
  default: () => createElement("form", { className: "authMagicLink" }, "email form"),
}));

vi.mock("@/components/auth/SocialSignInButtons", () => ({
  default: () => createElement("div", { className: "authProviders" }, "social"),
}));

vi.mock("@/components/auth/HandlePasswordSignIn", () => ({
  default: () => createElement("div", { className: "authHandlePassword" }, "password"),
}));

import LoginPage from "@/components/auth/LoginPage";

const SIGNED_IN = {
  user: { email: "karan@example.test", user_metadata: { full_name: "Karan" } },
};

afterEach(() => {
  authState.current = { user: null };
});

function markup(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(LoginPage, props));
}

describe("the add-account door", () => {
  it("only an explicit add=1 asks for it", () => {
    expect(parseAddAccount("1")).toBe(true);
    expect(parseAddAccount("true")).toBe(false);
    expect(parseAddAccount(null)).toBe(false);
    expect(LOGIN_ADD_ACCOUNT_PARAM).toBe("add");
  });

  it("offers the form to a live session, and says both accounts stay", () => {
    authState.current = SIGNED_IN;
    const html = markup({ addAccount: true, from: "/today" });

    expect(html).toContain("Add another account");
    expect(html).toContain("authMagicLink");
    expect(html).toContain("switch between them");
    // The signed-in card would be the dead end this flag exists to remove.
    expect(html).not.toContain("You are signed in");
    expect(html).not.toContain("Continue to the map");
  });

  it("answers a live session with the signed-in card without the flag", () => {
    authState.current = SIGNED_IN;
    const html = markup({ from: "/today" });

    expect(html).toContain("You are signed in");
    expect(html).not.toContain("Add another account");
    expect(html).not.toContain("authMagicLink");
  });

  it("is the ordinary sign-in page when nobody is signed in", () => {
    const html = markup({ addAccount: true });

    // The flag says "I already have a session". Without one there is nothing to
    // add to, so the page is exactly the door it always was.
    expect(html).toContain("Sign in or create your account");
    expect(html).not.toContain("Welcome back");
    expect(html).not.toContain("Add another account");
    expect(html).toContain("authMagicLink");
  });

  it("is reached from the nav card, carrying the page to return to", () => {
    const button = readFileSync(
      join(process.cwd(), "components/auth/SignInButton.tsx"),
      "utf8",
    );

    expect(button).toContain("addAccountLoginHref");
    expect(button).toContain("LOGIN_ADD_ACCOUNT_PARAM");
    expect(button).toContain("addAccountHref={addAccountHref}");
  });

  it("is read on the server, so the form is there on first paint", () => {
    const route = readFileSync(join(process.cwd(), "app/login/page.tsx"), "utf8");

    expect(route).toContain("parseAddAccount");
    expect(route).toContain("addAccount={parseAddAccount(");
  });
});
