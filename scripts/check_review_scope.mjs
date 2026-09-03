#!/usr/bin/env node

// Review-scope report for pull requests. This script is deliberately
// dependency-free so CI can run it before installing the application.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const MAX_REVIEW_FILES = 150;
export const MAX_RUNTIME_DOMAINS = 2;

const CATEGORY_ORDER = [
  "source",
  "migration",
  "generated",
  "evidence",
  "test",
  "config",
  "docs",
  "skill-pack",
  "other",
];

const SKILL_PACK_PATH = /(?:^|\/)skills(?:\/|$)/;
const GENERATED_PATHS = [
  /^(?:data|public\/data)\/generated(?:\/|$)/,
  /^public\/data\/venues_slim[^/]*\.json$/,
  /^public\/data\/cities\/[^/]+\/venues_slim[^/]*\.json$/,
  /^public\/data\/(?:uk_base|london_venues|london_desks)\/(?!README\.md$).+/,
  /^public\/data\/pubmaxxing_seed_snapshot\.json$/,
  /^public\/data\/(?:heritage_listings|historic_pubs)\.json$/,
  /^data\/persona_drinks\.json$/,
  /^public\/vendor\/maplibre\//,
  /^(?:\.next|build|coverage|dist|out|playwright-report|test-results)(?:\/|$)/,
  /^(?:generated|__generated__)(?:\/|$)/,
  /(?:^|\/)__generated__(?:\/|$)/,
  /(?:^|\/)[^/]+\.generated\.[^/]+$/,
  /^next-env\.d\.ts$/,
];
const EVIDENCE_PATH = /^(?:docs\/(?:proof|reviews|evidence)|e2e-shots|screenshots)(?:\/|$)/;
const MIGRATION_PATH = /^supabase\/migrations(?:\/|$)/;
const TEST_PATH = /^(?:__tests__|e2e|tests)(?:\/|$)|(?:^|\/)(?:test|spec)\.[^/]+$/;
const CONFIG_PATH = /^(?:\.github|\.githooks|\.husky)(?:\/|$)|^(?:package\.json|package-lock\.json|tsconfig(?:\.[^/]+)?\.json|next\.config\.[^/]+|vitest\.config\.[^/]+|playwright\.config\.[^/]+|eslint\.config\.[^/]+)$/;
const SOURCE_ROOTS = new Set(["app", "components", "lib", "scripts", "supabase"]);
const NON_RUNTIME_SOURCE_PATHS = new Set(["scripts/check_review_scope.mjs"]);

/** Convert Git's path spelling into the one used by the report. */
export function normalizeReviewPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function isGeneratedPath(path) {
  return GENERATED_PATHS.some((pattern) => pattern.test(path));
}

function runtimeDomain(path, category) {
  if (category !== "source") return null;
  if (NON_RUNTIME_SOURCE_PATHS.has(path)) return null;
  const root = path.split("/", 1)[0];
  return SOURCE_ROOTS.has(root) ? root : null;
}

/**
 * Classify one changed path. The category is the review lane; `domain` is
 * populated only for runtime source so evidence and migration files do not
 * inflate the runtime-domain warning.
 */
export function classifyReviewFile(value) {
  const path = normalizeReviewPath(value);
  let category = "other";

  if (SKILL_PACK_PATH.test(path)) category = "skill-pack";
  else if (isGeneratedPath(path)) category = "generated";
  else if (MIGRATION_PATH.test(path)) category = "migration";
  else if (EVIDENCE_PATH.test(path)) category = "evidence";
  else if (SOURCE_ROOTS.has(path.split("/", 1)[0])) category = "source";
  else if (TEST_PATH.test(path)) category = "test";
  else if (CONFIG_PATH.test(path)) category = "config";
  else if (path.startsWith("docs/")) category = "docs";

  return { path, category, domain: runtimeDomain(path, category) };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

/**
 * Build a deterministic report from changed paths. Large or mixed reviews
 * warn, but only generated and skill-pack paths make the report fail.
 */
export function summarizeReviewScope(values) {
  const paths = uniqueSorted(values.map(normalizeReviewPath).filter(Boolean));
  const classifications = paths.map(classifyReviewFile);
  const categories = {};
  for (const item of classifications) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item.path);
  }

  const orderedCategories = {};
  for (const category of CATEGORY_ORDER) {
    if (categories[category]?.length) {
      orderedCategories[category] = categories[category];
    }
  }

  const categoryCounts = Object.fromEntries(
    Object.entries(orderedCategories).map(([category, files]) => [category, files.length]),
  );
  const domains = uniqueSorted(
    classifications.map((item) => item.domain).filter((domain) => domain !== null),
  );
  const warnings = [];
  if (domains.length > MAX_RUNTIME_DOMAINS) {
    warnings.push(
      `review spans ${domains.length} runtime domains (limit ${MAX_RUNTIME_DOMAINS})`,
    );
  }
  if (paths.length > MAX_REVIEW_FILES) {
    warnings.push(`review changes ${paths.length} files (limit ${MAX_REVIEW_FILES})`);
  }

  const forbidden = classifications
    .filter((item) => item.category === "generated" || item.category === "skill-pack")
    .map(({ category, path }) => ({ category, path }));

  return {
    fileCount: paths.length,
    categories: orderedCategories,
    categoryCounts,
    domains,
    warnings,
    forbidden,
    ok: forbidden.length === 0,
  };
}

export function changedFilesFromGit(base, head, cwd) {
  const diffBase = /^0{40}$/.test(base)
    ? "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    : base;
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRD", diffBase, head],
    { cwd, encoding: "utf8" },
  );
  return output.split("\n").filter(Boolean);
}

function usage() {
  return "Usage: node scripts/check_review_scope.mjs --base <sha> --head <sha> [--repo <path>]";
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--base" && flag !== "--head" && flag !== "--repo") {
      throw new Error(`unknown option: ${flag}\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${flag}\n${usage()}`);
    }
    values[flag.slice(2)] = value;
    index += 1;
  }
  if (!values.base || !values.head) throw new Error(usage());
  return values;
}

export function runReviewScopeCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  const files = changedFilesFromGit(args.base, args.head, args.repo ?? cwd);
  const report = summarizeReviewScope(files);
  console.log(JSON.stringify({ base: args.base, head: args.head, ...report }, null, 2));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const report = runReviewScopeCli();
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
