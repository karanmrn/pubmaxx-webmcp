import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error -- next.config.mjs has no declaration file.
import nextConfigModule from "@/next.config.mjs";

describe("Next deployment skew configuration", () => {
  it("declares a deployment marker for local and prebuilt builds", () => {
    expect(nextConfigModule.deploymentId).toBeTruthy();
  });

  it("does not create a new deployment marker each time Next loads its config", () => {
    const source = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");

    expect(source).not.toMatch(/swVersion\s*=[\s\S]*?Date\.now/);
  });
});
