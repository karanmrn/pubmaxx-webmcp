import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  baseRefForRun,
  commandsForMode,
  captureRefreshSnapshot,
  keyReadinessError,
  laneReadiness,
  defaultMaxLoad,
  loadKeyFile,
  parseFreeMemoryPercent,
  providerSafeEnvironment,
  publishPreparedChanges,
  redactSecrets,
  renderLaunchAgents,
  resourceRefusal,
  summariseRefresh,
  validatePreparedData,
} from "../scripts/local-refresh/scheduler.mjs";

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "pubmax-local-refresh-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local refresh resource gate", () => {
  it("sets CPU pressure ceiling to 75% of logical capacity with a floor of four", () => {
    expect(defaultMaxLoad(8)).toBe(6);
    expect(defaultMaxLoad(2)).toBe(4);
  });

  it("reads macOS memory_pressure free percentage", () => {
    expect(
      parseFreeMemoryPercent(
        "The system has 8589934592 bytes.\nSystem-wide memory free percentage: 75%\n",
      ),
    ).toBe(75);
  });

  it("refuses when one-minute load exceeds the configured ceiling", () => {
    expect(
      resourceRefusal({
        load1: 5.1,
        maxLoad: 4,
        freeMemoryPercent: 70,
        minFreeMemoryPercent: 25,
      }),
    ).toBe("load 5.10 exceeds limit 4.00");
  });

  it("refuses when system-free memory falls below the configured floor", () => {
    expect(
      resourceRefusal({
        load1: 1.5,
        maxLoad: 4,
        freeMemoryPercent: 24,
        minFreeMemoryPercent: 25,
      }),
    ).toBe("free memory 24% is below floor 25%");
  });

  it("allows a healthy machine", () => {
    expect(
      resourceRefusal({
        load1: 2.25,
        maxLoad: 4,
        freeMemoryPercent: 75,
        minFreeMemoryPercent: 25,
      }),
    ).toBeNull();
  });
});

describe("local refresh key loading", () => {
  it("removes provider secrets from external command environments without mutating input", () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: "/usr/bin:/bin",
      SAFE_MARKER: "preserved",
      EXA_API_KEY: "exa-secret",
      BROWSERBASE_API_KEY: "browserbase-secret",
      TAVILY_API_KEY: "tavily-secret",
      TICKETMASTER_API_KEY: "ticketmaster-secret",
      SKIDDLE_API_KEY: "skiddle-secret",
      CONTEXT_DEV_API_KEY: "context-dev-secret",
    };

    const safeEnvironment = providerSafeEnvironment(environment);

    expect(safeEnvironment).toEqual({
      NODE_ENV: "test",
      PATH: "/usr/bin:/bin",
      SAFE_MARKER: "preserved",
    });
    expect(environment).toHaveProperty("EXA_API_KEY", "exa-secret");
  });

  it("loads a mode-0600 env file and redacts every loaded value", () => {
    const directory = temporaryDirectory();
    const keyFile = join(directory, "keys.env");
    writeFileSync(
      keyFile,
      "# local only\nexport BROWSERBASE_API_KEY='browserbase-test-secret'\nEXA_API_KEY=exa-test-secret\nTAVILY_API_KEY=tavily-test-secret\n",
    );
    chmodSync(keyFile, 0o600);

    const keys = loadKeyFile(keyFile);
    expect(keys).toEqual({
      BROWSERBASE_API_KEY: "browserbase-test-secret",
      EXA_API_KEY: "exa-test-secret",
      TAVILY_API_KEY: "tavily-test-secret",
    });
    expect(redactSecrets("token=browserbase-test-secret other=exa-test-secret", Object.values(keys))).toBe(
      "token=[REDACTED] other=[REDACTED]",
    );
  });

  it("rejects a key file readable by group or other users", () => {
    const directory = temporaryDirectory();
    const keyFile = join(directory, "keys.env");
    writeFileSync(keyFile, "EXA_API_KEY=not-safe\n");
    chmodSync(keyFile, 0o644);

    expect(() => loadKeyFile(keyFile)).toThrow(/must have mode 0600/);
  });

  it("reports missing keys by refresh mode without inventing a fallback", () => {
    expect(keyReadinessError("prices", {})).toBe(
      "prices refresh requires EXA_API_KEY, BROWSERBASE_API_KEY, and TAVILY_API_KEY in the protected key file; missing EXA_API_KEY, BROWSERBASE_API_KEY, TAVILY_API_KEY",
    );
    // Events readiness is per LANE: the Common reader needs no provider key, so
    // a keyless machine still has a runnable lane and the mode is not blocked.
    expect(keyReadinessError("events", {})).toBeNull();
    expect(
      keyReadinessError("prices", {
        EXA_API_KEY: "present",
        BROWSERBASE_API_KEY: "present",
        TAVILY_API_KEY: "present",
      }),
    ).toBeNull();
    expect(keyReadinessError("events", { TICKETMASTER_API_KEY: "present" })).toBeNull();
  });

  it("skips only the provider lane when no provider key is present, and reports it", () => {
    const keyless = laneReadiness("events", {});
    expect(keyless.runnable.map((command) => command.args)).toEqual([
      ["scripts/whatson/commonRefresh.mjs"],
    ]);
    expect(keyless.skipped).toHaveLength(1);
    expect(keyless.skipped[0].reason).toContain("scripts/whatson/eventsRefresh.mjs");
    expect(keyless.skipped[0].reason).toContain("TICKETMASTER_API_KEY");

    const keyed = laneReadiness("events", { TICKETMASTER_API_KEY: "present" });
    expect(keyed.runnable.map((command) => command.args)).toEqual([
      ["scripts/whatson/eventsRefresh.mjs"],
      ["scripts/whatson/commonRefresh.mjs"],
    ]);
    expect(keyed.skipped).toEqual([]);
  });

  it("still refuses a keyless prices run, whose lanes all need the same keys", () => {
    expect(laneReadiness("prices", {}).skipped).toEqual([]);
    expect(keyReadinessError("prices", {})).toContain("missing");
  });
});

describe("local refresh data snapshot", () => {
  it("reads venue, price, and deal lanes used by the PR summary", () => {
    const repository = temporaryDirectory();
    mkdirSync(join(repository, "public/data/drink_price_updates"), { recursive: true });
    mkdirSync(join(repository, "public/data/price_updates"), { recursive: true });
    mkdirSync(join(repository, "public/data/whats_on"), { recursive: true });
    writeFileSync(
      join(repository, "public/data/pint_prices_app_dataset.json"),
      JSON.stringify([
        {
          app_price_id: "app_price_000001",
          pub_key: "alpha",
          pub_name: "Alpha Arms",
          address: "1 A St",
          latitude: 51.5,
          longitude: -0.1,
          pint_name: "Lager",
          price_gbp: 5.5,
        },
      ]),
    );
    writeFileSync(
      join(repository, "public/data/drink_price_updates/latest.json"),
      JSON.stringify({
        updates: [
          {
            venueKey: "alpha-key",
            drinkName: "Lager",
            category: "beer",
            priceGbp: 5.5,
            source: { url: "https://alpha.example/menu" },
          },
        ],
      }),
    );
    writeFileSync(join(repository, "public/data/price_updates/latest.json"), JSON.stringify({ updates: [] }));
    writeFileSync(
      join(repository, "public/data/whats_on/deals_london.json"),
      JSON.stringify({ rows: [{ id: "deal-alpha", kind: "deal" }] }),
    );

    expect(captureRefreshSnapshot(repository)).toEqual({
      venues: [{ id: "alpha", name: "Alpha Arms", address: "1 A St", lat: 51.5, lng: -0.1 }],
      prices: [
        { id: "dataset-row|app_price_000001", price: 5.5 },
        { id: "drink|alpha-key|beer|lager|https://alpha.example/menu", price: 5.5 },
      ],
      deals: [{ id: "deal-alpha" }],
      events: [],
      enrichments: [],
    });
  });
});

describe("local refresh scraper sequence", () => {
  it("proves committed branch code in dry runs while scheduled runs stay on origin/main", () => {
    expect(baseRefForRun(true)).toBe("HEAD");
    expect(baseRefForRun(false)).toBe("origin/main");
  });

  it("runs every specified price script serially without delegating PR creation", () => {
    const commands = commandsForMode("prices", false);
    expect(commands.map((command) => command.args[0])).toEqual([
      "scripts/refresh_drink_prices.mjs",
      "scripts/refresh_prices.mjs",
      "scripts/firecrawl_greene_king_prices.mjs",
      "scripts/firecrawl_mbplc_prices.mjs",
      "scripts/harvest_outer_london_prices.mjs",
      "scripts/merge_london_chain_scrapes.mjs",
      "scripts/merge_london_chain_gazetteer.mjs",
    ]);
    expect(commands.flatMap((command) => command.args)).not.toContain("--open-pr");
  });

  it("bounds network-heavy scrapers during a dry run", () => {
    expect(commandsForMode("prices", true).map((command) => command.args)).toEqual([
      ["scripts/refresh_drink_prices.mjs", "--limit", "1"],
      ["scripts/refresh_prices.mjs"],
      ["scripts/firecrawl_greene_king_prices.mjs", "--limit", "1", "--merge"],
      ["scripts/firecrawl_mbplc_prices.mjs", "--limit", "1"],
      ["scripts/harvest_outer_london_prices.mjs", "--limit", "1", "--budget", "2"],
      ["scripts/merge_london_chain_scrapes.mjs"],
      ["scripts/merge_london_chain_gazetteer.mjs"],
    ]);
  });

  it("uses the existing official-provider event refresher", () => {
    expect(commandsForMode("events", false)).toEqual([
      {
        executable: process.execPath,
        args: ["scripts/whatson/eventsRefresh.mjs"],
        independent: true,
        requiresAnyKey: ["TICKETMASTER_API_KEY", "SKIDDLE_API_KEY", "CONTEXT_DEV_API_KEY"],
      },
      {
        executable: process.execPath,
        args: ["scripts/whatson/commonRefresh.mjs"],
        independent: true,
      },
    ]);
  });
});

describe("local refresh PR summary", () => {
  it("counts review-significant changes independently", () => {
    const before = {
      venues: [
        { id: "pub-a", name: "Alpha Arms", address: "1 A St", lat: 51.5, lng: -0.1 },
        { id: "pub-b", name: "Beta Arms", address: "2 B St", lat: 51.51, lng: -0.11 },
      ],
      prices: [
        { id: "pub-a|lager", price: 5.5, observedAt: "2026-07-01T00:00:00Z" },
        { id: "pub-b|ale", price: 6, observedAt: "2026-07-01T00:00:00Z" },
      ],
      deals: [{ id: "deal-monday" }],
      events: [],
      enrichments: [{ id: "pub-a", value: "old-menu" }],
    };
    const after = {
      venues: [
        { id: "pub-a", name: "Alpha Arms", address: "1 A St", lat: 51.5005, lng: -0.1 },
        { id: "pub-b", name: "Beta Arms", address: "2 B St", lat: 51.51, lng: -0.11 },
        { id: "pub-c", name: "Charlie Arms", address: "3 C St", lat: 51.52, lng: -0.12 },
      ],
      prices: [
        { id: "pub-a|lager", price: 5.75, observedAt: "2026-08-01T00:00:00Z" },
        { id: "pub-b|ale", price: 6, observedAt: "2026-08-01T00:00:00Z" },
        { id: "pub-c|stout", price: 6.25, observedAt: "2026-08-01T00:00:00Z" },
      ],
      deals: [{ id: "deal-monday" }, { id: "deal-tuesday" }],
      events: [{ id: "event-tuesday" }],
      enrichments: [{ id: "pub-a", value: "new-menu" }],
    };

    expect(summariseRefresh(before, after)).toEqual({
      newPubs: 1,
      newPriceRows: 1,
      priceChanges: 1,
      refreshedPriceRows: 1,
      newDeals: 1,
      newEvents: 1,
      locationFixes: 1,
      enrichmentChanges: 1,
    });
  });
});

describe("local refresh publication", () => {
  it("fails before branch creation or push when gh-axi is unavailable", async () => {
    const repository = temporaryDirectory();
    const remote = temporaryDirectory();
    execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", remote]);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repository });
    mkdirSync(join(repository, "public/data/drink_price_updates"), { recursive: true });
    const latest = join(repository, "public/data/drink_price_updates/latest.json");
    writeFileSync(latest, JSON.stringify({ updates: [{ venueKey: "alpha", priceGbp: 5.5 }] }));
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"],
      { cwd: repository },
    );
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: repository });
    execFileSync("git", ["push", "-q", "-u", "origin", "main"], { cwd: repository });
    const originalMain = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    writeFileSync(latest, JSON.stringify({ updates: [{ venueKey: "alpha", priceGbp: 5.75 }] }));
    const missingGhAxi = join(repository, "missing-gh-axi");

    await expect(
      publishPreparedChanges({
        worktree: repository,
        mode: "prices",
        dryRun: false,
        summary: {
          newPubs: 0,
          newPriceRows: 0,
          priceChanges: 1,
          refreshedPriceRows: 0,
          newDeals: 0,
          newEvents: 0,
          locationFixes: 0,
          enrichmentChanges: 0,
        },
        log: () => undefined,
        ghAxiPath: missingGhAxi,
        timestamp: "2026-08-05T10:00:00.000Z",
      }),
    ).rejects.toThrow(
      `gh-axi is not executable at ${missingGhAxi}; refusing to push without review PR capability`,
    );

    expect(
      execFileSync("git", ["branch", "--format=%(refname:short)"], {
        cwd: repository,
        encoding: "utf8",
      }).trim(),
    ).toBe("main");
    expect(
      execFileSync("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"], {
        encoding: "utf8",
      }).trim(),
    ).toBe(`main ${originalMain}`);
  });

  it("validates one changed row, opens a review PR, and leaves remote main unmerged", async () => {
    const repository = temporaryDirectory();
    const remote = temporaryDirectory();
    const gitEnvironmentCapture = join(repository, "git-environment.json");
    const ghEnvironmentCapture = join(repository, "gh-environment.json");
    const providerKeyNames = [
      "EXA_API_KEY",
      "BROWSERBASE_API_KEY",
      "TAVILY_API_KEY",
      "TICKETMASTER_API_KEY",
      "SKIDDLE_API_KEY",
    ];
    execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", remote]);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repository });
    mkdirSync(join(repository, "public/data/drink_price_updates"), { recursive: true });
    const latest = join(repository, "public/data/drink_price_updates/latest.json");
    writeFileSync(
      latest,
      JSON.stringify({ updates: [{ venueKey: "alpha", drinkName: "Lager", priceGbp: 5.5 }] }),
    );
    writeFileSync(
      join(repository, "validate-fixture.cjs"),
      `const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync("public/data/drink_price_updates/latest.json", "utf8"));
if (data.updates.length !== 1 || data.updates[0].priceGbp !== 5.75) process.exit(1);
fs.writeFileSync("validation.marker", "validated one changed row\\n");
`,
    );
    writeFileSync(
      join(repository, "package.json"),
      JSON.stringify({ scripts: { "validate-data": "node validate-fixture.cjs" } }),
    );
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"],
      { cwd: repository },
    );
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: repository });
    execFileSync("git", ["push", "-q", "-u", "origin", "main"], { cwd: repository });
    const originalMain = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();

    const captureScript = (capturePath: string) => `#!/usr/bin/env node
const fs = require("node:fs");
const names = ${JSON.stringify(providerKeyNames)};
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  args: process.argv.slice(2),
  visibleProviderKeys: names.filter((name) => Object.hasOwn(process.env, name)),
}));
`;
    const prePushHook = join(repository, ".git/hooks/pre-push");
    writeFileSync(prePushHook, captureScript(gitEnvironmentCapture));
    chmodSync(prePushHook, 0o755);
    const fakeGhAxi = join(repository, "fake-gh-axi");
    writeFileSync(fakeGhAxi, captureScript(ghEnvironmentCapture));
    chmodSync(fakeGhAxi, 0o755);

    writeFileSync(
      latest,
      JSON.stringify({ updates: [{ venueKey: "alpha", drinkName: "Lager", priceGbp: 5.75 }] }),
    );
    writeFileSync(join(repository, "unapproved-output.txt"), "must not be staged\n");
    const externalEnvironment = {
      ...process.env,
      EXA_API_KEY: "exa-secret",
      BROWSERBASE_API_KEY: "browserbase-secret",
      TAVILY_API_KEY: "tavily-secret",
      TICKETMASTER_API_KEY: "ticketmaster-secret",
      SKIDDLE_API_KEY: "skiddle-secret",
    };

    await validatePreparedData({
      worktree: repository,
      environment: externalEnvironment,
      log: () => undefined,
    });
    expect(readFileSync(join(repository, "validation.marker"), "utf8")).toBe(
      "validated one changed row\n",
    );

    const result = await publishPreparedChanges({
      worktree: repository,
      mode: "prices",
      dryRun: false,
      summary: {
        newPubs: 0,
        newPriceRows: 0,
        priceChanges: 1,
        refreshedPriceRows: 0,
        newDeals: 0,
        newEvents: 0,
        locationFixes: 0,
        enrichmentChanges: 0,
      },
      log: () => undefined,
      ghAxiPath: fakeGhAxi,
      timestamp: "2026-08-05T11:00:00.000Z",
      environment: externalEnvironment,
    });

    expect(result).toEqual({
      status: "published",
      changedFiles: ["public/data/drink_price_updates/latest.json"],
      branch: "automation/local-refresh-prices-20260805t110000z",
    });
    const gitCapture = JSON.parse(readFileSync(gitEnvironmentCapture, "utf8"));
    expect(gitCapture.visibleProviderKeys).toEqual([]);
    const ghCapture = JSON.parse(readFileSync(ghEnvironmentCapture, "utf8"));
    expect(ghCapture.visibleProviderKeys).toEqual([]);
    expect(ghCapture.args.slice(0, 2)).toEqual(["pr", "create"]);
    expect(ghCapture.args).toContain("automation/local-refresh-prices-20260805t110000z");
    expect(ghCapture.args).not.toContain("merge");

    const reviewRef = "refs/heads/automation/local-refresh-prices-20260805t110000z";
    expect(
      execFileSync("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"], {
        encoding: "utf8",
      }).trim(),
    ).toBe(originalMain);
    const reviewCommitAndParent = execFileSync(
      "git",
      ["--git-dir", remote, "rev-list", "--parents", "-n", "1", reviewRef],
      { encoding: "utf8" },
    )
      .trim()
      .split(" ");
    expect(reviewCommitAndParent).toHaveLength(2);
    expect(reviewCommitAndParent[1]).toBe(originalMain);
    expect(
      execFileSync(
        "git",
        ["--git-dir", remote, "diff-tree", "--no-commit-id", "--name-only", "-r", reviewRef],
        { encoding: "utf8" },
      ).trim(),
    ).toBe("public/data/drink_price_updates/latest.json");
  });

  it("returns quietly without creating a branch when tracked data is unchanged", async () => {
    const repository = temporaryDirectory();
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repository });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial"], {
      cwd: repository,
    });

    const result = await publishPreparedChanges({
      worktree: repository,
      mode: "prices",
      dryRun: true,
      summary: {
        newPubs: 0,
        newPriceRows: 0,
        priceChanges: 0,
        refreshedPriceRows: 0,
        newDeals: 0,
        newEvents: 0,
        locationFixes: 0,
        enrichmentChanges: 0,
      },
      log: () => undefined,
    });

    expect(result).toEqual({ status: "no-change", changedFiles: [] });
    expect(execFileSync("git", ["branch", "--format=%(refname:short)"], { cwd: repository, encoding: "utf8" }).trim()).toBe("main");
  });

  it("does not publish timestamp-only envelope churn", async () => {
    const repository = temporaryDirectory();
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repository });
    mkdirSync(join(repository, "public/data/drink_price_updates"), { recursive: true });
    const latest = join(repository, "public/data/drink_price_updates/latest.json");
    writeFileSync(latest, JSON.stringify({ generatedAt: "2026-07-01T00:00:00Z", updates: [] }));
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"], {
      cwd: repository,
    });
    writeFileSync(latest, JSON.stringify({ generatedAt: "2026-08-01T00:00:00Z", updates: [] }));

    const result = await publishPreparedChanges({
      worktree: repository,
      mode: "prices",
      dryRun: true,
      summary: {
        newPubs: 0,
        newPriceRows: 0,
        priceChanges: 0,
        refreshedPriceRows: 0,
        newDeals: 0,
        newEvents: 0,
        locationFixes: 0,
        enrichmentChanges: 0,
      },
      log: () => undefined,
    });

    expect(result).toEqual({ status: "no-change", changedFiles: [] });
  });
});

describe("local refresh validation", () => {
  it("uses the package validation entrypoint so generated prerequisites exist", async () => {
    const repository = temporaryDirectory();
    writeFileSync(
      join(repository, "package.json"),
      JSON.stringify({
        scripts: {
          "prevalidate-data":
            "node -e \"require('fs').writeFileSync('generated.marker','ready')\"",
          "validate-data":
            "node -e \"if(!require('fs').existsSync('generated.marker'))process.exit(1)\"",
        },
      }),
    );

    await validatePreparedData({
      worktree: repository,
      environment: process.env,
      log: () => undefined,
    });

    expect(() => execFileSync("test", ["-f", join(repository, "generated.marker")])).not.toThrow();
  });
});

describe("local refresh launchd agents", () => {
  it("renders Monday prices and daily events without secrets", () => {
    const agents = renderLaunchAgents({
      repoRoot: "/Users/test/pubmax",
      nodePath: "/opt/node/bin/node",
      homeDir: "/Users/test",
    });

    expect(agents.map((agent) => agent.label)).toEqual([
      "com.pubmax.refresh-prices",
      "com.pubmax.refresh-events",
    ]);

    const prices = agents[0].xml;
    expect(prices).toContain("<key>Weekday</key>\n      <integer>1</integer>");
    expect(prices).toContain("<key>Hour</key>\n      <integer>7</integer>");
    expect(prices).toContain("<key>Minute</key>\n      <integer>30</integer>");

    const events = agents[1].xml;
    expect(events).not.toContain("<key>Weekday</key>");
    expect(events).toContain("<key>Hour</key>\n      <integer>15</integer>");
    expect(events).toContain("<key>Minute</key>\n      <integer>45</integer>");

    for (const { xml } of agents) {
      expect(xml).toContain("<key>StartCalendarInterval</key>");
      expect(xml).toContain("<key>LowPriorityIO</key>");
      expect(xml).toContain("<key>ProcessType</key>\n  <string>Background</string>");
      expect(xml).toContain("/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
      expect(xml).toContain("/Users/test/pubmax/scripts/local-refresh/scheduler.mjs");
      expect(xml).toContain("/Users/test/karan-agent-workspace/data/refresh-logs/");
      expect(xml).not.toMatch(/API_KEY|SECRET_KEY|test-secret-value/);
    }
  });
});
