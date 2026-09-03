import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateAreaNewsEntry, type AreaNewsDataset } from "@/lib/areaNews";
import { KNOWN_AREA_SLUGS, parseExtractedFact } from "../scripts/lib/keenableAreaNews.mjs";

export type AreaNewsLoadResult =
  | (AreaNewsDataset & { status: "ready" })
  | { status: "unavailable"; version: 1; generatedAt: ""; entries: [] };

let loadResult: AreaNewsLoadResult | null = null;

/** Read the committed dataset once and preserve read failure as a distinct state. */
export async function loadAreaNews(): Promise<AreaNewsLoadResult> {
  if (loadResult?.status === "ready") return loadResult;
  try {
    const file = path.join(process.cwd(), "data", "area_news.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<AreaNewsDataset>;
    if (
      typeof parsed.version !== "number" ||
      typeof parsed.generatedAt !== "string" ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.some((entry) => validateAreaNewsEntry(entry).length > 0)
    ) {
      throw new Error("Area news dataset shape is invalid.");
    }
    const now = Date.now();
    const nowDay = new Date(now);
    nowDay.setUTCHours(0, 0, 0, 0);
    const oldestAllowed = nowDay.getTime() - 21 * 24 * 60 * 60 * 1000;
    const currentYear = nowDay.getUTCFullYear();
    for (const entry of parsed.entries) {
      const observedAt = Date.parse(`${entry.observedAt}T00:00:00Z`);
      if (observedAt < oldestAllowed || observedAt > nowDay.getTime()) continue;
      if (!parseExtractedFact({ content: JSON.stringify(entry) }, {
        knownAreas: KNOWN_AREA_SLUGS,
        currentYear,
        now: nowDay.getTime(),
      })) {
        throw new Error("Area news dataset current fact is invalid.");
      }
    }
    const ready: AreaNewsLoadResult = {
      status: "ready",
      version: parsed.version,
      generatedAt: parsed.generatedAt,
      entries: parsed.entries,
    };
    loadResult = ready;
    return ready;
  } catch {
    return { status: "unavailable", version: 1, generatedAt: "", entries: [] };
  }
}

/** Test-only: drop the in-memory cache between cases. */
export function __resetAreaNewsCache(): void {
  loadResult = null;
}
