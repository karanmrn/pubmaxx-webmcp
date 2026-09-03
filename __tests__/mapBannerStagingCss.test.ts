import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The map banner-staging coordinator lives in CSS (which self-gating sibling may
// render is a presentation concern). This locks its policy from source, the same
// idiom as activationChromeCss.test.ts. Behaviour is additionally proven by the
// fresh-profile + post-dismissal Playwright screenshots.
const css = readFileSync(join(process.cwd(), "components/map/mapBannerStaging.css"), "utf8");

describe("map banner staging CSS", () => {
  it("keeps location independent while onboarding suppresses ambient status and Tonight", () => {
    for (const sel of [".cityStatusBanner", ".tonightLaneCollapsed"]) {
      const escaped = sel.replace(/\./g, "\\.");
      expect(css).toMatch(new RegExp(`\\.appShell\\.onboarding-open\\s+${escaped}`));
    }
    expect(css).not.toMatch(/\.appShell\.onboarding-open\s+\.citySuggestBanner/);
  });

  it("keeps the location control available alongside closure/safety status", () => {
    expect(css).not.toMatch(/\.mapStage:has\(\.cityStatusBanner\)\s+\.citySuggestBanner/);
  });

  it("defers the tonight-nearby card to either status or location", () => {
    expect(css).toMatch(/\.mapStage:has\(\.cityStatusBanner\)\s+\.tonightLaneCollapsed/);
    expect(css).toMatch(/\.mapStage:has\(\.citySuggestBanner\)\s+\.tonightLaneCollapsed/);
  });

  it("never suppresses the closure band itself via the priority cascade (it is the top)", () => {
    // No :has(...) rule may target .cityStatusBanner — the highest priority band
    // must always render when eligible.
    expect(css).not.toMatch(/:has\([^)]*\)\s+\.cityStatusBanner/);
  });

  it("scopes the staging to desktop so the mobile map shell is untouched", () => {
    expect(css).toMatch(/@media \(min-width:\s*641px\)/);
  });
});
