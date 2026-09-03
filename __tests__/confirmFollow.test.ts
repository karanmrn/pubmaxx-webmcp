import { act as reactAct, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/components/profile/HandleAvatar", () => ({
  default: () => createElement("span", null, "avatar"),
}));

// The two identity reads this surface makes. Both are TRI-STATE, which is the
// whole point of the states below: "not asked yet" is not "signed out".
const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  identityResolved: true,
}));
const viewer = vi.hoisted(() => ({ handle: null as string | null }));
const followAction = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => auth,
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => viewer.handle,
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: followAction.request,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import ConfirmFollow from "@/components/social/ConfirmFollow";
import { markAddLinkDoorTaken } from "@/lib/addLink";

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(ConfirmFollow, { targetHandle: "karan", ...props }),
  );
}

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

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
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

  override get textContent(): string {
    return this.data;
  }

  override set textContent(value: string) {
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

let root: Root | null = null;
let container: TestElement | null = null;
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

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function mountEnvironment(): ReturnType<typeof memoryStorage> {
  const document = new TestDocument();
  // The door marker is DEVICE-scoped: a magic link lands in a fresh tab, where a
  // sessionStorage marker would already be gone. The two stores are kept apart
  // here so the surface cannot pass by reading the wrong one.
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const window = {
    document,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
    sessionStorage,
    localStorage,
    location: { href: "http://localhost/add/karan?auto=1", origin: "http://localhost" },
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
  container = document.createElement("div");
  root = createRoot(container as unknown as Element);
  return localStorage;
}

beforeEach(() => {
  auth.user = null;
  auth.identityResolved = true;
  viewer.handle = null;
  followAction.request.mockReset();
  followAction.request.mockResolvedValue(
    new Response(JSON.stringify({ following: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(async () => {
  if (root) {
    await commitReactWork(() => root?.unmount());
    root = null;
  }
  container = null;
  if (previousWindow !== undefined || previousDocument !== undefined) {
    Object.assign(globalThis, {
      window: previousWindow,
      document: previousDocument,
      IS_REACT_ACT_ENVIRONMENT: false,
    });
    previousWindow = undefined;
    previousDocument = undefined;
  }
});

describe("ConfirmFollow", () => {
  it("asks a stranger for an account, and carries the add link through both doors", () => {
    const html = render();

    expect(html).toContain("Create account and add @karan");
    expect(html).toContain('href="/login?mode=signup&amp;from=%2Fadd%2Fkaran%3Fauto%3D1"');
    expect(html).toContain("I have an account, sign in");
    expect(html).toContain('href="/login?mode=signin&amp;from=%2Fadd%2Fkaran%3Fauto%3D1"');
    // The old device-handle path is gone: nobody adds a friend off localStorage.
    expect(html).not.toContain("Claim a handle to add them");
  });

  it("names the friend when the profile carries a display name", () => {
    const html = render({ targetName: "Karan M" });

    expect(html).toContain("Add Karan M?");
    expect(html).toContain("@karan");
    expect(html).toContain("Create account and add Karan M");
  });

  it("offers an account with no handle the claim surface, carrying the same return", () => {
    auth.user = { id: "user-1" };

    const html = render();

    expect(html).toContain("Choose a handle to add them");
    expect(html).toContain('href="/u/you?returnTo=%2Fadd%2Fkaran%3Fauto%3D1"');
  });

  it("offers a signed-in drinker the add itself", () => {
    auth.user = { id: "user-1" };
    viewer.handle = "newdrinker";

    const html = render();

    expect(html).toContain("Add @karan");
    expect(html).toContain("A lot is mutual.");
    expect(html).not.toContain("Create account and add");
  });

  it("names nobody and offers no door until the session answers", () => {
    auth.identityResolved = false;

    const html = render();

    expect(html).toContain("Checking your session.");
    expect(html).not.toContain("Create account and add");
    expect(html).not.toContain("I have an account, sign in");
  });

  it("turns your own link into the share surface", () => {
    auth.user = { id: "user-1" };
    viewer.handle = "karan";

    const html = render();

    expect(html).toContain("Share your link");
    expect(html).not.toContain("Create account and add");
  });

  it("does not treat a signed-out cached handle as the target account", () => {
    viewer.handle = "karan";

    const html = render({ targetName: "Karan M" });

    expect(html).toContain("Create account and add Karan M");
    expect(html).not.toContain("Share your link");
    expect(html).not.toContain("Add @karan</button>");
  });

  it("does not show the previous account receipt after an account switch", async () => {
    const storage = mountEnvironment();
    markAddLinkDoorTaken(storage, Date.now(), "karan");
    auth.user = { id: "account-a" };
    viewer.handle = "viewer-a";

    await commitReactWork(async () => {
      root?.render(createElement(ConfirmFollow, { targetHandle: "karan", auto: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container?.textContent).toContain("@karan is in your lot.");
    });

    auth.user = { id: "account-b" };
    auth.identityResolved = false;
    viewer.handle = null;
    await commitReactWork(() => {
      root?.render(createElement(ConfirmFollow, { targetHandle: "karan", auto: true }));
    });

    expect(container?.textContent).toContain("Checking your session.");
    expect(container?.textContent).not.toContain("@karan is in your lot.");

    auth.identityResolved = true;
    viewer.handle = "viewer-b";
    await commitReactWork(async () => {
      root?.render(createElement(ConfirmFollow, { targetHandle: "karan", auto: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container?.textContent).toContain("Add @karan");
    });
    // The door marker is one-shot. A second account on the same tab cannot
    // inherit the first account's return and auto-follow.
    expect(followAction.request).toHaveBeenCalledTimes(1);
    expect(container?.textContent).not.toContain("@karan is in your lot.");
  });

  it("does not auto-add a crafted auto=1 that never took a door", async () => {
    mountEnvironment();
    auth.user = { id: "account-a" };
    viewer.handle = "viewer-a";

    await commitReactWork(async () => {
      root?.render(createElement(ConfirmFollow, { targetHandle: "karan", auto: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(followAction.request).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Add @karan");
    expect(container?.textContent).not.toContain("is in your lot.");
  });

  it("does not auto-add on a door taken for a different friend", async () => {
    const storage = mountEnvironment();
    markAddLinkDoorTaken(storage, Date.now(), "someoneelse");
    auth.user = { id: "account-a" };
    viewer.handle = "viewer-a";

    await commitReactWork(async () => {
      root?.render(createElement(ConfirmFollow, { targetHandle: "karan", auto: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(followAction.request).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Add @karan");
  });

  it("shows a deleted target as a refusal, with no receipt and no retry", async () => {
    followAction.request.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "That account isn't here any more.",
          code: "PROFILE_NOT_FOUND",
          retryable: false,
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    const storage = mountEnvironment();
    markAddLinkDoorTaken(storage, Date.now(), "karan");
    auth.user = { id: "account-a" };
    viewer.handle = "viewer-a";

    await commitReactWork(async () => {
      root?.render(createElement(ConfirmFollow, { targetHandle: "karan", auto: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container?.textContent).toContain("That account isn't here any more.");
    });
    expect(container?.textContent).not.toContain("is in your lot.");
    expect(container?.textContent).not.toContain("A lot is mutual.");
    // The card still asks "Add @karan?"; the BUTTON that would retry is gone.
    expect(container?.textContent ?? "").not.toMatch(/Add @karan(?!\?)/);
  });
});
