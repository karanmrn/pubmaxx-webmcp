#!/usr/bin/env node
// Prints the owner apply list for supabase/migrations, in real apply order.
//
// The list used to be a hand-typed section in FABLE_HANDOFF.md. A hand-typed
// list drifts: it stops being updated, and the migrations directory keeps
// growing past it. This script reads the migrations directory itself, so the
// list can never go stale.
//
// Apply order is TIMESTAMP order, not the four-digit number in a filename.
// Most filenames carry both (20260806160000_0076_plan_member_group_prefs.sql),
// but the number is not reliable: 0075 has a later timestamp than 0076 and
// 0077, because it was renamed after they landed. Some filenames carry no
// number at all. The timestamp prefix is the one thing every file has, and
// it is what `supabase migration list` and the CLI apply order both use.
//
// Usage:
//   node scripts/qa/migration-apply-list.mjs
//     Print every migration filename, oldest first.
//
//   node scripts/qa/migration-apply-list.mjs --against <file>
//     Print only the migrations not yet applied, oldest first.
//     <file> holds one applied version per line, the same 14-digit
//     version `supabase migration list` prints in its Local column.
//     Blank lines and lines with no 14-digit version are skipped, so a
//     raw pasted CLI table works as-is.
//
// Pure filesystem plus argv/stdin. No network call. No secret read.
// supabase/migrations/rollback/ is a subdirectory, so a plain (non-recursive)
// directory read already excludes it.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_RE = /^(\d{14})_.+\.sql$/;
const VERSION_TOKEN_RE = /\b(\d{14})\b/;

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

// Reads one directory and returns its migration filenames in apply order.
export function listMigrations(migrationsDir = MIGRATIONS_DIR) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && VERSION_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

// Returns the 14-digit version prefix of a migration filename, or null.
export function versionOf(filename) {
  const match = filename.match(VERSION_RE);
  return match ? match[1] : null;
}

// Reads applied versions out of free-form text, one 14-digit version per
// line found. Header rows, separator rows, and blank lines have no match
// and are skipped.
export function parseAppliedVersions(text) {
  const applied = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(VERSION_TOKEN_RE);
    if (match) applied.add(match[1]);
  }
  return applied;
}

// Filters a migration list down to the ones whose version is not in the
// applied set. Keeps the input order, so callers pass an already-sorted list.
export function unappliedMigrations(migrations, appliedVersions) {
  return migrations.filter((name) => !appliedVersions.has(versionOf(name)));
}

function main() {
  const args = process.argv.slice(2);
  const againstIndex = args.indexOf("--against");
  const migrations = listMigrations();

  let output = migrations;
  if (againstIndex !== -1) {
    const appliedFile = args[againstIndex + 1];
    if (!appliedFile) {
      console.error("--against needs a file path");
      process.exitCode = 1;
      return;
    }
    const appliedVersions = parseAppliedVersions(readFileSync(appliedFile, "utf8"));
    output = unappliedMigrations(migrations, appliedVersions);
  }

  for (const name of output) {
    console.log(name);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
