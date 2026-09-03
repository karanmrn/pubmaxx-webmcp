import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  clerkIntegrationConfigured: false,
}));

vi.mock("@clerk/nextjs", () => ({
  Show: ({ children }: { children: ReactNode }) => children,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  SignUpButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () => null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));

import ClerkAccountControls from "@/components/auth/ClerkAccountControls";

afterEach(() => {
  authState.user = null;
  authState.clerkIntegrationConfigured = false;
});

describe("Clerk account controls", () => {
  it("stays hidden without a product Supabase session", () => {
    const html = renderToStaticMarkup(createElement(ClerkAccountControls));

    expect(html).toBe("");
  });

  it("stays hidden when only the product session side of the gate is present", () => {
    authState.user = { id: "account-a" };

    const html = renderToStaticMarkup(createElement(ClerkAccountControls));

    expect(html).toBe("");
  });

  it("is available only behind two-key configuration and a product session", () => {
    authState.user = { id: "account-a" };
    authState.clerkIntegrationConfigured = true;

    const html = renderToStaticMarkup(createElement(ClerkAccountControls));

    expect(html).toContain("Create Clerk account");
    expect(html).toContain("Sign in to Clerk");
  });

  it("states that Clerk session identity is separate from product identity", () => {
    authState.user = { id: "account-a" };
    authState.clerkIntegrationConfigured = true;

    const html = renderToStaticMarkup(createElement(ClerkAccountControls));

    expect(html).toContain("Clerk session");
    expect(html).toContain("PUBMAXX User ID");
    expect(html).toContain("PUBMAXX Handle");
    expect(html).not.toContain("Signed in to your PUBMAXX account");
  });
});
