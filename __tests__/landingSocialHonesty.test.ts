import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/city/CityChooser", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/landing/ThamesHero", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";

function renderLanding(socialFriendsLaunchEnabled?: boolean): string {
  return renderToStaticMarkup(
    createElement(LandingPage, { socialFriendsLaunchEnabled }),
  );
}

function linkTexts(markup: string, href: string): string[] {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...markup.matchAll(new RegExp(`<a[^>]*href="${escapedHref}"[^>]*>([\\s\\S]*?)</a>`, "g"))].map(
    ([, content]) => content!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  );
}

describe("landing Social honesty", () => {
  it("defaults Memory to the live Social surface", () => {
    const markup = renderLanding();
    expect(linkTexts(markup, "/plan")).toContain("Start a plan");
    expect(linkTexts(markup, "/social")).toContain("Open Social");
    expect(linkTexts(markup, "/u/you#night-memories")).toHaveLength(0);
  });

  it("uses Memories when the emergency rollback is enabled", () => {
    const markup = renderLanding(false);
    expect(linkTexts(markup, "/u/you#night-memories")).toContain("Open Memories");
    expect(linkTexts(markup, "/social")).not.toContain("Open Social");
  });

  it("labels Social navigation according to its launch state", () => {
    expect(renderLanding(false)).toContain("Social preview");
    expect(renderLanding(true)).toContain("Social");
    expect(renderLanding(true)).not.toContain("Social preview");
  });
});
