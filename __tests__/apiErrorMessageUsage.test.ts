import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

describe("API error message usage", () => {
  it("does not pass response bodies directly to Error", () => {
    const matches: string[] = [];
    const scan = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          scan(path);
          continue;
        }
        if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
        if (readFileSync(path, "utf8").includes("new Error(body")) matches.push(path);
      }
    };
    for (const directory of ["components", "app", "lib"]) {
      scan(join(process.cwd(), directory));
    }

    expect(matches).toEqual([]);
  });
});
