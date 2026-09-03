// @vitest-environment jsdom

// The hero's lede belongs to the button it describes.
//
// DEFECT (UI audit, 2026-09-01, production, 390x844): "Choose its form and
// voice in five steps..." floated roughly 200px below the call-to-action
// cluster with nothing tying it to the "Meet your Pub Pal" button it is about,
// and the three secondary links wrapped 2 + 1, leaving "Find my pint" dangling
// alone under the pair.
//
// The cause of the first is one line of CSS: at phone width .lpHeroCopy is
// `display: contents`, so the lede was flattened into the .lpHero grid as a
// sibling of the whole action block and took that grid's 38px gap. It now sits
// inside .lpHeroActions, under the primary, on that block's own 14px gap.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
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

const landingCss = readFileSync(
  join(process.cwd(), "components/landing/landing.css"),
  "utf8",
);

function heroActions(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(LandingPage));
  const actions = host.querySelector<HTMLElement>(".lpHeroActions");
  expect(actions, "landing action stack present").not.toBeNull();
  return actions!;
}

describe("the lede sits under the call to action it describes", () => {
  it("renders inside the action stack, between the primary and the links", () => {
    const actions = heroActions();
    expect([...actions.children].map((child) => child.className)).toEqual([
      "lpButton lpButtonPrimary",
      "lpHeroLede",
      "lpHeroSecondaryRow",
    ]);
    expect(actions.querySelectorAll(".lpHeroLede")).toHaveLength(1);
  });

  it("carries no margin of its own, so the stack's gap owns the rhythm", () => {
    expect(landingCss).toMatch(/\.lpHeroLede \{[^}]*margin: 0;/);
  });
});

describe("the three secondary links are peers at phone width", () => {
  it("stacks them one per row rather than wrapping 2 + 1", () => {
    const phoneRule = landingCss.match(
      /@media \(max-width: 640px\) \{\s*\.lpHeroSecondaryRow \{[\s\S]*?\}\s*\}/,
    )?.[0];
    expect(phoneRule, "phone rule for the secondary row present").toBeTruthy();
    expect(phoneRule).toContain("flex-direction: column;");
    expect(phoneRule).toContain("align-items: flex-start;");
  });

  it("leaves the wide-viewport row alone", () => {
    const base = landingCss.match(/\n\.lpHeroSecondaryRow \{[\s\S]*?\}/)?.[0];
    expect(base).toContain("flex-wrap: wrap;");
    expect(base).not.toContain("flex-direction: column;");
  });
});
