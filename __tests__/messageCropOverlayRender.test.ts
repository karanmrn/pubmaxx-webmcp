// @vitest-environment jsdom

// The crop step the DM thread actually MOUNTS.
//
// Choosing a photo in a thread used to drop the cropper into the flow of the
// page, so on a phone it pushed the composer off screen and its own Use photo /
// Cancel row landed under the tab bar. The fix is a bounded card in a modal
// overlay, and the overlay is a real modal: focus moves into it, Escape leaves.
//
// The shipped stylesheet is fenced in `messageBubbleAndComposer.test.ts` and the
// rendered geometry in `e2e/message-bubble-geometry.spec.ts` - but that probe
// BUILDS its own elements with these class names, so neither file notices if the
// thread stops emitting the wrapper. This one mounts the thread, chooses a file,
// and asks the DOM what appeared.

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

// ONE stable value, the way the real provider memoises its context. A fresh
// object per call would give MessageThread a fresh `refresh` callback per
// render, re-running its load effect for ever.
const AUTH = { user: { id: "user-1" }, handle: "alice" };
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => AUTH }));

vi.mock("@/components/auth/SignInButton", () => ({
  default: () => createElement("button", { type: "button" }, "Sign in"),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

vi.mock("@/lib/messagesRealtime", () => ({
  subscribeToMessages: () => () => {},
}));

// One empty, readable thread: enough for the composer and its attachment picker
// to render, which is where a photo is chosen.
vi.mock("@/lib/authedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authedFetch")>()),
  authedActionFetch: async () => Response.json({ messages: [] }),
}));

import MessageThread from "@/components/messages/MessageThread";

let container: HTMLDivElement;
let root: Root | null = null;

async function mountThread(): Promise<void> {
  await act(async () => {
    root?.render(createElement(MessageThread, { conversationId: "c1" }));
  });
  await settle();
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** Choose a photo the way the picker's own hidden input does. */
async function choosePhoto(): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("#message-photo-file");
  expect(input, "the attachment picker's photo input must be mounted").not.toBeNull();
  const file = new File([new Uint8Array([1, 2, 3])], "pint.jpg", { type: "image/jpeg" });
  Object.defineProperty(input!, "files", { value: [file], configurable: true });
  await act(async () => {
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

function overlays(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".messageCropOverlay")];
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The cropper hands the chosen file to an <img> through an object URL, and
  // jsdom ships neither half.
  Object.defineProperty(URL, "createObjectURL", {
    value: () => "blob:crop-step",
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: () => {},
    configurable: true,
    writable: true,
  });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("choosing a DM photo opens a bounded modal card, not an in-flow step", () => {
  it("puts the crop step inside ONE overlay and ONE modal card", async () => {
    await mountThread();
    expect(overlays(), "nothing is open until a photo is chosen").toHaveLength(0);

    await choosePhoto();

    // THE DEFECT: the cropper rendered straight into the thread, so the phone
    // had no bounded card at all and its own actions fell under the tab bar.
    expect(overlays()).toHaveLength(1);
    const overlay = overlays()[0]!;

    const dialogs = overlay.querySelectorAll('[role="dialog"][aria-modal="true"]');
    expect(dialogs).toHaveLength(1);
    const card = dialogs[0] as HTMLElement;
    expect(card.classList.contains("messageCropCard")).toBe(true);

    // It is the MESSAGE photo's crop step, at the message target's own shape.
    expect(card.querySelector(".profileCropStep-message-photo")).not.toBeNull();
    expect(card.querySelector(".profileCropActions")).not.toBeNull();
  });

  it("moves focus into the card rather than leaving it on the thread behind", async () => {
    await mountThread();
    await choosePhoto();

    const card = container.querySelector<HTMLElement>(".messageCropCard");
    expect(card).not.toBeNull();
    // A dialog that declares itself modal has to BE one: a keyboard reader was
    // left on the composer underneath with no way in and no way out.
    expect(card!.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape, so the way out is not hunting for Cancel", async () => {
    await mountThread();
    await choosePhoto();
    expect(overlays()).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();

    expect(overlays()).toHaveLength(0);
  });

  it("closes on the card's own Cancel", async () => {
    await mountThread();
    await choosePhoto();
    const cancel = container.querySelector<HTMLButtonElement>(
      ".messageCropCard .profileCropCancel",
    );
    expect(cancel).not.toBeNull();

    await act(async () => {
      cancel!.click();
    });
    await settle();

    expect(overlays()).toHaveLength(0);
  });
});
