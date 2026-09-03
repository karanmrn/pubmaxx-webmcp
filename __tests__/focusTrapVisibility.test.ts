import { describe, expect, it } from "vitest";

import {
  FocusTrapOwner,
  shouldEngageFocusTrap,
  shouldInertOutsideSibling,
} from "@/lib/useFocusTrap";

// D2 — the desktop Pint Drop dead end. The phone sheet portal stays mounted at
// desktop widths with `display: none`. Its "moment" sheet opens at the `full`
// detent, so the trap inerted the whole desktop app: the toolbar search input
// could not take focus (activeElement stayed BODY) and the visible desktop
// picker's own rows were unclickable.
describe("shouldEngageFocusTrap", () => {
  it("never traps for a container CSS has hidden", () => {
    expect(
      shouldEngageFocusTrap({
        active: true,
        // section → .mobileSheetPortal (display:none above 640px) → body → html
        displayChain: ["flex", "none", "block", "block"],
      }),
    ).toBe(false);
  });

  it("traps for a container that is on screen", () => {
    expect(
      shouldEngageFocusTrap({
        active: true,
        displayChain: ["flex", "flex", "block", "block"],
      }),
    ).toBe(true);
  });

  it("never traps while inactive", () => {
    expect(
      shouldEngageFocusTrap({ active: false, displayChain: ["flex", "block"] }),
    ).toBe(false);
  });
});

describe("shouldInertOutsideSibling", () => {
  function el(className: string): HTMLElement {
    return {
      classList: { contains: (token: string) => className.split(/\s+/).includes(token) },
    } as HTMLElement;
  }

  it("keeps the primary tab bar interactive beside a map sheet", () => {
    expect(shouldInertOutsideSibling(el("mobileTabBar"), "map-surface")).toBe(false);
    expect(shouldInertOutsideSibling(el("appShell mapStage"), "map-surface")).toBe(true);
  });

  it("keeps account setup above an open map sheet interactive", () => {
    expect(
      shouldInertOutsideSibling(el("accountOnboardingBackdrop"), "map-surface"),
    ).toBe(false);
  });

  it("inerts every outside sibling for a strict modal", () => {
    expect(shouldInertOutsideSibling(el("mobileTabBar"), "strict-modal")).toBe(true);
    expect(
      shouldInertOutsideSibling(el("accountOnboardingBackdrop"), "strict-modal"),
    ).toBe(true);
  });
});

describe("FocusTrapOwner", () => {
  function node(inert = false): HTMLElement {
    return { inert } as HTMLElement;
  }

  function focusOrigin() {
    let focusCalls = 0;
    const element = {
      inert: false,
      isConnected: true,
      parentElement: null,
      focus: () => {
        focusCalls += 1;
      },
    } as unknown as HTMLElement;
    return {
      element,
      disconnect: () => Object.defineProperty(element, "isConnected", { value: false }),
      focusCalls: () => focusCalls,
    };
  }

  for (const firstRelease of ["map", "strict"] as const) {
    it(`keeps an overlapping trap inert when ${firstRelease} releases first`, () => {
      const outside = node();
      const map = new FocusTrapOwner();
      const strict = new FocusTrapOwner();

      map.reconcile([outside]);
      strict.reconcile([outside]);
      (firstRelease === "map" ? map : strict).release();

      expect(outside.inert).toBe(true);

      (firstRelease === "map" ? strict : map).release();

      expect(outside.inert).toBe(false);
    });
  }

  it("restores the earlier map origin after overlapping teardown", () => {
    const mapOrigin = focusOrigin();
    const sheetOrigin = focusOrigin();
    const map = new FocusTrapOwner();
    const strict = new FocusTrapOwner();

    map.captureFocus(mapOrigin.element);
    strict.captureFocus(sheetOrigin.element);
    strict.reconcile([mapOrigin.element]);

    map.release();

    expect(mapOrigin.focusCalls()).toBe(0);

    sheetOrigin.disconnect();
    strict.release();

    expect(sheetOrigin.focusCalls()).toBe(0);
    expect(mapOrigin.focusCalls()).toBe(1);
  });
});
