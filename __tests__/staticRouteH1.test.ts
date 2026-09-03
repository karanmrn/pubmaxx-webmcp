import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function countH1(source: string): number {
  return (source.match(/<h1[\s>]/g) ?? []).length;
}

/** App-router pages with no dynamic segment in the path. */
function staticPageFiles(): string[] {
  const appDir = join(ROOT, "app");
  const files: string[] = [];

  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.includes("[")) continue;
        walk(join(dir, entry.name), rel);
      } else if (entry.name === "page.tsx") {
        files.push(`app/${rel}`);
      }
    }
  }

  walk(appDir, "");
  return files.sort();
}

describe("static route page headings", () => {
  it("uses the /near lede as the page h1", () => {
    const nearMeNow = read("components/nearme/NearMeNow.tsx");
    expect(nearMeNow).toContain("<h1 className=\"nmnLede\">");
    expect(nearMeNow).not.toMatch(/<p className="nmnLede"/);
  });

  it("keeps at most one h1 per static route page source", () => {
    const offenders = staticPageFiles()
      .map((file) => ({ file, count: countH1(read(file)) }))
      .filter((entry) => entry.count > 1);

    expect(offenders).toEqual([]);
  });
});
