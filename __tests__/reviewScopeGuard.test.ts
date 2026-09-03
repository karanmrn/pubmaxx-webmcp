import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  changedFilesFromGit,
  MAX_REVIEW_FILES,
  MAX_RUNTIME_DOMAINS,
  summarizeReviewScope,
} from "../scripts/check_review_scope.mjs";

describe("review scope guard", () => {
  it("reports source, migration, generated, and evidence files by category", () => {
    const report = summarizeReviewScope([
      "app/api/price-submit/route.ts",
      "lib/communityPriceStore.ts",
      "supabase/migrations/0114_review_scope.sql",
      "public/data/generated/venue-pack.json",
      "docs/proof/review/desktop.png",
    ]);

    expect(report.categoryCounts).toEqual({
      source: 2,
      migration: 1,
      generated: 1,
      evidence: 1,
    });
    expect(report.categories.source).toEqual([
      "app/api/price-submit/route.ts",
      "lib/communityPriceStore.ts",
    ]);
    expect(report.categories.migration).toEqual([
      "supabase/migrations/0114_review_scope.sql",
    ]);
    expect(report.domains).toEqual(["app", "lib"]);
  });

  it("does not count review tooling as a runtime domain", () => {
    const report = summarizeReviewScope([
      "app/api/review/route.ts",
      "lib/reviewScope.ts",
      "scripts/check_review_scope.mjs",
      ".github/workflows/ci.yml",
      "docs/reviews/review-scope.md",
    ]);

    expect(report.domains).toEqual(["app", "lib"]);
    expect(report.warnings).toEqual([]);
    expect(report.categoryCounts).toEqual({
      source: 3,
      evidence: 1,
      config: 1,
    });
  });

  it("still counts script modules imported by Production code", () => {
    const report = summarizeReviewScope([
      "app/api/out/route.ts",
      "lib/out/venueMatch.ts",
      "scripts/whatson/resolveVenueId.mjs",
    ]);

    expect(report.domains).toEqual(["app", "lib", "scripts"]);
    expect(report.warnings).toEqual([
      `review spans ${MAX_RUNTIME_DOMAINS + 1} runtime domains (limit ${MAX_RUNTIME_DOMAINS})`,
    ]);
  });

  it("warns only after the runtime-domain and file-count thresholds", () => {
    const twoDomains = summarizeReviewScope([
      "app/api/example/route.ts",
      "lib/example.ts",
    ]);
    expect(twoDomains.warnings).toEqual([]);

    const threeDomains = summarizeReviewScope([
      "app/api/example/route.ts",
      "components/example.tsx",
      "lib/example.ts",
    ]);
    expect(threeDomains.warnings).toEqual([
      `review spans ${MAX_RUNTIME_DOMAINS + 1} runtime domains (limit ${MAX_RUNTIME_DOMAINS})`,
    ]);

    const manyFiles = summarizeReviewScope(
      Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, index) =>
        `lib/generated-review-${index}.ts`,
      ),
    );
    expect(manyFiles.warnings).toEqual([
      `review changes ${MAX_REVIEW_FILES + 1} files (limit ${MAX_REVIEW_FILES})`,
    ]);
  });

  it("fails only for generated or skill-pack leakage", () => {
    const generated = summarizeReviewScope(["data/generated/venues.json"]);
    expect(generated.ok).toBe(false);
    expect(generated.forbidden).toEqual([
      { category: "generated", path: "data/generated/venues.json" },
    ]);

    const skillPack = summarizeReviewScope(["skills/example/SKILL.md"]);
    expect(skillPack.ok).toBe(false);
    expect(skillPack.forbidden).toEqual([
      { category: "skill-pack", path: "skills/example/SKILL.md" },
    ]);

    const legitimateLargeReview = summarizeReviewScope(
      Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, index) =>
        `app/feature-${index}.ts`,
      ),
    );
    expect(legitimateLargeReview.ok).toBe(true);
    expect(legitimateLargeReview.warnings).not.toEqual([]);
  });

  it("classifies generated venue indexes and build outputs without blocking curated data", () => {
    const generated = [
      "public/data/venues_slim.json",
      "public/data/venues_slim.core.json",
      "public/data/cities/bath/venues_slim.manifest.json",
      "public/data/uk_base/manifest.json",
      "public/data/london_venues/manifest.json",
      "public/data/london_desks/desks.json",
      "public/data/pubmaxxing_seed_snapshot.json",
      "public/data/heritage_listings.json",
      "public/data/historic_pubs.json",
      "data/persona_drinks.json",
    ];
    expect(summarizeReviewScope(generated).forbidden).toEqual(
      generated.sort().map((path) => ({ category: "generated", path })),
    );

    const curated = [
      "public/data/uk_base/README.md",
      "public/data/london_venues/README.md",
      "public/data/london_desks/README.md",
      "public/data/drink_price_updates/latest.json",
      "public/data/heritage_cache.json",
    ];
    expect(summarizeReviewScope(curated).forbidden).toEqual([]);
  });

  it("keeps deleted generated paths in the changed-file report", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();

    try {
      git("init", "-q");
      git("config", "user.email", "review-scope@example.invalid");
      git("config", "user.name", "Review Scope Test");
      mkdirSync(join(repo, "data/generated"), { recursive: true });
      writeFileSync(join(repo, "data/generated/venues.json"), "{}\n");
      git("add", ".");
      git("commit", "-qm", "seed generated path");
      const base = git("rev-parse", "HEAD");
      rmSync(join(repo, "data/generated/venues.json"));
      git("commit", "-am", "delete generated path");
      const head = git("rev-parse", "HEAD");

      expect(changedFilesFromGit(base, head, repo)).toEqual([
        "data/generated/venues.json",
      ]);
      expect(summarizeReviewScope(changedFilesFromGit(base, head, repo)).forbidden).toEqual([
        { category: "generated", path: "data/generated/venues.json" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("uses an empty-tree diff for an all-zero base SHA", () => {
    const repo = mkdtempSync(join(tmpdir(), "pubmax-review-scope-zero-base-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();

    try {
      git("init", "-q");
      git("config", "user.email", "review-scope@example.invalid");
      git("config", "user.name", "Review Scope Test");
      mkdirSync(join(repo, "public/data"), { recursive: true });
      writeFileSync(join(repo, "public/data/venues_slim.json"), "{}\n");
      git("add", ".");
      git("commit", "-qm", "seed first branch");
      const head = git("rev-parse", "HEAD");

      const files = changedFilesFromGit("0".repeat(40), head, repo);
      expect(files).toEqual(["public/data/venues_slim.json"]);
      expect(summarizeReviewScope(files).ok).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
