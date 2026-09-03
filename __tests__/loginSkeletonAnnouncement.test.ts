// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A live region announces a CHANGE. Text already present when the region
// mounted is never spoken, so the skeleton's screen-reader line has to arrive
// AFTER the first paint. Only a real mount can show that, which is why this
// file runs in jsdom while the rest of the login coverage renders to a string.

const authState = vi.hoisted(() => ({ loading: true }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: authState.loading,
    configured: true,
    clerkIntegrationConfigured: false,
    socialProviders: { google: true, apple: true },
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithEmail: vi.fn(),
    cancelAuthAttempt: vi.fn(),
    signOut: vi.fn(async () => undefined),
    switchAccount: vi.fn(async () => ({ status: "switched" })),
    welcomeBack: null,
    resumeSignIn: vi.fn(),
    handle: null,
  }),
}));

vi.mock("@/components/auth/MagicLinkForm", () => ({
  default: () => createElement("form", null, "email form"),
}));

vi.mock("@/components/auth/SocialSignInButtons", () => ({
  default: () => createElement("div", null, "social"),
}));

vi.mock("@/components/auth/HandlePasswordSignIn", () => ({
  default: () => createElement("div", null, "password"),
}));

import LoginPage from "@/components/auth/LoginPage";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.loading = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function statusRegion(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".loginPageSrOnly");
}

describe("the sign-in skeleton's screen-reader line", () => {
  it("arrives as a change after mount, never already spoken", async () => {
    // A mutation whose TARGET is the region means the region was already in the
    // document when its text arrived. Text shipped inside the region's own
    // insertion mutates the region's parent instead, and is never announced.
    const withinRegion: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        const element =
          target instanceof HTMLElement ? target : target.parentElement;
        if (element?.classList.contains("loginPageSrOnly")) {
          withinRegion.push(element.textContent ?? "");
        }
      }
    });
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    await act(async () => {
      root.render(createElement(LoginPage));
    });
    observer.disconnect();

    expect(withinRegion).toContain("Loading");
    expect(statusRegion()?.textContent).toBe("Loading");
    expect(statusRegion()?.getAttribute("role")).toBe("status");
  });

  // THE REGRESSION THIS ROUND CLOSES: `aria-busy` withholds updates from a live
  // region ANYWHERE beneath it, and busy never clears here - the subtree
  // unmounts instead - so a status node inside the busy container is never
  // spoken however the text arrives. No ancestor of the region may be busy.
  it("keeps every aria-busy container off the live region's ancestry", () => {
    act(() => {
      root.render(createElement(LoginPage));
    });

    const region = statusRegion();
    expect(region).not.toBeNull();

    const busyAncestors: string[] = [];
    for (
      let node = region?.parentElement ?? null;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (node.getAttribute("aria-busy") === "true") {
        busyAncestors.push(node.className || node.tagName);
      }
    }
    expect(busyAncestors).toEqual([]);

    // The shape it stands beside is still the thing that is busy.
    expect(
      host.querySelector(".loginPageSkeleton")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(host.querySelector("main.loginPage")?.hasAttribute("aria-busy")).toBe(
      false,
    );
  });

  // A live region an ancestor has hidden is not read either.
  it("keeps the live region out of every aria-hidden subtree", () => {
    act(() => {
      root.render(createElement(LoginPage));
    });

    const region = statusRegion();
    for (
      let node = region?.parentElement ?? null;
      node && node !== document.body;
      node = node.parentElement
    ) {
      expect(node.getAttribute("aria-hidden")).not.toBe("true");
    }
  });

  it("takes the whole region away once the session answers", () => {
    act(() => {
      root.render(createElement(LoginPage));
    });
    expect(statusRegion()).not.toBeNull();

    authState.loading = false;
    act(() => {
      root.render(createElement(LoginPage));
    });

    expect(statusRegion()).toBeNull();
    expect(host.querySelector(".loginPageSkeleton")).toBeNull();
  });
});
