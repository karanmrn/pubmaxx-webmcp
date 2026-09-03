import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*{([^}]*)}`))?.[1] ?? "";
}

const profileCss = read("app/u/[handle]/profile.css");
const profilePage = read("app/u/[handle]/ProfilePageClient.tsx");
const profileListPage = read("app/u/[handle]/lists/[listType]/page.tsx");

describe("profile route shell", () => {
  it("centres the shared capped shell with balanced desktop gutters", () => {
    const shell = ruleBody(profileCss, ".profilePage .profileMain");

    expect(shell).toMatch(/width:\s*100%/);
    expect(shell).toMatch(/max-width:\s*var\(--content-max-wide\)/);
    expect(shell).toMatch(/margin-inline:\s*auto/);
    expect(shell).toMatch(/box-sizing:\s*border-box/);
  });

  it("keeps profile and profile-list routes on the shared shell", () => {
    expect(profilePage).toContain(
      '<main id="main" className="container profileMain">',
    );
    expect(profileListPage).toContain(
      '<main id="main" className="container profileMain">',
    );
  });
});
