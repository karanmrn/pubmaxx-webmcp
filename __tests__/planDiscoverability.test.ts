import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

const PLAN_INTAKE = path.join(__dirname, "..", "components", "plan", "PlanIntake.tsx");

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

const renderedLanding = renderToStaticMarkup(createElement(LandingPage));
const planIntake = readFileSync(PLAN_INTAKE, "utf8");

describe("Lane H plan discoverability", () => {
  it("keeps a primary hero CTA on /pal for meeting Pub Pal", () => {
    const hero = renderedLanding.match(/<section class="lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).toMatch(
      /class="lpButton lpButtonPrimary"[^>]*href="\/pal"[^>]*>[\s\S]*?Meet your Pub Pal/,
    );
  });

  it("exposes Plan in the landing primary nav", () => {
    const nav = renderedLanding.match(/<nav class="lpPrimaryNav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav).toMatch(/href="\/plan"[^>]*>Plan<\/a>/);
  });

  it("does not bury Plan only behind the map in the final CTA", () => {
    const finalBlock = renderedLanding.match(/<section class="lpFinalCta"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(finalBlock).toMatch(/href="\/plan"[^>]*>[\s\S]*?Plan tonight together/);
  });

  it("routes the Pub Pal callout to its meeting surface, not back to Plan", () => {
    const callout = renderedLanding.match(/<div class="lpPalCallout"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(callout).toMatch(/href="\/pal"[^>]*>[\s\S]*?Meet your Pub Pal/);
    expect(callout).toContain("Ask your Pub Pal");
    expect(callout).not.toMatch(/href="\/plan"/);
  });

  it("offers Pub Pal as an alternate entry on the plan intake surface", () => {
    expect(planIntake).toContain('href="/pal/chat"');
    expect(planIntake).toContain("Not sure?");
    expect(planIntake).toContain("Ask your Pub Pal…");
    expect(planIntake).toContain("planIntake__palEntry");
  });
});
