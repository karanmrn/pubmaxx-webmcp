import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("canonical Social traffic", () => {
  it.each([
    "app/add/[handle]/AddPageShell.tsx",
    "app/discover/page.tsx",
    "app/drinks/page.tsx",
    "app/feed/page.tsx",
    "components/map/usePintDrops.ts",
    "app/layout.tsx",
  ])(
    "does not send internal navigation through retired routes in %s",
    (file) => {
      const source = readFileSync(join(ROOT, file), "utf8");

      expect(source).not.toMatch(
        /(?:href:\s*|router\.push\(|urls:\s*\[[^\]]*)[\s\S]*?["']\/(?:feed|discover|drinks|stories)(?:[?"'])/,
      );
      expect(source).not.toMatch(
        /(?:canonical:\s*|permanentRedirect\()["']\/(?:feed|discover|drinks|stories)(?:[?"'])/,
      );
    },
  );
});
