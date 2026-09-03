import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import { resolvePlaywrightNextDistDir } from "@/lib/playwrightDistDir";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDirectories: string[] = [];

function tempDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "pubmax-gate-"));
  tempDirectories.push(directory);
  return directory;
}

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function playwrightReport(overrides: Record<string, unknown> = {}) {
  return {
    suites: [
      {
        title: "suite",
        specs: [
          {
            title: "works",
            tests: [
              {
                projectName: "chromium",
                status: "expected",
                expectedStatus: "passed",
                results: [{ status: "passed", retry: 0 }],
                ...overrides,
              },
            ],
          },
        ],
      },
    ],
  };
}

function playwrightAxeAttachmentReport() {
  const body = Buffer.from(
    JSON.stringify({
      testEngine: { name: "axe-core", version: "4.12.0" },
      violations: [
        {
          id: "color-contrast",
          impact: "serious",
          description: "Ensure foreground and background colors have enough contrast",
          nodes: [{ html: "<p>Unreadable fixture</p>" }],
        },
      ],
    }),
    "utf8",
  ).toString("base64");

  return playwrightReport({
    results: [
      {
        status: "passed",
        retry: 0,
        attachments: [
          {
            name: "axe-results",
            contentType: "application/json",
            body,
          },
        ],
      },
    ],
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Playwright isolated build configuration", () => {
  it.each([
    [
      "explicit screenshot override",
      {
        PW_NEXT_DIST_DIR: ".next-custom",
        PW_SCREENSHOTS: "1",
        NEXT_DIST_DIR: ".next-isolated",
      },
      ".next-custom",
    ],
    [
      "explicit normal E2E override",
      { PW_NEXT_DIST_DIR: ".next-custom", NEXT_DIST_DIR: ".next-prod" },
      ".next-custom",
    ],
    [
      "screenshot wrapper directory",
      { PW_SCREENSHOTS: "1", NEXT_DIST_DIR: ".next-isolated" },
      ".next-isolated",
    ],
    ["screenshot default", { PW_SCREENSHOTS: "1" }, ".next"],
    ["normal E2E default", { NEXT_DIST_DIR: ".next-prod" }, ".next-e2e"],
  ])("resolves %s", (_label, env, expected) => {
    expect(resolvePlaywrightNextDistDir(env)).toBe(expected);
  });

  it("passes PW_NEXT_DIST_DIR through webServer.env", () => {
    const source = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");

    expect(source).toContain("resolvePlaywrightNextDistDir()");
    expect(source).toContain("SKIP_WEBSERVER = process.env.PW_SKIP_WEBSERVER === \"1\"");
    expect(source).toContain("webServer: SKIP_WEBSERVER");
    expect(source).toContain('name: "chromium-keyless"');
    expect(source).toContain("baseURL: KEYLESS_BASE_URL");
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_URL: ""');
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ""');
    expect(source).toContain(
      "node scripts/run-with-restored-next-env.mjs npm run build && npm run start",
    );
    expect(source).toContain("NEXT_DIST_DIR,");
    expect(source).not.toContain("NEXT_DIST_DIR=.next-e2e npm run build");
  });

  it("keeps isolated build directories outside lint and git inputs", () => {
    const eslintSource = readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8");
    const gitignorePath = path.join(ROOT, ".gitignore");

    expect(eslintSource).toContain('".next-*/**"');
    if (existsSync(gitignorePath)) {
      expect(readFileSync(gitignorePath, "utf8")).toContain(".next-*/");
    } else {
      // Vercel source archives omit repository-control dotfiles. Local and
      // GitHub CI still assert the .gitignore contract above; an archive with
      // no Git metadata has no Git input for an isolated build to enter.
      expect(existsSync(path.join(ROOT, ".git"))).toBe(false);
    }
  });
});

describe("assert-playwright-gate", () => {
  it("accepts a discovered passing report", () => {
    const directory = tempDirectory();
    const report = path.join(directory, "report.json");
    writeFileSync(report, JSON.stringify(playwrightReport()));

    const result = run("assert-playwright-gate.mjs", [
      report,
      "--require-zero-skipped",
      "--report-retries",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"discovered":1');
    expect(result.stdout).toContain("retries: none");
  });

  it.each([
    ["skipped", playwrightReport({ status: "skipped" }), "skipped test"],
    [
      "retried",
      playwrightReport({ status: "flaky", results: [{ status: "failed", retry: 0 }, { status: "passed", retry: 1 }] }),
      "retried/flaky",
    ],
    ["zero tests", { suites: [] }, "zero tests discovered"],
    ["malformed shape", { projects: [] }, "suites array"],
    ["axe attachment violation", playwrightAxeAttachmentReport(), "serious:color-contrast"],
  ])("rejects %s", (_label, value, expected) => {
    const directory = tempDirectory();
    const report = path.join(directory, "report.json");
    writeFileSync(report, JSON.stringify(value));

    const result = run("assert-playwright-gate.mjs", [report, "--require-zero-skipped"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expected);
  });

  it("rejects invalid JSON", () => {
    const directory = tempDirectory();
    const report = path.join(directory, "report.json");
    writeFileSync(report, "not json");

    const result = run("assert-playwright-gate.mjs", [report]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot parse");
  });
});

describe("assert-no-conditional-e2e-skips", () => {
  it("allows explicit environment-gated suites", () => {
    const directory = tempDirectory();
    writeFileSync(
      path.join(directory, "perf.spec.ts"),
      'import { test } from "@playwright/test";\ntest.skip(!process.env.PUBMAX_PERF, "explicit lab");\ntest("x", () => {});\n',
    );

    const result = run("assert-no-conditional-e2e-skips.mjs", [directory]);

    expect(result.status).toBe(0);
  });

  it("rejects data-dependent and unconditional runtime skips", () => {
    const directory = tempDirectory();
    writeFileSync(
      path.join(directory, "quiet.spec.ts"),
      'import { test } from "@playwright/test";\ntest("x", () => { test.skip(true, "quiet inventory"); });\n',
    );

    const result = run("assert-no-conditional-e2e-skips.mjs", [directory]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("depends on true");
  });

  it("rejects multiline skip conditions through the TypeScript AST", () => {
    const directory = tempDirectory();
    writeFileSync(
      path.join(directory, "multiline.spec.ts"),
      `import { test } from "@playwright/test";
       test("x", async ({ page }) => {
         const count = await page.locator("li").count();
         test.skip(
           count === 0 ||
             process.env.PUBMAX_ALLOW_EMPTY === "1",
           "quiet inventory",
         );
       });
      `,
    );

    const result = run("assert-no-conditional-e2e-skips.mjs", [directory]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("count === 0 || process.env.PUBMAX_ALLOW_EMPTY");
  });

  it("rejects an empty spec directory", () => {
    const directory = tempDirectory();

    const result = run("assert-no-conditional-e2e-skips.mjs", [directory]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no E2E specs");
  });
});

describe("assert-privacy-response", () => {
  it("accepts privacy-preview fields", () => {
    const directory = tempDirectory();
    const response = path.join(directory, "preview.json");
    writeFileSync(
      response,
      JSON.stringify({ visibility: "preview", stopCount: 3, routeReady: true }),
    );

    const result = run("assert-privacy-response.mjs", [response]);

    expect(result.status).toBe(0);
  });

  it("rejects forbidden structural fields and explicit literals", () => {
    const directory = tempDirectory();
    const response = path.join(directory, "leak.txt");
    writeFileSync(response, '<script>{\\"venueId\\":\\"venue-secret\\"}</script>');

    const result = run("assert-privacy-response.mjs", [
      response,
      "--forbid",
      "venue-secret",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("forbidden key venueId");
    expect(result.stderr).toContain("forbidden literal");
  });
});
