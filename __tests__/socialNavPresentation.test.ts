// @vitest-environment jsdom
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
}));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/map",
  subscribePreferredCity: () => () => {},
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));
vi.mock("@/lib/mapWarmup", () => ({
  warmNavRoute: () => undefined,
}));
vi.mock("@/lib/mobileShell", () => ({
  requestMobileSheetDismiss: () => undefined,
}));
vi.mock("@/lib/softKeyboard", () => ({
  readSoftKeyboardOpen: () => false,
  serverSoftKeyboardOpen: () => false,
  subscribeSoftKeyboard: () => () => {},
}));
vi.mock("@/lib/useFocusTrap", () => ({
  readStrictModalFocusTrap: () => false,
  serverStrictModalFocusTrap: () => false,
  subscribeStrictModalFocusTrap: () => () => {},
}));
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {} }),
}));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));

import MobileTabBar from "@/components/nav/MobileTabBar";
import SiteNav from "@/components/nav/SiteNav";
import { SocialFriendsLaunchProvider } from "@/lib/useSocialFriendsLaunch";

// The SERVER render is what this file is about: the flag is known when the root
// layout renders, so the HTML a stranger receives (including the two CDN-cached
// prerendered documents) already names Social correctly.
function serverRender(
  component: ComponentType,
  friendsLaunchEnabled: boolean,
): HTMLElement {
  // The provider's own props type names `children`, so createElement's props
  // overload would demand it there; the child belongs in the child argument.
  const LaunchProvider = SocialFriendsLaunchProvider as ComponentType<{
    value: boolean;
  }>;
  const markup = renderToStaticMarkup(
    createElement(
      LaunchProvider,
      { value: friendsLaunchEnabled },
      createElement(component),
    ),
  );
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

function socialTab(host: HTMLElement): HTMLAnchorElement {
  const tab = host.querySelector<HTMLAnchorElement>('a[href="/social"]');
  if (!tab) throw new Error("no Social tab rendered");
  return tab;
}

describe("the phone Social tab", () => {
  it("keeps Social visible as a preview destination while launch is gated", () => {
    const tab = socialTab(serverRender(MobileTabBar, false));

    expect(tab.textContent).toBe("Social");
    expect(tab.getAttribute("aria-label")).toBe("Social preview");
    expect(tab.querySelector(".mobileTabPreviewDot")).not.toBeNull();
  });

  it("renders Social on the first paint when launch is on", () => {
    const tab = socialTab(serverRender(MobileTabBar, true));

    expect(tab.textContent).toBe("Social");
    expect(tab.getAttribute("aria-label")).toBeNull();
  });
});

describe("the desktop Social nav link", () => {
  it("names the gated desktop destination Social preview", () => {
    const tab = serverRender(SiteNav, false).querySelector<HTMLAnchorElement>('a[href="/social"]');
    expect(tab?.textContent).toBe("Social preview");
    expect(tab?.getAttribute("aria-label")).toBe("Social preview");
  });

  it("names Social in the served HTML when the launch is on", () => {
    const tab = socialTab(serverRender(SiteNav, true));
    expect(tab.textContent).toContain("Social");
    expect(tab.textContent).not.toContain("preview");
  });
});
