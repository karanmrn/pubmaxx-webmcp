import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  validatePintIndexSnapshot,
  type PintIndexSnapshot,
} from "@/lib/pintIndex";
import { PINT_INDEX_SNAPSHOT_PATH } from "@/lib/pintIndexSnapshotFile.mjs";

const snapshotFile = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  PINT_INDEX_SNAPSHOT_PATH,
);

export async function loadPublicPintIndexSnapshot(): Promise<PintIndexSnapshot | null> {
  try {
    const raw = await fs.readFile(
      /* turbopackIgnore: true */ snapshotFile,
      "utf8",
    );
    const result = validatePintIndexSnapshot(JSON.parse(raw));
    return result.ok ? result.snapshot : null;
  } catch {
    return null;
  }
}
