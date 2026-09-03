import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("map library import boundaries", () => {
  it.each(["lib/crawlUrl.ts", "lib/mapArrival.ts", "lib/mapVenueList.ts"])(
    "%s does not import component modules",
    (path) => {
      expect(read(path)).not.toMatch(/from ["']@\/components\//);
    },
  );
});
