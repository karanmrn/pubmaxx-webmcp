import { act as reactAct, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

import PeopleListClient from "@/app/u/[handle]/people/[relation]/PeopleListClient";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

class TestNode extends EventTarget {
  nodeType: number;
  nodeName: string;
  ownerDocument: TestDocument | null;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  private textValue = "";

  constructor(nodeType: number, nodeName: string, ownerDocument: TestDocument | null) {
    super();
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

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
    return this.nodeType === 3
      ? this.textValue
      : this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.textValue = value;
    this.childNodes = value ? [new TestNode(3, "#text", this.ownerDocument)] : [];
    if (this.childNodes[0]) this.childNodes[0].textValue = value;
  }
}

class TestElement extends TestNode {
  tagName: string;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  style: Record<string, string> = {};
  private attributes = new Map<string, string>();

  constructor(tagName: string, ownerDocument: TestDocument) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name.toLowerCase(), value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  querySelector(selector: string): TestElement | null {
    if (selector === "img" && this.tagName === "IMG") return this;
    for (const child of this.childNodes) {
      if (child instanceof TestElement) {
        const hit = child.querySelector(selector);
        if (hit) return hit;
      }
    }
    return null;
  }

  removeAttribute(): void {}
}

class TestDocument extends TestNode {
  defaultView: TestWindow;
  documentElement: TestElement;
  body: TestElement;
  activeElement: TestElement;
  visibilityState: DocumentVisibilityState = "visible";

  constructor() {
    super(9, "#document", null);
    this.ownerDocument = this;
    this.documentElement = new TestElement("html", this);
    this.body = new TestElement("body", this);
    this.activeElement = this.body;
    this.defaultView = undefined as unknown as TestWindow;
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

class TestWindow extends EventTarget {
  document!: TestDocument;
  navigator = { onLine: true };
  localStorage = null;
  sessionStorage: Storage | null = null;
  HTMLElement = TestElement;
  HTMLIFrameElement = class {};
  Node = TestNode;
  setTimeout = setTimeout.bind(globalThis);
  clearTimeout = clearTimeout.bind(globalThis);
}

let root: Root | null = null;
let container: TestElement;
let previousWindow: typeof globalThis.window | undefined;
let previousDocument: typeof globalThis.document | undefined;
let browserWindow: TestWindow;
let browserDocument: TestDocument;

async function commit(work: () => void | Promise<void>): Promise<void> {
  if (typeof reactAct === "function") {
    await reactAct(work);
    return;
  }
  work();
  await Promise.resolve();
}

function settle(): Promise<void> {
  return commit(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clearSurfaceCache();
  browserDocument = new TestDocument();
  browserWindow = new TestWindow();
  browserWindow.document = browserDocument;
  browserDocument.defaultView = browserWindow;
  previousWindow = globalThis.window;
  previousDocument = globalThis.document;
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserDocument,
    IS_REACT_ACT_ENVIRONMENT: typeof reactAct === "function",
    Node: TestNode,
    HTMLElement: TestElement,
    HTMLIFrameElement: class {},
  });
  container = browserDocument.createElement("div");
  root = createRoot(container as unknown as Element);
});

afterEach(async () => {
  if (root) {
    await commit(() => root?.unmount());
    root = null;
  }
  clearSurfaceCache();
  vi.restoreAllMocks();
  Object.assign(globalThis, {
    window: previousWindow,
    document: previousDocument,
    IS_REACT_ACT_ENVIRONMENT: false,
  });
  vi.useRealTimers();
});

function listResponse(rows: Array<string | { handle: string; avatarUrl?: string }>): Response {
  return Response.json({
    followers: rows.map((row) => (typeof row === "string" ? { handle: row } : row)),
  });
}

function lotResponse(rows: string[] = []): Response {
  return Response.json({ lot: rows });
}

describe("PeopleListClient recovery", () => {
  it("shows an error after rejection and loads after online without a click", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(listResponse(["alice"]))
      .mockResolvedValueOnce(lotResponse());

    await commit(() =>
      root?.render(createElement(PeopleListClient, { handle: "karan", relation: "followers" })),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await settle();

    expect(container.textContent).toContain("Could not load this list. That is us, not you.");
    expect(container.textContent).toContain("Try again");

    await commit(() => {
      browserWindow.dispatchEvent(new Event("online"));
    });
    await vi.advanceTimersByTimeAsync(200);
    await settle();

    expect(container.textContent).toContain("@alice");
    expect(container.textContent).not.toContain("Try again");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("renders an owned avatar when the list row carries one", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        listResponse([{ handle: "alice", avatarUrl: "/api/avatar/p1/g1" }]),
      )
      .mockResolvedValueOnce(lotResponse());

    await commit(() =>
      root?.render(createElement(PeopleListClient, { handle: "karan", relation: "followers" })),
    );
    await settle();

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/api/avatar/p1/g1");
    expect(container.textContent).toContain("@alice");
  });

  it("paints a cached public snapshot on remount before revalidation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(listResponse(["alice"]))
      .mockResolvedValueOnce(lotResponse())
      .mockRejectedValue(new TypeError("offline"));

    await commit(() =>
      root?.render(createElement(PeopleListClient, { handle: "karan", relation: "followers" })),
    );
    await settle();
    expect(container.textContent).toContain("@alice");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await commit(() => root?.unmount());
    root = createRoot(container as unknown as Element);
    await commit(() =>
      root?.render(createElement(PeopleListClient, { handle: "karan", relation: "followers" })),
    );
    await settle();

    expect(container.textContent).toContain("@alice");
    expect(container.textContent).not.toContain("Could not load this list");
  });

  it("uses honest offline copy while keeping online fault copy", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    Object.defineProperty(browserWindow.navigator, "onLine", { value: false, configurable: true });

    await commit(() =>
      root?.render(createElement(PeopleListClient, { handle: "karan", relation: "followers" })),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(container.textContent).toContain("You look offline. We will retry when you are back.");

    await commit(() => root?.unmount());
    root = createRoot(container as unknown as Element);
    Object.defineProperty(browserWindow.navigator, "onLine", { value: true, configurable: true });
    await commit(() =>
      root?.render(createElement(PeopleListClient, { handle: "karan", relation: "followers" })),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(container.textContent).toContain("Could not load this list. That is us, not you.");
  });
});
