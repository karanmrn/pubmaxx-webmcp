// Build data/persona_drinks.json from the QA'd research crawl (JSONL source).
//
// The persona-drinks lens ("Drink like...") ties famous / fictional drink
// orders to REAL pubs by drink category. This script is the deterministic seam
// between the research artifact and the shipped dataset:
//
//   1. read data/persona_drinks.source.jsonl (one JSON object per line);
//   2. validate every entry against the same schema lib/personaDrinks.ts
//      enforces (fail loud on any bad row, a broken source is a build break);
//   3. DROP low-confidence entries (a "reported favourite" we are not confident
//      in is not shippable copy);
//   4. STRIP em / en dashes from every display string. The product guardrail
//      is "no em dashes anywhere", and the source quotes carry many. We replace
//      them with a comma seam and collapse the punctuation deterministically so
//      the meaning survives and the sweep test stays green;
//   5. write data/persona_drinks.json, sorted by kind then name for a stable,
//      review-friendly diff.
//
// Refresh cadence lives in data/freshness_registry.json (id: persona_drinks):
// re-run the persona crawl, drop the new JSONL in as the source, then
//   node scripts/build_persona_drinks.mjs
//
// Node-only (fs). Never imported by the app bundle.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SOURCE = join(ROOT, "data", "persona_drinks.source.jsonl");
const OUT = join(ROOT, "data", "persona_drinks.json");

// The closed drink-category set, kept in lockstep with DRINK_CATEGORIES in
// lib/drinks.ts. Duplicated here (not imported) so this Node script has zero
// dependency on the TS module graph; a test asserts the two never drift.
const DRINK_CATEGORIES = [
  "beer",
  "wine",
  "whisky",
  "gin",
  "vodka",
  "rum",
  "cocktail",
  "shot",
  "alcohol-free",
  "soft-drink",
  "coffee",
  "other",
];
const KINDS = ["person", "fictional"];
const CONFIDENCES = ["high", "medium", "low"];

/**
 * Replace em (U+2014) and en (U+2013) dashes with a comma seam and normalise
 * the surrounding punctuation, so a sourced quote reads cleanly without any
 * banned dash. Pure string transform, deterministic.
 */
export function stripDashes(text) {
  return (
    text
      // A dash used as a clause break becomes a comma seam.
      .replace(/\s*[—–]\s*/g, ", ")
      // Collapse a comma that now sits next to existing punctuation.
      .replace(/,\s*,/g, ", ")
      .replace(/\s+,/g, ",")
      .replace(/,\s*([.;:!?])/g, "$1")
      // A trailing comma seam (dash at end of string) is just noise.
      .replace(/,\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

function fail(id, message) {
  throw new Error(`persona_drinks build: entry ${id ?? "<no id>"}: ${message}`);
}

function validateRaw(row) {
  const id = row.id;
  if (typeof id !== "string" || !id.trim()) fail(id, "missing id");
  for (const field of ["name", "knownFor", "drink", "why", "howToOrder"]) {
    if (typeof row[field] !== "string" || !row[field].trim()) {
      fail(id, `missing/empty ${field}`);
    }
  }
  if (!KINDS.includes(row.kind)) fail(id, `bad kind ${row.kind}`);
  if (!DRINK_CATEGORIES.includes(row.drinkCategory)) {
    fail(id, `drinkCategory ${row.drinkCategory} not in closed set`);
  }
  if (!CONFIDENCES.includes(row.confidence)) {
    fail(id, `bad confidence ${row.confidence}`);
  }
  if (typeof row.sourceUrl !== "string" || !/^https?:\/\//.test(row.sourceUrl)) {
    fail(id, "sourceUrl must be an absolute http(s) URL");
  }
  if (typeof row.sourceName !== "string" || !row.sourceName.trim()) {
    fail(id, "missing sourceName");
  }
  if (
    typeof row.observedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}/.test(row.observedAt)
  ) {
    fail(id, "observedAt must be an ISO date");
  }
  if (!Array.isArray(row.ingredients)) fail(id, "ingredients must be an array");
  for (const ing of row.ingredients) {
    if (typeof ing !== "string" || !ing.trim()) fail(id, "empty ingredient");
  }
}

const lines = readFileSync(SOURCE, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const seen = new Set();
const kept = [];
let dropped = 0;

for (const line of lines) {
  const row = JSON.parse(line);
  validateRaw(row);
  if (seen.has(row.id)) fail(row.id, "duplicate id");
  seen.add(row.id);

  if (row.confidence === "low") {
    dropped += 1;
    continue;
  }

  kept.push({
    id: row.id,
    name: stripDashes(row.name),
    kind: row.kind,
    knownFor: stripDashes(row.knownFor),
    drink: stripDashes(row.drink),
    drinkCategory: row.drinkCategory,
    why: stripDashes(row.why),
    sourceUrl: row.sourceUrl,
    sourceName: stripDashes(row.sourceName),
    observedAt: row.observedAt,
    ingredients: row.ingredients.map((ing) => stripDashes(ing)),
    howToOrder: stripDashes(row.howToOrder),
    confidence: row.confidence,
  });
}

kept.sort(
  (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
);

// Final guard: no banned dash may survive into the shipped artifact.
const DASH = /[—–]/;
for (const entry of kept) {
  for (const [field, value] of Object.entries(entry)) {
    const strings = Array.isArray(value) ? value : [value];
    for (const s of strings) {
      if (typeof s === "string" && DASH.test(s)) {
        fail(entry.id, `em/en dash survived in ${field}`);
      }
    }
  }
}

writeFileSync(OUT, `${JSON.stringify(kept, null, 2)}\n`);

console.log(
  `persona_drinks: wrote ${kept.length} entries to data/persona_drinks.json ` +
    `(dropped ${dropped} low-confidence, from ${lines.length} source rows)`,
);
