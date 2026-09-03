import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { publishStagedDirectory } from "../scripts/lib/atomicDirectoryPublish.mjs";

const roots: string[] = [];
const WHOLE_LAYER_BUDGET_BYTES = 5 * 1024 * 1024;

async function jsonFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(root, entry.name);
      if (entry.isDirectory()) return jsonFiles(filePath);
      return entry.name.endsWith(".json") ? [filePath] : [];
    }),
  );
  return nested.flat();
}

async function fixture(): Promise<{ target: string; staged: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "uk-base-publish-"));
  roots.push(root);
  const target = path.join(root, "uk_base");
  const staged = path.join(root, ".uk_base-stage");
  await fs.mkdir(target);
  await fs.mkdir(staged);
  await fs.writeFile(path.join(target, "README.md"), "hand written");
  const oldGeneration = "aaaaaaaaaaaaaaaa";
  const oldPack = path.join(target, "packs", oldGeneration);
  await fs.mkdir(oldPack, { recursive: true });
  await fs.writeFile(
    path.join(target, "manifest.json"),
    JSON.stringify({
      version: 1,
      shards: [
        {
          id: "old",
          core: false,
          url: `/data/uk_base/packs/${oldGeneration}/old.json`,
          count: 1,
          bbox: [-1, 53, 0, 54],
        },
      ],
    }),
  );
  await fs.writeFile(path.join(oldPack, "old.json"), "old shard");
  await fs.writeFile(path.join(target, "legacy.json"), "legacy shard");
  return { target, staged };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("publishStagedDirectory", () => {
  it("ships one committed generation inside the whole-layer budget", async () => {
    const packRoot = path.join(process.cwd(), "public", "data", "uk_base");
    const manifest = JSON.parse(
      await fs.readFile(path.join(packRoot, "manifest.json"), "utf8"),
    ) as { urlPrefix: string; shards: Array<Record<string, unknown>> };
    const generations = (
      await fs.readdir(path.join(packRoot, "packs"), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const files = await jsonFiles(packRoot);
    const totalBytes = (
      await Promise.all(files.map(async (file) => (await fs.stat(file)).size))
    ).reduce((total, bytes) => total + bytes, 0);

    expect(manifest).not.toHaveProperty("previousGenerations");
    expect(generations).toHaveLength(1);
    expect(manifest.urlPrefix).toBe(
      `/data/uk_base/packs/${generations[0]}/`,
    );
    expect(manifest.shards.every((shard) => !("url" in shard))).toBe(true);
    expect(files.filter((file) => path.dirname(file) === packRoot)).toEqual([
      path.join(packRoot, "manifest.json"),
      path.join(packRoot, "places.json"),
    ]);
    expect(totalBytes).toBeLessThan(WHOLE_LAYER_BUDGET_BYTES);
  });

  it("publishes a complete staged pack while preserving the handwritten README", async () => {
    const { target, staged } = await fixture();
    await fs.writeFile(
      path.join(staged, "manifest.json"),
      JSON.stringify({
        version: 1,
        urlPrefix: "/data/uk_base/",
        shards: [
          {
            id: "cell",
            core: false,
            count: 1,
            bbox: [-1, 53, 0, 54],
          },
        ],
      }),
    );
    await fs.writeFile(path.join(staged, "cell.json"), "new cell");

    await publishStagedDirectory({
      stagedDir: staged,
      targetDir: target,
      requiredFiles: ["manifest.json"],
    });

    expect(await fs.readFile(path.join(target, "README.md"), "utf8")).toBe("hand written");
    const manifest = JSON.parse(
      await fs.readFile(path.join(target, "manifest.json"), "utf8"),
    ) as {
      urlPrefix: string;
      shards: Array<{ id: string; url?: string }>;
    };
    expect(manifest.urlPrefix).toMatch(
      /^\/data\/uk_base\/packs\/[a-f0-9]{16}\/$/,
    );
    expect(manifest.shards[0]).not.toHaveProperty("url");
    expect(manifest).not.toHaveProperty("previousGenerations");
    expect(
      await fs.readFile(
        path.join(
          target,
          `${manifest.urlPrefix}${manifest.shards[0].id}.json`.replace(
            "/data/uk_base/",
            "",
          ),
        ),
        "utf8",
      ),
    ).toBe("new cell");
    const generations = await fs.readdir(path.join(target, "packs"));
    expect(generations).toEqual([
      manifest.urlPrefix.split("/")[4],
    ]);
    await expect(fs.access(path.join(target, "legacy.json"))).rejects.toThrow();
    await expect(fs.access(staged)).rejects.toThrow();
  });

  // The publisher used to hardcode /data/uk_base/, so a second sharded layer
  // could only publish through it by forking it or by lying about where its own
  // files live. The prefix is a parameter; its default is the pub layer's.
  it("publishes a second layer under its own URL prefix", async () => {
    const { target, staged } = await fixture();
    await fs.writeFile(
      path.join(staged, "manifest.json"),
      JSON.stringify({
        version: 1,
        urlPrefix: "/data/london_venues/",
        shards: [{ id: "cell", core: false, count: 1, bbox: [-1, 53, 0, 54] }],
      }),
    );
    await fs.writeFile(path.join(staged, "cell.json"), "new cell");

    await publishStagedDirectory({
      stagedDir: staged,
      targetDir: target,
      requiredFiles: ["manifest.json"],
      urlPrefix: "/data/london_venues/",
    });

    const manifest = JSON.parse(
      await fs.readFile(path.join(target, "manifest.json"), "utf8"),
    ) as { urlPrefix: string };
    expect(manifest.urlPrefix).toMatch(/^\/data\/london_venues\/packs\/[a-f0-9]{16}\/$/);
  });

  it("refuses a staged manifest claiming a prefix the caller did not name", async () => {
    const { target, staged } = await fixture();
    await fs.writeFile(
      path.join(staged, "manifest.json"),
      JSON.stringify({
        version: 1,
        urlPrefix: "/data/uk_base/",
        shards: [{ id: "cell", core: false, count: 1, bbox: [-1, 53, 0, 54] }],
      }),
    );
    await fs.writeFile(path.join(staged, "cell.json"), "new cell");

    await expect(
      publishStagedDirectory({
        stagedDir: staged,
        targetDir: target,
        requiredFiles: ["manifest.json"],
        urlPrefix: "/data/london_venues/",
      }),
    ).rejects.toThrow(/Invalid staged shard URL prefix/);
  });

  it("leaves the current pack untouched when the staged pack is incomplete", async () => {
    const { target, staged } = await fixture();

    await expect(
      publishStagedDirectory({
        stagedDir: staged,
        targetDir: target,
        requiredFiles: ["manifest.json"],
      }),
    ).rejects.toThrow();

    const manifest = JSON.parse(
      await fs.readFile(path.join(target, "manifest.json"), "utf8"),
    ) as { shards: Array<{ url: string }> };
    expect(manifest.shards[0].url).toBe(
      "/data/uk_base/packs/aaaaaaaaaaaaaaaa/old.json",
    );
    expect(
      await fs.readFile(
        path.join(target, "packs", "aaaaaaaaaaaaaaaa", "old.json"),
        "utf8",
      ),
    ).toBe("old shard");
    expect(await fs.readFile(path.join(target, "README.md"), "utf8")).toBe("hand written");
  });

  it("checks expanded final manifest bytes before publishing", async () => {
    const { target, staged } = await fixture();
    const stagedManifest = JSON.stringify({
      version: 1,
      shards: [
        {
          id: "cell",
          core: false,
          url: "/data/uk_base/cell.json",
          count: 1,
          bbox: [-1, 53, 0, 54],
        },
      ],
    });
    await fs.writeFile(path.join(staged, "manifest.json"), stagedManifest);
    await fs.writeFile(path.join(staged, "cell.json"), "new cell");

    await expect(
      publishStagedDirectory({
        stagedDir: staged,
        targetDir: target,
        requiredFiles: ["manifest.json"],
        manifestBudgetBytes: Buffer.byteLength(stagedManifest) + 1,
        totalBudgetBytes: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow("Published manifest");

    const manifest = JSON.parse(
      await fs.readFile(path.join(target, "manifest.json"), "utf8"),
    ) as { shards: Array<{ url: string }> };
    expect(manifest.shards[0].url).toBe(
      "/data/uk_base/packs/aaaaaaaaaaaaaaaa/old.json",
    );
  });
});
