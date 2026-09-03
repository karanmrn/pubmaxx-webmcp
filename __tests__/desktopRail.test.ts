import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DesktopRail from "@/components/desktop/DesktopRail";

// Node-env unit test (no DOM): the host is a pure layout component, so
// renderToStaticMarkup is enough to lock its slot contract, and the CSS is
// asserted from source (the same idiom as activationChromeCss.test.ts).

const desktopRailCss = readFileSync(
  join(process.cwd(), "components/desktop/desktopRail.css"),
  "utf8",
);

describe("DesktopRail host — slot contract", () => {
  it("renders the named slots in Conditions → AreaNews → NightArc order", () => {
    const html = renderToStaticMarkup(
      createElement(DesktopRail, {
        conditions: createElement("div", null, "SLOT_CONDITIONS"),
        areaNews: createElement("div", null, "SLOT_AREANEWS"),
        nightArc: createElement("div", null, "SLOT_NIGHTARC"),
      }),
    );
    expect(html.indexOf("SLOT_CONDITIONS")).toBeGreaterThan(-1);
    expect(html.indexOf("SLOT_CONDITIONS")).toBeLessThan(html.indexOf("SLOT_AREANEWS"));
    expect(html.indexOf("SLOT_AREANEWS")).toBeLessThan(html.indexOf("SLOT_NIGHTARC"));
    expect(html).toContain('class="desktopRail"');
    expect(html).toContain("<aside");
  });

  it("omits an absent slot with no wrapper element (no phantom gap)", () => {
    const html = renderToStaticMarkup(
      createElement(DesktopRail, {
        conditions: createElement("div", null, "ONLY_CONDITIONS"),
      }),
    );
    expect(html).toContain("ONLY_CONDITIONS");
    expect(html).not.toContain("SLOT_AREANEWS");
    // exactly one child element — omitted slots contribute no markup
    expect(html.match(/<div/g)?.length).toBe(1);
  });

  it("appends children after the named slots", () => {
    const html = renderToStaticMarkup(
      createElement(
        DesktopRail,
        { conditions: createElement("div", null, "SLOT_CONDITIONS") },
        createElement("div", null, "EXTRA_CHILD"),
      ),
    );
    expect(html.indexOf("SLOT_CONDITIONS")).toBeLessThan(html.indexOf("EXTRA_CHILD"));
  });

  it("renders nothing when no slots are provided", () => {
    expect(renderToStaticMarkup(createElement(DesktopRail, {}))).toBe("");
  });

  it("passes a host className and aria-label through to the landmark", () => {
    const html = renderToStaticMarkup(
      createElement(DesktopRail, {
        className: "mapRail",
        ariaLabel: "Map conditions",
        conditions: createElement("div", null, "x"),
      }),
    );
    expect(html).toContain('class="desktopRail mapRail"');
    expect(html).toContain('aria-label="Map conditions"');
  });
});

describe("DesktopRail host — CSS", () => {
  it("is a transparent flex stack (no border/surface of its own)", () => {
    const block = desktopRailCss.match(/\.desktopRail\s*{[\s\S]*?}/)?.[0] ?? "";
    expect(block).toMatch(/display:\s*flex;/);
    expect(block).toMatch(/flex-direction:\s*column;/);
    expect(block).toMatch(/gap:\s*16px;/);
    // transparent: the slots carry the chrome, so the host sets no bg/border
    expect(block).not.toMatch(/background:/);
    expect(block).not.toMatch(/border:/);
  });

  it("becomes a sticky rail at the >=1024 breakpoint with an overridable offset", () => {
    expect(desktopRailCss).toMatch(
      /@media\s*\(min-width:\s*1024px\)\s*{[\s\S]*?\.desktopRail\s*{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*var\(--desktop-rail-top,\s*96px\);/,
    );
  });
});
