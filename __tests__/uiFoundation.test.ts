import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const shadcn = JSON.parse(readFileSync(join(process.cwd(), "components.json"), "utf8")) as {
  tailwind: { css: string };
};

describe("owned UI foundation", () => {
  it("wires Tailwind v4 through the existing semantic token sheet", () => {
    expect(globals).toContain('@import "tailwindcss/theme.css" layer(theme);');
    expect(globals).toContain('@import "tailwindcss/utilities.css" layer(utilities);');
    expect(globals).not.toContain('@import "tailwindcss";');
    expect(globals).not.toContain("tailwindcss/preflight.css");
    expect(shadcn.tailwind.css).toBe("app/globals.css");
  });
});
