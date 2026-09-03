// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The phone sheet portal is display:none above the phone breakpoint, and CSS
// reaches neither of the two things a MOUNTED sheet still owns: the Escape key
// it claims on `window`, and the focus it captures and restores. Only a real
// mount shows that, which is why this file runs in jsdom.
//
// `choose-area` is the first overlay a DESKTOP control opens, so it is the
// first time the hidden phone sheet and a desktop dialog answered the same
// press - the dialog closed AND the surface trail was sent Home behind it.

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { default: MobileMapShell } = await import(
  "@/components/mobile/MobileMapShell"
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) {
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
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function shellProps(overrides: Record<string, unknown> = {}) {
  return {
    cityId: "london" as const,
    cityLabel: "Camden",
    limitedCoverage: false,
    overlay: "choose-area" as const,
    onOverlayChange: vi.fn(),
    activeQuery: "",
    onClearQuery: vi.fn(),
    onNearMe: vi.fn(),
    nearMeStatus: "idle" as const,
    nearMeError: null,
    onDismissNearMeError: vi.fn(),
    nearbyCount: 0,
    tonightCount: 0,
    tonightNearReader: false,
    tflCount: 0,
    tflStatus: "clear" as const,
    priceLabel: "Any price",
    drinkFiltersActive: false,
    zoneActive: false,
    openNowActive: false,
    drinkLaneLabel: "Pints",
    drinkLaneSelected: false,
    drinkContent: null,
    priceCapActive: false,
    planOpen: false,
    planActive: false,
    planStopCount: 0,
    planInteractive: true,
    venueListOpen: false,
    bandNoticeOpen: false,
    onPlan: vi.fn(),
    searchContent: null,
    filtersContent: null,
    tflContent: null,
    tonightContent: null,
    layersContent: null,
    palContent: null,
    momentContent: null,
    nearMeContent: null,
    areaContent: null,
    chooseAreaContent: createElement("p", null, "Choose an area body"),
    backLabel: null,
    onBack: vi.fn(),
    onHome: vi.fn(),
    ...overrides,
  };
}

function mount(overrides: Record<string, unknown> = {}) {
  const props = shellProps(overrides);
  act(() => {
    root.render(createElement(MobileMapShell, props));
  });
  return props;
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe("the phone sheet lane belongs to the phone", () => {
  it("mounts the sheet and answers Escape when the shell owns the lane", () => {
    const props = mount({ sheetsEnabled: true, onBack: vi.fn() });
    expect(document.body.querySelector(".mobileSheetPortal")).not.toBeNull();
    const event = pressEscape();
    expect(props.onBack).toHaveBeenCalledTimes(1);
    // It claims the key, which is what tells every other Escape handler in the
    // map lane to stand down for this press.
    expect(event.defaultPrevented).toBe(true);
  });

  it("mounts no sheet, and answers no Escape, when it does not", () => {
    const props = mount({ sheetsEnabled: false, onBack: vi.fn() });
    // Not merely hidden: absent, because a mounted sheet claims Escape on
    // `window` and captures focus, and neither is something CSS can withhold.
    expect(document.body.querySelector(".mobileSheetPortal")).toBeNull();
    const event = pressEscape();
    expect(props.onBack).not.toHaveBeenCalled();
    // So the desktop dialog's own dismissal is the only one for that press.
    expect(event.defaultPrevented).toBe(false);
  });

  it("still owns the lane for an overlay a phone control opened", () => {
    const props = mount({
      sheetsEnabled: true,
      overlay: "filters",
      onBack: vi.fn(),
    });
    expect(document.body.querySelector(".mobileSheetPortal")).not.toBeNull();
    pressEscape();
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
