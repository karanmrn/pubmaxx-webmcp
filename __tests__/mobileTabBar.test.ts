import { describe, expect, it } from "vitest";
import { buildTabs, shouldShowMobileTabBar } from "@/components/nav/MobileTabBar";
import { navPathMatches } from "@/components/nav/navigationModel";

// Five-tab contract for the mobile bar. Moment is a floating + action, never
// a destination, so it is not in this row. Today and Tonight share the Now
// tab; the URL is the truth.

function activeLabel(pathname: string): string | undefined {
  const tabs = buildTabs();
  return tabs.find((tab) => navPathMatches(pathname, tab.match ?? [tab.href]))?.label;
}

describe("mobile tab bar contract", () => {
  it("shows the app tab bar on every route, including the landing pathname", () => {
    expect(shouldShowMobileTabBar("/")).toBe(true);
    expect(shouldShowMobileTabBar("/pal/chat")).toBe(true);
    expect(shouldShowMobileTabBar("/near")).toBe(true);
    expect(shouldShowMobileTabBar("/map")).toBe(true);
    expect(shouldShowMobileTabBar("/plan")).toBe(true);
    expect(shouldShowMobileTabBar("/out")).toBe(true);
    expect(shouldShowMobileTabBar("/area/clapham/drink/guinness")).toBe(true);
  });

  it("renders exactly five tabs in the journey order", () => {
    const tabs = buildTabs();
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Now",
      "Map",
      "Out",
      "Social",
      "You",
    ]);
  });

  it("keeps gated Social visible as a preview destination", () => {
    const tabs = buildTabs("/u/you", "/today", false);
    const social = tabs.find((tab) => tab.label === "Social");
    expect(tabs.map((tab) => tab.label)).toEqual(["Now", "Map", "Out", "Social", "You"]);
    expect(social?.preview).toBe(true);
    expect(social?.ariaLabel).toBe("Social preview");
  });

  it("routes every tab to its owned destination", () => {
    const tabs = buildTabs("/u/you", "/tonight");
    const byLabel = Object.fromEntries(tabs.map((tab) => [tab.label, tab]));
    expect(byLabel.Now.href).toBe("/tonight");
    expect(byLabel.Now.match).toEqual(["/today", "/tonight"]);
    expect(byLabel.Map.href).toBe("/map");
    expect(byLabel.Out.href).toBe("/out");
    expect(byLabel.Social.href).toBe("/social");
    expect(byLabel.You.href).toBe("/u/you");
  });

  it("points You at the device handle when known (skips /u/you sentinel hop)", () => {
    const tabs = buildTabs("/u/karan");
    const you = tabs.find((tab) => tab.label === "You");
    expect(you?.href).toBe("/u/karan");
    expect(you?.match).toEqual(["/u"]);
  });

  it("keeps Moment out of the tab row", () => {
    const tabs = buildTabs();
    expect(tabs.some((tab) => tab.label === "Moment")).toBe(false);
    expect(tabs.some((tab) => tab.href.startsWith("/moment"))).toBe(false);
    expect(tabs.map((tab) => tab.key)).not.toContain("moment");
  });

  it("marks Now active on both /today and /tonight", () => {
    expect(activeLabel("/today")).toBe("Now");
    expect(activeLabel("/tonight")).toBe("Now");
    expect(activeLabel("/out")).toBe("Out");
    expect(activeLabel("/social")).toBe("Social");
    expect(activeLabel("/feed")).toBe("Social");
    expect(activeLabel("/moment")).toBeUndefined();
  });
});
