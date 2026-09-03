import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("weather refresh workflow", () => {
  it("configures an auditable bot identity before the refresh script commits", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/weather-refresh.yml"), "utf8");
    const identity = workflow.indexOf("git config user.name \"github-actions[bot]\"");
    const email = workflow.indexOf("git config user.email \"41898282+github-actions[bot]@users.noreply.github.com\"");
    const refresh = workflow.indexOf("npm run refresh:weather -- --open-pr");

    expect(identity).toBeGreaterThan(-1);
    expect(email).toBeGreaterThan(identity);
    expect(refresh).toBeGreaterThan(email);
  });
});
