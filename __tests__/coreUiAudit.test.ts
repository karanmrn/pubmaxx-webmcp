import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const root = process.cwd();
const wordmark = readFileSync(join(root, "components/brand/PubmaxxWordmark.tsx"), "utf8");
const consent = readFileSync(join(root, "app/globals.css"), "utf8");
const tour = readFileSync(join(root, "components/onboarding/firstRunTour.css"), "utf8");
const planEntry = readFileSync(join(root, "components/plan/PlanDescribeFirst.tsx"), "utf8");
const planCss = readFileSync(join(root, "app/plan/plan.css"), "utf8");
const mobileMapCss = readFileSync(
  join(root, "components/mobile/mobileMapShell.css"),
  "utf8",
);
const nextConfig = readFileSync(join(root, "next.config.mjs"), "utf8");
const vercelIgnore = readFileSync(join(root, ".vercelignore"), "utf8");

describe("core UI audit fixes", () => {
  it("makes Meet your Pub Pal the landing hero primary", () => {
    const rendered = renderToStaticMarkup(createElement(LandingPage));
    const hero = rendered.match(/<section class="lpHero"[\s\S]*?<\/section>/)?.[0];
    expect(hero, "landing hero present").toBeTruthy();
    expect(hero).toMatch(
      /class="lpButton lpButtonPrimary"[^>]*href="\/pal"[^>]*>[\s\S]*?Meet your Pub Pal/,
    );
    expect(hero?.match(/class="lpButton lpButtonPrimary"/g)).toHaveLength(1);
  });

  it("publishes the complete PUBMAXX brand to assistive technology", () => {
    expect(wordmark).toMatch(/className=\{`pubmaxxWordmark[\s\S]*?role="img"/);
    expect(wordmark).toMatch(/aria-label=\{BRAND_NAME\}/);
  });

  it("clears mobile consent with the measured 64px tab bar", () => {
    expect(consent).toMatch(/var\(--tabbar-h,\s*64px\)/);
    expect(consent).toMatch(/--analytics-consent-mobile-clearance,\s*128px/);
  });

  it("uses a distinct neutral tone for the dearest first-visit price band", () => {
    expect(tour).toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?background:\s*color-mix\(/);
    expect(tour).not.toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?background:\s*var\(--amber\)/);
    expect(tour).not.toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?var\(--brick\)/);
  });

  it("keeps the plan entry placeholder readable on a phone", () => {
    expect(planEntry).toMatch(/placeholder="Quiet in Clapham for 4"/);
    expect(planEntry).not.toMatch(/placeholder="[^"]*…/);
    expect(planCss).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.planPage__intro\s*\{\s*margin:\s*10px auto 10px/);
  });

  it("removes non-core map tools during first-session arrival", () => {
    expect(mobileMapCss).toMatch(
      /body:has\(\.mapArrivalCard\) \.mobileMapUtilityCorner,[\s\S]*?body:has\(\.mapArrivalCard\) \.mobileMapTonightChip,[\s\S]*?\{\s*display:\s*none;/,
    );
  });

  it("does not ship removed Next experimental options", () => {
    expect(nextConfig).not.toMatch(/\bviewTransition\s*:/);
  });

  it("keeps proof and local build artifacts out of Vercel uploads", () => {
    expect(vercelIgnore).toMatch(/^\/docs\/$/m);
    expect(vercelIgnore).toMatch(/^\/\.next-\*$/m);
    expect(vercelIgnore).toMatch(/^\/coverage\/$/m);
    expect(vercelIgnore).not.toMatch(/^\/?data\/$/m);
    expect(vercelIgnore).not.toMatch(/^\/?public\/$/m);
  });
});
