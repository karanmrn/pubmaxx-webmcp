#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DEFAULT_FORBIDDEN_KEYS = [
  "acceptedVenueId",
  "venueId",
  "venueIds",
  "routeVenueIds",
  "stops",
  "stopOrder",
  "routeGeometry",
  "alternatives",
  "nightContext",
  "groundingProof",
  "operationKey",
  "capability",
  "memberCapability",
  "crew",
];

function usage() {
  console.error(
    "Usage: node scripts/assert-privacy-response.mjs <response-file>... [--forbid <literal>]...",
  );
}

const args = process.argv.slice(2);
const files = [];
const forbiddenLiterals = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--forbid") {
    const value = args[index + 1];
    if (!value) {
      usage();
      process.exit(2);
    }
    forbiddenLiterals.push(value);
    index += 1;
  } else if (args[index].startsWith("--")) {
    console.error(`unknown option: ${args[index]}`);
    process.exit(2);
  } else {
    files.push(args[index]);
  }
}

if (files.length === 0) {
  usage();
  process.exit(2);
}

const findings = [];
for (const file of files) {
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    console.error(
      `privacy scan failed: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    continue;
  }

  const normalized = source.replaceAll('\\"', '"');
  for (const key of DEFAULT_FORBIDDEN_KEYS) {
    const pattern = new RegExp(`(?:["']${key}["']|\\b${key}\\b)\\s*:`, "i");
    if (pattern.test(normalized)) findings.push(`${file}: forbidden key ${key}`);
  }
  for (const literal of forbiddenLiterals) {
    if (literal && source.includes(literal)) {
      findings.push(`${file}: forbidden literal ${JSON.stringify(literal)}`);
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  console.error(`privacy scan failed: ${findings.length} forbidden match(es)`);
  process.exit(1);
}
if (process.exitCode) process.exit();

console.log(
  `privacy scan passed: ${files.length} response file(s), ${forbiddenLiterals.length} explicit literal(s)`,
);
