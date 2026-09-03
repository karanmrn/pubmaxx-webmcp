import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Hero scroll cinema hard gate (feat(landing): hero scroll cinema with
// aperture splash, PIECE 2): prefers-reduced-motion and phones (<=700px)
// get a static composed hero - no scrub, no motion. Source-lock companion
// to e2e/hero-cinema-reduced-motion.spec.ts, which proves the same gate in
// a real browser.

const heroCinemaCss = readFileSync(
  join(process.cwd(), "components/landing/heroCinema.css"),
  "utf8",
);
const landingTsx = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);
const motionVocabulary = readFileSync(
  join(process.cwd(), "lib/motionVocabulary.ts"),
  "utf8",
);

describe("hero scroll cinema reduced-motion and phone gate", () => {
  it("defaults --cinema-progress to the settled card (safe fallback)", () => {
    expect(heroCinemaCss).toMatch(/:root\s*\{[^}]*--cinema-progress:\s*1;/);
  });

  it("only opens the cinema treatment inside the compound wide + motion-allowed query", () => {
    const gate = heroCinemaCss.match(
      /@media \(min-width: 701px\) and \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*)\}\s*$/,
    );
    expect(gate, "compound media query present").toBeTruthy();
    const gatedBlock = gate?.[1] ?? "";

    // The progress-driven transform, opacity and border-radius rules all
    // live inside the gate - none of them may leak outside it.
    expect(gatedBlock).toMatch(/\.thamesHeroPhoto\s*\{/);
    expect(gatedBlock).toMatch(/border-radius:\s*calc\(32px \* var\(--cinema-progress\)\)/);
    // The same overscale, now named: `1 + overscale * (1 - progress)` is
    // `1.06 - 0.06 * progress` written so the caption's clearance can be
    // derived from the token rather than eyeballed against a literal.
    expect(gatedBlock).toMatch(
      /transform:\s*scale\(\s*calc\(1 \+ var\(--cinema-open-overscale\) \* \(1 - var\(--cinema-progress\)\)\)\s*\)/,
    );
    expect(heroCinemaCss).toMatch(/--cinema-open-overscale:\s*0\.06;/);

    // Nothing outside the gate references --cinema-progress in a rule body
    // (only the safe :root default at the top of the file may).
    const outsideGate = heroCinemaCss.replace(gate?.[0] ?? "", "");
    expect(outsideGate).not.toMatch(/border-radius:\s*calc\(32px \* var\(--cinema-progress\)\)/);
  });

  it("never forces the dark start frame from CSS: no-JS keeps the composed hero", () => {
    // The dark progress-0 open is JS-owned. A CSS `--cinema-progress: 0`
    // would leave a no-JS (or pre-hydration) wide viewport 55% ink-washed
    // forever, so the stylesheet may only ever declare the settled default.
    expect(heroCinemaCss).not.toMatch(/--cinema-progress:\s*0/);
  });

  it("scrubbed properties carry no transition while being scrubbed", () => {
    // Scroll is the clock during a scrub: the effect flags .lpHero with
    // data-cinema-scrub before every scroll-driven write, and the CSS zeroes
    // the settle transitions under that flag so the card tracks the wheel
    // 1:1 (motionDuration.cinemaSettle is documented as not for the scrubbed
    // transform).
    expect(heroCinemaCss).toMatch(
      /\.lpHero\[data-cinema-scrub\][\s\S]*?\{\s*transition:\s*none;\s*\}/,
    );
    expect(landingTsx).toMatch(/hero\.setAttribute\("data-cinema-scrub", ""\);/);
    expect(landingTsx).toMatch(/hero\.removeAttribute\("data-cinema-scrub"\);/);
  });

  it("JS scroll listener eligibility mirrors the CSS media query exactly", () => {
    expect(landingTsx).toMatch(/window\.matchMedia\("\(min-width: 701px\)"\)/);
    expect(landingTsx).toMatch(
      /const eligible = wideQuery\.matches && !prefersReducedMotion\(\);/,
    );
    // Ineligible viewports/preferences must fully detach: no lingering
    // scroll listener and no stale --cinema-progress override.
    expect(landingTsx).toMatch(/window\.removeEventListener\("scroll", onScroll\);/);
    expect(landingTsx).toMatch(/hero\.style\.removeProperty\("--cinema-progress"\);/);
  });

  it("reduced motion is read centrally from lib/motionVocabulary, never ad hoc on the landing surface", () => {
    expect(landingTsx).toMatch(
      /import \{ onReducedMotionChange, prefersReducedMotion \} from "@\/lib\/motionVocabulary";/,
    );
    expect(landingTsx).not.toMatch(/matchMedia\("\(prefers-reduced-motion/);
    expect(motionVocabulary).toMatch(/prefers-reduced-motion: reduce/);
  });
});
