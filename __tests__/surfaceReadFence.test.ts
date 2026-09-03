import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SURFACE_READ_EXEMPTIONS } from "@/lib/surfaceReadPolicy";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_SPEC =
  /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function browserReachableModules(): string[] {
  const all = [
    ...walk(join(ROOT, "components")),
    ...walk(join(ROOT, "app")),
    ...walk(join(ROOT, "lib")),
  ];
  const reachable = new Set(
    all.filter((file) => /^\s*["']use client["']/m.test(readFileSync(file, "utf8"))),
  );
  const queue = [...reachable];
  while (queue.length) {
    const file = queue.pop() as string;
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_SPEC)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const target = resolveImport(file, spec);
      if (!target || reachable.has(target) || /\.server\.tsx?$/.test(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return [...reachable];
}

const PAINTED_READ_FILES = [
  "components/profile/YourContributionsCard.tsx",
  "components/profile/ContributionLanesCard.tsx",
  "components/profile/NextBadgeChips.tsx",
  "components/profile/ProfileCoverPhotosEditor.tsx",
  "components/borough/BoroughPintPriceCard.tsx",
  "components/borough/BoroughPassportSlice.tsx",
  "components/map/useWhatsOnTonight.ts",
  "components/map/useTonightOpportunities.ts",
  "components/map/usePersonaTonight.ts",
  "components/discovery/MusicTonightLane.tsx",
  "components/discovery/DealsTonightLane.tsx",
  "components/discovery/GardenTonightCard.tsx",
  "components/desktop/ConditionsChip.tsx",
  "components/map/VenueTonightChips.tsx",
  "app/tonight/TonightConditionsStrip.tsx",
  "app/tonight/TonightGetHomeStrip.tsx",
  "app/today/TodayTubeCard.tsx",
  "app/today/TodayGetThereStrip.tsx",
  "components/transport/DisruptionLine.tsx",
] as const;

describe("painted reads", () => {
  it("routes each core reload read through surfaceDataCache", () => {
    const offenders = PAINTED_READ_FILES.filter((relativePath) => {
      const source = readFileSync(join(ROOT, relativePath), "utf8");
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      if (relativePath === "components/profile/ProfileCoverPhotosEditor.tsx") {
        return (
          !source.includes('from "@/lib/surfaceDataCache"') ||
          /\bfetch\s*\(\s*base\b/.test(withoutComments)
        );
      }
      return !source.includes('from "@/lib/surfaceDataCache"') ||
        /\bfetch\s*\(/.test(withoutComments);
    });

    expect(offenders).toEqual([]);
  });

  it("accounts for every remaining direct fetch in a browser module", () => {
    const declared = new Map<string, (typeof SURFACE_READ_EXEMPTIONS)[number]>(
      SURFACE_READ_EXEMPTIONS.map((entry) => [entry.path, entry]),
    );
    const reachable = browserReachableModules();
    const clientFiles = [
      ...walk(join(ROOT, "app")),
      ...walk(join(ROOT, "components")),
    ].filter((file) => /^\s*["']use client["']/m.test(readFileSync(file, "utf8")));
    const files = [...new Set([...reachable, ...clientFiles])];

    const direct: Array<{ path: string; count: number }> = [];
    for (const file of files) {
      if (file.includes("/api/") || /\.server\.tsx?$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      const count = withoutComments.match(/\bfetch\s*\(/g)?.length ?? 0;
      if (count > 0) direct.push({ path: file.slice(ROOT.length + 1), count });
    }

    const missing = direct.filter(({ path }) => !declared.has(path));
    const changed = direct.filter(({ path, count }) => declared.get(path)?.fetchCount !== count);
    const directPaths = new Set(direct.map(({ path }) => path));
    const orphaned = SURFACE_READ_EXEMPTIONS.filter((entry) => !directPaths.has(entry.path));
    const invalid = SURFACE_READ_EXEMPTIONS.filter(
      (entry) => !entry.reason.trim() || declared.get(entry.path) !== entry,
    );

    expect({ missing, changed, orphaned, invalid }).toEqual({
      missing: [],
      changed: [],
      orphaned: [],
      invalid: [],
    });
  });
});
