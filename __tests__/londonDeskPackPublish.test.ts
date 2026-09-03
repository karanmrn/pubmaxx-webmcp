import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { publishStagedDirectory } from "../scripts/lib/atomicDirectoryPublish.mjs";
import { LONDON_VENUE_DIR_NAME } from "../scripts/build_london_venue_shards.mjs";
import { DESK_PACK_PATH } from "@/lib/nearDeskVenues";

// The desk pack is a published byte contract under public/data. Its own
// directory is the fence: the London venue shard publisher deletes every
// *.json in ITS root that is not manifest.json, so this runs the real
// publisher over a stand-in public/data and asks whether the pack survives.

const roots: string[] = [];

async function publicDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "london-desk-publish-"));
  roots.push(root);
  return root;
}

async function publishLondonVenues(dataRoot: string): Promise<void> {
  const target = path.join(dataRoot, LONDON_VENUE_DIR_NAME);
  const staged = path.join(dataRoot, `.${LONDON_VENUE_DIR_NAME}-stage`);
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(staged, { recursive: true });
  await fs.writeFile(
    path.join(staged, "manifest.json"),
    JSON.stringify({
      version: 1,
      urlPrefix: `/data/${LONDON_VENUE_DIR_NAME}/`,
      shards: [{ id: "cell", count: 1, bbox: [-1, 51, 0, 52] }],
    }),
  );
  await fs.writeFile(path.join(staged, "cell.json"), '{"venues":[]}');
  await publishStagedDirectory({
    stagedDir: staged,
    targetDir: target,
    requiredFiles: ["manifest.json"],
    urlPrefix: `/data/${LONDON_VENUE_DIR_NAME}/`,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("London desk pack location", () => {
  it("survives a London venue shard publish", async () => {
    const dataRoot = await publicDataRoot();
    const packPath = path.join(dataRoot, DESK_PACK_PATH.replace(/^\/data\//, ""));
    await fs.mkdir(path.dirname(packPath), { recursive: true });
    await fs.writeFile(packPath, '{"version":1,"venues":[]}');

    await publishLondonVenues(dataRoot);

    expect(await fs.readFile(packPath, "utf8")).toBe('{"version":1,"venues":[]}');
  });

  it("is deleted when it sits in the swept shard root", async () => {
    const dataRoot = await publicDataRoot();
    const sweptPath = path.join(dataRoot, LONDON_VENUE_DIR_NAME, "desks.json");
    await fs.mkdir(path.dirname(sweptPath), { recursive: true });
    await fs.writeFile(sweptPath, '{"version":1,"venues":[]}');

    await publishLondonVenues(dataRoot);

    await expect(fs.access(sweptPath)).rejects.toThrow();
  });

  it("ships the real pack where the reader asks for it", async () => {
    const shipped = path.join(process.cwd(), "public", DESK_PACK_PATH.replace(/^\//, ""));
    const body = JSON.parse(await fs.readFile(shipped, "utf8")) as { venues?: unknown };
    expect(Array.isArray(body.venues)).toBe(true);
  });
});
