import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("app-wide auth-wall width contract (post-766)", () => {
  const authCss = read("app/auth/auth.css");

  it("caps standalone .authOptions at 26rem and fills the host", () => {
    expect(authCss).toMatch(/\.authOptions\s*\{[\s\S]*?max-width:\s*26rem/);
    expect(authCss).toMatch(
      /\.authUser:not\(\.authUserNav\)\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*100%[\s\S]*?min-width:\s*0/,
    );
  });

  it("keeps host :has wrappers shrink-safe for padded cards", () => {
    expect(authCss).toMatch(
      /:where\(:has\(>\s*\.authUser:not\(\.authUserNav\)\)\)\s*\{[\s\S]*?min-width:\s*0/,
    );
  });
});

describe("messages thread eyebrow uses type token", () => {
  it("reads --text-2xs instead of a raw rem size", () => {
    const css = read("app/messages/messages.css");
    const rule = /\.messagesThreadEyebrow\s*\{([\s\S]*?)\}/.exec(css);
    expect(rule, ".messagesThreadEyebrow missing").not.toBeNull();
    expect(rule![1]).toMatch(/font-size:\s*var\(--text-2xs,\s*0\.68rem\)/);
    expect(rule![1]).not.toMatch(/font-size:\s*0\.\d+rem;/);
  });
});

describe("--text-2xs owner is single-root + scoped legacy bump only", () => {
  it("defines 0.68rem once as the default and redefines only under data-legacy", () => {
    const css = read("app/globals.css");
    const assignments = [...css.matchAll(/--text-2xs:\s*([0-9.]+)rem/g)];
    // Exactly two assignments: root default, then Legacy Mode bump.
    expect(assignments.map((m) => m[1])).toEqual(["0.68", "0.78"]);

    const defaultAt = css.indexOf("--text-2xs: 0.68rem");
    // Match the real rule open, not a comment that happens to name the selector.
    const legacyRuleAt = css.indexOf('html[data-legacy="1"] {');
    const bumpAt = css.indexOf("--text-2xs: 0.78rem");
    expect(defaultAt).toBeGreaterThanOrEqual(0);
    expect(legacyRuleAt).toBeGreaterThan(defaultAt);
    // The 0.78 value must appear after the legacy rule open (scoped bump), never
    // as a second root-level definition before data-legacy.
    expect(bumpAt).toBeGreaterThan(legacyRuleAt);
  });
});
