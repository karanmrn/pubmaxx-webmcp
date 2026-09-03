import { act as reactAct, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_CONSENT_STORAGE_KEY } from "@/lib/analyticsIdentity";
import { LAST_CREW_STORAGE_KEY } from "@/lib/lastCrew";
import {
  MORNING_REENTRY_VERSION,
  recordCompletedNight,
} from "@/lib/morningReentry";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => createElement("a", { href, ...rest }, children),
}));

import MorningReentryCard from "@/components/night/MorningReentryCard";

const PLAN_ID = "11111111-2222-4333-8444-555555555555";
const PRIVATE_NAMES = ["Karan Private", "Amy Private"];

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
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
}

class TestDocument extends TestNode {
  defaultView: Record<string, unknown>;
  documentElement: TestElement;
  body: TestElement;
  activeElement: TestElement;
  referrer = "";

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
let previousSelf: typeof globalThis.self | undefined;
let previousNavigator: PropertyDescriptor | undefined;
let beacons: Blob[];

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

beforeEach(() => {
  beacons = [];
  const document = new TestDocument();
  const localStorage = makeMemoryStorage();
  const window = {
    document,
    localStorage,
    sessionStorage: makeMemoryStorage(),
    location: { origin: "https://pubmaxxing.com", pathname: "/map" },
    screen: { width: 390, height: 844 },
    innerWidth: 390,
    innerHeight: 844,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    HTMLElement: TestElement,
    HTMLIFrameElement: class {},
    Node: TestNode,
  };
  document.defaultView = window;

  previousWindow = globalThis.window;
  previousDocument = globalThis.document;
  previousSelf = globalThis.self;
  previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.assign(globalThis, {
    window,
    self: window,
    document,
    IS_REACT_ACT_ENVIRONMENT: typeof reactAct === "function",
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      sendBeacon: (_url: string, body: Blob) => {
        beacons.push(body);
        return true;
      },
    },
  });

  localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "granted");
  localStorage.setItem(LAST_CREW_STORAGE_KEY, JSON.stringify({
    names: PRIVATE_NAMES,
    savedAt: new Date().toISOString(),
    sourcePlanId: PLAN_ID,
  }));
  recordCompletedNight({
    version: MORNING_REENTRY_VERSION,
    planId: PLAN_ID,
    title: "Friday in Soho",
    completedAt: new Date(Date.now() - 60_000).toISOString(),
  }, { suppressThisSession: false });

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
    self: previousSelf,
    document: previousDocument,
    IS_REACT_ACT_ENVIRONMENT: false,
  });
  if (previousNavigator) {
    Object.defineProperty(globalThis, "navigator", previousNavigator);
  } else {
    delete (globalThis as { navigator?: Navigator }).navigator;
  }
});

describe("morning re-entry usual lot", () => {
  it("offers a private /plan action and records a completed-plan commitment", async () => {
    await commitReactWork(() => {
      root?.render(createElement(MorningReentryCard));
    });

    const planLink = findElement(
      container,
      (element) => element.tagName === "A" && element.getAttribute("href") === "/plan",
    );
    expect(planLink).not.toBeNull();
    expect(planLink?.getAttribute("class")).toContain("morningCard__link--secondary");
    expect(planLink?.getAttribute("href")).toBe("/plan");

    await commitReactWork(() => mountedClick(planLink as TestElement));

    expect(beacons).toHaveLength(1);
    const payload = JSON.parse(await beacons[0]!.text()) as {
      name: string;
      props: Record<string, unknown>;
    };
    expect(payload.name).toBe("next_night_committed");
    expect(payload.props).toEqual({ source: "completed_plan", windowDays: 0 });
    expect(JSON.stringify(payload)).not.toContain(PRIVATE_NAMES[0]);
    expect(JSON.stringify(payload)).not.toContain(PRIVATE_NAMES[1]);
  });
});
