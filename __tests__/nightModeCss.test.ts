import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "components/night/nightMode.css"), "utf8");

describe("Night Mode CSS token safety", () => {
  it("keeps Night Mode dismiss and restore controls thumb-sized", () => {
    expect(css).toMatch(/\.nightCard__close\s*{[\s\S]*?min-width:\s*56px;[\s\S]*?min-height:\s*56px;/);
    expect(css).toMatch(/\.nightPill\s*{[\s\S]*?min-height:\s*44px;/);
  });

  it("gives the pavement-glance next-stop button a pavement-grade tap floor", () => {
    expect(css).toMatch(/\.nightCard__next\s*{[\s\S]*?min-height:\s*68px;/);
    expect(css).toMatch(/\.nightCard__nextAction\s*{[\s\S]*?min-height:\s*44px;/);
  });

  it("uses semantic theme tokens for accent, success, and danger states", () => {
    expect(css).toContain("var(--color-on-accent-strong");
    expect(css).toContain("var(--color-positive");
    expect(css).toContain("var(--color-negative");
  });

  it("does not reintroduce low-contrast hard-coded night-mode state colours", () => {
    expect(css).not.toMatch(/color:\s*#fff\b/i);
    expect(css).not.toMatch(/#b3261e/i);
    expect(css).not.toMatch(/#2f7a3d/i);
    expect(css).not.toMatch(/#1f5a2b/i);
  });
});
