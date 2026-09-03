import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "components/plan/nightCrawl.css"), "utf8");
const tsx = readFileSync(join(process.cwd(), "components/plan/NightCrawlMode.tsx"), "utf8");

describe("Night-crawl surface conformance (U7)", () => {
  it("is an OLED-dark surface (ink-dark paper), not the light paper token", () => {
    expect(css).toMatch(/--nc-paper:\s*#070b0a/i);
    expect(css).toMatch(/\.nightCrawl\s*{[\s\S]*?background:[\s\S]*?var\(--nc-paper\)/);
  });

  it("makes the arrive slab the one giant target (>= 64px tall) and skip a demoted 62px+ secondary", () => {
    const arrive = css.match(/\.nightCrawl__arrive\s*{([\s\S]*?)}/)?.[1] ?? "";
    const skip = css.match(/\.nightCrawl__skip\s*{([\s\S]*?)}/)?.[1] ?? "";
    const arriveMin = Number(arrive.match(/min-height:\s*(\d+)px/)?.[1] ?? "0");
    const skipMin = Number(skip.match(/min-height:\s*(\d+)px/)?.[1] ?? "0");
    expect(arriveMin).toBeGreaterThanOrEqual(64);
    expect(skipMin).toBeGreaterThanOrEqual(62);
    // arrive is the dominant slab — it must not be narrower than skip
    expect(arrive).toMatch(/flex:\s*1\.6/);
  });

  it("pins a get-home escape hatch at 64px+ that always renders", () => {
    const escape = css.match(/\.nightCrawl__escape\s*{([\s\S]*?)}/)?.[1] ?? "";
    expect(Number(escape.match(/min-height:\s*(\d+)px/)?.[1] ?? "0")).toBeGreaterThanOrEqual(64);
    // Rendered unconditionally in the surface (outside every conditional branch).
    expect(tsx).toMatch(/nightCrawl__escape[\s\S]*Get me home/);
    expect(tsx).toContain("tfl.gov.uk/plan-a-journey");
  });

  it("respects reduced motion (kills the entrance + press transforms)", () => {
    const query = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    expect(query).toMatch(/\.nightCrawl\s*{\s*animation:\s*none/);
    expect(query).toMatch(/transform:\s*none/);
  });

  it("does not adopt the quarantined party font (stays out of the third-family budget)", () => {
    expect(css).not.toContain("--font-party");
    expect(tsx).not.toContain("--font-party");
  });

  it("keeps thumb-sized touch targets on the exit control (44px+)", () => {
    const exit = css.match(/\.nightCrawl__exit\s*{([\s\S]*?)}/)?.[1] ?? "";
    expect(Number(exit.match(/min-height:\s*(\d+)px/)?.[1] ?? "0")).toBeGreaterThanOrEqual(44);
  });
});
