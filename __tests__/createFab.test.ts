// The floating create action. Compose is an ACTION, so it never joins the
// launch-aware tab row; what it owes instead is the three destinations, a returnTo that
// survives the query of the route it was pressed on, and the same disappearance
// the tab bar performs when the soft keyboard comes up.
//
// The keyboard half is the regression: the control was opacity 0 and translated
// into the tab-bar lane while still being tappable and still a tab stop, because
// `pointer-events: none` on the wrapper does not reach a child that says `auto`.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CREATE_FAB_ACTIONS,
  createFabMenuVisible,
  returnToFromLocation,
} from "@/components/nav/createFabActions";
import { safeMomentReturnTo } from "@/components/nav/navigationModel";

describe("what the create action offers", () => {
  it("offers exactly the three compose rows, in order", () => {
    expect(CREATE_FAB_ACTIONS.map((item) => item.label)).toEqual([
      "Post a moment",
      "Log a price",
      "Start a plan",
    ]);
    expect(CREATE_FAB_ACTIONS.map((item) => item.action)).toEqual([
      "moment",
      "price",
      "plan",
    ]);
  });

  it("sends each row to its own destination", () => {
    const byAction = Object.fromEntries(
      CREATE_FAB_ACTIONS.map((item) => [item.action, item.hrefFor("/map")]),
    );
    expect(byAction.price).toBe("/map?log=1");
    expect(byAction.plan).toBe("/plan");
    expect(byAction.moment).toBe("/moment?returnTo=%2Fmap");
  });

  it("carries the query of the route it was pressed on back into the Moment", () => {
    const moment = CREATE_FAB_ACTIONS.find((item) => item.action === "moment")!;
    const href = moment.hrefFor("/map?sel=venue-123");
    const returnTo = new URL(href, "https://pubmaxxing.com").searchParams.get("returnTo");
    // The pub the composer opened from, not a bare map.
    expect(returnTo).toBe("/map?sel=venue-123");
    expect(safeMomentReturnTo(returnTo)).toBe("/map?sel=venue-123");
  });

  it("never paints the sheet while the control is hidden", () => {
    expect(createFabMenuVisible(true, false)).toBe(true);
    expect(createFabMenuVisible(true, true)).toBe(false);
    expect(createFabMenuVisible(false, false)).toBe(false);
  });
});

// The Map writes its selection into the URL with history.pushState, which the
// Next router never hears, so a returnTo taken from useSearchParams alone came
// back a bare /map after a reader had tapped a pin.
describe("where the composer is told to come back to", () => {
  it("takes the live address bar over the router's reading", () => {
    expect(
      returnToFromLocation({ pathname: "/map", search: "?sel=venue-123" }, "/map"),
    ).toBe("/map?sel=venue-123");
  });

  it("keeps a route with no query intact", () => {
    expect(returnToFromLocation({ pathname: "/out", search: "" }, "/map")).toBe("/out");
  });

  it("falls back to the router's reading when there is no window to read", () => {
    expect(returnToFromLocation(null, "/out?day=weekend")).toBe("/out?day=weekend");
    expect(returnToFromLocation(undefined, "/out")).toBe("/out");
    expect(returnToFromLocation({ pathname: "", search: "?a=1" }, "/out")).toBe("/out");
    // Never an off-site or scheme-relative path, whatever the location said.
    expect(returnToFromLocation({ pathname: "//evil.example", search: "" }, "/out")).toBe(
      "//evil.example",
    );
    expect(safeMomentReturnTo("//evil.example")).toBe("/map");
  });
});

describe("what the create action renders for each keyboard answer", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/softKeyboard");
    vi.doUnmock("@/lib/useFocusTrap");
    vi.doUnmock("next/navigation");
  });

  async function renderFab(
    keyboardOpen: boolean,
    pathname = "/out",
    search = "",
    strictModalOpen = false,
  ): Promise<string> {
    vi.doMock("next/navigation", () => ({
      usePathname: () => pathname,
      useSearchParams: () => new URLSearchParams(search),
      useRouter: () => ({
        back: () => undefined,
        forward: () => undefined,
        refresh: () => undefined,
        push: () => undefined,
        replace: () => undefined,
        prefetch: () => Promise.resolve(),
      }),
    }));
    vi.doMock("@/lib/softKeyboard", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/softKeyboard")>()),
      subscribeSoftKeyboard: () => () => {},
      readSoftKeyboardOpen: () => keyboardOpen,
      serverSoftKeyboardOpen: () => keyboardOpen,
    }));
    vi.doMock("@/lib/useFocusTrap", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/useFocusTrap")>()),
      subscribeStrictModalFocusTrap: () => () => {},
      readStrictModalFocusTrap: () => strictModalOpen,
      serverStrictModalFocusTrap: () => strictModalOpen,
    }));
    vi.resetModules();
    const { default: CreateFab } = await import("@/components/nav/CreateFab");
    return renderToStaticMarkup(createElement(CreateFab));
  }

  const rootTag = (markup: string): string => markup.slice(0, markup.indexOf(">") + 1);
  const buttonTag = (markup: string): string => {
    const start = markup.indexOf("<button");
    return markup.slice(start, markup.indexOf(">", start) + 1);
  };

  it("keeps the control live with no keyboard on screen", async () => {
    const markup = await renderFab(false);
    expect(rootTag(markup)).toContain('class="createFabRoot"');
    expect(rootTag(markup)).not.toContain("isKeyboardHidden");
    expect(rootTag(markup)).not.toContain("aria-hidden");
    expect(rootTag(markup)).not.toMatch(/\binert\b/);
    expect(buttonTag(markup)).not.toMatch(/tabindex="-1"/i);
  });

  it("takes the control out of reach entirely while the keyboard is up", async () => {
    const markup = await renderFab(true);
    expect(rootTag(markup)).toContain("isKeyboardHidden");
    expect(rootTag(markup)).toContain('aria-hidden="true"');
    expect(rootTag(markup)).toMatch(/\binert\b/);
    expect(buttonTag(markup)).toMatch(/tabindex="-1"/i);
    // Hidden, not unmounted: it comes straight back on blur.
    expect(markup).toContain("createFab");
    // And the sheet cannot be open behind it.
    expect(markup).not.toContain("createFabMenu");
  });

  it("rides with the tab bar on the landing pathname", async () => {
    expect(await renderFab(false, "/")).toContain("createFabRoot");
  });

  it("keeps the control inert after a strict modal outlives the keyboard", async () => {
    const markup = await renderFab(false, "/out", "", true);
    expect(rootTag(markup)).not.toContain("isKeyboardHidden");
    expect(rootTag(markup)).not.toContain("aria-hidden");
    expect(rootTag(markup)).toMatch(/\binert\b/);
    expect(buttonTag(markup)).toMatch(/tabindex="-1"/i);
  });
});

// What the hidden state COSTS a reader - the control off screen, untappable,
// and its box no longer owning the point it used to sit on - is rendered
// geometry, and a regex over createFab.css proves none of it: matching text can
// be dead, and a rename that preserves the behaviour would fail it. That half is
// measured in a real browser by
// e2e/mobile-map-chrome-fit.spec.ts ("the create action leaves the screen ...").
