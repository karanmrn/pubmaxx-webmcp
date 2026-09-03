import { expect, test } from "@playwright/test";

import {
  applyGatePresentation,
  captureGateScreenshot,
  GATE_PRESENTATIONS,
} from "./gateEvidence";

// §10 presentation matrix for the trusted-handoff surfaces. Every surface is
// exercised in the 8 viewport × theme × motion combinations (GATE_PRESENTATIONS,
// the L01 idiom) and gated on layout HEALTH rather than pixel diffs: the page
// renders its main landmark and never overflows the viewport horizontally in any
// combo. A full-page screenshot is attached per case as design-QA evidence
// (the pixel-perfect design pass stays in screenshots.spec.ts / npm run shots).
//
// Right-sized: the handoff endpoints (/near acceptance, /plan composer). The
// selected Map sheet's presentation is covered by the mobile sheet + map specs;
// this gate proves the acceptance→composer surfaces stay unbroken across themes,
// motion, and both viewports.

const SURFACES = [
  { path: "/near", label: "near" },
  { path: "/plan", label: "plan" },
] as const;

for (const surface of SURFACES) {
  for (const presentation of GATE_PRESENTATIONS) {
    const tag = `${surface.label}-${presentation.viewport.width}-${presentation.theme}-${presentation.motion}`;
    test(`presentation health: ${tag}`, async ({ page }, testInfo) => {
      await applyGatePresentation(page, presentation);
      await page.addInitScript(() => {
        // Keep first-run chrome out of the presentation shots.
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await page.goto(surface.path);

      await expect(page.locator("main").first()).toBeVisible();

      const overflow = await page.evaluate(() =>
        Math.ceil(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      );
      expect(overflow, `${tag} must not overflow horizontally`).toBeLessThanOrEqual(1);

      await captureGateScreenshot(page, testInfo, `trusted-handoff-${tag}`);
    });
  }
}
