import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(process.cwd(), "components/feed/feedSightings.css"),
  "utf8",
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(css)?.[1] ?? "";
}

describe("feed sighting row hierarchy", () => {
  it("gives drink two wrapping lines beside a non-shrinking price column", () => {
    const main = rule(".feedSightingMain");
    const drink = rule(".feedSightingDrink");
    const price = rule(".feedSightingPrice");

    expect(main).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(drink).toMatch(/-webkit-line-clamp:\s*2/);
    expect(drink).toMatch(/overflow-wrap:\s*anywhere/);
    expect(drink).not.toMatch(/white-space:\s*nowrap/);
    expect(price).toMatch(/white-space:\s*nowrap/);
  });

  it("lets the cold-start line wrap rather than clamp or ellipse", () => {
    const lede = rule(".feedSightingsLede");

    expect(lede).not.toBe("");
    expect(lede).not.toMatch(/line-clamp/);
    expect(lede).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(lede).not.toMatch(/white-space:\s*nowrap/);
  });
});
