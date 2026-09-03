// The two surfaces the captain photographed, rendered under the state that
// produced those photographs: a live session that has not answered.
//
// Under `unresolved` neither may say anything about the viewer. Under a
// settled `signed-out` both keep their door, because a stranger still needs
// one. This is the #1239 landing-header fence applied to the pages.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/SignInButton", () => ({
  default: () => createElement("form", null, "Continue with email"),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, prefetch: async () => undefined }),
  usePathname: () => "/u/karan",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: async () => new Response("{}"),
  publishAuthActionState: () => {},
}));

import ProfileMessageButton from "@/components/messages/ProfileMessageButton";

afterEach(() => {
  authState.current = {};
});

const BASE = {
  user: null,
  handle: null,
  configured: true,
  providerAuthState: "signed-out",
};

function messageButton(overrides: Record<string, unknown>): string {
  authState.current = { ...BASE, ...overrides };
  return renderToStaticMarkup(
    createElement(ProfileMessageButton, {
      targetHandle: "karan",
      viewerHandle: "",
    }),
  );
}

describe("the profile message control waits for the live session", () => {
  it("says nothing while the session has not answered", () => {
    // This is the photograph: "Sign in to message" plus a whole email form on
    // the captain's own profile, while their session sat intact in storage.
    const html = messageButton({ providerAuthState: "unresolved" });

    expect(html).toBe("");
  });

  it("keeps an unavailable session neutral", () => {
    const html = messageButton({ providerAuthState: "unavailable" });

    expect(html).toBe("");
  });

  it("keeps the door once the session has answered nobody", () => {
    const html = messageButton({ providerAuthState: "signed-out" });

    expect(html).toContain("Sign in to message");
    expect(html).toContain("Continue with email");
  });

  it("offers Message to a signed-in account", () => {
    const html = messageButton({
      user: { id: "acct" },
      handle: "someone",
      providerAuthState: "authenticated",
    });

    expect(html).toContain("Message");
    expect(html).not.toContain("Sign in to message");
  });

  it("treats a user in context as signed in even before the state settles", () => {
    // Bootstrap can still be finishing while the session is already known.
    const html = messageButton({
      user: { id: "acct" },
      handle: "someone",
      providerAuthState: "unresolved",
    });

    expect(html).toContain("Message");
  });
});
