import { existsSync } from "node:fs";

import { canonicalOsmId } from "../../../lib/harvestFold.ts";

function requiredFile(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`missing ${label}: ${filePath}`);
  return filePath;
}

export function buildSeedMetadata(rows, filePath) {
  if (!Array.isArray(rows)) throw new Error(`malformed harvest seed in ${filePath}`);
  const metadata = new Map();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || typeof raw.osmId !== "string" || typeof raw.name !== "string") {
      throw new Error(`malformed harvest seed row in ${filePath}`);
    }
    const osmId = canonicalOsmId(raw.osmId);
    if (!osmId) throw new Error(`malformed harvest seed OSM id: ${raw.osmId}`);
    if (metadata.has(osmId)) throw new Error(`duplicate harvest seed OSM id: ${osmId}`);
    const tags = raw.addressTags;
    if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
      throw new Error(`harvest seed row has no addressTags: ${raw.osmId}`);
    }
    const town = [tags["addr:town"], tags["addr:city"], tags["addr:village"], tags["addr:place"]]
      .find((value) => typeof value === "string" && value.trim()) ?? null;
    metadata.set(osmId, { name: raw.name.trim(), town: town ? town.trim() : null });
  }
  return metadata;
}

export async function loadSeedMetadata(filePath, readJsonl) {
  return buildSeedMetadata(await readJsonl(requiredFile(filePath, "harvest seed")), filePath);
}
