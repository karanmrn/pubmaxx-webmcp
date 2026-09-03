// The wiring half of the keyboard rule: which events it listens to, and when it
// is allowed to answer.
//
// The rule itself (both halves of the evidence) is fenced in
// softKeyboardTabBar.test.ts. What is fenced HERE is the part that is easy to
// get subtly wrong and impossible to see in a screenshot: `focusout` fires
// BEFORE the next field takes focus, so a recompute inside it answers "no text
// field" for one task every time somebody moves from one field to the next. The
// bar would flash back over the keyboard between the two fields.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";

type Handler = () => void;

const LAYOUT_HEIGHT = 844;
const WITH_KEYBOARD = 544;

let documentHandlers: Map<string, Set<Handler>>;
let viewportHandlers: Map<string, Set<Handler>>;
let activeElement: unknown;

function fakeListeners(store: Map<string, Set<Handler>>) {
  return {
    addEventListener: (type: string, handler: Handler) => {
      const set = store.get(type) ?? new Set<Handler>();
      set.add(handler);
      store.set(type, set);
    },
    removeEventListener: (type: string, handler: Handler) => {
      store.get(type)?.delete(handler);
    },
  };
}

function fire(store: Map<string, Set<Handler>>, type: string): void {
  for (const handler of [...(store.get(type) ?? [])]) handler();
}

function textInput(type = "text") {
  return {
    tagName: "INPUT",
    getAttribute: (name: string) => (name === "type" ? type : null),
  };
}

function setViewportHeight(height: number): void {
  (globalThis.window as unknown as { visualViewport: { height: number } }).visualViewport.height =
    height;
}

beforeEach(() => {
  vi.useFakeTimers();
  documentHandlers = new Map();
  viewportHandlers = new Map();
  activeElement = { tagName: "BODY" };
  vi.stubGlobal("document", {
    ...fakeListeners(documentHandlers),
    get activeElement() {
      return activeElement;
    },
  });
  vi.stubGlobal("window", {
    innerHeight: LAYOUT_HEIGHT,
    visualViewport: { height: LAYOUT_HEIGHT, ...fakeListeners(viewportHandlers) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Subscribe and return [notifications, unsubscribe]. */
function subscribe(): [{ count: number }, () => void] {
  const seen = { count: 0 };
  const off = subscribeSoftKeyboard(() => {
    seen.count += 1;
  });
  return [seen, off];
}

describe("what the keyboard store listens to", () => {
  it("takes the caret from the document and the height from the visual viewport", () => {
    const [, off] = subscribe();
    expect([...documentHandlers.keys()].sort()).toEqual(["focusin", "focusout"]);
    expect([...viewportHandlers.keys()].sort()).toEqual(["resize", "scroll"]);
    off();
    // Detached with the last subscriber, so a page with no tab bar pays nothing.
    expect([...(documentHandlers.get("focusin") ?? [])]).toHaveLength(0);
    expect([...(viewportHandlers.get("resize") ?? [])]).toHaveLength(0);
  });

  it("opens when the field is focused and the viewport has shrunk, and closes on blur", () => {
    const [seen, off] = subscribe();
    expect(readSoftKeyboardOpen()).toBe(false);

    activeElement = textInput("password");
    fire(documentHandlers, "focusin");
    vi.runAllTimers();
    // Focus alone is not a keyboard.
    expect(readSoftKeyboardOpen()).toBe(false);

    setViewportHeight(WITH_KEYBOARD);
    fire(viewportHandlers, "resize");
    expect(readSoftKeyboardOpen()).toBe(true);
    expect(seen.count).toBeGreaterThan(0);

    activeElement = { tagName: "BODY" };
    setViewportHeight(LAYOUT_HEIGHT);
    fire(documentHandlers, "focusout");
    fire(viewportHandlers, "resize");
    vi.runAllTimers();
    expect(readSoftKeyboardOpen()).toBe(false);
    off();
  });

  it("stays hidden while focus moves from one field to the next", () => {
    const [, off] = subscribe();
    activeElement = textInput("email");
    setViewportHeight(WITH_KEYBOARD);
    fire(documentHandlers, "focusin");
    fire(viewportHandlers, "resize");
    vi.runAllTimers();
    expect(readSoftKeyboardOpen()).toBe(true);

    // The browser's real order: focusout with the body holding focus, THEN
    // focusin on the next field. The keyboard never went anywhere.
    activeElement = { tagName: "BODY" };
    fire(documentHandlers, "focusout");
    activeElement = textInput("password");
    fire(documentHandlers, "focusin");
    vi.runAllTimers();
    expect(readSoftKeyboardOpen()).toBe(true);
    off();
  });

  it("shows the bar again for the next mount after the last subscriber leaves", () => {
    const [, off] = subscribe();
    activeElement = textInput();
    setViewportHeight(WITH_KEYBOARD);
    fire(viewportHandlers, "resize");
    expect(readSoftKeyboardOpen()).toBe(true);
    off();
    expect(readSoftKeyboardOpen()).toBe(false);
  });
});
