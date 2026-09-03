// What the switcher SHOWS. The account card is the one place a person hops
// between the accounts they run, so the list is held to the same rules the card
// is: it names people rather than addresses, it is offered to everybody on the
// same terms, and it never claims a door it cannot open.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AccountMenu from "@/components/auth/AccountMenu";
import AccountSwitcher from "@/components/auth/AccountSwitcher";
import type { DeviceAccountRecord } from "@/lib/deviceAccountSessions";

vi.mock("@/components/auth/ClerkAccountControls", () => ({
  default: () => "Clerk account controls",
}));

const ACCOUNT_A: DeviceAccountRecord = {
  userId: "user-a",
  refreshToken: "refresh-token-a",
  email: "karan@example.test",
  handle: "karan",
  lastActiveAt: 2_000,
};

const ACCOUNT_B: DeviceAccountRecord = {
  userId: "user-b",
  refreshToken: "refresh-token-b",
  email: "karanm@example.test",
  handle: "karansznx",
  lastActiveAt: 1_000,
};

const SIGNED_OUT_ACCOUNT: DeviceAccountRecord = {
  ...ACCOUNT_B,
  refreshToken: null,
};

function switcherMarkup(
  accounts: readonly DeviceAccountRecord[],
  overrides: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    createElement(AccountSwitcher, {
      accounts,
      addAccountHref: "/login?add=1&from=%2Ftoday",
      open: true,
      onToggle: () => {},
      onSwitch: async () => ({ status: "switched" as const, userId: "user-b" }),
      ...overrides,
    }),
  );
}

function menuMarkup(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(AccountMenu, {
      id: "account-menu",
      name: "Karan",
      handle: "karan",
      email: "karan@example.test",
      onSignOut: () => {},
      activeUserId: ACCOUNT_A.userId,
      onSwitchAccount: async () => ({
        status: "switched" as const,
        userId: "user-b",
      }),
      ...overrides,
    }),
  );
}

describe("the switcher list", () => {
  it("names each remembered account by its handle", () => {
    const html = switcherMarkup([ACCOUNT_B]);

    expect(html).toContain("Switch account");
    expect(html).toContain("@karansznx");
    // A handle is what this app calls a person, so the address stays off the row.
    expect(html).not.toContain("karanm@example.test");
  });

  it("falls back to the address only for an account with no handle yet", () => {
    const html = switcherMarkup([
      { ...ACCOUNT_B, handle: null },
    ]);

    expect(html).toContain("karanm@example.test");
    expect(html).not.toContain("@karansznx");
  });

  it("offers a tap for an account it can still sign in silently", () => {
    const html = switcherMarkup([ACCOUNT_B]);

    expect(html).toContain("authSwitcherRow");
    expect(html).toContain("<button");
    expect(html).not.toContain("Signed out");
  });

  it("shows a refused account as signed out and sends it to the sign-in page", () => {
    // A stored refresh token GoTrue refused is deleted on the spot. The row must
    // stay: "we cannot let you back in silently" is a different answer from "you
    // were never here", and only the second one may hide an account.
    const html = switcherMarkup([SIGNED_OUT_ACCOUNT]);

    expect(html).toContain("Signed out");
    expect(html).toContain('href="/login?add=1&amp;from=%2Ftoday"');
  });

  it("always offers Add account, so a first second account is reachable", () => {
    const empty = switcherMarkup([]);

    expect(empty).toContain("Switch account");
    expect(empty).toContain("Add account");
    expect(empty).toContain('href="/login?add=1&amp;from=%2Ftoday"');
  });

  it("keeps the list closed until somebody asks for it", () => {
    const closed = switcherMarkup([ACCOUNT_B], { open: false });

    expect(closed).toContain("Switch account");
    expect(closed).not.toContain("@karansznx");
    expect(closed).not.toContain("Add account");
  });
});

describe("the way out gains a scope only when there is a choice", () => {
  it("prints one plain Sign out for a device holding one account", () => {
    const html = menuMarkup({ deviceAccounts: [ACCOUNT_A] });

    expect(html).toContain(">Sign out</button>");
    expect(html).not.toContain("Sign out of all accounts");
  });

  it("names the account and the device once a second account is here", () => {
    const html = menuMarkup({ deviceAccounts: [ACCOUNT_A, ACCOUNT_B] });

    expect(html).toContain("Sign out of @karan");
    expect(html).toContain("Sign out of all accounts");
    // Not the bare label as well: two ways out are a choice, three are a muddle.
    expect(html).not.toContain(">Sign out</button>");
  });

  it("names this account plainly when it has claimed no handle", () => {
    const html = menuMarkup({
      handle: null,
      deviceAccounts: [ACCOUNT_A, ACCOUNT_B],
    });

    expect(html).toContain("Sign out of this account");
    expect(html).toContain("Sign out of all accounts");
  });

  it("names the active account and no other, list closed", () => {
    const html = menuMarkup({ deviceAccounts: [ACCOUNT_A, ACCOUNT_B] });

    // The card is about ONE account. A remembered second account is behind the
    // disclosure and reaches neither the card nor the way out until it is asked
    // for; the other account's handle appearing here would be the leak the whole
    // device-identity law exists to stop.
    expect(html).toContain("Switch account");
    expect(html).toContain("@karan<");
    expect(html).not.toContain("@karansznx");
    expect(html).not.toContain("karanm@example.test");
  });

  it("is the card it always was when no host wired a switcher", () => {
    const html = menuMarkup({ onSwitchAccount: undefined });

    expect(html).not.toContain("Switch account");
    expect(html).toContain(">Sign out</button>");
    expect(html).toContain("Your profile");
  });
});
