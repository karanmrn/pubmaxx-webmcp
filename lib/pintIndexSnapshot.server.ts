import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  isPintIndexMonth,
  validateArchivedPintIndexSnapshot,
  type ArchivedPintIndexSnapshot,
} from "@/lib/pintIndexArchive";
export { PINT_INDEX_SNAPSHOT_PATH } from "@/lib/pintIndexSnapshotFile.mjs";
export { loadPublicPintIndexSnapshot } from "@/lib/publicPintIndexSnapshot.server";

/** One JSON file per frozen month, named `YYYY-MM.json`. */
export const PINT_INDEX_ARCHIVE_DIR = "public/data/pint_index";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Every published month id, newest first. Missing directory reads as none. */
export async function listPintIndexArchiveMonths(): Promise<string[]> {
  try {
    const names = await fs.readdir(path.join(process.cwd(), PINT_INDEX_ARCHIVE_DIR));
    return names
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter(isPintIndexMonth)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * One frozen month, or null when it is unpublished or fails its own contract.
 * A month that no longer matches its integrity hash is treated as unpublished
 * rather than served: a silently rewritten edition must not answer a citation.
 */
export async function loadArchivedPintIndexMonth(month: string): Promise<ArchivedPintIndexSnapshot | null> {
  if (!isPintIndexMonth(month)) return null;
  try {
    const file = path.join(process.cwd(), PINT_INDEX_ARCHIVE_DIR, `${month}.json`);
    const result = validateArchivedPintIndexSnapshot(JSON.parse(await fs.readFile(file, "utf8")), {
      month,
      sha256: sha256Hex,
    });
    return result.ok ? result.archive : null;
  } catch {
    return null;
  }
}

/** Every published month that still passes its contract, newest first. */
export async function loadPintIndexArchive(): Promise<ArchivedPintIndexSnapshot[]> {
  const months = await listPintIndexArchiveMonths();
  const loaded = await Promise.all(months.map((month) => loadArchivedPintIndexMonth(month)));
  return loaded.filter((entry): entry is ArchivedPintIndexSnapshot => entry !== null);
}
