import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

// AGENTS.md is a POINTER document, so a pointer that no longer resolves is the
// one way it can rot silently. Nothing else reads this file: no test, script or
// e2e spec opens it, so the suite cannot otherwise tell whether a law still
// names a real module or a fence that was renamed a month ago.
//
// This fence answers only that question. It says nothing about what the prose
// claims, because a document that must be true cannot be checked by a test;
// what it CAN check is that every file, test and directory the prose sends a
// reader to is still there.
//
const ROOT = resolve(process.cwd());
const DOC = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
const TRACKED_PATHS = new Set(
  execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean),
);
const TRACKED_DIRECTORIES = new Set<string>();

for (const trackedPath of TRACKED_PATHS) {
  let directory = trackedPath;
  while (directory.includes("/")) {
    directory = directory.slice(0, directory.lastIndexOf("/"));
    TRACKED_DIRECTORIES.add(directory);
  }
}

/** Backticked tokens that look like a path into this repository. */
const BACKTICKED_TOKEN = /`([^`\r\n]+)`/g;
const PATH_TOKEN = /^[A-Za-z0-9_.\[\]{}<>,*\/-]+$/;

function looksLikeRepositoryPath(raw: string): boolean {
  if (!raw || raw === "." || raw === ".." || !PATH_TOKEN.test(raw)) return false;
  if (raw.startsWith("@")) return false;
  if (raw.startsWith("/")) return raw.length > 1 && raw.endsWith("/");
  return raw.includes("/") || raw.includes(".");
}

// Explicit non-file names remain here so real repository pointers are checked.
const NOT_REPO_PATHS = new Set([
  // Next development route types are generated and absent from a clean clone.
  "./.next/dev/types/routes.d.ts",
  // Server suffix names a convention, not one concrete file.
  ".server.ts",
  // Generic JSON glob names a publish input class, not one repository file.
  "*.json",
  // Generic manifest name is a publish input, not the repository root file.
  "manifest.json",
  // ESM declaration suffix names a sidecar convention, not one concrete file.
  ".d.mts",
  // Homepage card uses `/api/home-card`, not this absent Next file convention.
  "opengraph-image.tsx",
  // Next trace suffix names generated output, not a committed file.
  ".nft.json",
  // This glob names a class of server modules, not one concrete file.
  "lib/**/*.server.ts",
  // Member name, not a repository path.
  "AuthProvider.updateSession",
  // Database column glob, not a repository path.
  "profiles.cover_*",
  // Analytics event name, not a repository path.
  "uploaded_image.scan_skipped",
  // Database column name, not a repository path.
  "plan_crew_members.token_hash",
  // Database column name, not a repository path.
  "community_prices.actor",
  // Database column name, not a repository path.
  "venue_occupancy_flags.actor_hash",
  // External host policy endpoint, not a repository path.
  "robots.txt",
  // Database column name, not a repository path.
  "profiles.founding_member_number",
  // Date-template path, not a literal repository path.
  "public/data/pint_index/<YYYY-MM>.json",
  // Next configuration property, not a repository path.
  "experimental.staleTimes",
  // URL in trailing-slash law, not a repository path.
  "/api/thing/",
  // Harvest working directory is gitignored by design.
  "data-harvest/bars-enriched/",
  // Throwaway Overpass working directory is absent from clean clones.
  "raw_venues/",
  // Next's generated build directory is absent from clean clones.
  ".next",
  // Hostnames, not repository files.
  "*.vercel.app",
  "pubmaxxing.com",
  // Environment file a reader is told to CREATE, so a clean clone lacks it.
  ".env.local",
  // CSS class selectors, not files.
  ".lpButtonPrimary",
  ".messageBubble",
  ".messageLine",
  ".mobileTabBar",
  ".mobileTabBarClearance",
  // An OSM tag VALUE, not a path.
  "24/7",
  // Receipt copy the product prints, not a file.
  "Logged.",
  // Member and property names, not repository paths.
  "auth.refreshSession",
  "auth.users.encrypted_password",
  "CATEGORY_META.order",
  "ComposerHydration.heldVenueId",
  "filters.drinkCategory",
  "ProfileImageServeDeps.extraServingKey",
  "profileImageSlotSpec.cover.aspectRatio",
  "PublicProfile.coverUrls",
  "row.priceGbp",
  "supabase.auth.setSession",
  "supabasePlanStore.create",
  "webServer.env",
  // Structured log event names, not paths.
  "out.provider_failed",
  "out.supply",
  "profile_image.serve_refused",
  "uploaded_image.object_unreadable",
  // Database objects, not repository paths.
  "public.account_has_password",
  "public.rls_*",
  "pubmax_private.grant_founding_member_number",
  // Storage key TEMPLATES with runtime segments, not committed files.
  "messages/{conversationId}/{messageId}.jpg",
  "venue-photos/{venueId}/{photoId}.jpg",
  // Build output naming a route at runtime, absent from a clean clone.
  ".next-prod/server/<route>/route.js.nft.json",
  // Per-city artifacts: each city ships its own copy, so this names a CLASS.
  "venues_slim.json",
  "venues_slim.core.json",
  "venues_slim*.json",
]);

function pointers(): string[] {
  const found = new Set<string>();
  for (const match of DOC.matchAll(BACKTICKED_TOKEN)) {
    const raw = (match[1] ?? "").trim();
    if (!looksLikeRepositoryPath(raw) || NOT_REPO_PATHS.has(raw)) continue;
    found.add(raw);
  }
  return [...found].sort();
}

function expandBraces(pointer: string): string[] {
  const open = pointer.indexOf("{");
  if (open === -1) return [pointer];

  let depth = 0;
  for (let index = open; index < pointer.length; index += 1) {
    if (pointer[index] === "{") depth += 1;
    if (pointer[index] === "}" && --depth === 0) {
      const options = pointer.slice(open + 1, index).split(",");
      return options.flatMap((option) =>
        expandBraces(pointer.slice(0, open) + option + pointer.slice(index + 1)),
      );
    }
  }

  return [pointer];
}

function wildcardRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

function relativePathInsideRoot(path: string): string | null {
  const candidate = relative(ROOT, resolve(path));
  if (
    candidate === ".." ||
    candidate.startsWith(`..${sep}`) ||
    isAbsolute(candidate)
  ) {
    return null;
  }
  return candidate.split(sep).join("/");
}

function trackedNodeExists(path: string): boolean {
  return Boolean(path) && (TRACKED_PATHS.has(path) || TRACKED_DIRECTORIES.has(path));
}

function resolvesPattern(pointer: string): boolean {
  const segments = pointer.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    return false;
  }

  function visit(directory: string, index: number): boolean {
    if (index === segments.length) return true;

    const segment = segments[index];
    if (segment.includes("*")) {
      if (!existsSync(directory) || !statSync(directory).isDirectory()) return false;
      const pattern = wildcardRegExp(segment);
      return readdirSync(directory).some(
        (entry) => {
          if (!pattern.test(entry)) return false;
          const candidate = join(directory, entry);
          const candidatePath = relativePathInsideRoot(candidate);
          return (
            candidatePath !== null &&
            trackedNodeExists(candidatePath) &&
            existsSync(candidate) &&
            visit(candidate, index + 1)
          );
        },
      );
    }

    const next = join(directory, segment);
    const nextPath = relativePathInsideRoot(next);
    if (nextPath === null || !trackedNodeExists(nextPath) || !existsSync(next)) {
      return false;
    }
    return visit(next, index + 1);
  }

  return visit(ROOT, 0);
}

/** Resolve a pointer that may carry glob syntax or be a directory. */
function resolves(pointer: string): boolean {
  // Brace sets assert every named path; wildcard segments assert any matching path.
  return expandBraces(pointer).every(resolvesPattern);
}

describe("AGENTS.md pointers", () => {
  it("sends every reader to a file or directory that exists", () => {
    const dangling = pointers().filter((pointer) => !resolves(pointer));
    expect(dangling, "AGENTS.md points at paths that are no longer here").toEqual([]);
  });

  it("keeps its pointers, so a trim cannot quietly gut it", () => {
    // A pointer document with no pointers has stopped being one, and the
    // pointer is the half a future reader cannot reconstruct: prose can be
    // re-derived from the code, the knowledge of WHICH file owns a rule cannot.
    // So this floor RATCHETS. It sits just under the shipped count rather than
    // far below it, because a floor hundreds of pointers beneath the number it guards
    // reads as protection and can never fire. Same rule as the performance
    // budgets: take it UP when the count rises, and take it DOWN only in the
    // commit that removes pointers on purpose, with the reason.
    expect(pointers().length).toBeGreaterThan(549);
  });
});
