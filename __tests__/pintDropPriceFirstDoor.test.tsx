// @vitest-environment jsdom

// The price-first Pint Drop door (activation report D2). The first Pint Drop
// used to sit behind the whole Stories composer — camera step, handle, story,
// era, vibes, visibility — before a price could be entered. The door now opens
// on the price: chips, drink, one Log it action. Everything else waits behind
// one disclosure. Signed out, the SAME door renders and the gate is the
// sign-in link where submit would be. These tests pin the step order and the
// gate; the trust rules (account-bound author, no anonymous authority) are
// pinned by __tests__/pintDropUserFlow.test.ts and are untouched here.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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

// The draft hydration, viewport, dictation and Round hooks are lifecycle
// plumbing, not door policy — stub them so the composer renders synchronously.
vi.mock("@/components/map/composer/useVenueDraft", () => ({
  useVenueDraft: () => true,
}));
vi.mock("@/components/map/composer/useIsMobileComposer", () => ({
  useIsMobileComposer: () => true,
}));
vi.mock("@/components/map/composer/useSpeechDictation", () => ({
  useSpeechDictation: () => ({
    speechSupported: false,
    listening: false,
    error: "",
    toggleListening: () => {},
  }),
}));
vi.mock("@/components/map/composer/useActiveRound", () => ({
  useActiveRound: () => false,
}));

import PintDropComposer from "@/components/map/PintDropComposer";
import { SPILL_EXTRAS_TOGGLE_LABEL, SPILL_LOG_ACTION_LABEL } from "@/lib/spill";
import type { PintDropsState } from "@/components/map/usePintDrops";

const VENUE_ID = "venue-test1";

type StateOverrides = {
  handle?: string;
  accountHandle?: string | null;
  authConfigured?: boolean;
  signedIn?: boolean;
  identityReady?: boolean;
  dropForm?: Partial<{ price: string; drink: string; note: string; era: string; withWho: string }>;
  vibeTags?: string[];
};

function makeState(overrides: StateOverrides = {}): PintDropsState {
  return {
    handle: overrides.handle ?? "",
    setHandle: () => {},
    accountHandle: overrides.accountHandle ?? null,
    authConfigured: overrides.authConfigured ?? false,
    signedIn: overrides.signedIn ?? false,
    identityReady: overrides.identityReady ?? true,
    dropForm: {
      price: "",
      drink: "",
      note: "",
      era: "",
      withWho: "",
      ...overrides.dropForm,
    },
    setDropForm: () => {},
    vibeTags: overrides.vibeTags ?? [],
    setVibeTags: () => {},
    toggleVibeTag: () => {},
    visibility: "public",
    setVisibility: () => {},
    pintPhoto: null,
    venuePhoto: null,
    pintInputRef: { current: null },
    venueInputRef: { current: null },
    pickPhoto: () => {},
    removePhoto: () => {},
    resetComposer: () => {},
    submitting: false,
    dropMsg: null,
    submitDrop: async () => {},
    venueSignals: new Map(),
  } as unknown as PintDropsState;
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

async function render(state: PintDropsState): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(PintDropComposer, {
        venueId: VENUE_ID,
        state,
        venueName: "The Test Arms",
      }),
    );
  });
}

function extrasToggle(): HTMLButtonElement {
  const toggle = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(SPILL_EXTRAS_TOGGLE_LABEL),
  );
  expect(toggle).toBeTruthy();
  return toggle as HTMLButtonElement;
}

describe("price-first Pint Drop door", () => {
  it("opens on the price step, with the photo and story behind the disclosure", async () => {
    await render(makeState());

    const priceStep = container.querySelector('[data-testid="spill-price-step"]');
    expect(priceStep).toBeTruthy();
    expect(container.querySelector('[aria-label="Quick-add price"]')).toBeTruthy();

    // Nothing optional renders before the first tap — no camera step, no
    // story, no vibes, no visibility control.
    expect(container.querySelector('[data-testid="spill-camera-step"]')).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();

    // The price step sits before the extras toggle in document order.
    const toggle = extrasToggle();
    expect(
      priceStep!.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("reveals the camera step, story and visibility only after the disclosure", async () => {
    await render(makeState());

    await act(async () => {
      extrasToggle().click();
    });

    expect(extrasToggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-testid="spill-camera-step"]')).toBeTruthy();
    expect(container.querySelector("textarea")).toBeTruthy();
    expect(container.querySelector('[role="radiogroup"]')).toBeTruthy();
  });

  it("signed out shows the same door with the sign-in gate where submit would be", async () => {
    await render(makeState({ authConfigured: true, signedIn: false }));

    // The same price-first door.
    expect(container.querySelector('[data-testid="spill-price-step"]')).toBeTruthy();

    // No submit button; the gate is the sign-in link, above the extras toggle.
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    const gate = container.querySelector("a.spillSubmitLink");
    expect(gate).toBeTruthy();
    expect(gate!.getAttribute("href")).toContain("/login?mode=signin");
    expect(gate!.getAttribute("href")).toContain(encodeURIComponent(VENUE_ID));
    expect(
      gate!.compareDocumentPosition(extrasToggle()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // And the door says so up front, in words that name the account rule.
    expect(container.textContent).toContain("Sign in to post it under your name.");
  });

  it("signed in posts under the account handle with one Log it action and no handle input", async () => {
    await render(
      makeState({
        authConfigured: true,
        signedIn: true,
        identityReady: true,
        accountHandle: "karan",
        dropForm: { price: "4.50" },
      }),
    );

    const submit = container.querySelector('button[type="submit"]');
    expect(submit).toBeTruthy();
    expect(submit!.textContent).toContain(SPILL_LOG_ACTION_LABEL);
    expect(submit!.hasAttribute("disabled")).toBe(false);

    // The account handle is shown, never edited: no handle input anywhere.
    expect(container.textContent).toContain("@karan");
    const handleInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "@thirsty_ted",
    );
    expect(handleInput).toBeUndefined();
  });

  it("disables Log it until the Pint Drop has a price or story", async () => {
    await render(
      makeState({
        authConfigured: true,
        signedIn: true,
        identityReady: true,
        accountHandle: "karan",
      }),
    );

    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it("keyless demo keeps the typed handle reachable in the compact door", async () => {
    await render(makeState({ authConfigured: false }));

    const handleInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "@thirsty_ted",
    );
    expect(handleInput).toBeTruthy();
    // Reachable without opening the extras: it precedes the toggle.
    expect(
      handleInput!.compareDocumentPosition(extrasToggle()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("re-opens the extras when a recovered draft already carries a story", async () => {
    await render(makeState({ dropForm: { note: "Best pour in Zone 3" } }));

    expect(extrasToggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("textarea")).toBeTruthy();
  });
});
