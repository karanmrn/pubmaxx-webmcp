import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The integration script exports its pure guards for testing; importing it must
// not run main() (guarded by the process.argv[1] === import.meta.url check).
// @ts-expect-error — .mjs script has no type declarations.
import { inLondon, loadJson, resolveMatch } from "@/scripts/integrate_wikipedia_london_pubs.mjs";

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "integrate-wiki-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("inLondon bounds check (item 1)", () => {
  it("accepts central London", () => {
    expect(inLondon(51.5072, -0.1276)).toBe(true);
  });

  it("accepts the inclusive corners of the box", () => {
    expect(inLondon(51.26, -0.55)).toBe(true);
    expect(inLondon(51.72, 0.3)).toBe(true);
  });

  it("REJECTS a point east of the upper longitude bound", () => {
    // Regression: the old check compared LON_MAX <= LON_MAX (always true), so
    // the eastern edge was never enforced and this returned true.
    expect(inLondon(51.5, 0.5)).toBe(false);
    expect(inLondon(51.5, 2.0)).toBe(false);
  });

  it("rejects points outside the other three bounds", () => {
    expect(inLondon(51.5, -0.9)).toBe(false); // west of LON_MIN
    expect(inLondon(51.0, -0.1)).toBe(false); // south of LAT_MIN
    expect(inLondon(52.0, -0.1)).toBe(false); // north of LAT_MAX
  });
});

describe("loadJson error handling (item 2)", () => {
  it("returns the fallback when the file is missing (ENOENT)", () => {
    const dir = tmp();
    expect(loadJson(join(dir, "does-not-exist.json"), { seeded: true })).toEqual({
      seeded: true,
    });
  });

  it("parses and returns an existing valid JSON file", () => {
    const dir = tmp();
    const path = join(dir, "data.json");
    writeFileSync(path, JSON.stringify([{ ok: 1 }]), "utf8");
    expect(loadJson(path, null)).toEqual([{ ok: 1 }]);
  });

  it("throws loudly on a corrupt/partial existing file instead of returning fallback", () => {
    const dir = tmp();
    const path = join(dir, "corrupt.json");
    writeFileSync(path, '{"pubs": [', "utf8"); // truncated JSON
    expect(() => loadJson(path, [])).toThrow(/Failed to parse/);
  });

  it("throws loudly on a non-ENOENT read error (path is a directory)", () => {
    const dir = tmp();
    const sub = join(dir, "adir");
    mkdirSync(sub);
    expect(() => loadJson(sub, [])).toThrow(/Failed to read/);
  });
});

describe("Wikipedia venue distance gate", () => {
  const pub = { name: "Boundary Arms", url: "https://en.wikipedia.org/wiki/Boundary_Arms" };
  const summary = { title: "Boundary Arms", lat: 51.5, lng: -0.1 };

  function indexesAt(distanceMetres: number) {
    const latitudeDelta = (distanceMetres / 6_371_000) * (180 / Math.PI);
    return {
      nameToKeys: new Map([["boundary arms", ["venue-boundary"]]]),
      rowsByKey: new Map([[
        "venue-boundary",
        { latitude: summary.lat + latitudeDelta, longitude: summary.lng },
      ]]),
    };
  }

  it("accepts a same-name venue inside 350 metres", () => {
    expect(resolveMatch(pub, summary, indexesAt(349.9))).toBe("venue-boundary");
  });

  it("rejects a same-name venue outside 350 metres", () => {
    expect(resolveMatch(pub, summary, indexesAt(350.1))).toBeNull();
  });
});
