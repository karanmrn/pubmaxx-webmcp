import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import OutTonightPlanCta from "@/components/profile/OutTonightPlanCta";
import { planOccasionHref } from "@/lib/planOccasion";

describe("planOccasionHref", () => {
  it("builds a quiet soft-plan deep link with optional src", () => {
    expect(planOccasionHref("quiet")).toBe("/plan?occasion=quiet");
    expect(planOccasionHref("quiet", { src: "out-tonight" })).toBe(
      "/plan?occasion=quiet&src=out-tonight",
    );
  });
});

describe("OutTonightPlanCta", () => {
  it("links self variant into a quiet soft plan", () => {
    const html = renderToStaticMarkup(createElement(OutTonightPlanCta, { variant: "self" }));
    expect(html).toContain("Plan with your lot");
    expect(html).toContain('href="/plan?occasion=quiet&amp;src=out-tonight"');
  });

  it("links crew variant into a quiet soft plan", () => {
    const html = renderToStaticMarkup(createElement(OutTonightPlanCta, { variant: "crew" }));
    expect(html).toContain("Start a soft plan");
    expect(html).toContain('href="/plan?occasion=quiet&amp;src=out-tonight"');
  });
});

describe("OutTonight beacon plan CTA wiring", () => {
  it("ships the self beacon with a plan handoff when out", () => {
    const toggle = readFileSync(join(process.cwd(), "components/profile/OutTonightToggle.tsx"), "utf8");
    expect(toggle).toContain("OutTonightPlanCta");
    expect(toggle).toContain('variant="self"');
    expect(toggle).toMatch(/state\.kind === "on"/);
  });

  it("ships the crew line with a soft plan handoff", () => {
    const crewLine = readFileSync(join(process.cwd(), "components/profile/OutTonightCrewLine.tsx"), "utf8");
    expect(crewLine).toContain("OutTonightPlanCta");
    expect(crewLine).toContain('variant="crew"');
  });
});
