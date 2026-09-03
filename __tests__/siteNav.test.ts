import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// SiteNav pulls in several context-bound children (auth, command palette,
// theme) and the app-router `usePathname` hook. This test isolates SiteNav's
// own markup — specifically the desktop Moment compose affordance (audit
// finding D2) — by stubbing those dependencies. `momentHref` stays REAL so the
// href shape under test is the same one the mobile FAB produces.
vi.mock("next/navigation", () => ({
  usePathname: () => "/tonight",
}));
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {} }),
}));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
// SiteNavMore keeps real markup so the overflow link contract is tested.

async function renderSiteNav(): Promise<string> {
  const { default: SiteNav } = await import("@/components/nav/SiteNav");
  return renderToStaticMarkup(createElement(SiteNav));
}

describe("SiteNav desktop Moment affordance (audit D2)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Moment compose link into the action cluster", async () => {
    const markup = await renderSiteNav();
    expect(markup).toContain("siteNavMoment");
    expect(markup).toContain('aria-label="Share a Moment"');
  });

  it("points the Moment link at /moment carrying the current page as returnTo", async () => {
    const markup = await renderSiteNav();
    // Same href shape the mobile FAB emits via momentHref(): the compose route
    // with the current path url-encoded as returnTo so composing round-trips.
    expect(markup).toContain('href="/moment?returnTo=%2Ftonight"');
  });

  it("keeps the Moment affordance free of em dashes", async () => {
    const markup = await renderSiteNav();
    expect(markup).not.toContain("—");
  });
});

describe("SiteNav More overflow (Wave D2.2)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a More control for secondary destinations", async () => {
    const markup = await renderSiteNav();
    expect(markup).toContain("siteNavMore");
    expect(markup).toContain("siteNavMoreBtn");
    expect(markup).toContain(">More</span>");
  });

  it("exposes only live secondary destinations in More", async () => {
    const { SITE_NAV_MORE_LINKS } = await import("@/components/nav/SiteNavMore");
    expect(SITE_NAV_MORE_LINKS.map((link) => link.href)).toEqual([
      "/plan",
      "/near",
      "/historic",
      "/pal",
    ]);
    expect(SITE_NAV_MORE_LINKS.map((link) => link.label)).toEqual([
      "Plan",
      "Near",
      "Historic",
      "Pal",
    ]);
  });

  it("explains what every More destination is for", async () => {
    const { SITE_NAV_MORE_LINKS } = await import("@/components/nav/SiteNavMore");
    expect(SITE_NAV_MORE_LINKS.map((link) => link.description)).toEqual([
      "Build a three-stop outing",
      "Find priced pubs close to you",
      "Read the stories behind old pubs",
      "Ask for a pub that fits tonight",
    ]);
  });

  it("keeps More markup free of em dashes", async () => {
    const markup = await renderSiteNav();
    expect(markup).not.toContain("—");
  });
});
