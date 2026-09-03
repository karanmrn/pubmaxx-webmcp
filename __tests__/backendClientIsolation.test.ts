// Which backend client each surface actually pays for.
//
// U4 of docs/plans/SITE_SPEED_2026-09-01.md. Two backend clients ship as
// dependencies, `@supabase/supabase-js` and `convex`, and the question the unit
// asks is entry-point isolation rather than removal: is either parsed on a
// route that does not use it?
//
// The 2026-09-01 production inventory and decoded-KB figures live in
// docs/PERFORMANCE_BUDGETS.md under "What each route actually parses". This
// file is the fence for its three entry-point conclusions: Supabase stays
// dynamic and off the critical path, MapLibre stays on the map, and Convex
// reaches no browser bundle. The Convex scaffold remains under its Wave 0.6
// containment law (__tests__/convexContainment.test.ts).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".ts") || full.endsWith(".tsx")) found.push(full);
    }
  };
  walk(join(REPO_ROOT, dir));
  return found;
}

function importsPackage(source: string, name: string): boolean {
  return new RegExp(`from ["']${name}(?:/[^"']*)?["']`).test(source);
}

describe("no browser route pays for Convex", () => {
  it("is imported by nothing the app renders", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(dir)) {
        const relative = file.slice(REPO_ROOT.length + 1);
        // lib/convex holds the contracts and the migration scaffold. They are
        // types and tables, and no route imports them.
        if (relative.startsWith("lib/convex/")) continue;
        const source = readFileSync(file, "utf8");
        if (importsPackage(source, "convex")) offenders.push(relative);
      }
    }
    expect(
      offenders,
      "a route importing convex needs an owner ruling first (Wave 0.6 containment)",
    ).toEqual([]);
  });
});

describe("MapLibre stays on the map", () => {
  it("is imported only by the map canvas and its own scene modules", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(dir)) {
        const relative = file.slice(REPO_ROOT.length + 1);
        const source = readFileSync(file, "utf8");
        if (!importsPackage(source, "maplibre-gl")) continue;
        // A type-only import costs a browser nothing.
        if (/import type \* as maplibregl from ["']maplibre-gl["']/.test(source)) continue;
        if (/import type \{[^}]*\} from ["']maplibre-gl["']/.test(source)) continue;
        const onTheMap =
          relative.startsWith("components/map/") ||
          relative === "components/PubMapCanvas.tsx" ||
          relative.startsWith("lib/map");
        if (!onTheMap) offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the Supabase browser client stays off the critical path", () => {
  const authClient = readFileSync(join(REPO_ROOT, "lib/authClient.ts"), "utf8");

  it("is reached through a dynamic import, never a static one", () => {
    expect(authClient).toContain('import("@supabase/supabase-js")');
    expect(authClient).not.toMatch(
      /^import \{[^}]*\} from ["']@supabase\/supabase-js["']/m,
    );
  });

  it("keeps the type-only import type-only", () => {
    expect(authClient).toContain(
      'import type { SupabaseClient } from "@supabase/supabase-js"',
    );
  });
});
