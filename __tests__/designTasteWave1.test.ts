import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? cssFiles(full)
      : entry.endsWith(".css")
        ? [full]
        : [];
  });
}

const excludedLanes = ["app/messages/", "app/plan/", "components/map/"];
// Global Map styles and the shared Map contribution gate stay in their lane.
const excludedSelectors = [
  ".mapLoadingEyebrow",
  ".venueHoverEyebrow",
  ".contributionGateEyebrow",
  // The Map tour stays in Map's lane per fence.
  ".tourEyebrow",
];
const stampSelectors = [
  ".feedEyebrow",
  ".lpHeroKicker",
  ".passportKicker",
  ".passportQuestKicker",
  ".passportQuestOptInKicker",
];

describe("desktop taste wave 1", () => {
  it("keeps plain-text eyebrows in sentence case outside excluded lanes", () => {
    const violations: string[] = [];

    for (const file of [...cssFiles(join(ROOT, "app")), ...cssFiles(join(ROOT, "components"))]) {
      const fileName = relative(ROOT, file);
      if (excludedLanes.some((lane) => fileName.startsWith(lane))) continue;

      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1].trim();
        const declarations = match[2];
        if (!/(eyebrow|kicker|sectionLabel)/i.test(selector)) continue;
        if (!/text-transform:\s*uppercase/i.test(declarations)) continue;
        if (excludedSelectors.some((excluded) => selector.includes(excluded))) continue;
        if (stampSelectors.some((stamp) => selector.includes(stamp))) continue;
        violations.push(`${fileName}: ${selector.replace(/\s+/g, " ")}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps Discover backgrounds flat", () => {
    const routeStyles = [
      "app/discover/discover.css",
      "components/discovery/gardenTonightCard.css",
      "components/night/nightAreaCoverage.css",
    ];

    for (const file of routeStyles) {
      const css = readFileSync(join(ROOT, file), "utf8");
      expect(css, file).not.toMatch(/background(?:-image)?\s*:[^;]*gradient\(/);
    }
  });
});
