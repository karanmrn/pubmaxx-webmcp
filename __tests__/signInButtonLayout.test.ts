import { act as reactAct, createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {
    user: {
      id: "account-a",
      email: "reader@example.com",
      user_metadata: {},
    } as { id: string; email: string; user_metadata: Record<string, unknown> } | null,
    loading: false,
    configured: true,
    supabaseAuthState: "signed-out",
    clerkIntegrationConfigured: true,
    socialProviders: { google: false, apple: false },
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithEmail: vi.fn(),
    cancelAuthAttempt: vi.fn(),
    signOut: vi.fn(async () => {}),
  },
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@clerk/nextjs", () => ({
  Show: ({ children }: { children: ReactNode }) => children,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  SignUpButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () => createElement("span", { className: "clerkUserButton" }),
}));
vi.mock("@/components/auth/MagicLinkForm", () => ({
  default: () => createElement("input", { className: "authMagicLinkInput" }),
}));
vi.mock("@/components/auth/SocialSignInButtons", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import SignInButton from "@/components/auth/SignInButton";

class TestNode {
  nodeType: number;
  nodeName: string;
  ownerDocument: TestDocument | null;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];

  constructor(nodeType: number, nodeName: string, ownerDocument: TestDocument | null) {
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

  contains(candidate: TestNode): boolean {
    if (candidate === this) return true;
    return this.childNodes.some((child) => child.contains(candidate));
  }

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  set textContent(value: string) {
    this.childNodes = value ? [new TestText(value, this.ownerDocument)] : [];
  }
}

class TestText extends TestNode {
  data: string;

  constructor(value: string, ownerDocument: TestDocument | null) {
    super(3, "#text", ownerDocument);
    this.data = value;
  }
}

class TestElement extends TestNode {
  tagName: string;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  style: Record<string, string> = {};
  attributes = new Map<string, string>();

  constructor(tagName: string, ownerDocument: TestDocument) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  querySelector(selector: string): TestElement | null {
    return findElement(this, (element) => {
      const enabled = !element.attributes.has("disabled");
      return enabled && (
        selector.includes("button") && element.tagName === "BUTTON" ||
        selector.includes("input") && element.tagName === "INPUT" ||
        selector.includes("[href]") && element.attributes.has("href")
      );
    });
  }

  querySelectorAll(): TestElement[] {
    return [];
  }
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

  createTextNode(value: string): TestText {
    return new TestText(value, this);
  }
}

function findElement(
  node: TestNode,
  predicate: (element: TestElement) => boolean,
): TestElement | null {
  for (const child of node.childNodes) {
    if (child instanceof TestElement && predicate(child)) return child;
    const nested = findElement(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function findByClass(node: TestNode, className: string): TestElement | null {
  return findElement(node, (element) =>
    (element.getAttribute("class") ?? "").split(/\s+/).includes(className),
  );
}

function mountedClick(element: TestElement): void {
  const propsKey = Object.getOwnPropertyNames(element).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (!propsKey) throw new Error("Mounted element has no React props");
  const props = (element as unknown as Record<string, { onClick?: () => void }>)[propsKey];
  if (!props?.onClick) throw new Error("Mounted element has no click handler");
  props.onClick();
}

let root: Root | null = null;
let container: TestElement;
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

async function mount(compact: boolean): Promise<void> {
  await commitReactWork(() => {
    root?.render(createElement(SignInButton, { compact }));
  });
}

beforeEach(() => {
  authState.current.user = {
    id: "account-a",
    email: "reader@example.com",
    user_metadata: {},
  };
  authState.current.loading = false;
  authState.current.configured = true;
  authState.current.clerkIntegrationConfigured = true;
  authState.current.signOut.mockClear();
  const document = new TestDocument();
  const window = {
    document,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
    // next/link's viewport prefetch reaches for the idle callback the moment a
    // link mounts, and the account card in the popover is made of links.
    requestIdleCallback: (callback: IdleRequestCallback) =>
      setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 0),
    cancelIdleCallback: clearTimeout,
    IntersectionObserver: class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
    },
    location: { href: "http://localhost/map" },
    HTMLElement: TestElement,
    HTMLIFrameElement: class {},
    Node: TestNode,
  };
  document.defaultView = window;
  previousWindow = globalThis.window;
  previousDocument = globalThis.document;
  Object.assign(globalThis, {
    window,
    // next/link's prefetch reads `self`, not `window`.
    self: window,
    document,
    IS_REACT_ACT_ENVIRONMENT: typeof reactAct === "function",
  });
  container = document.createElement("div");
  root = createRoot(container as unknown as Element);
});

afterEach(async () => {
  if (root) {
    await commitReactWork(() => root?.unmount());
    root = null;
  }
  Object.assign(globalThis, {
    window: previousWindow,
    self: previousWindow,
    document: previousDocument,
    IS_REACT_ACT_ENVIRONMENT: false,
  });
});

describe("signed-in auth layout with fully configured Clerk", () => {
  it("keeps compact headers to one disclosure and no stacked Clerk controls", async () => {
    await mount(true);

    expect(findByClass(container, "authUserNav")).not.toBeNull();
    expect(findByClass(container, "authCompactTrigger")).not.toBeNull();
    expect(findByClass(container, "clerkAccount")).toBeNull();
    expect(findByClass(container, "authSignOut")).toBeNull();
  });

  it("opens full account and Clerk controls only inside the compact popover", async () => {
    await mount(true);
    const trigger = findByClass(container, "authCompactTrigger");
    expect(trigger).not.toBeNull();

    await commitReactWork(() => mountedClick(trigger as TestElement));

    const menu = findByClass(container, "authMenu");
    const clerkControls = findByClass(container, "clerkAccount");
    const signOut = findByClass(container, "authSignOut");
    expect(menu).not.toBeNull();
    expect(clerkControls).not.toBeNull();
    expect(signOut).not.toBeNull();
    expect(menu?.contains(clerkControls as TestElement)).toBe(true);
    expect(menu?.contains(signOut as TestElement)).toBe(true);
  });

  it("keeps full controls visible in non-compact account surfaces", async () => {
    await mount(false);

    expect(findByClass(container, "authUserNav")).toBeNull();
    expect(findByClass(container, "authSignOut")).not.toBeNull();
    expect(findByClass(container, "clerkAccount")).not.toBeNull();
  });
});

describe("signed-out compact auth focus", () => {
  it("focuses the first enabled popover control", async () => {
    authState.current.user = null;
    authState.current.clerkIntegrationConfigured = false;
    await mount(true);
    const trigger = findByClass(container, "authCompactTrigger");
    expect(trigger).not.toBeNull();

    await commitReactWork(() => mountedClick(trigger as TestElement));

    expect(document.activeElement).toBe(findByClass(container, "authMagicLinkInput"));
  });
});
