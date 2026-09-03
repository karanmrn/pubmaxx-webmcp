#!/usr/bin/env node
// Freeze one closed month of the public London Pint Index.
//
//   node scripts/publish_pint_index_month.mjs --month 2026-06
//   node scripts/publish_pint_index_month.mjs --month 2026-06 \
//     --withdraw crown-camden@2026-06-20T18:00:00.000Z \
//     --correction "The Crown's 20 June price cited the wrong menu page."
//   node scripts/publish_pint_index_month.mjs --month 2026-06 \
//     --restate crown-camden@2026-06-20T18:00:00.000Z 560 \
//     --correction "The Crown's 20 June price was transcribed as 5.06; the menu says 5.60."
//
// The rules are not in this file. They are in lib/pintIndexArchive.ts, which
// the route and the tests read too; this is the thin CLI over them:
//   • a month is written once, and only after it has closed;
//   • a published month changes only as a NAMED correction that actually
//     changes something, appended with the hash of what it replaced;
//   • a FIRST publication filters what the live snapshot already published; a
//     correction amends the PUBLISHED edition and never re-reads that
//     snapshot, whose window has moved on by then;
//   • an amendment names ONE observation, as narrowly as that month needs:
//     <venueId>[@<observedAt>][#<sourceId>][^<ordinal>];
//   • nothing here invents an observation, and it dies rather than guess.
//
// Run it after the live snapshot is regenerated, on or after the 1st of the
// following month. `npm run validate-data` re-checks every published month.

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SNAPSHOT_PATH = path.join(ROOT, "public/data/pint_index_snapshot.json");
const ARCHIVE_DIR = path.join(ROOT, "public/data/pint_index");

const sha256 = (input) => createHash("sha256").update(input, "utf8").digest("hex");

// `crown-camden`, `crown-camden@2026-06-20T18:00:00.000Z`, and if the month
// somehow holds two prices for that pub at the same instant, `...#drop-2` and
// then `...^2`. Each part names a PRICE more narrowly than the last, and none
// of the three separators can occur inside an ISO instant. The archive rules
// decide which parts are needed; this only reads them.
function parseObservationRef(token, flag) {
  const raw = (token ?? "").trim();
  if (!raw) die(`${flag} needs a venue id, optionally as <venueId>[@<observedAt>][#<sourceId>][^<ordinal>]`);

  let rest = raw;
  let ordinal = null;
  const caret = rest.lastIndexOf("^");
  if (caret !== -1) {
    const value = Number(rest.slice(caret + 1).trim());
    if (!Number.isInteger(value) || value < 1) die(`${flag} needs a whole ordinal of 1 or more after the ^`);
    ordinal = value;
    rest = rest.slice(0, caret);
  }

  let sourceId = null;
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    sourceId = rest.slice(hash + 1).trim();
    if (!sourceId) die(`${flag} needs a source id after the #`);
    rest = rest.slice(0, hash);
  }

  const at = rest.indexOf("@");
  const venueId = (at === -1 ? rest : rest.slice(0, at)).trim();
  const observedAt = at === -1 ? null : rest.slice(at + 1).trim();
  if (!venueId) die(`${flag} needs a venue id`);
  if (at !== -1 && !observedAt) die(`${flag} needs an observed-at date after the @`);
  return { venueId, observedAt, sourceId, ordinal };
}

function parseArgs(argv) {
  const args = { month: null, correction: null, withdraw: [], restate: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--month") args.month = argv[++i] ?? null;
    else if (argv[i] === "--correction") args.correction = argv[++i] ?? null;
    else if (argv[i] === "--withdraw") args.withdraw.push(parseObservationRef(argv[++i], "--withdraw"));
    else if (argv[i] === "--restate") {
      const ref = parseObservationRef(argv[++i], "--restate");
      const pence = Number(argv[++i]);
      if (!Number.isInteger(pence) || pence <= 0) {
        die("--restate needs the corrected price in whole pence, for example: --restate crown-camden 560");
      }
      args.restate.push({ ...ref, pricePence: pence });
    }
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
    else die(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function die(message) {
  console.error(`publish_pint_index_month: ${message}`);
  process.exit(1);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log([
      "usage: publish_pint_index_month.mjs --month YYYY-MM",
      "         [--withdraw <observation>]...",
      "         [--restate <observation> <pricePence>]...",
      "         [--correction \"what changed and why\"]",
      "",
      "  --withdraw  a price that should never have been in the Index leaves it",
      "  --restate   a price that belongs is republished at the figure its source carries",
      "",
      "  <observation> is <venueId>[@<observedAt>][#<sourceId>][^<ordinal>], naming ONE",
      "  published price. Add only as much as the month needs: the observed-at instant",
      "  when the pub has more than one price, the source id when two share an instant,",
      "  the ordinal (1-based, published order) when even that cannot tell them apart.",
      "  An ambiguous reference is refused rather than resolved by guessing.",
    ].join("\n"));
    return;
  }
  if (!args.month) die("--month YYYY-MM is required");

  // The archive contract is TypeScript the app also runs; load it through the
  // same tsx runner the other typed scripts use rather than duplicating it.
  const {
    amendArchivedMonth,
    buildArchivedMonth,
    monthPublishBlocker,
    monthPublishFloorBlocker,
    planArchivePublish,
    validateArchivedPintIndexSnapshot,
  } = await import("../lib/pintIndexArchive.ts");

  const snapshot = await readJson(SNAPSHOT_PATH).catch((error) =>
    die(`could not read ${SNAPSHOT_PATH}: ${error.message}`),
  );

  const now = new Date();
  const floorBlocker = monthPublishFloorBlocker(args.month, now);
  if (floorBlocker) die(floorBlocker);

  const issuedAt = now.toISOString();

  await mkdir(ARCHIVE_DIR, { recursive: true });
  const published = new Set(await readdir(ARCHIVE_DIR).catch(() => []));
  const file = path.join(ARCHIVE_DIR, `${args.month}.json`);
  // The lineage a correction records is only worth anything if the file it is
  // taken from still holds its own contract. Reading it unchecked would let a
  // hand-edited edition hand over a tampered digest as the hash of what was
  // replaced, and bless it as revision 2.
  let existing = null;
  if (published.has(`${args.month}.json`)) {
    const stored = await readJson(file).catch((error) => die(`could not read ${file}: ${error.message}`));
    const current = validateArchivedPintIndexSnapshot(stored, { month: args.month, sha256 });
    if (!current.ok) {
      die(`refusing to correct an edition that fails its own contract:\n  ${current.errors.join("\n  ")}`);
    }
    existing = current.archive;
  }

  // The live snapshot answers the FIRST publication and nothing else: whether
  // it was generated after the month closed, whether it was looking at that
  // month, and which observations the month holds. A correction reads the
  // published edition instead, because the snapshot's window has moved on and
  // its silence about an old month is absence, not evidence.
  let rebuilt;
  if (existing) {
    const amended = amendArchivedMonth({
      edition: existing,
      withdraw: args.withdraw,
      restate: args.restate,
      sha256,
    });
    if (!amended.ok) die(amended.reason);
    rebuilt = amended.archive;
  } else {
    if (args.withdraw.length > 0 || args.restate.length > 0) {
      die(`${args.month} is not published yet, so there is no observation to amend`);
    }
    const blocker = monthPublishBlocker(args.month, snapshot, now);
    if (blocker) die(blocker);
    rebuilt = buildArchivedMonth({ snapshot, month: args.month, publishedAt: issuedAt, sha256 });
  }

  const plan = planArchivePublish({
    existing,
    rebuilt,
    correctionNote: args.correction,
    issuedAt,
    sha256,
  });
  if (!plan.ok) die(plan.reason);

  const check = validateArchivedPintIndexSnapshot(plan.archive, { month: args.month, sha256 });
  if (!check.ok) die(`refusing to publish an invalid edition:\n  ${check.errors.join("\n  ")}`);

  await writeFile(file, `${JSON.stringify(plan.archive, null, 2)}\n`, "utf8");
  const count = plan.archive.observations.length;
  console.log(
    plan.kind === "correction"
      ? `corrected ${args.month} (revision ${plan.archive.archive.revision}, ${count} observations) → ${path.relative(ROOT, file)}`
      : `published ${args.month} (${count} observations) → ${path.relative(ROOT, file)}`,
  );
}

main().catch((error) => die(error.stack ?? String(error)));
