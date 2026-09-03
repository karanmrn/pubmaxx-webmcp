import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/plan/page.tsx"), "utf8");

describe("new Plan hero copy", () => {
  it("states the full three-to-six stop range", () => {
    expect(source).toContain("Get three to six useful stops");
    expect(source).not.toContain("Get three useful stops");
  });
});
