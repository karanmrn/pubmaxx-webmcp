import { act as reactAct, createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => ({
  session: {
    access_token: "shared-session",
    user: { id: "account-a" },
  } as { access_token: string; user: { id: string } } | null,
  supabaseOAuth: vi.fn(),
}));

const clerkState = vi.hoisted(() => ({ configured: true }));

const authAvailability = vi.hoisted(() => ({
  guard: vi.fn(),
  loadSupabase: vi.fn(async () => ({ google: false, apple: false })),
}));

const authRedirect = vi.hoisted(() => ({
  begin: vi.fn(async () => ({
    ok: true as const,
    id: "attempt-id",
    callbackUrl: "http://localhost/auth-callback",
  })),
}));

vi.mock("@/components/identity/AccountOnboarding", () => ({
  default: () => null,
}));
vi.mock("@/components/identity/IdentityNudge", () => ({
  default: () => null,
}));
vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));
vi.mock("@/lib/authCallbackClient", () => ({
  clearLegacyPkceVerifiers: vi.fn(),
  establishAuthCallbackSession: vi.fn(),
}));
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => ({
    auth: {
      getSession: async () => ({ data: { session: providerState.session } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithOAuth: providerState.supabaseOAuth,
      signOut: vi.fn(),
    },
  }),
  isAuthConfigured: () => true,
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  guardSocialAuthProvider: authAvailability.guard,
  loadSocialAuthProviders: authAvailability.loadSupabase,
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false },
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax:auth-fragment-restored",
  beginCanonicalAuthAttempt: authRedirect.begin,
  cancelAuthAttempt: vi.fn(),
  defaultEmailAuthNext: () => "/u/you",
  releaseAuthAttempt: vi.fn(),
  scrubAuthCallback: async () => null,
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: vi.fn(async () => null),
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));
vi.mock("@/lib/referralClaimClient", () => ({
  claimSignupReferralFromAuthCallback: vi.fn(),
  withReferralSignupProof: vi.fn((attempt) => attempt),
}));

import {
  AuthProvider,
  useAuth,
  type AuthContextValue,
} from "@/components/auth/AuthProvider";
import { useContributionGate } from "@/components/identity/ContributionGateDialog";

class TestNode {
  nodeType: number;
  nodeName: string;
  ownerDocument: TestDocument | null;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];

  constructor(
    nodeType: number,
    nodeName: string,
    ownerDocument: TestDocument | null,
  ) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  appendChild(child: TestNode): TestNode {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: TestNode, before: TestNode | null): TestNode {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child: TestNode): TestNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  set textContent(value: string) {
    this.childNodes = value
      ? [new TestNode(3, "#text", this.ownerDocument)]
      : [];
  }
}

class TestElement extends TestNode {
  tagName: string;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  style: Record<string, string> = {};

  constructor(tagName: string, ownerDocument: TestDocument) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(): void {}
  removeAttribute(): void {}
}

class TestDocument extends TestNode {
  defaultView: Record<string, unknown>;
  documentElement: TestElement;
  body: TestElement;
  activeElement: TestElement;

  constructor() {
    super(9, "#document", null);
    this.ownerDocument = this;
    this.documentElement = new TestElement("html", this);
    this.body = new TestElement("body", this);
    this.activeElement = this.body;
    this.defaultView = {};
  }

  createElement(tagName: string): TestElement {
    return new TestElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): TestElement {
    return new TestElement(tagName, this);
  }

  createTextNode(): TestNode {
    return new TestNode(3, "#text", this);
  }
}

type ConsumerState = {
  auth: AuthContextValue;
  requestContribution: ReturnType<typeof useContributionGate>["requestContribution"];
};

const consumers = new Map<string, ConsumerState>();
let root: Root | null = null;
let previousWindow: typeof globalThis.window | undefined;
let previousDocument: typeof globalThis.document | undefined;

async function commitReactWork(work: () => void | Promise<void>): Promise<void> {
  if (typeof reactAct === "function") {
    await reactAct(work);
    return;
  }

  let pending: void | Promise<void> = undefined;
  flushSync(() => {
    pending = work();
  });
  await pending;
}

function Consumer({ name }: { name: string }): ReactNode {
  const auth = useAuth();
  const { requestContribution } = useContributionGate();
  consumers.set(name, { auth, requestContribution });
  return null;
}

beforeEach(() => {
  consumers.clear();
  providerState.session = {
    access_token: "shared-session",
    user: { id: "account-a" },
  };
  clerkState.configured = true;
  providerState.supabaseOAuth.mockReset();
  providerState.supabaseOAuth.mockResolvedValue({ error: null });
  authAvailability.guard.mockReset();
  authAvailability.guard.mockResolvedValue({
    availability: { google: true, apple: false },
    result: { error: null },
  });
  authAvailability.loadSupabase.mockClear();
  authRedirect.begin.mockClear();
  const document = new TestDocument();
  const window = {
    document,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
    location: { href: "http://localhost/map" },
    history: { state: null, replaceState: vi.fn() },
    localStorage: null,
    sessionStorage: null,
    HTMLElement: TestElement,
    HTMLIFrameElement: class {},
    Node: TestNode,
  };
  document.defaultView = window;
  previousWindow = globalThis.window;
  previousDocument = globalThis.document;
  Object.assign(globalThis, {
    window,
    document,
    IS_REACT_ACT_ENVIRONMENT: typeof reactAct === "function",
  });
});

afterEach(async () => {
  if (root) {
    await commitReactWork(() => root?.unmount());
    root = null;
  }
  Object.assign(globalThis, {
    window: previousWindow,
    document: previousDocument,
    IS_REACT_ACT_ENVIRONMENT: false,
  });
  vi.unstubAllEnvs();
});

describe("shared contribution auth invalidation", () => {
  it("stops a second consumer from receiving a rejected token", async () => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: clerkState.configured },
          createElement(Consumer, { name: "visit" }),
          createElement(Consumer, { name: "weather" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(consumers.get("visit")?.auth.contributionAuth).toMatchObject({
        userId: "account-a",
        accessToken: "shared-session",
      });
      expect(consumers.get("weather")?.auth.contributionAuth).toMatchObject({
        userId: "account-a",
        accessToken: "shared-session",
      });
    });

    await commitReactWork(async () => {
      await consumers.get("visit")?.requestContribution(async () => ({
        status: "sign_in_required",
      }));
    });

    await vi.waitFor(() => {
      expect(consumers.get("weather")?.auth.contributionAuth).toBeNull();
    });

    let weatherActionCalled = false;
    await commitReactWork(async () => {
      await consumers.get("weather")?.requestContribution(async () => {
        weatherActionCalled = true;
      });
    });

    expect(consumers.get("weather")?.auth.contributionAuth).toBeNull();
    expect(weatherActionCalled).toBe(false);
  });

  it("keeps generic social sign-in on Supabase when Clerk account controls are available", async () => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: clerkState.configured },
          createElement(Consumer, { name: "social" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const auth = consumers.get("social")?.auth;
    expect(auth).toBeDefined();
    const supabaseLoadCallsBeforeClick = authAvailability.loadSupabase.mock.calls.length;

    await commitReactWork(async () => {
      await auth?.signInWithGoogle();
    });

    expect(authAvailability.guard).toHaveBeenCalledWith("google", expect.any(Function), expect.any(Function));
    const start = authAvailability.guard.mock.calls[0]?.[1] as (() => Promise<unknown>) | undefined;
    const load = authAvailability.guard.mock.calls[0]?.[2] as (() => Promise<unknown>) | undefined;
    await load?.();
    await start?.();

    expect(authAvailability.loadSupabase.mock.calls.length).toBe(
      supabaseLoadCallsBeforeClick + 1,
    );
    expect(providerState.supabaseOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost/auth-callback" },
    });
  });

  it("uses an explicit destination for OAuth and welcome-back email callbacks", async () => {
    const container = globalThis.document.createElement("div");
    root = createRoot(container);
    const destination = "/add/karan?auto=1";

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: false },
          createElement(Consumer, { name: "login" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    authAvailability.guard.mockImplementationOnce(async (_provider, start) => ({
      availability: { google: true, apple: false },
      result: await start(),
    }));

    const auth = consumers.get("login")?.auth;
    await auth?.signInWithGoogle(destination);
    expect(authRedirect.begin).toHaveBeenLastCalledWith(
      "http://localhost/map",
      destination,
      expect.any(Object),
      expect.any(Function),
    );

    await auth?.resumeSignIn(destination);
    expect(authRedirect.begin).toHaveBeenLastCalledWith(
      "http://localhost/map",
      destination,
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("keeps the Supabase path without a product session even when Clerk is configured", async () => {
    providerState.session = null;
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: clerkState.configured },
          createElement(Consumer, { name: "social" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const auth = consumers.get("social")?.auth;
    expect(auth).toBeDefined();
    await commitReactWork(async () => {
      await auth?.signInWithGoogle();
    });

    const start = authAvailability.guard.mock.calls[0]?.[1] as (() => Promise<unknown>) | undefined;
    const load = authAvailability.guard.mock.calls[0]?.[2] as (() => Promise<unknown>) | undefined;
    await load?.();
    await start?.();

    expect(authAvailability.loadSupabase).toHaveBeenCalled();
    expect(providerState.supabaseOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost/auth-callback" },
    });
  });

  it("keeps the Supabase path when only the Clerk publishable key is present", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk",
    );
    clerkState.configured = false;
    const container = globalThis.document.createElement("div");
    root = createRoot(container);

    await commitReactWork(async () => {
      root?.render(
        createElement(
          AuthProvider,
          { clerkIntegrationConfigured: clerkState.configured },
          createElement(Consumer, { name: "social" }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const supabaseLoadCallsBeforeClick = authAvailability.loadSupabase.mock.calls.length;
    expect(consumers.get("social")?.auth.clerkIntegrationConfigured).toBe(false);
    await commitReactWork(async () => {
      await consumers.get("social")?.auth.signInWithGoogle();
    });

    expect(authAvailability.guard).toHaveBeenCalledWith("google", expect.any(Function), expect.any(Function));

    const start = authAvailability.guard.mock.calls[0]?.[1] as (() => Promise<unknown>) | undefined;
    const load = authAvailability.guard.mock.calls[0]?.[2] as (() => Promise<unknown>) | undefined;
    await load?.();
    await start?.();

    expect(authAvailability.loadSupabase.mock.calls.length).toBe(supabaseLoadCallsBeforeClick + 1);
    expect(providerState.supabaseOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost/auth-callback" },
    });
  });
});
