import { promises as fs } from "fs";
import path from "path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUkBaseIdIndex, lookupUkBasePub, resetUkBaseIndexForTests } from "@/lib/ukBaseIndex";
import {
  UK_BASE_ID_PREFIX,
  parseUkBaseManifest,
  ukBaseIdFor,
} from "@/lib/ukBasePubs";

// The server-side membership index for `venue-uk-…` ids — the thing that lets
// /api/price-submit accept a real base pub without accepting a fabricated id
// on shape alone. Asserted against the committed shard pack, not fixtures, so
// a pack refresh that broke the decode would fail here first.

async function committedManifest() {
  const manifestRaw = await fs.readFile(
    path.join(process.cwd(), "public", "data", "uk_base", "manifest.json"),
    "utf8",
  );
  const manifest = parseUkBaseManifest(JSON.parse(manifestRaw));
  if (!manifest) throw new Error("Committed UK base manifest is malformed");
  return manifest;
}

async function firstCommittedOsmRef(): Promise<string> {
  const manifest = await committedManifest();
  const shardRaw = await fs.readFile(
    path.join(process.cwd(), "public", manifest.shards[0].url.replace(/^\//, "")),
    "utf8",
  );
  const shard = JSON.parse(shardRaw) as { pubs: Array<[string, ...unknown[]]> };
  return shard.pubs[0][0];
}

async function withMutatedFirstShard(
  mutate: (body: Record<string, unknown>) => void,
): Promise<Awaited<ReturnType<typeof getUkBaseIdIndex>>> {
  const manifestPath = path.join(
    process.cwd(),
    "public",
    "data",
    "uk_base",
    "manifest.json",
  );
  const manifest = parseUkBaseManifest(
    JSON.parse(await fs.readFile(manifestPath, "utf8")),
  );
  if (!manifest) throw new Error("Committed UK base manifest is malformed");
  const shardPath = path.join(
    process.cwd(),
    "public",
    manifest.shards[0].url.replace(/^\//, ""),
  );
  const realReadFile = fs.readFile.bind(fs);
  const readSpy = vi.spyOn(fs, "readFile").mockImplementation(
    async (...args: Parameters<typeof fs.readFile>) => {
      const raw = await realReadFile(...args);
      if (String(args[0]) !== shardPath || typeof raw !== "string") return raw;
      const body = JSON.parse(raw) as Record<string, unknown>;
      mutate(body);
      return JSON.stringify(body);
    },
  );

  try {
    return await getUkBaseIdIndex();
  } finally {
    readSpy.mockRestore();
  }
}

beforeEach(() => {
  resetUkBaseIndexForTests();
});

describe("getUkBaseIdIndex", () => {
  it("contains every committed base pub id, prefixed, and nothing malformed", async () => {
    const result = await getUkBaseIdIndex();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const index = result.ids;
    // The full pack has tens of thousands of pubs; a partial read collapses
    // well below this floor.
    expect(index.size).toBeGreaterThan(30_000);
    for (const id of index) {
      expect(id.startsWith(UK_BASE_ID_PREFIX)).toBe(true);
    }
  });

  it("answers has() for a real shard row's id", async () => {
    const osmRef = await firstCommittedOsmRef();
    const result = await getUkBaseIdIndex();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.ids.has(ukBaseIdFor(osmRef))).toBe(true);
  });

  it("rejects a well-formed id that no shard carries", async () => {
    const result = await getUkBaseIdIndex();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.ids.has(`${UK_BASE_ID_PREFIX}n0000000000`)).toBe(false);
  });

  it("memoizes: a second call returns the same ready result instance", async () => {
    const first = await getUkBaseIdIndex();
    const second = await getUkBaseIdIndex();
    expect(second).toBe(first);
  });

  it("reports unavailable instead of returning a partial authoritative index", async () => {
    const manifestPath = path.join(
      process.cwd(),
      "public",
      "data",
      "uk_base",
      "manifest.json",
    );
    const manifest = parseUkBaseManifest(
      JSON.parse(await fs.readFile(manifestPath, "utf8")),
    );
    if (!manifest) throw new Error("Committed UK base manifest is malformed");
    const failedPath = path.join(
      process.cwd(),
      "public",
      manifest.shards[0].url.replace(/^\//, ""),
    );
    const realReadFile = fs.readFile.bind(fs);
    const readSpy = vi.spyOn(fs, "readFile").mockImplementation(
      async (...args: Parameters<typeof fs.readFile>) => {
        if (String(args[0]) === failedPath) throw new Error("fixture shard unavailable");
        return realReadFile(...args);
      },
    );

    try {
      const result = await getUkBaseIdIndex();
      expect(result).toEqual({ status: "unavailable" });
    } finally {
      readSpy.mockRestore();
    }
  });

  it("reports unavailable when a shard version or cell disagrees with its manifest", async () => {
    expect(
      await withMutatedFirstShard((body) => {
        body.version = 999;
      }),
    ).toEqual({ status: "unavailable" });

    resetUkBaseIndexForTests();
    expect(
      await withMutatedFirstShard((body) => {
        body.cell = "wrong-cell";
      }),
    ).toEqual({ status: "unavailable" });
  });

  it("reports unavailable when a shard silently drops a malformed or missing row", async () => {
    expect(
      await withMutatedFirstShard((body) => {
        const pubs = body.pubs as unknown[];
        pubs[0] = ["n-broken", "", "", 51.5, -0.1];
      }),
    ).toEqual({ status: "unavailable" });

    resetUkBaseIndexForTests();
    expect(
      await withMutatedFirstShard((body) => {
        const pubs = body.pubs as unknown[];
        pubs.pop();
      }),
    ).toEqual({ status: "unavailable" });
  });
});

describe("lookupUkBasePub", () => {
  it("returns the full record for a committed shard row", async () => {
    const osmRef = await firstCommittedOsmRef();
    const result = await lookupUkBasePub(ukBaseIdFor(osmRef));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.pub.id).toBe(ukBaseIdFor(osmRef));
    expect(result.pub.name.length).toBeGreaterThan(0);
    expect(Number.isFinite(result.pub.lat)).toBe(true);
    expect(Number.isFinite(result.pub.lng)).toBe(true);
  });

  it("fails closed for a well-formed id the pack does not carry", async () => {
    expect(await lookupUkBasePub(`${UK_BASE_ID_PREFIX}n0000000000`)).toEqual({
      status: "missing",
    });
  });

  it("rejects a curated venue id without opening the pack as found", async () => {
    expect(await lookupUkBasePub("venue-7l4pei")).toEqual({ status: "missing" });
  });
});
