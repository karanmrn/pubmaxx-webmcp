#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolvePostcodeCoordinateDecisions } from "./lib/postcodeCoordinateDecisions.mjs";

const root = process.cwd();

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

let rows;
try {
  rows = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
  console.error(`postcode-coordinate decision input is invalid: ${error.message}`);
  process.exit(1);
}

try {
  const osmData = loadJson("data/osm/uk/uk_osm_pubs.json");
  const result = resolvePostcodeCoordinateDecisions({
    rows,
    osmPubs: osmData.pubs,
    correctionRegistry: loadJson("data/postcode_coordinate_corrections.json"),
    quarantineRegistry: loadJson("data/postcode_coordinate_quarantine.json"),
    exceptionRegistry: loadJson("data/postcode_coordinate_exceptions.json"),
  });

  if (result.invalidDecisions.length > 0) {
    for (const error of result.invalidDecisions) {
      console.error(error);
    }
    process.exit(1);
  }

  process.stdout.write(
    JSON.stringify({
      appliedCorrections: result.appliedCorrections,
      appliedQuarantines: result.appliedQuarantines,
      checkedRows: result.checkedRows,
      referenceCount: result.referenceCount,
    }),
  );
} catch (error) {
  console.error(`postcode-coordinate decision validation failed: ${error.message}`);
  process.exit(1);
}
