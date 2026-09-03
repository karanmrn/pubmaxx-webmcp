import { act as reactDomAct, createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeagueRow } from "@/lib/pintIndex";

const camdenLeagueRow: LeagueRow = {
  slug: "camden",
  name: "Camden",
  pubCount: 2,
  averageGbp: 6.1,
  minGbp: 5.8,
  minPubName: "Cheap A",
  maxGbp: 6.4,
  maxPubName: "Cheap B",
};

const leagueLoader = vi.hoisted(() => ({
  load: vi.fn(async () => [camdenLeagueRow]),
  reset: vi.fn(),
}));

vi.mock("@/lib/pintIndexLeagueLoader", () => ({
  loadPintIndexLeagueRows: () => leagueLoader.load(),
  resetPintIndexLeagueLoader: () => leagueLoader.reset(),
}));

import VenueAreaPriceCompare from "@/components/map/VenueAreaPriceCompare";

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

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
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
    this.documentElement.appendChild(this.body);
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

function elementText(node: TestNode): string {
  if (node instanceof TestText) return node.data;
  return node.childNodes.map((child) => elementText(child)).join("");
}

const reactAct = reactDomAct;

async function commit(work: () => void | Promise<void>) {
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

let root: Root | null = null;
let container: TestElement;
let previousWindow: typeof globalThis.window | undefined;
let previousDocument: typeof globalThis.document | undefined;

beforeEach(() => {
  leagueLoader.load.mockClear();
  leagueLoader.load.mockResolvedValue([camdenLeagueRow]);
  const document = new TestDocument();
  const window = {
    document,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
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
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element);
});

afterEach(async () => {
  if (root) {
    await commit(() => root?.unmount());
    root = null;
  }
  Object.assign(globalThis, {
    window: previousWindow,
    document: previousDocument,
    IS_REACT_ACT_ENVIRONMENT: false,
  });
});

describe("VenueAreaPriceCompare component", () => {
  it("renders the borough compare line once league rows settle", async () => {
    await commit(() => {
      root?.render(
        createElement(VenueAreaPriceCompare, {
          priceGbp: 5.4,
          primaryBorough: "Camden",
        }),
      );
    });

    await vi.waitFor(() => {
      expect(
        findElement(container, (element) =>
          (element.getAttribute("class") ?? "").split(/\s+/).includes("venueAreaPriceCompare"),
        ),
      ).not.toBeNull();
    });

    const line = findElement(container, (element) =>
      (element.getAttribute("class") ?? "").split(/\s+/).includes("venueAreaPriceCompare"),
    );
    expect(elementText(line!)).toBe("£5.40 here. Camden average £6.10.");
  });

  it("stays silent when the borough has no league row after fetch settles", async () => {
    leagueLoader.load.mockResolvedValue([]);

    await commit(() => {
      root?.render(
        createElement(VenueAreaPriceCompare, {
          priceGbp: 5.4,
          primaryBorough: "Lambeth",
          zone: 2,
        }),
      );
    });

    await vi.waitFor(() => {
      expect(leagueLoader.load).toHaveBeenCalled();
    });

    expect(
      findElement(container, (element) =>
        (element.getAttribute("class") ?? "").split(/\s+/).includes("venueAreaPriceCompare"),
      ),
    ).toBeNull();
  });

  it("stays silent until the league fetch settles even when zone data exists", async () => {
    let resolveLeague!: (rows: LeagueRow[]) => void;
    leagueLoader.load.mockImplementation(
      () =>
        new Promise<LeagueRow[]>((resolve) => {
          resolveLeague = resolve;
        }),
    );

    await commit(() => {
      root?.render(
        createElement(VenueAreaPriceCompare, {
          priceGbp: 5.4,
          primaryBorough: "Camden",
          zone: 2,
          zoneIndex: {
            rows: [
              {
                zone: 2,
                medianGbp: 6.1,
                pricedCount: 12,
                enough: true,
              },
            ],
            ranked: [],
            dearest: null,
            cheapest: null,
            taxGbp: null,
          },
        }),
      );
    });

    expect(
      findElement(container, (element) =>
        (element.getAttribute("class") ?? "").split(/\s+/).includes("venueAreaPriceCompare"),
      ),
    ).toBeNull();

    await commit(async () => {
      resolveLeague([camdenLeagueRow]);
    });

    await vi.waitFor(() => {
      expect(
        findElement(container, (element) =>
          (element.getAttribute("class") ?? "").split(/\s+/).includes("venueAreaPriceCompare"),
        ),
      ).not.toBeNull();
    });
  });
});
