#!/usr/bin/env node
/**
 * Entry point for `npm run test:rls`.
 *
 * When PostgreSQL binaries are absent, prints an UNMISSABLE skip banner to
 * stdout (not only stderr - Vitest can swallow console.error under the
 * default reporter) and exits 0. A skip is not a pass: the banner names the
 * suite, the reason, and that fact.
 *
 * When Postgres is present, runs the real session suite with a verbose
 * reporter so skip reasons cannot hide.
 *
 * Never applies migrations to a live Supabase project.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const RLS_SUITES = [
  "__tests__/rlsWave2Session.test.ts",
  "__tests__/socialCrewMigration.test.ts",
  "__tests__/socialCrewLegacyRoutesRls.test.ts",
  "__tests__/pintDropVerifiedReportsMigrationEffective.test.ts",
  "__tests__/wantedPromotionMigrationEffective.test.ts",
];

const { missingPostgresReason } = await import(
  pathToFileURL(join(__dirname, "session-harness.mjs")).href
);

const missing = missingPostgresReason();

function printLoudSkip(reason) {
  const reasonLines = reason.split(/\s+/).reduce((lines, word) => {
    const current = lines.at(-1) ?? "";
    if (!current || `${current} ${word}`.length > 60) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
    return lines;
  }, []);
  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════════════╗",
    "║  RLS SESSION SUITE SKIPPED - THIS IS NOT A PASS                      ║",
    "║  Suites: __tests__/rlsWave2Session.test.ts                          ║",
    "║          __tests__/socialCrewMigration.test.ts  (npm run test:rls)  ║",
    "║          __tests__/socialCrewLegacyRoutesRls.test.ts                ║",
    "║          __tests__/pintDropVerifiedReportsMigrationEffective.test.ts║",
    "║          __tests__/wantedPromotionMigrationEffective.test.ts       ║",
    "╠══════════════════════════════════════════════════════════════════════╣",
    "║  Effective RLS tests need local PostgreSQL 16+ (initdb/postgres/psql)║",
    "║  They were NOT executed. A green CI step with this banner still means║",
    "║  zero policy proofs ran on this host.                                ║",
    "╠══════════════════════════════════════════════════════════════════════╣",
    `║  Reason: ${(reasonLines.shift() ?? "").padEnd(60)}║`,
  ];
  for (const reasonLine of reasonLines) {
    lines.push(`║          ${reasonLine.padEnd(60)}║`);
  }
  lines.push(
    "╠══════════════════════════════════════════════════════════════════════╣",
    "║  Provision PostgreSQL 16 + PostgREST 14, then rerun locally.         ║",
    "║  Do not treat this skip as evidence that RLS policies are correct.   ║",
    "╚══════════════════════════════════════════════════════════════════════╝",
    "",
  );
  // stdout stays visible in CI logs even when test reporters mute stderr.
  process.stdout.write(lines.join("\n") + "\n");
}

if (missing) {
  printLoudSkip(missing);
  // Exit 0: skip is correct on hosts without Postgres. Banner is the contract.
  process.exit(0);
}

const vitestBin = join(REPO_ROOT, "node_modules/.bin/vitest");
const result = spawnSync(
  vitestBin,
  [
    "run",
    ...RLS_SUITES,
    // Verbose + no silent: each test name and any skip reason stays in the log.
    "--reporter=verbose",
    "--silent=false",
    // Each suite boots its own ephemeral PostgreSQL cluster. Concurrent boots
    // starve a 2-core CI runner and the losers time out waiting to accept
    // connections, so the suites run one after another.
    "--no-file-parallelism",
  ],
  {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
