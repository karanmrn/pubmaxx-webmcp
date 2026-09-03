import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

// Captain decision 2026-08-17 (audit lane E, L2b): the landing hero carries no
// example price figures, so the caption no longer has to disclaim them. Proven
// against RENDERED markup, because a source read passes on any wording change
// while the figure is still painted.

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/city/CityChooser", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";

function heroFigure(): string {
  const rendered = renderToStaticMarkup(createElement(LandingPage));
  const figure = rendered.match(
    /<figure class="lpHeroMap"[^>]*>[\s\S]*?<\/figure>/,
  )?.[0];
  expect(figure, "hero figure present").toBeTruthy();
  return figure ?? "";
}

describe("landing hero price copy", () => {
  it("paints no price figure on any hero drink pin", () => {
    const figure = heroFigure();

    // The pins are still there and still named, so this is not passing on an
    // empty hero.
    expect(figure).toMatch(/class="thamesHeroPin"/);
    expect(figure).toMatch(/class="thamesHeroPinPlace">The Dove</);
    expect(figure).not.toContain("thamesHeroPinPrice");
    expect(figure).not.toMatch(/£\s?\d/);
  });

  it("hangs no price band on a hero pin", () => {
    // The rim used to carry the map's own price key (green / amber / red) over
    // six named pubs. With the figures and their disclaimer gone, a band would
    // be a price claim nothing on the page answers for.
    expect(heroFigure()).not.toMatch(/data-band=/);
  });

  it("keeps one invite line and drops the example-price disclaimer", () => {
    const caption = heroFigure().match(
      /<figcaption class="lpHeroMapCaption"[^>]*>[\s\S]*?<\/figcaption>/,
    )?.[0];
    expect(caption, "hero caption present").toBeTruthy();

    expect(caption).toContain("lpHeroMapInvite");
    expect(caption).toContain(
      "Each shape is a drink. Tap or pick one to see the pubs that pour it.",
    );
    expect(caption).not.toContain("examples, not live listed prices");
    expect(caption).not.toMatch(/Prices shown/i);
  });
});
